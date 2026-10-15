// v8 card repair: a corpus of realistic, sloppy card answers, the kind a
// small card writer gives (the first live runs' among them, reconstructed
// from their events), each read as the room reads it: parseObject, then
// prepareCard (repairCard, validateCard, behaviourGaps). Every answer must
// validate after repair, with sensible deliverables, and each page, command
// and function deliverable must have a check that exercises it, or a retry
// error that asks for one. Then the vetting the live run got wrong, with a
// scripted Clef, and an amendment that must not rewrite what it is not about.
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCard, repairCard, validateCard, cardUsable, applyVetting, vettable, existenceOnly, VET_DROP_BAR } from '../src/card.js';
import { vetRequirements, vetAmendChanges } from '../src/model.js';
import { mergeAmendment, cardDelta, revalidate, keepDeliverables, effectiveGoal } from '../src/amend.js';
import { parseObject } from '../src/protocol.js';
import { kindOf } from '../src/contracts.js';
import { TOOLCHAINS } from '../src/toolchains.js';
import { CLEF } from '../src/prompts.js';

const json = o => JSON.stringify(o);
const cmd = (run, out) => ({kind: 'command', run, expect: {exit: 0, ...(out ? {stdout_has: [out]} : {})}});
const BEHAVIOUR_ERROR = /^deliverable "([^"]+)" is a (page|command|function) and no check (uses|runs|calls) it: add a requirement serving/;
const EXERCISES = {page: ['browser', 'http'], command: ['command', 'http', 'browser'], function: ['call', 'command', 'http', 'browser']};

// Each case: a goal, the writer's answer as text, the deliverables expected
// after repair ([name, kind, path]), and, when the answer leaves a page,
// command or function unchecked, the deliverable the retry error names.
const CORPUS = [
  // ---------------------------------------------------------------- live A: a Python CLI
  {name: 'live A: a command named with an underscore and no path', goal: 'A Python CLI that converts temperatures.',
    answer: json({card: 1, summary: 'A temperature converter', languages: ['python'], deliverables: [{name: 'convert_temp', kind: 'command', does: 'converts a temperature between Celsius and Fahrenheit'}],
      requirements: [{id: 'R1', says: 'Converting 100 C prints 212 F', source: 'converts temperatures', serves: ['convert_temp'], check: cmd('convert_temp 100 C', '212')},
        {id: 'R2', says: 'Converting 32 F prints 0 C', source: 'converts temperatures', serves: ['convert_temp'], check: cmd('convert_temp 32 F', '0')}]}),
    deliverables: [['convert_temp', 'command', 'convert_temp.py']]},
  {name: 'Python CLI: a capitalised command served by its file path', goal: 'A Python CLI that converts temperatures.',
    answer: json({card: 1, summary: 'converter', languages: ['python'], deliverables: [{name: 'Convert-Temp', kind: 'command', path: './convert_temp.py'}],
      requirements: [{id: 'R1', says: 'Converting 100 C prints 212', source: 'converts temperatures', serves: ['convert_temp.py'], check: cmd('Convert-Temp 100 C', '212')}]}),
    deliverables: [['convert-temp', 'command', 'convert_temp.py']],
    check: out => assert.equal(out.card.requirements[0].check.run, 'convert-temp 100 C', 'the check runs the renamed command')},
  {name: 'Python CLI: a script listed as a function, run by the interpreter', goal: 'A Python CLI that converts temperatures.',
    answer: json({card: 1, summary: 'converter', languages: ['python'], deliverables: [{name: 'convert_temp.py', kind: 'function', does: 'the CLI'}],
      requirements: [{id: 'R1', says: 'Converting 100 C prints 212', source: 'converts temperatures', serves: ['convert_temp.py'], check: cmd('python3 convert_temp.py 100 C', '212')}]}),
    deliverables: [['convert_temp', 'command', 'convert_temp.py']]},
  {name: 'Python CLI: module:function, module.function and a reserved command name', goal: 'A Python command-line tool that converts temperatures between Celsius and Fahrenheit.',
    answer: json({card: 1, summary: 'converter', languages: ['python'], deliverables: [
      {name: 'python', kind: 'command', path: 'convert.py', does: 'the command line'},
      {name: 'converter.py:to_celsius', does: 'Fahrenheit to Celsius'},
      {name: 'converter.to_fahrenheit', kind: 'function', does: 'Celsius to Fahrenheit'}],
    requirements: [{id: 'R1', says: 'convert 100 C prints 212', source: 'converts temperatures between Celsius and Fahrenheit', serves: ['python'], check: cmd('python3 convert.py 100 C', '212')},
      {id: 'R2', says: 'to_celsius(212) is 100', source: 'converts temperatures', serves: ['converter.py:to_celsius'], check: {kind: 'call', steps: [{call: 'converter.to_celsius', args: [212], expect: 100}]}},
      {id: 'R3', says: 'to_fahrenheit(0) is 32', source: 'converts temperatures', serves: ['to_fahrenheit'], check: {kind: 'call', steps: [{function: 'to_fahrenheit', args: [0], expected: 32}]}}]}),
    deliverables: [['convert', 'command', 'convert.py'], ['to_celsius', 'function', 'converter.py'], ['to_fahrenheit', 'function', null]]},
  {name: 'Python CLI: a check given as a command line, ids as numbers, the summary missing', goal: 'A small Python CLI that counts the words in a file.',
    answer: json({card: 1, languages: 'python, text', deliverables: [{name: 'wordcount', kind: 'cli', path: 'wordcount.py'}],
      requirements: [{id: 1, says: 'Counting a two-word file prints 2', source: 'counts the words in a file', serves: 'wordcount', check: 'wordcount sample.txt'}]}),
    deliverables: [['wordcount', 'command', 'wordcount.py']],
    check: out => { assert.equal(out.card.requirements[0].id, 'R1'); assert.match(out.card.summary, /counts the words/); }},

  // ---------------------------------------------------------------- the issue tracker, three ways
  {name: 'live B: an issue tracker web server listed as a function', goal: 'Build a small issue tracker that lets someone create, view, update, and delete tickets.',
    answer: json({card: 1, summary: 'An issue tracker server', languages: ['javascript'], deliverables: [{name: 'server.js', kind: 'function', does: 'serves the tracker API'}],
      run: [{id: 'api', run: 'node server.js', port: true, ready: '/tickets'}],
      requirements: [{id: 'R1', says: 'Creating a ticket answers 201', source: 'create tickets', serves: ['server.js'], check: {kind: 'http', serve: 'api', steps: [{method: 'POST', path: '/tickets', body: {title: 'Bug'}, expect: {status: 201}}]}},
        {id: 'R2', says: 'A created ticket can be viewed', source: 'view tickets', serves: ['server.js'], check: {kind: 'http', serve: 'api', steps: [{method: 'POST', path: '/tickets', body: {title: 'Bug'}, save: 't'}, {method: 'GET', path: '/tickets', expect: {status: 200, body_has: ['Bug']}}]}}]}),
    deliverables: [['server.js', 'file', 'server.js']]},
  {name: 'issue tracker as a CLI: case slips, a missing path and no languages', goal: 'Build a small issue tracker that lets someone create, view, update, and delete tickets from the command line, in Python.',
    answer: json({card: 1, summary: 'A ticket command', deliverables: [{name: 'Tickets', kind: 'command', does: 'manages tickets'}, {name: 'tickets.json', does: 'where tickets are kept'}],
      requirements: [{id: 'R1', says: 'Adding a ticket prints its id', source: 'create tickets', serves: ['TICKETS'], check: cmd('tickets add "Fix login"', '1')},
        {id: 'R2', says: 'Listing shows an added ticket', source: 'view tickets', serves: ['tickets'], check: cmd('tickets list')},
        {id: 'R3', says: 'Deleting a ticket removes it', source: 'delete tickets', serves: ['Tickets'], check: cmd('tickets delete 1')}]}),
    deliverables: [['tickets', 'command', 'tickets.py'], ['tickets.json', 'data', 'tickets.json']],
    check: out => assert.ok(out.card.languages.includes('python'), 'the goal names the language')},
  {name: 'issue tracker as a library: functions by module path, serves by a shared file', goal: 'Write a JavaScript library for a small issue tracker: create, view, update and delete tickets.',
    answer: json({card: 1, summary: 'A ticket library', languages: ['javascript'], deliverables: [
      {name: 'tickets.createTicket', does: 'creates a ticket'}, {name: 'tickets.js:getTicket', does: 'reads a ticket'},
      {name: 'update-ticket', kind: 'function', path: 'tickets.js'}, {name: 'deleteTicket', kind: 'function', path: 'tickets.js'}],
    requirements: [
      {id: 'R1', says: 'A created ticket can be read back', source: 'create, view', serves: ['tickets.js'], check: {kind: 'call', steps: [{call: 'tickets.createTicket', args: [{title: 'a'}], save: 't'}, {call: 'getTicket', args: ['$t.id'], expect_has: 'a'}]}},
      {id: 'R2', says: 'Updating changes the title', source: 'update tickets', serves: ['updateTicket'], check: {kind: 'call', steps: [{call: 'createTicket', args: [{title: 'a'}], save: 't'}, {call: 'updateTicket', args: ['$t.id', {title: 'b'}], expect_has: 'b'}]}},
      {id: 'R3', says: 'Deleting removes the ticket', source: 'delete tickets', serves: ['deleteTicket()'], check: {kind: 'call', steps: [{call: 'createTicket', args: [{title: 'a'}], save: 't'}, {call: 'deleteTicket', args: ['$t.id']}, {call: 'getTicket', args: ['$t.id'], expect: null}]}}]}),
    deliverables: [['createTicket', 'function', 'tickets.js'], ['getTicket', 'function', null], ['updateTicket', 'function', null], ['deleteTicket', 'function', null]],
    check: out => assert.deepEqual(out.card.requirements[0].serves, ['createTicket', 'getTicket'], 'an ambiguous path serves what the call check names')},
  {name: 'issue tracker web server: lowercase routes, a run without an id, a serve by another name', goal: 'Build a small issue tracker web server where someone can create and list tickets over HTTP.',
    answer: json({card: 1, summary: 'A ticket API', languages: ['javascript'], deliverables: [
      {name: 'post /tickets', kind: 'route', does: 'creates a ticket'}, {name: 'get /tickets', kind: 'route', does: 'lists tickets'}, {name: 'app', kind: 'command', path: 'app.js', does: 'starts the server'}],
    run: [{run: 'app --port {port}', port: true}],
    requirements: [{id: 'R1', says: 'A created ticket is listed', source: 'create and list tickets', serves: ['POST /tickets', 'GET /tickets'], check: {kind: 'http', serve: 'server', steps: [{method: 'post', path: '/tickets', body: {title: 'x'}, expect: {status: 201}}, {method: 'get', url: '/tickets', expect: {body_has: ['x']}}]}}]}),
    deliverables: [['POST /tickets', 'route', null], ['GET /tickets', 'route', null], ['app', 'command', 'app.js']],
    check: out => { assert.deepEqual(out.card.run.map(r => r.id), ['app']); assert.equal(out.card.requirements[0].check.serve, 'app'); }},

  // ---------------------------------------------------------------- documents
  {name: 'a README on a base repo: no path, and only "it exists"', goal: 'Add a README to this repository that explains how to install and run the tool.', base: ['tool.py', 'LICENSE'],
    answer: json({card: 1, summary: 'A README', languages: ['text'], deliverables: [{name: 'README', kind: 'doc', does: 'explains installing and running the tool'}],
      requirements: [{id: 'R1', says: 'README.md exists', source: 'Add a README', serves: ['README'], check: {kind: 'file', path: 'README.md'}}]}),
    deliverables: [['README.md', 'doc', 'README.md']],
    check: out => {
      const judge = out.card.requirements.find(r => r.inferred);
      assert.equal(judge.check.kind, 'judge');
      assert.match(judge.check.question, /^Does README\.md do what the goal asks: Add a README to this repository that explains how to install and run the tool\?$/);
      assert.ok(!judge.untraced, 'its source is the goal sentence it quotes');
    }},
  {name: 'a markdown-only goal: a kind in other words and a missing path', goal: 'Write a short guide on brewing pour-over coffee at home.',
    answer: '```json\n' + json({card: 1, summary: 'A brewing guide', deliverables: [{name: 'brewing guide', kind: 'document', does: 'how to brew pour-over coffee'}],
      requirements: [{says: 'The guide lists the equipment needed', serves: ['brewing guide'], check: {kind: 'review', path: 'brewing-guide.md', question: 'Does it list the equipment needed?'}}]}) + '\n```',
    deliverables: [['brewing-guide.md', 'doc', 'brewing-guide.md']],
    check: out => { assert.equal(out.card.requirements[0].source_inferred, true); assert.equal(out.card.requirements[0].source, 'Write a short guide on brewing pour-over coffee at home.'); }},
  {name: 'a document whose requirement has no serves and only finds the file', goal: 'Document the release process for the team.',
    answer: json({card: 1, summary: 'Release notes', languages: ['markdown'], deliverables: [{name: 'docs/RELEASING.md', kind: 'doc', path: 'docs/RELEASING.md'}],
      requirements: [{id: 'R1', says: 'The release process is documented', source: 'Document the release process', check: {kind: 'file', path: 'docs/releasing.md'}}]}),
    deliverables: [['docs/RELEASING.md', 'doc', 'docs/RELEASING.md']],
    check: out => { assert.deepEqual(out.card.requirements[0].serves, ['docs/RELEASING.md']); assert.equal(out.card.requirements[0].check.path, 'docs/RELEASING.md'); assert.ok(out.card.requirements.some(r => r.inferred && r.check.kind === 'judge')); }},

  // ---------------------------------------------------------------- live C: a static page
  {name: 'live C: a to-do page whose requirements have no source and only read files', goal: 'A static web page with a to-do list.',
    answer: json({card: 1, summary: 'A to-do page', languages: ['html', 'css', 'javascript'], deliverables: [
      {name: 'index.html', kind: 'page', path: 'index.html', does: 'the to-do page'}, {name: 'style.css', kind: 'file', path: 'style.css'},
      {name: 'script.js', kind: 'file', path: 'script.js', examples: [{given: 'add "milk"', expect: 'milk is listed'}]}],
    requirements: [{id: 'R1', says: 'The page contains a to-do list structure', source: '', serves: ['index.html'], check: {kind: 'file', path: 'index.html', has: ['<ul']}},
      {id: 'R2', says: 'The page includes CSS styling', source: '', serves: ['style.css'], check: {kind: 'file', path: 'style.css'}},
      {id: 'R3', says: 'The page has JavaScript for task management', source: '', serves: ['script.js'], check: {kind: 'file', path: 'script.js', has: ['addEventListener']}}]}),
    deliverables: [['index.html', 'page', 'index.html'], ['style.css', 'file', 'style.css'], ['script.js', 'file', 'script.js']], retry: 'index.html',
    check: out => assert.ok(out.card.requirements.filter(r => !r.implicit).every(r => r.source === 'A static web page with a to-do list.' && r.source_inferred && !r.untraced))},
  {name: 'a to-do page: a browser check and no run', goal: 'A static web page with a to-do list where I can add and remove items.',
    answer: json({card: 1, summary: 'A to-do page', languages: ['text'], deliverables: [{name: 'index.html', kind: 'page', path: 'index.html'}],
      requirements: [{id: 'R1', says: 'Adding an item shows it', source: 'add and remove items', serves: ['index'], check: {kind: 'browser', serve: 'site', steps: [{goto: '/'}, {fill: {placeholder: 'New item', text: 'milk'}}, {press: 'Enter'}, {expect_text: 'milk'}]}}]}),
    deliverables: [['index.html', 'page', 'index.html']],
    check: out => assert.deepEqual(out.card.run, [{id: 'site', static: true}])},
  {name: 'a page served under a run id the writer misspelt, serves in capitals', goal: 'A single web page that shows a countdown to a date the visitor picks.',
    answer: json({card: 1, summary: 'A countdown page', languages: ['text', 'js'], deliverables: [{name: 'countdown.html', kind: 'page'}, {name: 'countdown.js', path: 'countdown.js'}],
      run: [{id: 'site', static: 'true'}],
      requirements: [{id: 'R1', says: 'Picking a date shows the days left', source: 'shows a countdown to a date the visitor picks', serves: ['COUNTDOWN.HTML'], check: {kind: 'browser', serve: 'web', steps: [{goto: '/countdown.html'}, {fill: {label: 'Date', text: '2099-01-01'}}, {expect_text: 'days'}]}}]}),
    deliverables: [['countdown.html', 'page', 'countdown.html'], ['countdown.js', 'file', 'countdown.js']]},
  {name: 'a page with only existence checks: a clear retry error', goal: 'A web page that converts between metres and feet as you type.',
    answer: json({card: 1, summary: 'A unit page', languages: ['text'], deliverables: [{name: 'index.html', kind: 'page', path: 'index.html'}],
      requirements: [{id: 'R1', says: 'index.html exists', source: 'A web page', serves: ['index.html'], check: {kind: 'file', path: 'index.html'}}]}),
    deliverables: [['index.html', 'page', 'index.html']], retry: 'index.html'},
  {name: 'a page whose check is wrapped in a list, with the kind missing', goal: 'A web page with a button that shows a random quote.',
    answer: json({card: 1, summary: 'A quote page', languages: ['text'], deliverables: [{name: 'quotes.html', does: 'shows a random quote'}], run: 'static',
      requirements: [{id: 'R1', says: 'Clicking the button shows a quote', source: 'a button that shows a random quote', serves: ['quotes.html'], check: [{steps: [{goto: '/quotes.html'}, {click: {role: 'button', name: 'New quote'}}, {expect_count: {role: 'blockquote', n: 1}}]}]}]}),
    deliverables: [['quotes.html', 'page', 'quotes.html']],
    check: out => { assert.equal(out.card.requirements[0].check.kind, 'browser'); assert.equal(out.card.run[0].static, true); }},

  // ---------------------------------------------------------------- an HTTP API
  {name: 'an HTTP API: a server command, routes, requirements keyed by id', goal: 'An HTTP API in JavaScript that stores notes and returns them as JSON.',
    answer: 'Here is the project card:\n' + json({card: 1, summary: 'A notes API', languages: ['javascript'], deliverables: [
      {name: 'serve-notes', kind: 'command', path: 'server.js'}, {name: 'POST /notes', kind: 'route'}, {name: 'GET /notes', kind: 'route'}],
    run: [{id: 'api', run: 'serve-notes {port}', port: true, ready: '/notes'}],
    requirements: {R1: {says: 'A stored note is returned as JSON', source: 'stores notes and returns them as JSON', serves: ['POST /notes', 'GET /notes'], check: {kind: 'http', serve: 'api', steps: [{method: 'POST', path: '/notes', body: {text: 'hi'}}, {method: 'GET', path: '/notes', expect: {json_has: [{text: 'hi'}]}}]}}}}) + '\nLet me know if you want changes.',
    deliverables: [['serve-notes', 'command', 'server.js'], ['POST /notes', 'route', null], ['GET /notes', 'route', null]]},
  {name: 'an HTTP API: a server file with no kind and a requirement with no serves', goal: 'A Python HTTP API that returns the current time.',
    answer: json({card: 1, summary: 'A time API', languages: ['python'], deliverables: [{name: 'api.py', does: 'the server'}],
      run: [{id: 'api', run: 'python3 api.py {port}', port: true}],
      requirements: [{id: 'R1', says: 'GET /time answers 200', source: 'returns the current time', check: {kind: 'http', serve: 'api', steps: [{method: 'GET', path: '/time', expect: {status: 200}}]}}]}),
    deliverables: [['api.py', 'file', 'api.py']],
    check: out => assert.deepEqual(out.card.requirements[0].serves, ['api.py'], 'its run\'s file')},

  // ---------------------------------------------------------------- a Python library
  {name: 'a Python library: dotted names, a hyphenated name, sources missing', goal: 'A small Python library with functions to slugify text and to parse dates in day/month/year form.',
    answer: json({card: 1, summary: 'Text helpers', languages: ['python'], deliverables: [
      {name: 'textutils.slugify', does: 'turns text into a slug', examples: [{given: ['Hello World'], expect: 'hello-world'}]}, {name: 'parse-date', kind: 'function', path: 'textutils.py'}],
    requirements: [{id: 'R1', says: 'slugify lowercases and joins words with hyphens', serves: ['slugify'], check: {kind: 'call', steps: [{call: 'slugify', args: ['A B'], expect: 'a-b'}]}},
      {id: 'R2', says: 'parse_date reads 31/12/2024', serves: ['parse-date'], check: {kind: 'call', steps: [{call: 'parse_date', args: ['31/12/2024'], expect_has: '2024'}]}}]}),
    deliverables: [['slugify', 'function', 'textutils.py'], ['parse_date', 'function', null]],
    check: out => assert.ok(out.card.requirements.filter(r => !r.implicit).every(r => r.source_inferred && !r.untraced))},
  {name: 'a Python library: a function with no check and no example: a clear retry error', goal: 'A Python library that computes the mean and the median of a list of numbers.',
    answer: json({card: 1, summary: 'Statistics', languages: ['python'], deliverables: [{name: 'mean', path: 'stats.py'}, {name: 'median', path: 'stats.py'}],
      requirements: [{id: 'R1', says: 'mean([1,2,3]) is 2', source: 'computes the mean', serves: ['mean'], check: {kind: 'call', steps: [{call: 'mean', args: [[1, 2, 3]], expect: 2}]}}]}),
    deliverables: [['mean', 'function', 'stats.py'], ['median', 'function', null]], retry: 'median'},
  {name: 'a library whose functions have no paths and no languages', goal: 'Write a JavaScript module that formats durations like 1h 5m.',
    answer: json({card: 1, summary: 'Duration formatting', deliverables: [{name: 'formatDuration', kind: 'function', examples: [{given: [3900], expect: '1h 5m'}]}],
      requirements: [{id: 'R1', says: 'formatDuration(60) is 1m', source: 'formats durations', serves: ['formatDuration'], check: {kind: 'call', steps: [{call: 'formatDuration', args: [60], expect: '1m'}]}}]}),
    deliverables: [['formatDuration', 'function', null]],
    check: out => assert.ok(out.card.languages.includes('javascript'))},

  // ---------------------------------------------------------------- a script with a config file
  {name: 'a script with a config file: kinds in other words, a check run through the interpreter', goal: 'A Python script that backs up a folder to a destination named in a YAML config file.',
    answer: json({card: 1, summary: 'A backup script', languages: ['python', 'yaml'], deliverables: [
      {name: 'backup.py', kind: 'script', does: 'copies the folder'}, {name: 'config.yaml', kind: 'config', does: 'names the source and destination'}],
    requirements: [{id: 'R1', says: 'Running with the config copies the files', source: 'backs up a folder to a destination', serves: ['backup'], check: {kind: 'cli', command: ['python3', 'backup.py', '--config', 'config.yaml'], expect: {exit_code: 0}}},
      {id: 'R2', says: 'The config names a destination', source: 'a destination named in a YAML config file', serves: ['config'], check: {kind: 'file', path: 'config.yaml', contains: 'destination'}}]}),
    deliverables: [['backup', 'command', 'backup.py'], ['config.yaml', 'data', 'config.yaml']],
    check: out => assert.deepEqual(out.card.requirements[0].check.argv, ['python3', 'backup.py', '--config', 'config.yaml'])},
  {name: 'a script with a config file: the config named as a function', goal: 'A Node script that sends a reminder at the times listed in reminders.json.',
    answer: json({card: 1, summary: 'Reminders', languages: ['javascript'], deliverables: [{name: 'remind', kind: 'command', path: 'remind.js'}, {name: 'reminders.json', kind: 'function'}],
      requirements: [{id: 'R1', says: 'It prints the next reminder', source: 'sends a reminder at the times listed', serves: ['remind'], check: {kind: 'command', run: 'remind --dry-run', files: {'fixture.json': '[]'}, expect: {stdout_has: ['next']}}}]}),
    deliverables: [['remind', 'command', 'remind.js'], ['reminders.json', 'data', 'reminders.json']]},

  // ---------------------------------------------------------------- shapes of the answer
  {name: 'the card wrapped in another object, with prose before it', goal: 'A Python CLI that prints the weather forecast stored in a local file.',
    answer: 'Sure! ' + json({project_card: {card: 1, summary: 'Forecast printer', languages: ['python'], deliverables: [{name: 'forecast', kind: 'command', path: 'forecast.py'}],
      requirements: [{id: 'R1', says: 'It prints the forecast', source: 'prints the weather forecast', serves: ['forecast'], check: cmd('forecast', 'forecast')}]}}),
    deliverables: [['forecast', 'command', 'forecast.py']]},
  {name: 'deliverables keyed by name, the says under another field', goal: 'A command that rolls dice written like 2d6 and prints the total.',
    answer: json({card: 1, summary: 'Dice', languages: ['python'], deliverables: {roll: {kind: 'command', path: 'roll.py'}},
      requirements: [{id: 'R1', description: 'Rolling 1d1 prints 1', source: 'rolls dice written like 2d6 and prints the total', serves: ['roll'], check: cmd('roll 1d1', '1')}]}),
    deliverables: [['roll', 'command', 'roll.py']]},
  {name: 'serves under "deliverable", a check written in the requirement\'s own fields', goal: 'A Python CLI that reverses each line of its input.',
    answer: json({card: 1, summary: 'Reverser', languages: ['python'], deliverables: [{name: 'rev', kind: 'command', path: 'rev.py'}],
      requirements: [{id: 'R1', says: 'abc becomes cba', source: 'reverses each line of its input', deliverable: 'rev', kind: 'command', run: 'rev', stdin: 'abc\n', expect: {stdout: 'cba\n'}}]}),
    deliverables: [['rev', 'command', 'rev.py']]},
  {name: 'flags only the runtime sets are dropped from a writer\'s answer', goal: 'A Python CLI that prints a greeting.',
    answer: json({card: 1, summary: 'Greeter', languages: ['python'], deliverables: [{name: 'greet', kind: 'command', path: 'greet.py'}],
      requirements: [{id: 'R1', says: 'It greets', source: 'the moon landing', serves: ['greet'], check: cmd('greet', 'Hello'), implicit: true, inferred: true, source_inferred: true}]}),
    deliverables: [['greet', 'command', 'greet.py']],
    check: out => { const r = out.card.requirements[0]; assert.ok(!r.implicit && !r.inferred && !r.source_inferred); assert.equal(r.untraced, true); assert.ok(vettable(out.card).includes(r), 'Clef still vets it'); }},
  {name: 'a command with no check that runs it: a clear retry error', goal: 'A Python CLI that renames photos by the date they were taken.',
    answer: json({card: 1, summary: 'Photo renamer', languages: ['python'], deliverables: [{name: 'rename_photos', kind: 'command'}, {name: 'USAGE.md', kind: 'doc'}],
      requirements: [{id: 'R1', says: 'The usage is documented', source: 'renames photos by the date', serves: ['USAGE.md'], check: {kind: 'judge', path: 'USAGE.md', question: 'Does it explain how to rename photos by date?'}}]}),
    deliverables: [['rename_photos', 'command', 'rename_photos.py'], ['USAGE.md', 'doc', 'USAGE.md']], retry: 'rename_photos'},
  {name: 'a call step under "function" with "expected", and serves by stem', goal: 'A Python function that tells whether a year is a leap year.',
    answer: json({card: 1, summary: 'Leap years', languages: ['python'], deliverables: [{name: 'is_leap', path: 'leap.py'}],
      requirements: [{id: 'R1', says: '2000 is a leap year', source: 'tells whether a year is a leap year', serves: ['leap'], check: {kind: 'call', function: 'is_leap', args: [2000], expected: true}}]}),
    deliverables: [['is_leap', 'function', 'leap.py']],
    check: out => assert.deepEqual(out.card.requirements[0].check.steps, [{call: 'is_leap', args: [2000], expect: true}])},
  {name: 'a runtime directory and a hidden path are still refused, the rest kept', goal: 'A Python CLI that prints the date.',
    answer: json({card: 1, summary: 'Date', languages: ['python'], deliverables: [{name: 'today', kind: 'command', path: 'today.py'}, {name: 'components/notes.md', kind: 'doc'}],
      requirements: [{id: 'R1', says: 'It prints a date', source: 'prints the date', serves: ['today'], check: cmd('today', '20')}]}),
    deliverables: [['today', 'command', 'today.py']], errors: [/cannot be placed at components\/notes\.md/]},
  {name: 'a deliverable named in prose with no kind: the retry is told to give its kind', goal: 'A Python CLI that prints a joke, and a getting-started guide.',
    answer: json({card: 1, summary: 'Jokes', languages: ['python'], deliverables: [{name: 'joke', kind: 'command', path: 'joke.py'}, {name: 'Getting Started Guide', does: 'how to start'}],
      requirements: [{id: 'R1', says: 'It prints a joke', source: 'prints a joke', serves: ['joke'], check: cmd('joke')}]}),
    deliverables: [['joke', 'command', 'joke.py']], errors: [/"Getting Started Guide" is not a valid python function name; it has no kind, so it reads as a function: give it its kind \(one of function, file, page, route, command, doc, data\)/]},
  {name: 'a check path written with ./ and a different case', goal: 'A guide that explains how to set up the development environment.',
    answer: json({card: 1, summary: 'Setup guide', languages: ['text'], deliverables: [{name: 'SETUP.md', kind: 'doc', path: 'SETUP.md'}],
      requirements: [{id: 'R1', says: 'It explains the setup', source: 'explains how to set up the development environment', serves: ['./setup.md'], check: {kind: 'judge', path: './Setup.md', question: 'Does it explain how to set up the development environment?'}}]}),
    deliverables: [['SETUP.md', 'doc', 'SETUP.md']]}
];

test('the corpus holds at least 30 answers, among them the three live failures', () => {
  assert.ok(CORPUS.length >= 30, String(CORPUS.length));
  assert.equal(CORPUS.filter(c => /^live [ABC]:/.test(c.name)).length, 3);
});

for (const c of CORPUS) test(`corpus: ${c.name}`, () => {
  const parsed = parseObject(c.answer);
  assert.ok(!parsed.parse_error, 'the answer parses');
  const out = prepareCard(parsed, {goal: c.goal, installed: TOOLCHAINS, base: c.base || []});
  const behaviour = out.errors.filter(e => BEHAVIOUR_ERROR.test(e)), other = out.errors.filter(e => !BEHAVIOUR_ERROR.test(e));
  if (c.errors) { assert.equal(other.length, c.errors.length, other.join('\n')); c.errors.forEach((re, i) => assert.match(other[i], re)); }
  else assert.deepEqual(other, [], 'nothing but a missing behavioural check is left for the retry');
  assert.deepEqual(out.unsupported, []);
  assert.ok(cardUsable(out.card), 'the card can start');
  assert.deepEqual(out.card.deliverables.map(d => [d.name, kindOf(d), d.path ?? null]), c.deliverables);
  // Each page, command and function is exercised by a check, or the retry error names it.
  const asked = behaviour.map(e => BEHAVIOUR_ERROR.exec(e)[1]);
  for (const d of out.card.deliverables.filter(d => EXERCISES[kindOf(d)])) {
    // A command a run starts is exercised by the http and browser checks on that run.
    const started = r => kindOf(d) === 'command' && ['http', 'browser'].includes(r.check.kind) && out.card.run.find(x => x.id === r.check.serve)?.argv?.[0] === d.name;
    const exercised = out.card.requirements.some(r => r.serves.includes(d.name) && EXERCISES[kindOf(d)].includes(r.check.kind) || started(r));
    assert.ok(exercised !== asked.includes(d.name), `${d.name}: exercised ${exercised}, asked ${asked.includes(d.name)}`);
  }
  assert.deepEqual(asked, c.retry ? [c.retry] : []);
  // Every requirement serves a deliverable and quotes a source; a repair that changed something said so.
  for (const r of out.card.requirements.filter(r => !r.implicit && !r.project)) {
    assert.ok(r.serves.length && r.serves.every(s => out.card.deliverables.some(d => d.name === s)), r.id);
    assert.ok(r.source, `${r.id} has a source`);
  }
  // The repaired card is a fixed point: validating the draft a retry is shown again changes nothing but the runtime's marks.
  const marks = card => ({...card, requirements: card.requirements.map(({source_inferred: _s, inferred: _i, untraced: _u, ...r}) => r)});
  assert.deepEqual(marks(validateCard(out.draft, {goal: c.goal, base: c.base || []}).card), marks(out.card));
  c.check?.(out);
});

test('repairs never admit a check the validator refuses: argv only, the denylist, paths and URLs', () => {
  const goal = 'A Python CLI that prints the date.';
  const base = {card: 1, summary: 'x', languages: ['python'], deliverables: [{name: 'today', kind: 'command', path: 'today.py'}]};
  const req = check => ({id: 'R1', says: 'It prints a date', source: 'prints the date', serves: ['today'], check});
  const errorsOf = check => prepareCard({...base, requirements: [req(check), req(cmd('today', '20'))].map((r, i) => ({...r, id: `R${i + 1}`}))}, {goal}).errors.join('\n');
  assert.match(errorsOf('today; rm -rf /'), /shell syntax/);
  assert.match(errorsOf({kind: 'cli', command: ['sh', '-c', 'echo hi']}), /runs "sh", which is neither/);
  assert.match(errorsOf({kind: 'command', run: ['python3', '-c', 'print(1)']}), /runs code given inline/);
  assert.match(errorsOf({kind: 'command', run: 'python3 -m pip install requests'}), /fetches packages|installs packages/);
  assert.match(errorsOf({kind: 'file', path: '../etc/passwd'}), /neither a deliverable's path nor an existing file/);
  assert.match(errorsOf({kind: 'command', run: 'today', files: {'today.py': 'x'}}), /would replace the deliverable/);
  const page = {card: 1, summary: 'x', languages: ['text'], deliverables: [{name: 'index.html', kind: 'page', path: 'index.html'}],
    requirements: [{id: 'R1', says: 'It loads', source: 'prints the date', serves: ['index.html'], check: {kind: 'browser', serve: 'site', steps: [{goto: '//evil.example/'}]}}]};
  assert.match(prepareCard(page, {goal}).errors.join('\n'), /must start with a single "\/"/);
  // A command named as a system program is renamed after its file, never kept; with no file to name it after, it stays an error.
  assert.equal(prepareCard({...base, deliverables: [{name: 'bash', kind: 'command', path: 'today.py'}], requirements: [req(cmd('today', '20'))]}, {goal}).card.deliverables[0].name, 'today');
  assert.match(prepareCard({...base, deliverables: [{name: 'curl', kind: 'command', path: 'curl.py'}], requirements: [req(cmd('python3 curl.py', '20'))]}, {goal}).errors.join('\n'), /has the name of a system or toolchain program|not a command name/);
  // An existing file stays a deliverable for base gating to decide (Clef's base question), never dropped or approved here.
  const onBase = prepareCard({...base, deliverables: [{name: 'tool.py', kind: 'function'}], requirements: [req({kind: 'judge', path: 'tool.py', question: 'Does it print the date?'})]}, {goal, base: ['tool.py']});
  assert.deepEqual(onBase.card.deliverables.map(d => [d.name, d.kind]), [['tool.py', 'file']]);
});

test('repairCard says what it did, one note per repair', () => {
  const {notes} = repairCard(parseObject(CORPUS[0].answer), {goal: CORPUS[0].goal});
  assert.deepEqual(notes, ['command convert_temp had no path; it is convert_temp.py.']);
  const b = repairCard(parseObject(CORPUS.find(c => c.name.startsWith('live B')).answer), {goal: 'x'});
  assert.deepEqual(b.notes, ['"server.js" (kind function) is the file server.js.']);
  assert.deepEqual(repairCard('not a card', {}), {card: 'not a card', notes: []});
});

// ---------------------------------------------------------------- vetting, the live C numbers
const C = CORPUS.find(c => c.name.startsWith('live C'));
// A scripted Clef that answers each requirement with the p the live run got, by its statement.
const LIVE_P = [[/to-do list structure/, 0.492], [/CSS styling/, 0.220], [/JavaScript for task management/, 0.261], [/does what the goal asks/, 0.453]];
const scriptedClef = (table, calls = []) => ({SPLIT_MODEL: '@cf/cloudflare/clef-flash', AI: {run: async (_m, input) => {
  calls.push(input);
  return {answers: Object.fromEntries(Object.keys(input.questions).map(k => {
    const r = input.state.requirements.find(x => x.slot === Number(k.split('_').pop()));
    return [k, {noul: (table.find(([re]) => re.test(r.says)) || [null, 0.9])[1]}];
  }))};
}}});

test('vetting (live C): Clef-flash\'s p of 0.49, 0.22 and 0.26 no longer remove the page\'s requirements', async () => {
  const fixed = parseObject(C.answer);
  fixed.requirements.push({id: 'R4', says: 'Adding an item lists it', source: '', serves: ['index.html'], check: {kind: 'browser', serve: 'site', steps: [{fill: {placeholder: 'Add a task', text: 'milk'}}, {press: 'Enter'}, {expect_text: 'milk'}]}});
  fixed.run = [{id: 'site', static: true}];
  const {card, errors} = prepareCard(fixed, {goal: C.goal});
  assert.deepEqual(errors, []);
  const calls = [], {ps, failed} = await vetRequirements(scriptedClef([...LIVE_P, [/Adding an item/, 0.3]], calls), {goal: C.goal, requirements: vettable(card)});
  assert.deepEqual(failed, []);
  assert.deepEqual(calls[0].state.requirements.map(r => r.says), ['The page contains a to-do list structure', 'The page has JavaScript for task management', 'Adding an item lists it'],
    'a check that only finds a file is never vetted');
  const {card: vetted, dropped, doubtful} = applyVetting(card, ps);
  assert.deepEqual(dropped, []);
  assert.deepEqual(doubtful.map(r => [r.id, r.p]), [['R1', 0.492], ['R3', 0.261], ['R4', 0.3]]);
  assert.deepEqual(vetted.requirements.filter(r => !r.implicit).map(r => r.id), ['R1', 'R2', 'R3', 'R4'], 'the core requirements survive');
  // Even at p well under the bar, a requirement whose source is the goal's sentence stays.
  const low = applyVetting(card, ps.map(x => ({...x, p: 0.01})));
  assert.deepEqual(low.dropped, []);
  assert.ok(VET_DROP_BAR < 0.2);
});

test('vetting: an invented requirement is still dropped, unless it is the last that exercises its deliverable', async () => {
  const goal = 'A Python CLI that converts temperatures.';
  const raw = {card: 1, summary: 'x', languages: ['python'], deliverables: [{name: 'convert', kind: 'command', path: 'convert.py'}],
    requirements: [{id: 'R1', says: 'Converting 100 C prints 212', source: 'converts temperatures', serves: ['convert'], check: cmd('convert 100 C', '212')},
      {id: 'R2', says: 'It has a graphical window with charts', source: 'a window with charts', serves: ['convert'], check: cmd('convert --gui')}]};
  const {card} = prepareCard(raw, {goal});
  const {ps} = await vetRequirements(scriptedClef([[/graphical/, 0.05]]), {goal, requirements: vettable(card)});
  assert.deepEqual(applyVetting(card, ps).dropped.map(r => r.id), ['R2']);
  const alone = prepareCard({...raw, requirements: [raw.requirements[1]]}, {goal}).card;
  const out = applyVetting(alone, [{id: 'R2', p: 0.05}]);
  assert.deepEqual(out.dropped, []);
  assert.deepEqual(out.doubtful.map(r => [r.id, r.last]), [['R2', true]]);
});

// ---------------------------------------------------------------- the live C follow-up
test('amendment (live C): a readme change adds the readme and its question, and leaves script.js as it was', () => {
  const goal = C.goal, change = 'add a readme explaining how to run it';
  const first = parseObject(C.answer);
  first.run = [{id: 'site', static: true}];
  first.requirements.push({id: 'R4', says: 'Adding an item lists it', source: 'a to-do list', serves: ['index.html'], check: {kind: 'browser', serve: 'site', steps: [{fill: {placeholder: 'Add', text: 'milk'}}, {press: 'Enter'}, {expect_text: 'milk'}]}});
  const old = prepareCard(first, {goal}).card;
  // The writer's card for the change: the whole card, script.js without its examples, and three "exists" requirements.
  const written = {card: 1, summary: 'A to-do page and a readme', languages: ['text'], run: [{id: 'site', static: true}], deliverables: [
    {name: 'index.html', kind: 'page', path: 'index.html', does: 'the to-do page'}, {name: 'style.css', kind: 'file', path: 'style.css'}, {name: 'script.js', kind: 'file', path: 'script.js'},
    {name: 'README.md', kind: 'doc', path: 'README.md', does: 'explains how to run the page'}],
  requirements: [...first.requirements.filter(r => r.id === 'R4'),
    {id: 'R5', says: 'README.md exists', source: 'add a readme', serves: ['README.md'], check: {kind: 'file', path: 'README.md'}},
    {id: 'R6', says: 'style.css exists', source: 'add a readme', serves: ['style.css'], check: {kind: 'file', path: 'style.css'}},
    {id: 'R7', says: 'script.js exists', source: 'add a readme', serves: ['script.js'], check: {kind: 'file', path: 'script.js'}}]};
  const full = effectiveGoal(goal, [change]);
  const prepared = prepareCard(written, {goal: full, change});
  assert.deepEqual(prepared.errors, []);
  const judge = prepared.card.requirements.find(r => r.inferred);
  assert.equal(judge.check.question, 'Does README.md do what the goal asks: add a readme explaining how to run it?', 'the readme\'s content is checked, from the change\'s words');
  const merged = mergeAmendment(old, prepared.card, {change});
  const next = revalidate(merged.card, {goal: full}).card, delta = cardDelta(old, next);
  assert.deepEqual(delta.deliverables, {added: ['README.md'], changed: []}, 'script.js keeps its examples: a field left out is no change');
  assert.deepEqual(next.deliverables.find(d => d.name === 'script.js').examples, old.deliverables.find(d => d.name === 'script.js').examples);
  const added = next.requirements.filter(r => delta.requirements.added.includes(r.id));
  assert.deepEqual(added.map(r => [r.says, r.check.kind]), [['README.md exists', 'file'], [judge.says, 'judge']], 'no new "style.css exists" or "script.js exists"');
  assert.deepEqual(vettable(next).filter(r => delta.requirements.added.includes(r.id)), [], 'neither is Clef\'s to drop');
});

test('amendment scope: Clef is asked about each changed deliverable, and one it refuses stays as it was', async () => {
  const goal = 'A Python CLI that converts temperatures, with a usage note.';
  const old = prepareCard({card: 1, summary: 'x', languages: ['python'], deliverables: [{name: 'convert', kind: 'command', path: 'convert.py', does: 'converts Celsius to Fahrenheit'}, {name: 'USAGE.md', kind: 'doc', does: 'how to run it'}],
    requirements: [{id: 'R1', says: '100 C prints 212', source: 'converts temperatures', serves: ['convert'], check: cmd('convert 100', '212')}]}, {goal}).card;
  const written = JSON.parse(JSON.stringify(old));
  written.deliverables[0].does = 'converts Celsius to Fahrenheit and Kelvin';
  written.deliverables[1].does = 'a new note';
  const change = 'add kelvin output to the converter';
  const merged = mergeAmendment(old, written, {change});
  assert.deepEqual(merged.delta.deliverables.changed, ['convert', 'USAGE.md']);
  const asked = [];
  const env = {SPLIT_MODEL: '@cf/cloudflare/clef-flash', AI: {run: async (_m, input) => {
    asked.push(input);
    return {answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: input.state.deliverables[Number(k.split('_').pop())].name === 'convert' ? 0.9 : 0.1}]))};
  }}};
  const ps = await vetAmendChanges(env, {change, deliverables: merged.delta.deliverables.changed.map(n => old.deliverables.find(d => d.name === n))});
  assert.deepEqual(ps, [{name: 'convert', p: 0.9}, {name: 'USAGE.md', p: 0.1}]);
  assert.equal(asked[0].state.change, change);
  assert.deepEqual(asked[0].state.deliverables[1], {slot: 1, name: 'USAGE.md', kind: 'doc', path: 'USAGE.md', does: 'how to run it'});
  assert.ok(asked[0].questions.amend_change_1.instructions.startsWith(CLEF.amend_change.replace('{i}', '1').slice(0, 40)));
  const kept = keepDeliverables(merged.card, old, ['USAGE.md'], {goal});
  assert.deepEqual(cardDelta(old, kept).deliverables, {added: [], changed: ['convert']});
  assert.deepEqual(await vetAmendChanges({MOCK_AI: 'true'}, {change, deliverables: [{name: 'convert'}]}), [{name: 'convert', p: 1}]);
  await assert.rejects(vetAmendChanges({...env, AI: {run: async () => ({answers: {}})}}, {change, deliverables: [{name: 'convert'}]}), /no valid probability/);
});

test('existenceOnly: a file check without contents or json', () => {
  assert.ok(existenceOnly({check: {kind: 'file', path: 'a.md'}}));
  assert.ok(!existenceOnly({check: {kind: 'file', path: 'a.md', has: ['x']}}));
  assert.ok(!existenceOnly({check: {kind: 'judge', path: 'a.md', question: 'q?'}}));
});
