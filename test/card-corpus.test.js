// v8 card repair: a corpus of realistic, sloppy card answers, the kind a
// small card writer gives (the first live runs' among them, reconstructed
// from their events), each taken through the three layers as the room takes
// it (writeCard): layer 1 reads it leniently (repairCard), a scripted Clef
// places what layer 1 could not match (layer 3), layer 2 keeps the safety
// and executability rules (validateCard), and Clef's review sends the
// writer one revision with its notes. Clef reviews; it never deletes. Then
// the vetting the live run got wrong, and an amendment that leaves alone
// what it is not about.
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCard, repairCard, validateCard, cardUsable, applyVetting, vettable, existenceOnly, VET_DOUBT_BAR } from '../src/card.js';
import { writeCard, vetRequirements, vetAmendChanges } from '../src/model.js';
import { mergeAmendment, cardDelta, revalidate, effectiveGoal } from '../src/amend.js';
import { parseObject } from '../src/protocol.js';
import { kindOf } from '../src/contracts.js';
import { TOOLCHAINS } from '../src/toolchains.js';
import { CLEF } from '../src/prompts.js';

const json = o => JSON.stringify(o);
const cmd = (run, out) => ({kind: 'command', run, expect: {exit: 0, ...(out ? {stdout_has: [out]} : {})}});
const EXERCISES = {page: ['browser', 'http'], command: ['command', 'http', 'browser'], function: ['call', 'command', 'http', 'browser'], doc: ['judge']};

// Each case: a goal, the writer's answer as text, the deliverables expected
// on the final card ([name, kind, path]); place: what Clef ranks first for a
// reference layer 1 could not match ({written: deliverable}); revised: the
// writer's answer to the review notes (else it answers as before); errors:
// the layer-2 refusals left; check: anything else.
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
    deliverables: [['Convert-Temp', 'command', 'convert_temp.py']], ideal: true,
    check: out => { assert.equal(out.card.requirements[0].check.run, 'Convert-Temp 100 C', 'one word runs as typed: no naming rule'); assert.deepEqual(out.card.requirements[0].serves, ['Convert-Temp']); }},
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

  // ---------------------------------------------------------------- live 2: a requirement silently lost
  // The second live runs' to-do card (reconstructed from its export): the
  // writer's R1 opened http://localhost:8000/index.html, layer 2 refused it
  // ("must start with a single /"), card_errors said "the valid part is kept",
  // and R1 was gone; the implicit "styles.css exists" took its id.
  {name: 'live 2: a to-do page whose browser check opens http://localhost:8000/index.html', goal: 'A static web page with a to-do list.',
    answer: json({card: 1, summary: 'Static to-do list web page with HTML, CSS, and JavaScript.', languages: ['text', 'javascript'],
      deliverables: [{name: 'index.html', kind: 'page', path: 'index.html', does: 'Serves the to-do list interface'}, {name: 'styles.css', kind: 'data', path: 'styles.css', does: 'Styles the to-do list for visual clarity'},
        {name: 'script.js', kind: 'file', path: 'script.js', does: 'Adds interactivity for task management'}],
      run: [{id: 'serve', static: true}],
      requirements: [{id: 'R1', says: 'The page shows the to-do list', source: 'A static web page with a to-do list', serves: ['index.html'], check: {kind: 'browser', serve: 'serve', steps: [{goto: 'http://localhost:8000/index.html'}, {expect_text: 'To-Do'}]}},
        {id: 'R2', says: 'Tasks can be added and displayed', source: 'A static web page with a to-do list', serves: ['index.html', 'script.js'], check: {kind: 'browser', serve: 'serve', steps: [{fill: {label: 'Task', text: 'Sample task'}}, {click: {role: 'button', name: 'Add'}}, {expect_text: 'Sample task'}]}},
        {id: 'R3', says: 'CSS file is linked and applied', source: 'A static web page with a to-do list', serves: ['index.html'], check: {kind: 'file', path: 'index.html', has: ['<link rel="stylesheet" href="styles.css">']}}]}),
    deliverables: [['index.html', 'page', 'index.html'], ['styles.css', 'data', 'styles.css'], ['script.js', 'file', 'script.js']],
    check: out => {
      const r1 = out.card.requirements.find(r => r.id === 'R1');
      assert.deepEqual(r1.check.steps[0], {goto: '/index.html'}, 'layer 1 reads the URL on the run\'s host as its path');
      assert.ok(out.notes.some(n => /R1: its browser check opens "http:\/\/localhost:8000\/index\.html" as \/index\.html/.test(n)), out.notes.join('\n'));
      assert.ok(!out.card.requirements.some(r => r.untested));
      assert.equal(out.card.requirements.find(r => r.implicit)?.id, 'R4', 'the implicit requirement takes a free id, never the writer\'s');
    }},
  {name: 'live 2: a check layer 2 still refuses keeps its requirement, untested, never run', goal: 'A static web page with a to-do list.',
    answer: json({card: 1, summary: 'A to-do page', languages: ['text'], deliverables: [{name: 'index.html', kind: 'page', path: 'index.html'}], run: [{id: 'site', static: true}],
      requirements: [{id: 'R1', says: 'The page links to the shared list', source: 'a to-do list', serves: ['index.html'], check: {kind: 'browser', serve: 'site', steps: [{goto: 'https://lists.example.com/shared'}, {expect_text: 'Shared'}]}},
        {id: 'R2', says: 'A task can be added', source: 'a to-do list', serves: ['index.html'], check: {kind: 'browser', serve: 'site', steps: [{goto: '/'}, {fill: {label: 'Task', text: 'Walk'}}, {click: {role: 'button', name: 'Add'}}, {expect_text: 'Walk'}]}}]}),
    deliverables: [['index.html', 'page', 'index.html']], errors: [/R1: its browser check requests "https:\/\/lists\.example\.com\/shared": it must start with a single "\/"/],
    check: out => {
      const r1 = out.card.requirements.find(r => r.id === 'R1');
      assert.deepEqual([r1.untested, r1.check.kind, r1.says], [true, 'untested', 'The page links to the shared list']);
      assert.match(r1.check_error, /must start with a single/);
      assert.ok(out.card.review_notes.some(n => /^R1's check needs a form the runtime runs \(.*must start with a single/.test(n)), 'the refusal is a review note the card shows, and it asked for one revision');
    }},

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
    deliverables: [['Tickets', 'command', 'Tickets.py'], ['tickets.json', 'data', 'tickets.json']],
    check: out => { assert.ok(out.card.languages.includes('python'), 'the goal names the language'); assert.equal(out.card.requirements[1].check.run, 'Tickets list', 'the check runs the command by its name'); }},
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
    revised: json({card: 1, summary: 'A README', languages: ['text'], deliverables: [{name: 'README.md', kind: 'doc', path: 'README.md', does: 'explains installing and running the tool'}],
      requirements: [{id: 'R1', says: 'The README explains how to install and run the tool', source: 'explains how to install and run the tool', serves: ['README.md'], check: {kind: 'judge', path: 'README.md', question: 'Does it explain how to install and run the tool?'}}]}),
    deliverables: [['README.md', 'doc', 'README.md']],
    check: out => {
      assert.equal(out.attempts, 2, 'the review note on "it exists" led to a revised card');
      assert.deepEqual(out.card.requirements.map(r => r.check.kind), ['judge']);
      assert.equal(out.card.review_notes, undefined);
    }},
  {name: 'a markdown-only goal: a kind in other words and a missing path', goal: 'Write a short guide on brewing pour-over coffee at home.',
    answer: '```json\n' + json({card: 1, summary: 'A brewing guide', deliverables: [{name: 'brewing guide', kind: 'document', does: 'how to brew pour-over coffee'}],
      requirements: [{says: 'The guide lists the equipment needed', serves: ['brewing guide'], check: {kind: 'review', path: 'brewing-guide.md', question: 'Does it list the equipment needed?'}}]}) + '\n```',
    deliverables: [['brewing-guide.md', 'doc', 'brewing-guide.md']],
    check: out => { assert.equal(out.card.requirements[0].source, '', 'one shared word is no source'); assert.equal(out.card.requirements[0].untraced, true); }},
  {name: 'a document whose requirement has no serves and only finds the file', goal: 'Document the release process for the team.',
    answer: json({card: 1, summary: 'Release notes', languages: ['markdown'], deliverables: [{name: 'docs/RELEASING.md', kind: 'doc', path: 'docs/RELEASING.md'}],
      requirements: [{id: 'R1', says: 'The release process is documented', source: 'Document the release process', check: {kind: 'file', path: 'docs/releasing.md'}}]}),
    deliverables: [['docs/RELEASING.md', 'doc', 'docs/RELEASING.md']],
    check: out => { assert.deepEqual(out.card.requirements[0].serves, ['docs/RELEASING.md']); assert.equal(out.card.requirements[0].check.path, 'docs/RELEASING.md'); assert.match(out.card.review_notes.join(' '), /R1's check may not exercise what it states/, 'the writer kept it, so the note stays on the card'); }},

  // ---------------------------------------------------------------- live C: a static page
  {name: 'live C: a to-do page whose requirements have no source and only read files', goal: 'A static web page with a to-do list.',
    answer: json({card: 1, summary: 'A to-do page', languages: ['html', 'css', 'javascript'], deliverables: [
      {name: 'index.html', kind: 'page', path: 'index.html', does: 'the to-do page'}, {name: 'style.css', kind: 'file', path: 'style.css'},
      {name: 'script.js', kind: 'file', path: 'script.js', examples: [{given: 'add "milk"', expect: 'milk is listed'}]}],
    requirements: [{id: 'R1', says: 'The page contains a to-do list structure', source: '', serves: ['index.html'], check: {kind: 'file', path: 'index.html', has: ['<ul']}},
      {id: 'R2', says: 'The page includes CSS styling', source: '', serves: ['style.css'], check: {kind: 'file', path: 'style.css'}},
      {id: 'R3', says: 'The page has JavaScript for task management', source: '', serves: ['script.js'], check: {kind: 'file', path: 'script.js', has: ['addEventListener']}}]}),
    revised: json({card: 1, summary: 'A to-do page', languages: ['text', 'javascript'], run: [{id: 'site', static: true}], deliverables: [
      {name: 'index.html', kind: 'page', path: 'index.html', does: 'the to-do page'}, {name: 'style.css', kind: 'file', path: 'style.css'},
      {name: 'script.js', kind: 'file', path: 'script.js', examples: [{given: 'add "milk"', expect: 'milk is listed'}]}],
    requirements: [{id: 'R1', says: 'Adding a task lists it', source: 'a to-do list', serves: ['index.html'], check: {kind: 'browser', serve: 'site', steps: [{goto: '/'}, {fill: {placeholder: 'New task', text: 'milk'}}, {press: 'Enter'}, {expect_text: 'milk'}]}},
      {id: 'R2', says: 'A task can be marked done', source: 'a to-do list', serves: ['index.html', 'script.js'], check: {kind: 'browser', serve: 'site', steps: [{goto: '/'}, {fill: {placeholder: 'New task', text: 'milk'}}, {press: 'Enter'}, {click: {role: 'checkbox', name: 'milk'}}, {expect_count: {role: 'checkbox', n: 1}}]}}]}),
    deliverables: [['index.html', 'page', 'index.html'], ['style.css', 'file', 'style.css'], ['script.js', 'file', 'script.js']],
    check: out => { assert.equal(out.attempts, 2); assert.deepEqual(out.card.requirements.filter(r => !r.implicit).map(r => r.check.kind), ['browser', 'browser', 'file'], 'the revision\'s two checks, and the draft\'s R3 it left out'); }},
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
  {name: 'a page with only existence checks: the review note stays when the writer keeps it', goal: 'A web page that converts between metres and feet as you type.',
    answer: json({card: 1, summary: 'A unit page', languages: ['text'], deliverables: [{name: 'index.html', kind: 'page', path: 'index.html'}],
      requirements: [{id: 'R1', says: 'index.html exists', source: 'A web page', serves: ['index.html'], check: {kind: 'file', path: 'index.html'}}]}),
    revised: json({card: 1, summary: 'A unit page', languages: ['text'], run: [{id: 'site', static: true}], deliverables: [{name: 'index.html', kind: 'page', path: 'index.html'}],
      requirements: [{id: 'R1', says: 'index.html exists', source: 'A web page', serves: ['index.html'], check: {kind: 'file', path: 'index.html'}},
        {id: 'R2', says: 'Typing 1 metre shows 3.28 feet', source: 'converts between metres and feet as you type', serves: ['index.html'], check: {kind: 'browser', serve: 'site', steps: [{goto: '/'}, {fill: {label: 'Metres', text: '1'}}, {expect_text: '3.28'}]}}]}),
    deliverables: [['index.html', 'page', 'index.html']], check: out => assert.equal(out.attempts, 2, 'the runnability note asked for a check that exercises the page')},
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
    check: out => assert.deepEqual(out.card.requirements.filter(r => !r.implicit).map(r => [r.id, !!r.source_inferred, !!r.untraced]), [['R1', false, true], ['R2', true, false]], 'two shared words make a source; one leaves it untraced')},
  {name: 'a Python library: a function with no check and no example: a clear retry error', goal: 'A Python library that computes the mean and the median of a list of numbers.',
    answer: json({card: 1, summary: 'Statistics', languages: ['python'], deliverables: [{name: 'mean', path: 'stats.py'}, {name: 'median', path: 'stats.py'}],
      requirements: [{id: 'R1', says: 'mean([1,2,3]) is 2', source: 'computes the mean', serves: ['mean'], check: {kind: 'call', steps: [{call: 'mean', args: [[1, 2, 3]], expect: 2}]}}]}),
    revised: json({card: 1, summary: 'Statistics', languages: ['python'], deliverables: [{name: 'mean', path: 'stats.py'}, {name: 'median', path: 'stats.py'}],
      requirements: [{id: 'R2', says: 'median([3,1,2]) is 2', source: 'the median of a list of numbers', serves: ['median'], check: {kind: 'call', steps: [{call: 'median', args: [[3, 1, 2]], expect: 2}]}}]}),
    deliverables: [['mean', 'function', 'stats.py'], ['median', 'function', null]], check: out => assert.deepEqual(out.card.requirements.filter(r => !r.implicit).map(r => r.says), ['median([3,1,2]) is 2', 'mean([1,2,3]) is 2'], 'the revision left R1 out, and the draft\'s R1 is kept')},
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
      requirements: [{id: 'R1', says: 'It greets', source: 'the moon landing', serves: ['greet'], check: cmd('greet', 'Hello'), implicit: true, source_inferred: true, vet_p: 1, unattached: false}]}),
    deliverables: [['greet', 'command', 'greet.py']],
    check: out => { const r = out.card.requirements[0]; assert.ok(!r.implicit && !r.source_inferred && r.vet_p === undefined); assert.equal(r.untraced, true); assert.ok(vettable(out.card).includes(r), 'Clef still vets it'); }},
  {name: 'a command with no check that runs it: the review asks for one, and the revision adds it', goal: 'A Python CLI that renames photos by the date they were taken.',
    answer: json({card: 1, summary: 'Photo renamer', languages: ['python'], deliverables: [{name: 'rename_photos', kind: 'command'}, {name: 'USAGE.md', kind: 'doc'}],
      requirements: [{id: 'R1', says: 'The usage is documented', source: 'renames photos by the date', serves: ['USAGE.md'], check: {kind: 'judge', path: 'USAGE.md', question: 'Does it explain how to rename photos by date?'}}]}),
    revised: json({card: 1, summary: 'Photo renamer', languages: ['python'], deliverables: [{name: 'rename_photos', kind: 'command'}, {name: 'USAGE.md', kind: 'doc'}],
      requirements: [{id: 'R1', says: 'The usage is documented', source: 'renames photos by the date', serves: ['USAGE.md'], check: {kind: 'judge', path: 'USAGE.md', question: 'Does it explain how to rename photos by date?'}},
        {id: 'R2', says: 'A photo is renamed by its date', source: 'renames photos by the date they were taken', serves: ['rename_photos'], check: {kind: 'command', run: 'rename_photos --dry-run sample.jpg', expect: {stdout_has: ['20']}}}]}),
    deliverables: [['rename_photos', 'command', 'rename_photos.py'], ['USAGE.md', 'doc', 'USAGE.md']], check: out => assert.equal(out.attempts, 2)},
  {name: 'a call step under "function" with "expected", and serves by stem', goal: 'A Python function that tells whether a year is a leap year.',
    answer: json({card: 1, summary: 'Leap years', languages: ['python'], deliverables: [{name: 'is_leap', path: 'leap.py'}],
      requirements: [{id: 'R1', says: '2000 is a leap year', source: 'tells whether a year is a leap year', serves: ['leap'], check: {kind: 'call', function: 'is_leap', args: [2000], expected: true}}]}),
    deliverables: [['is_leap', 'function', 'leap.py']],
    check: out => assert.deepEqual(out.card.requirements[0].check.steps, [{call: 'is_leap', args: [2000], expect: true}])},
  // ---------------------------------------------------------------- layer 3 places a reference
  {name: 'layer 3: serves written as a description, which Clef places on a deliverable', goal: 'A Python command-line tool that converts temperatures, and a guide to it.',
    answer: json({card: 1, summary: 'converter', languages: ['python'], deliverables: [{name: 'convert', kind: 'command', path: 'convert.py'}, {name: 'GUIDE.md', kind: 'doc', path: 'GUIDE.md'}],
      requirements: [{id: 'R1', says: '100 C prints 212', source: 'converts temperatures', serves: ['the converter tool'], check: cmd('convert 100 C', '212')},
        {id: 'R2', says: 'The guide shows a conversion', source: 'a guide to it', serves: ['user documentation'], check: {kind: 'judge', path: 'GUIDE.md', question: 'Does it show a conversion?'}}]}),
    place: {'the converter tool': 'convert', 'user documentation': 'GUIDE.md'},
    deliverables: [['convert', 'command', 'convert.py'], ['GUIDE.md', 'doc', 'GUIDE.md']],
    check: out => { assert.deepEqual(out.card.requirements.map(r => r.serves), [['convert'], ['GUIDE.md']]); assert.ok(out.card.requirements.every(r => r.serves_inferred)); assert.ok(out.notes.some(n => /R1 serves convert \(written "the converter tool"\); Clef placed convert \(Clef p=0\.900\)/.test(n))); assert.equal(out.clefCalls.filter(c => Object.keys(c.questions)[0].startsWith('reference_')).length, 1, 'one batched ranking call'); }},
  {name: 'a call to a function written another way: layer 2 asks the writer, and Clef never rewrites the check', goal: 'A JavaScript function that adds sales tax to a price.',
    answer: json({card: 1, summary: 'tax', languages: ['javascript'], deliverables: [{name: 'addTax', path: 'tax.js'}, {name: 'roundCents', path: 'round.js'}],
      requirements: [{id: 'R1', says: 'Tax is added', source: 'adds sales tax to a price', serves: ['addTax'], check: {kind: 'call', steps: [{call: 'withSalesTax', args: [100, 0.2], expect: 120}]}},
        {id: 'R2', says: 'A price is rounded to cents', source: 'a price', serves: ['roundCents'], check: {kind: 'call', steps: [{call: 'roundCents', args: [1.005], expect: 1.01}]}}]}),
    revised: json({card: 1, summary: 'tax', languages: ['javascript'], deliverables: [{name: 'addTax', path: 'tax.js'}, {name: 'roundCents', path: 'round.js'}],
      requirements: [{id: 'R1', says: 'Tax is added', source: 'adds sales tax to a price', serves: ['addTax'], check: {kind: 'call', steps: [{call: 'addTax', args: [100, 0.2], expect: 120}]}}]}),
    deliverables: [['addTax', 'function', 'tax.js'], ['roundCents', 'function', 'round.js']],
    check: out => { assert.equal(out.attempts, 2); assert.equal(out.card.requirements.find(r => r.says === 'Tax is added').check.steps[0].call, 'addTax'); assert.ok(out.card.requirements.some(r => r.says === 'A price is rounded to cents'), 'the draft\'s R2 is kept'); }},
  {name: 'layer 3: a reference Clef places nowhere is kept, unattached', goal: 'A Python CLI that prints a calendar, and a page that shows it.',
    answer: json({card: 1, summary: 'calendar', languages: ['python'], deliverables: [{name: 'cal', kind: 'command', path: 'cal.py'}, {name: 'index.html', kind: 'page'}], run: [{id: 'site', static: true}],
      requirements: [{id: 'R1', says: 'It prints this month', source: 'prints a calendar', serves: ['cal'], check: cmd('cal', 'Mo')},
        {id: 'R2', says: 'The month is readable', source: 'a page that shows it', serves: ['the month view'], check: {kind: 'browser', serve: 'site', steps: [{goto: '/'}, {expect_text: 'Mo'}]}},
        {id: 'R3', says: 'It is accessible', source: 'a page that shows it', serves: ['accessibility'], check: {kind: 'http', serve: 'site', steps: [{method: 'GET', path: '/', expect: {status: 200}}]}}]}),
    deliverables: [['cal', 'command', 'cal.py'], ['index.html', 'page', 'index.html']],
    check: out => { assert.deepEqual(out.card.requirements.map(r => [r.id, r.serves, !!r.unattached]), [['R1', ['cal'], false], ['R2', ['index.html'], false], ['R3', [], true]], 'R2 by its check\'s page, R3 kept unattached'); }},
  // ---------------------------------------------------------------- the reviewer's ten cards
  {name: 'review 1: a Rust CLI, which this deployment does not run', goal: 'A Rust CLI that prints the SHA-256 hash of each file it is given.',
    answer: json({card: 1, summary: 'hasher', languages: ['rust'], deliverables: [{name: 'hasher', kind: 'command', path: 'src/main.rs'}],
      requirements: [{id: 'R1', says: 'hashing a file prints its hash', source: 'prints the SHA-256 hash', serves: ['hasher'], check: {kind: 'command', run: 'hasher a.txt', files: {'a.txt': 'abc'}, expect: {stdout_has: ['ba7816bf']}}}]}),
    unsupported: ['rust']},
  {name: 'review 2: md2html run as "python", a check written as type/cmd', goal: 'A Python script that converts a Markdown file to HTML, and a README that explains its options.',
    answer: '```json\n' + json({card: 1, summary: 'md2html', languages: 'Python', deliverables: [{name: 'md2html.py', kind: 'script'}, {name: 'README', kind: 'documentation'}],
      requirements: [{id: 'req-1', says: 'A heading becomes an h1', serves: ['md2html'], check: {type: 'shell', cmd: 'python md2html.py in.md', files: {'in.md': '# Hi'}, expect: {output: '<h1>Hi</h1>'}}},
        {id: 'req-2', says: 'The README lists the options', serves: 'README', check: {type: 'contains', file: 'README', contains: '--output'}}]}) + '\n```',
    deliverables: [['md2html', 'command', 'md2html.py'], ['README.md', 'doc', 'README.md']],
    check: out => assert.deepEqual(out.card.requirements[0].check.argv, ['python3', 'md2html.py', 'in.md'])},
  {name: 'review 3: a metronome page, its script a file, browser steps as {action, target}', goal: 'A web page that plays a metronome at a tempo the user chooses.',
    answer: json({card: 1, summary: 'metronome', languages: ['text', 'javascript'], deliverables: [{name: 'Metronome page', kind: 'webpage'}, {name: 'metronome.js', kind: 'script'}],
      requirements: [{id: 'R1', says: 'Choosing 120 bpm shows 120', source: 'a tempo the user chooses', serves: ['Metronome page'], check: {kind: 'browser', steps: [{action: 'fill', target: 'Tempo', value: '120'}, {action: 'expect', text: '120 bpm'}]}},
        {id: 'R2', says: 'The script starts the beat', source: 'plays a metronome', serves: ['metronome'], check: {kind: 'file', path: 'metronome.js', has: ['setInterval']}}]}),
    deliverables: [['Metronome-page.html', 'page', 'Metronome-page.html'], ['metronome.js', 'file', 'metronome.js']],
    check: out => assert.deepEqual(out.card.requirements[0].check.steps, [{fill: {label: 'Tempo', text: '120'}}, {expect_text: '120 bpm'}])},
  {name: 'review 4: a bookmarks API: a route with no kind, url and status_code', goal: 'A JavaScript HTTP API for a bookmarks list with endpoints to add a bookmark and to list them.',
    answer: json({card: 1, summary: 'bookmarks API', languages: ['javascript'], deliverables: [{name: 'POST /bookmarks'}, {name: 'get /bookmarks', kind: 'endpoint'}, {name: 'server', kind: 'command', path: 'server.js'}],
      run: [{run: 'npm start', port: true}],
      requirements: [{id: 'R1', says: 'Adding a bookmark answers 201', source: 'add a bookmark', serves: ['POST /bookmarks'], check: {kind: 'http', serve: 'api', steps: [{method: 'post', url: '/bookmarks', body: {url: 'https://a.example'}, expect: {status_code: 201}}]}},
        {id: 'R2', says: 'Listing shows it', source: 'list them', serves: ['GET /bookmarks'], check: {kind: 'http', steps: [{method: 'GET', path: '/bookmarks', expect: {status: 200}}]}}]}),
    revised: json({card: 1, summary: 'bookmarks API', languages: ['javascript'], deliverables: [{name: 'POST /bookmarks', kind: 'route'}, {name: 'GET /bookmarks', kind: 'route'}, {name: 'server', kind: 'command', path: 'server.js'}],
      run: [{id: 'api', run: 'server {port}', port: true}],
      requirements: [{id: 'R1', says: 'Adding a bookmark answers 201', source: 'add a bookmark', serves: ['POST /bookmarks'], check: {kind: 'http', serve: 'api', steps: [{method: 'POST', path: '/bookmarks', body: {url: 'https://a.example'}, expect: {status: 201}}]}},
        {id: 'R2', says: 'Listing shows it', source: 'list them', serves: ['GET /bookmarks'], check: {kind: 'http', serve: 'api', steps: [{method: 'GET', path: '/bookmarks', expect: {status: 200}}]}}]}),
    deliverables: [['POST /bookmarks', 'route', null], ['GET /bookmarks', 'route', null], ['server', 'command', 'server.js']],
    check: out => assert.deepEqual(out.card.requirements[0].check.steps[0].expect, {status: 201}, 'the expectation survives the url repair')},
  {name: 'review 5: an ISBN function by module path, a test file, a project check', goal: 'A Python function that validates ISBN-10 numbers, with its own tests.',
    answer: json({card: 1, summary: 'isbn', languages: ['python'], deliverables: [{name: 'isbn.is_valid_isbn10', does: 'true for a valid ISBN-10'}, {name: 'test_isbn.py', kind: 'test'}],
      project_checks: 'pytest -q',
      requirements: [{id: 'R1', says: 'A valid ISBN passes', source: 'validates ISBN-10 numbers', serves: ['is_valid'], check: {kind: 'call', steps: [{call: 'is_valid_isbn10', args: '0306406152', expect: true}]}},
        {id: 'R2', says: 'An invalid ISBN fails', source: 'validates ISBN-10 numbers', serves: ['isbn'], check: {kind: 'call', steps: [{call: 'isbn.is_valid_isbn10', args: ['0306406153'], expect: false}]}}]}),
    deliverables: [['is_valid_isbn10', 'function', 'isbn.py'], ['test_isbn.py', 'file', 'test_isbn.py']]},
  {name: 'review 6: a CSV report program and the file it writes', goal: 'A Python script that reads sales.csv and writes a summary.json with the total per region.',
    answer: json({card: 1, summary: 'report', languages: ['python'], deliverables: [{name: 'report', kind: 'program', file: 'report.py'}, {name: 'summary.json', kind: 'output'}],
      requirements: [{id: 'R1', says: 'The report runs', source: 'reads sales.csv', serves: ['report'], check: {kind: 'command', run: 'python3 report.py', files: {'sales.csv': 'region,amount\nN,5\nN,7\n'}}},
        {id: 'R2', says: 'summary.json totals per region', source: 'the total per region', serves: ['summary.json'], check: {kind: 'file', path: 'summary.json', json: true, has: ['12']}}]}),
    deliverables: [['report', 'command', 'report.py'], ['summary.json', 'data', 'summary.json']]},
  {name: 'review 7: tic-tac-toe with bare-string requirements, which the revision checks', goal: 'A browser game of tic-tac-toe in a single HTML file.',
    answer: json({card: 1, summary: 'tic-tac-toe', languages: ['text'], deliverables: ['tictactoe.html'], requirements: {R1: 'X moves first', R2: 'Three in a row wins'}}),
    revised: json({card: 1, summary: 'tic-tac-toe', languages: ['text'], run: [{id: 'site', static: true}], deliverables: [{name: 'tictactoe.html', kind: 'page'}],
      requirements: [{id: 'R1', says: 'X moves first', source: 'tic-tac-toe', serves: ['tictactoe.html'], check: {kind: 'browser', serve: 'site', steps: [{goto: '/tictactoe.html'}, {click: {label: 'cell 1'}}, {expect_text: 'X'}]}},
        {id: 'R2', says: 'Three in a row wins', source: 'tic-tac-toe', serves: ['tictactoe.html'], check: {kind: 'browser', serve: 'site', steps: [{goto: '/tictactoe.html'}, {click: {label: 'cell 1'}}, {click: {label: 'cell 4'}}, {click: {label: 'cell 2'}}, {click: {label: 'cell 5'}}, {click: {label: 'cell 3'}}, {expect_text: 'X wins'}]}}]}),
    deliverables: [['tictactoe.html', 'page', 'tictactoe.html']]},
  {name: 'review 8: a shell script run through bash is still refused', goal: 'A shell script that backs up my notes folder into a dated tar file.',
    answer: json({card: 1, summary: 'backup', languages: ['text'], deliverables: [{name: 'backup', kind: 'command', path: 'backup.sh'}],
      requirements: [{id: 'R1', says: 'It creates a tar', source: 'backs up my notes folder', serves: ['backup'], check: {kind: 'command', run: 'bash backup.sh notes'}}]}),
    refused: /R1: its command check: it runs "bash", which is neither a command deliverable nor an installed executable/},
  {name: 'review 9: a base repo, the readme named in another case', goal: 'Add a CONTRIBUTING guide to this repository and fix the typo in the readme.', base: ['README.md', 'src/index.js'],
    answer: json({card: 1, summary: 'docs', languages: ['text'], deliverables: [{name: 'CONTRIBUTING', kind: 'markdown'}, {name: 'readme.md', kind: 'doc'}],
      requirements: [{id: 'R1', says: 'The guide explains how to open a pull request', source: 'a CONTRIBUTING guide', serves: ['CONTRIBUTING'], check: {kind: 'judge', path: 'CONTRIBUTING.md', question: 'Does it explain how to open a pull request?'}},
        {id: 'R2', says: 'The typo is fixed', source: 'fix the typo in the readme', serves: ['readme'], check: {kind: 'file', path: 'readme.md', has: ['installation']}}]}),
    deliverables: [['CONTRIBUTING.md', 'doc', 'CONTRIBUTING.md'], ['README.md', 'doc', 'README.md']]},
  {name: 'review 10: a function named with its signature, and a demo page', goal: 'A JavaScript function that formats a number as currency, and a demo page that uses it.',
    answer: json({card: 1, summary: 'currency', languages: ['javascript', 'text'], deliverables: [{name: 'formatCurrency(amount, code)', kind: 'function', path: 'currency.js'}, {name: 'demo', kind: 'page'}],
      requirements: [{id: 'R1', says: '1234.5 USD is $1,234.50', source: 'formats a number as currency', serves: ['formatCurrency'], check: {kind: 'call', steps: [{call: 'formatCurrency', args: [1234.5, 'USD'], expect: '$1,234.50'}]}},
        {id: 'R2', says: 'The demo shows a formatted amount', source: 'a demo page that uses it', serves: ['demo'], check: {kind: 'browser', serve: 'demo', steps: [{goto: '/demo.html'}, {expect_text: '$'}]}}]}),
    deliverables: [['formatCurrency', 'function', 'currency.js'], ['demo.html', 'page', 'demo.html']],
    check: out => assert.deepEqual(out.card.deliverables[0].params, ['amount', 'code'])},
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

test('the corpus holds at least 40 answers, among them the three live failures and the reviewer\'s ten', () => {
  assert.ok(CORPUS.length >= 40, String(CORPUS.length));
  assert.equal(CORPUS.filter(c => /^live [ABC]:/.test(c.name)).length, 3);
  assert.equal(CORPUS.filter(c => /^review \d+:/.test(c.name)).length, 10);
});

// Two scripted Clefs. The ideal reviewer places a reference as the case
// says (else nowhere), says NO to a check that only finds a file and to a
// goal phrase no check covers, and yes to the rest. The noisy one answers
// every question with a p in [0.2, 0.8], fixed per question (a poorly
// calibrated Clef): it places references wrongly and doubts at random.
const exercisesCheck = check => !/^file \S+$/.test(check);
export const scriptedClef = (c = {}) => Object.assign((k, input) => {
  const [i, j] = (k.match(/\d+/g) || []).map(Number);
  if (k.startsWith('reference_')) return c.place?.[input.state.requirements[i].written] === input.state.deliverables[j].name ? 0.9 : 0.1;
  if (k.startsWith('exercises_')) return exercisesCheck(input.state.requirements[i].check) ? 0.9 : 0.2;
  // A phrase is covered when some check exercises something, and each page, command, function or route the phrase names has a check of its kind.
  if (k.startsWith('covered_')) {
    const phrase = input.state.phrases[i].text.toLowerCase(), checks = input.state.requirements.map(r => r.check).filter(exercisesCheck);
    const fits = {page: ch => /^(?:browser|http) /.test(ch), command: ch => /^(?:command|browser|http) /.test(ch), route: ch => /^http /.test(ch)};
    const checked = d => checks.some(ch => fits[d.kind] ? fits[d.kind](ch) : ch.includes(d.name));
    const named = input.state.deliverables.filter(d => ['page', 'command', 'function', 'route'].includes(d.kind) && String(d.name).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3).some(w => phrase.includes(w)));
    return checks.length && named.every(checked) ? 0.9 : 0.2;
  }
  return 0.9;
}, {ideal: true});
const hash = s => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };
export const noisyClef = () => (k, input) => 0.2 + 0.6 * hash(`${k}\n${JSON.stringify(input.state).slice(0, 400)}`);
const CLEFS = {ideal: scriptedClef, noisy: noisyClef};
// The room's card writer call, with the case's answers and a scripted Clef.
export async function throughLayers(c, clef = scriptedClef(c)) {
  const calls = [], clefCalls = [];
  const env = {MODEL_NAME: '@cf/qwen/qwen3-30b-a3b-fp8', AI: {run: async (_m, input) => {
    if (input.questions) { clefCalls.push(input); return {answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: clef(k, input)}]))}; }
    calls.push(input);
    return {response: calls.length > 1 && c.revised ? c.revised : c.answer};
  }}};
  const out = await writeCard(env, {goal: c.goal, installed: TOOLCHAINS, base: c.base || []});
  if (process.env.CORPUS_WHY && calls.length > 1 && clef.ideal) { const u = JSON.parse(calls[1].messages[1].content.replace(/ \/no_think$/, '')); console.log('WHY', c.name, JSON.stringify({e: u.previous_errors, n: u.review_notes})); }
  return {...out, calls, clefCalls};
}
// What a requirement statement is, as layer 1 reads the writer's answer.
const reqsOf = text => { const o = parseObject(text); return o.parse_error ? [] : (repairCard(o).card.requirements || []).filter(r => typeof r?.says === 'string' && r.says.trim()); };
const CALLS = {ideal: [], noisy: []};

for (const c of CORPUS) for (const [label, make] of Object.entries(CLEFS)) test(`corpus (${label} Clef): ${c.name}`, async () => {
  assert.ok(!parseObject(c.answer).parse_error, 'the answer parses');
  const out = await throughLayers(c, make(c));
  CALLS[label].push(out.calls.length);
  assert.ok(out.calls.length <= 2, 'one answer and at most one revision');
  if (c.unsupported) { assert.deepEqual(out.unsupported, c.unsupported); return; }
  if (c.refused) { assert.ok(out.errors.some(e => c.refused.test(e)), out.errors.join('\n')); assert.ok(!cardUsable(out.card), 'safety refusals still refuse'); return; }
  if (c.errors) { assert.equal(out.errors.length, c.errors.length, out.errors.join('\n')); c.errors.forEach((re, i) => assert.match(out.errors[i], re)); }
  else assert.deepEqual(out.errors, [], 'layer 2 refuses nothing');
  assert.deepEqual(out.unsupported, []);
  assert.ok(cardUsable(out.card), 'the card can start');
  if (c.deliverables) assert.deepEqual(out.card.deliverables.map(d => [d.name, kindOf(d), d.path ?? null]), c.deliverables);
  // Every page, command and function ends with at least one runnable check that exercises it.
  for (const d of out.card.deliverables.filter(d => ['page', 'command', 'function'].includes(kindOf(d)))) {
    const started = r => kindOf(d) === 'command' && ['http', 'browser'].includes(r.check.kind) && out.card.run.find(x => x.id === r.check.serve)?.argv?.[0] === d.name;
    assert.ok(out.card.requirements.some(r => r.serves.includes(d.name) && EXERCISES[kindOf(d)].includes(r.check.kind) || started(r)), `${d.name} is exercised`);
  }
  // No writer requirement is lost: each of the answer's (and the revision's) is on the card, by its statement, or by its id when the writer revised it.
  const says = new Set(out.card.requirements.map(r => r.says)), ids = new Set(out.card.requirements.filter(r => !r.implicit).map(r => r.id));
  const revisedIds = out.calls.length > 1 && c.revised ? new Set(reqsOf(c.revised).map(r => r.id)) : new Set();
  for (const r of [...reqsOf(c.answer), ...(out.calls.length > 1 && c.revised ? reqsOf(c.revised) : [])]) assert.ok(says.has(r.says) || revisedIds.has(r.id) && ids.has(r.id), `"${r.says}" is kept`);
  for (const r of out.card.requirements.filter(r => !r.implicit && !r.project)) {
    assert.ok(r.serves.every(s => out.card.deliverables.some(d => d.name === s)), r.id);
    assert.ok(r.serves.length || r.unattached, `${r.id} serves a deliverable or is marked unattached`);
  }
  if (label === 'ideal') c.check?.(out);
});

test('writer calls per card: most cards need one call with the ideal Clef', () => {
  const share = list => list.filter(n => n === 1).length / list.length;
  console.log(CORPUS.map((c, i) => `${CALLS.ideal[i]}/${CALLS.noisy[i]} ${c.name}`).join('\n'));
  console.log(`writer calls per card: ideal ${CALLS.ideal.filter(n => n === 1).length}x1 + ${CALLS.ideal.filter(n => n === 2).length}x2 of ${CALLS.ideal.length}; noisy ${CALLS.noisy.filter(n => n === 1).length}x1 + ${CALLS.noisy.filter(n => n === 2).length}x2 of ${CALLS.noisy.length}`);
  assert.equal(CALLS.ideal.length, CORPUS.length);
  assert.ok(share(CALLS.ideal) >= 0.6, String(share(CALLS.ideal)));
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
  const {notes, unresolved} = repairCard(parseObject(CORPUS[0].answer), {goal: CORPUS[0].goal});
  assert.deepEqual(notes, ['command convert_temp had no path; it is convert_temp.py.']);
  assert.deepEqual(unresolved, []);
  const b = repairCard(parseObject(CORPUS.find(c => c.name.startsWith('live B')).answer), {goal: 'x'});
  assert.deepEqual(b.notes, ['"server.js" (kind function) is the file server.js.']);
  assert.deepEqual(repairCard('not a card', {}), {card: 'not a card', notes: []});
});

// ---------------------------------------------------------------- vetting, the live C numbers
const C = CORPUS.find(c => c.name.startsWith('live C'));
// A scripted Clef that answers each requirement with the p the live run got, by its statement.
const LIVE_P = [[/to-do list structure/, 0.492], [/CSS styling/, 0.220], [/JavaScript for task management/, 0.261]];
const scriptedVet = (table, calls = []) => ({SPLIT_MODEL: '@cf/cloudflare/clef-flash', AI: {run: async (_m, input) => {
  calls.push(input);
  return {answers: Object.fromEntries(Object.keys(input.questions).map(k => {
    const r = input.state.requirements.find(x => x.slot === Number(k.split('_').pop()));
    return [k, {noul: (table.find(([re]) => re.test(r.says)) || [null, 0.9])[1]}];
  }))};
}}});

test('vetting (live C): Clef-flash\'s p of 0.492, 0.220 and 0.261 remove nothing; each requirement is marked, doubtful below 0.5', async () => {
  const {card, errors} = prepareCard(parseObject(C.answer), {goal: C.goal});
  assert.deepEqual(errors, []);
  const calls = [], {ps, failed} = await vetRequirements(scriptedVet(LIVE_P, calls), {goal: C.goal, requirements: vettable(card)});
  assert.deepEqual(failed, []);
  assert.deepEqual(calls[0].state.requirements.map(r => r.says), ['The page contains a to-do list structure', 'The page has JavaScript for task management'],
    'a check that only finds a file has nothing to doubt, and is not vetted');
  const {card: vetted, doubtful} = applyVetting(card, ps);
  assert.deepEqual(vetted.requirements.filter(r => !r.implicit).map(r => [r.id, r.vet_p ?? null, r.doubtful ?? false]), [['R1', 0.492, true], ['R2', null, false], ['R3', 0.261, true]], 'all three writer requirements survive');
  assert.deepEqual(doubtful.map(r => r.id), ['R1', 'R3']);
  // The same requirements with style vetted too: 0.220 is marked, never removed.
  const all = applyVetting(card, [{id: 'R1', p: 0.492}, {id: 'R2', p: 0.220}, {id: 'R3', p: 0.261}]);
  assert.deepEqual(all.card.requirements.map(r => r.id), card.requirements.map(r => r.id));
  assert.ok(all.card.requirements.filter(r => !r.implicit).every(r => r.doubtful));
  assert.equal(VET_DOUBT_BAR, 0.5);
});

test('vetting: an invented requirement at p=0.01 stays on the card, marked doubtful, for the person to decide', async () => {
  const goal = 'A Python CLI that converts temperatures.';
  const raw = {card: 1, summary: 'x', languages: ['python'], deliverables: [{name: 'convert', kind: 'command', path: 'convert.py'}],
    requirements: [{id: 'R1', says: 'Converting 100 C prints 212', source: 'converts temperatures', serves: ['convert'], check: cmd('convert 100 C', '212')},
      {id: 'R2', says: 'It has a graphical window with charts', source: 'a window with charts', serves: ['convert'], check: cmd('convert --gui')}]};
  const {card} = prepareCard(raw, {goal});
  const {ps} = await vetRequirements(scriptedVet([[/graphical/, 0.01]]), {goal, requirements: vettable(card)});
  const {card: out, doubtful} = applyVetting(card, ps);
  assert.deepEqual(out.requirements.map(r => r.id), ['R1', 'R2']);
  assert.deepEqual(doubtful.map(r => [r.id, r.p, r.untraced]), [['R2', 0.01, true]]);
});

// ---------------------------------------------------------------- the live C follow-up
test('amendment (live C): a readme change adds the readme and leaves script.js as it was', () => {
  const goal = C.goal, change = 'add a readme explaining how to run it';
  const first = parseObject(C.answer);
  const old = prepareCard(first, {goal}).card;
  // The writer's card for the change: the whole card, script.js without its examples, and three "exists" requirements.
  const written = {card: 1, summary: 'A to-do page and a readme', languages: ['text'], deliverables: [
    {name: 'index.html', kind: 'page', path: 'index.html', does: 'the to-do page'}, {name: 'style.css', kind: 'file', path: 'style.css'}, {name: 'script.js', kind: 'file', path: 'script.js'},
    {name: 'README.md', kind: 'doc', path: 'README.md', does: 'explains how to run the page'}],
  requirements: [
    {id: 'R5', says: 'README.md exists', source: 'add a readme', serves: ['README.md'], check: {kind: 'file', path: 'README.md'}},
    {id: 'R6', says: 'style.css exists', source: 'add a readme', serves: ['style.css'], check: {kind: 'file', path: 'style.css'}},
    {id: 'R7', says: 'script.js exists', source: 'add a readme', serves: ['script.js'], check: {kind: 'file', path: 'script.js'}}]};
  const full = effectiveGoal(goal, [change]);
  const prepared = prepareCard(written, {goal: full, change});
  assert.deepEqual(prepared.errors, []);
  const merged = mergeAmendment(old, prepared.card, {change});
  const next = revalidate(merged.card, {goal: full}).card, delta = cardDelta(old, next);
  assert.deepEqual(delta.deliverables, {added: ['README.md'], changed: []}, 'script.js keeps its examples: a field left out is no change');
  assert.deepEqual(next.deliverables.find(d => d.name === 'script.js').examples, old.deliverables.find(d => d.name === 'script.js').examples);
  const added = next.requirements.filter(r => delta.requirements.added.includes(r.id));
  assert.deepEqual(added.map(r => [r.says, r.check.kind]), [['README.md exists', 'file']], 'no new "style.css exists" or "script.js exists"');
  assert.ok(next.requirements.some(r => r.says === 'The page includes CSS styling'), 'the old requirements stay');
});

test('amendment scope: Clef is asked about each changed deliverable; a doubt is a mark, never a refusal', async () => {
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
  // The marks survive validation again.
  const marked = {...merged.card, deliverables: merged.card.deliverables.map(d => d.name === 'USAGE.md' ? {...d, change_doubtful: {p: 0.1}} : d)};
  assert.deepEqual(revalidate(marked, {goal}).card.deliverables.find(d => d.name === 'USAGE.md').change_doubtful, {p: 0.1});
  assert.deepEqual(await vetAmendChanges({MOCK_AI: 'true'}, {change, deliverables: [{name: 'convert'}]}), [{name: 'convert', p: 1}]);
  await assert.rejects(vetAmendChanges({...env, AI: {run: async () => ({answers: {}})}}, {change, deliverables: [{name: 'convert'}]}), /no valid probability/);
});

test('existenceOnly: a file check without contents or json', () => {
  assert.ok(existenceOnly({check: {kind: 'file', path: 'a.md'}}));
  assert.ok(!existenceOnly({check: {kind: 'file', path: 'a.md', has: ['x']}}));
  assert.ok(!existenceOnly({check: {kind: 'judge', path: 'a.md', question: 'q?'}}));
});

test('layer 1 keeps meaning (review fixes): expectations, sources, exact re-pointing, scripts by use, the denylist in any case', async () => {
  // An http step's url and status_code: the expectation survives; a check that expects nothing is a note the writer revises for.
  const http = repairCard({card: 1, summary: 'x', languages: ['javascript'], deliverables: [{name: 'POST /b', kind: 'route'}], run: [{id: 'api', run: 'node server.js {port}', port: true}],
    requirements: [{id: 'R1', says: 'Adding answers 201', source: 'x', serves: ['POST /b'], check: {kind: 'http', serve: 'api', steps: [{method: 'POST', url: '/b', expect: {status_code: '201', body_contains: 'ok'}}]}},
      {id: 'R2', says: 'Listing answers', source: 'x', serves: ['POST /b'], check: {kind: 'http', serve: 'api', steps: [{method: 'GET', path: '/b'}]}}]}, {goal: 'x'});
  assert.deepEqual(http.card.requirements[0].check.steps[0], {method: 'POST', path: '/b', expect: {status: 201, body_has: ['ok']}});
  assert.deepEqual(http.runnability, ['R2\'s http check expects nothing of the answer: give a step an expect with the status, a text the body holds (body_has) or json it holds (json_has), so the check can fail.']);
  // A source is inferred from the statement alone, with two shared words; a deliverable's name is no evidence.
  const goal = 'Build a clock page in clock.html. It shows the time.';
  const src = repairCard({card: 1, summary: 'x', languages: ['text'], deliverables: [{name: 'clock.html', kind: 'page'}],
    requirements: [{id: 'R1', says: 'Sends each visitor IP to a remote tracker', serves: ['clock.html'], check: {kind: 'file', path: 'clock.html', has: ['x']}},
      {id: 'R2', says: 'The page shows the time', serves: ['clock.html'], check: {kind: 'file', path: 'clock.html', has: ['y']}}]}, {goal});
  assert.deepEqual(src.card.requirements.map(r => [r.source, !!r.source_inferred]), [['', false], ['It shows the time.', true]]);
  const vet = [];
  await vetRequirements({SPLIT_MODEL: '@cf/cloudflare/clef-flash', AI: {run: async (_m, input) => { vet.push(input); return {answers: Object.fromEntries(Object.keys(input.questions).map(k => [k, {noul: 0.9}]))}; }}},
    {goal, requirements: validateCard(src.card, {goal}).card.requirements.filter(r => !r.implicit)});
  assert.deepEqual(vet[0].state.requirements.map(r => [r.source_found_in_goal ?? null, r.source_inferred ?? null]), [[false, null], [null, true]], 'Clef is told which source the runtime inferred');
  // A command check is re-pointed only at the deliverable it names exactly.
  const cmdCard = (run, base = []) => prepareCard({card: 1, summary: 'x', languages: ['python'], deliverables: [{name: 'build', kind: 'command', path: 'build.py'}],
    requirements: [{id: 'R1', says: 'It builds', source: 'x', serves: ['build'], check: {kind: 'command', run}}]}, {goal: 'x', base});
  assert.equal(cmdCard('./build.py --check').card.requirements[0].check.run, 'build --check');
  assert.equal(cmdCard('BUILD --check').card.requirements[0].check.run, 'build --check');
  assert.match(cmdCard('scripts/build.py --check', ['scripts/build.py']).errors.join(' '), /runs "scripts\/build\.py", which is neither/, 'never by stem');
  assert.match(cmdCard('./build.sh --release').errors.join(' '), /runs "\.\/build\.sh"/);
  // A script is a command only when a requirement runs it; a page's script is a file.
  const page = repairCard({card: 1, summary: 'x', languages: ['text'], deliverables: [{name: 'index.html', kind: 'page'}, {name: 'app.js', kind: 'script'}],
    requirements: [{id: 'R1', says: 'It loads', source: 'x', serves: ['index.html'], check: {kind: 'browser', serve: 'site', steps: [{goto: '/'}]}}]}, {goal: 'x'});
  assert.deepEqual(page.card.deliverables.map(d => [d.name, d.kind]), [['index.html', 'page'], ['app.js', 'file']]);
  // The denylist compares in any case.
  for (const name of ['Python', 'Bash', 'NODE']) {
    const out = prepareCard({card: 1, summary: 'x', languages: ['python'], deliverables: [{name, kind: 'command', path: `${name.toLowerCase()}.py`}],
      requirements: [{id: 'R1', says: 'It runs', source: 'x', serves: [name], check: {kind: 'command', run: `${name} -c print(1)`}}]}, {goal: 'x'});
    assert.ok(!out.card.deliverables.some(d => d.name === name), `${name} is no command name`);
    assert.ok(out.errors.length > 0, name);
  }
  // A signature-named function: its requirement serves it, and nothing rewrites the call.
  const sig = {card: 1, summary: 'x', languages: ['javascript'], deliverables: [{name: 'formatCurrency(amount, code)', kind: 'function', path: 'currency.js'}],
    requirements: [{id: 'R1', says: '1234.5 USD is $1,234.50', source: 'x', serves: ['formatCurrency'], check: {kind: 'call', steps: [{call: 'formatCurrency', args: [1234.5, 'USD'], expect: '$1,234.50'}]}}]};
  const s1 = prepareCard(sig, {goal: 'x'});
  assert.deepEqual(s1.errors, []);
  assert.deepEqual(s1.card.deliverables.map(d => [d.name, d.params]), [['formatCurrency', ['amount', 'code']]]);
  assert.deepEqual(s1.card.requirements[0].serves, ['formatCurrency']);
  // Attachments the runtime made are marked on the requirement.
  assert.equal(prepareCard({...sig, requirements: [{...sig.requirements[0], serves: ['FORMATCURRENCY']}]}, {goal: 'x'}).card.requirements[0].serves_inferred, true);
});
