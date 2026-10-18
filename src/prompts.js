// v8 §6: the prompts of the v8 pipeline, as data. A generative role's
// system prompt is ROLE[role] + FORMAT[role]: that role's own job and its
// own world, and nothing else. No text describes the structure around a
// role (who else works, what anyone else does, what anything is part of):
// an agent reads its own job, the data its request carries, and its answer
// format. Everything that belongs to one run (an assignment, a prompt, what
// the box has, a retry's reasons) goes in the user JSON, never here. Each
// text states a general principle with its reason, names no language,
// framework or product domain, and any example spans several domains, so no
// example can be copied into the work. test/prompt-lint.test.js holds every
// text here to that (§8.3). src/model.js keeps the call plumbing; the v7
// prompts stay there.

// §6.3: one paragraph per role, at most six sentences each.
export const ROLE = Object.freeze({
  splitter: 'Your role: state what your assignment delivers and how each delivery is checked, and divide the assignment into pieces that can each be made at the same time from its own task alone. You receive your assignment, your contracts (none when you state them), what your level already has, your packages, and any existing files and linked pages, quoted as reference. Declare through your functions the contracts of this level, each of yours by its name and any that one piece delivers for another to use, then validations: runnable checks, each showing different inputs or steps and what follows. Every function, command and route contract needs three different examples, each a call, request or run of it, since a contract is known by its validations alone. When piece is offered, declare through it the pieces of your division, two or more; then call done.',
  worker: 'Your role: write the files that deliver what your prompt asks. You receive your prompt (your task, what to deliver under which names and paths with examples of each, and the contracts you may call, each as declared), the paths of your files, complaints about them, answers to what you asked, and what is available to you by name. Deliver each item under exactly its name and at its path, so that each of its examples holds, since that is how your files are run. A contract you may call is delivered under its name at its path. A complaint says what was observed when your files ran: fix its cause in your files, and try your examples in your box. If you need something your prompt and what is available do not give, ask for it and meanwhile write the files independent of it.',
  builder: 'Your role: join files that were written apart, so that every reference among them reaches what it names. You receive the design, which states each contract, the piece that delivers it and its path, and the paths of the files, each with the piece it came from, or marked existing for a file the work starts from. Where a reference names something by another name or path than where it is, rename that name or path in the file, or write a small file of your own that makes the reference resolve where the defining file sits. A rename changes names and reference paths only, and a file of your own connects what the files already define, since what each file delivers is its own. Call done once every reference among the files reaches what it names.',
  compiler: 'Your role: find out whether the files you are given meet each of your validations, by running them. You receive your validations, each with the contracts it serves and its check as written, those contracts as declared, and the paths of the files. Your box holds the files, and run executes one command in it with the internet on, so install whatever building and running them needs, the way you judge best. Exercise each validation as its check describes, and give your verdict on it with result, saying what you observed. A failed result is read to correct the files, so its observation states exactly what happened against what the check expects. Call done once every validation has a result.'
});

export const FORMAT = Object.freeze({
  splitter: 'Answer by calling your functions, one or several at a time. Each result says what was stored, or exactly why nothing was: a call that stored nothing can be made again as its result describes. Names match exactly as declared, and level shows everything declared so far.',
  worker: 'Answer by calling your functions, one or several at a time. Each result says what was done, or exactly why nothing was. read_file shows a file of yours, write_file stores a whole file, and run executes one command in your own box, which holds your files as they stand, and shows what the process did. Call done once your files deliver everything your prompt asks, or wait, there while something you asked for is not answered yet.',
  builder: 'Answer by calling your functions, one or several at a time. Each result says what was done, or exactly why nothing was. read_file shows a file as it stands now, write_file stores a whole file of your own, delete_file removes one of yours, rename changes one name or reference path throughout one file, and done ends your turn.',
  compiler: 'Answer by calling your functions, one or several at a time. Each result says what was done, or exactly why nothing was. list_files and read_file show the files, run executes one command in your box and shows what the process did, result records your verdict on one validation, and done ends your turn.'
});

// The splitter's functions (Workers AI tools): what each does and takes, in
// the same terms as its role, with no filled-in value to copy. The runtime
// runs them (src/splitter.js); a result is all the feedback there is.
const KIND_LIST = ['function', 'file', 'page', 'route', 'command', 'doc', 'data'];
const names = desc => ({type: 'array', items: {type: 'string'}, description: desc});
// The splitter's validations: one function per check kind, each typed in
// full, so the platform shows the model every field's shape. Each call is one
// validation of the contracts it serves; the result gives its id, the
// examples it renders and how many different examples each contract it serves
// has so far, or why it cannot run.
const SERVES = names('The declared contracts it checks, by their names exactly as declared.');
const text = desc => ({type: 'string', description: desc});
const texts = desc => ({type: 'array', items: {type: 'string'}, description: desc});
const ANY = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'];
const CHECK_RESULT = ' The result gives the validation\'s id, the examples it renders and how many different examples each contract it serves has so far, or why it cannot run.';
const CHECK_TOOLS = [
  {name: 'file_check', description: 'Declares a validation that reads a file and looks for texts in it, each exactly as written. Each text is one example.' + CHECK_RESULT,
    parameters: {type: 'object', properties: {serves: SERVES, path: text('The path of the file, as a declared contract places it.'), has: texts('Texts the file contains, each exactly as written.'), json: {type: 'boolean', description: 'True when the file must parse as json.'}}, required: ['serves', 'path']}},
  {name: 'judge_check', description: 'Declares a validation a reader answers from one file alone: a yes or no question. One question is one example.' + CHECK_RESULT,
    parameters: {type: 'object', properties: {serves: SERVES, path: text('The path of the file the reader reads.'), question: text('A question answered yes or no from the file alone.')}, required: ['serves', 'path', 'question']}},
  {name: 'command_check', description: 'Declares a validation that runs a command in a fresh box and observes its exit and output. Each run is one example.' + CHECK_RESULT,
    parameters: {type: 'object', properties: {serves: SERVES,
      run: texts('The command as its argument list: a program or a declared command contract, then each argument, each passed exactly as written; no shell reads it. A command contract runs by its own file.'),
      stdin: text('What the command reads on its standard input.'),
      files: {type: 'object', additionalProperties: {type: 'string'}, description: 'Input files the command finds beside it: each relative path mapped to its text.'},
      expect: {type: 'object', properties: {exit: {type: 'integer', description: 'Its exit code.'}, stdout: text('Its whole standard output, exactly.'), stdout_has: texts('Texts its standard output contains.'), stderr_has: texts('Texts its error output contains.'), stderr: {type: 'boolean', description: 'True when it writes to its error output.'}},
        description: 'What it observes. With none, it observes an exit of 0.'}},
      required: ['serves', 'run']}},
  {name: 'call_check', description: 'Declares a validation that calls declared function contracts, in order, in one process, each by its name as declared. Each call is one example.' + CHECK_RESULT,
    parameters: {type: 'object', properties: {serves: SERVES, steps: {type: 'array', description: 'The calls, in order.', items: {type: 'object', properties: {
      call: text('A declared function contract.'), args: {type: 'array', items: {type: ANY}, description: 'Its arguments, as JSON values.'}, save: text('A name later arguments read as $name for what this call returns.'),
      expect: {type: ANY, description: 'The value it returns, as a JSON value.'}, expect_has: text('A text the value it returns contains.'), throws: {type: 'boolean', description: 'True when the call throws.'}}, required: ['call']}}}, required: ['serves', 'steps']}},
  {name: 'http_check', description: 'Declares a validation that starts a declared contract that states how it runs and sends it web requests, in order. Each request is one example.' + CHECK_RESULT,
    parameters: {type: 'object', properties: {serves: SERVES, serve: text('The declared contract to start: one that states its run.'), steps: {type: 'array', description: 'The requests, in order.', items: {type: 'object', properties: {
      method: {type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], description: 'GET when not given.'}, path: text('The path requested, starting with a single /.'), body: {type: ANY, description: 'The JSON body sent.'}, save: text('A name later paths and bodies read as $name for the JSON this request answers.'),
      expect: {type: 'object', properties: {status: {type: 'integer'}, body_has: texts('Texts the answer contains.'), json_has: {type: ANY, description: 'A JSON value the answer\'s JSON contains.'}}}}, required: ['path']}}}, required: ['serves', 'serve', 'steps']}},
  {name: 'browser_check', description: 'Declares a validation that starts a declared contract that states how it runs and drives it in a browser: one scenario of steps, in order, from a blank page (open one with goto). Each step runs exactly as written. One scenario is one example.' + CHECK_RESULT,
    parameters: {type: 'object', properties: {serves: SERVES, serve: text('The declared contract to start: one that states its run.'), steps: {type: 'array', description: 'The steps, in order; each holds exactly one of its fields.', items: {type: 'object', properties: {
      goto: text('A path to open, starting with a single /.'), reload: {type: 'boolean'}, press: text('A key to press.'),
      fill: {type: 'object', properties: {label: {type: 'string'}, placeholder: {type: 'string'}, role: {type: 'string'}, name: {type: 'string'}, text: {type: 'string'}}, description: 'The field and the text to enter. The field is the first shown one that matches every one given of: label, its label; placeholder; role, its ARIA role, with name its accessible name; name without role, its name attribute. Each matches exactly as written.'},
      click: {type: 'object', properties: {role: {type: 'string'}, name: {type: 'string'}, text: {type: 'string'}, label: {type: 'string'}}, description: 'What to click: the first shown element that matches every one given of: role, its ARIA role, with name its accessible name; name without role, its name attribute; text, its text; label, its label. Each matches exactly as written.'},
      expect_text: text('A text that appears.'), expect_no_text: text('A text that does not appear.'),
      expect_count: {type: 'object', properties: {role: {type: 'string'}, text: {type: 'string'}, n: {type: 'integer'}}, description: 'How many elements of a role, or holding a text, there are.'},
      expect_element: {type: 'object', properties: {selector: {type: 'string'}, text: {type: 'string'}}, required: ['selector'], description: 'An element by a selector, which the page\'s locator reads as written (a CSS selector), holding a text if given.'},
      expect_no_element: {type: 'object', properties: {selector: {type: 'string'}, text: {type: 'string'}}, required: ['selector'], description: 'An element that is not there.'}}}}}, required: ['serves', 'serve', 'steps']}}
];
export const CHECK_TOOL_KINDS = Object.freeze(Object.fromEntries(CHECK_TOOLS.map(t => [t.name, t.name.replace(/_check$/, '')])));
// A command in a box (the worker's and the compiler's run): its argument list and its input.
const RUN_PARAMETERS = {type: 'object', properties: {argv: texts('The program, then each argument, each a text.'), stdin: text('Text given to the command as its input, if any.')}, required: ['argv']};
export const TOOLS = Object.freeze({
  splitter: Object.freeze([
    {name: 'contract', description: 'Declares one contract of this level, stored exactly as given. The result says it is stored, or why it is not: a kind outside the seven, a missing path for a contract that lives in a file, or a name already declared.',
      parameters: {type: 'object', properties: {
        name: {type: 'string', description: 'A function by the name it is called by, stored as written; a command by any name; a run that starts with that name runs its file; a route as a request method in capitals, a space and a path; a file, page, doc or data contract by its path.'},
        kind: {type: 'string', enum: KIND_LIST, description: 'What the contract is.'},
        path: {type: 'string', description: 'The relative path of its file. A file, page, doc, data, command or function contract has one; a call check calls a function in the file its contract names.'},
        does: {type: 'string', description: 'What it does, in one line.'},
        inputs: {type: 'array', items: {type: 'object', properties: {name: {type: 'string'}, is: {type: 'string'}}, required: ['name']}, description: 'Its inputs, each with its name and what it is.'},
        outputs: {type: 'string', description: 'In one line, what a call returns, a command prints, a route answers or a file holds.'},
        effects: {type: 'string', description: 'What it changes, or none.'},
        run: {type: 'object', properties: {static: {type: 'boolean'}, run: {type: 'array', items: {type: 'string'}}, ready: {type: 'string'}}, description: 'Only for a page, route or command: how it is started. static true serves its files as they are. run is the command as its argument list, a program or a command contract, then each argument, each passed exactly as written with no shell, and ready a path that answers once it is up; it serves on the port its environment gives. A contract that states no run is not started.'}
      }, required: ['name', 'kind', 'does']}},
    ...CHECK_TOOLS,
    {name: 'piece', description: 'Declares one piece of the division: a task that can be made from its own words alone, and the declared contracts it delivers. The result says it is stored, or why it is not, such as how many pieces the level can hold now.',
      parameters: {type: 'object', properties: {
        label: {type: 'string', description: 'A few words naming what it produces.'},
        task: {type: 'string', description: 'What it must produce, in full sentences.'},
        contracts: names('The declared contracts it delivers, by their names exactly as declared.'),
        uses: names('The contracts it relies on: declared ones, ones your level already has, or ones you may call.'),
        packages: names('Names from your_packages it needs.'),
        refs: names('Outline refs of the linked pages it must read.')
      }, required: ['label', 'task', 'contracts']}},
    {name: 'drop_piece', description: 'Takes one declared piece out of the division, by its label. The result says it is taken out, with the count of pieces left, or that no piece has that label.',
      parameters: {type: 'object', properties: {label: {type: 'string', description: 'The label of a declared piece, exactly as declared.'}}, required: ['label']}},
    {name: 'drop_validation', description: 'Takes one validation listed with an id in validations_you_have out of what your contracts are known by, such as one whose expected value is not what they should hold; a check function states what replaces it. The result says it is taken out, or that no validation there has that id.',
      parameters: {type: 'object', properties: {id: {type: 'string', description: 'The id of a validation in validations_you_have, exactly as listed.'}}, required: ['id']}},
    {name: 'level', description: 'Shows everything declared so far: the contracts, the validations with their examples, and the pieces.', parameters: {type: 'object', properties: {}, required: []}},
    {name: 'read_file', description: 'Shows one of the files the work starts from, whole: any path existing_files lists. The result is its text, or that there is no such file at that path.',
      parameters: {type: 'object', properties: {path: {type: 'string', description: 'The relative path of the file, exactly as existing_files lists it.'}}, required: ['path']}},
    {name: 'done', description: 'Completes the level. When something is still missing, the result lists it and the level stays open: three different examples for every function, command and route contract, each a call, request or run of that contract, and, when piece is offered, a division of at least two pieces and no more than the level can hold now. A division is reviewed when done completes it; one that is not admitted comes back in the result, listed in rejected with why, and the level stays open with everything declared.', parameters: {type: 'object', properties: {}, required: []}}
  ]),
  // The worker's functions (src/worker.js): its own files, commands in its
  // own box, an ask by name, and the end of its turn.
  worker: Object.freeze([
    {name: 'read_file', description: 'Shows one of your files as it stands now, written this turn or before, or, where you have none at the path, a file existing_files lists. The result is its whole text, or that you have no file at that path, with the paths you have.',
      parameters: {type: 'object', properties: {path: text('The relative path of the file, exactly as your files list it.')}, required: ['path']}},
    {name: 'write_file', description: 'Stores a whole file at a path among your files: a new file, or the complete new text of one you have. The result says it is written, that the file already holds exactly this text, or why it is not written.',
      parameters: {type: 'object', properties: {path: text('The relative path of the file, inside your files.'), content: text('The complete text of the file.')}, required: ['path', 'content']}},
    {name: 'run', description: 'Runs one command in your own box, in the folder that holds your files as they stand now, with the internet on: the program and each argument as given, with no shell unless the argument list names one. Use it to install what you need, and to build and try your files. What a command changes in the box stays for the next. The result is what the process did: its exit code, its output and error output as printed, and whether it ran out of time.',
      parameters: RUN_PARAMETERS},
    {name: 'ask', description: 'Asks for something your prompt and what is available do not give. What you deliver, your packages, and the existing files and parts of linked pages given to you are answered at once, by name. Any other ask, a name you may call included, is sent as you make it, and the result says it is sent: its answer arrives at the start of your next turn.',
      parameters: {type: 'object', properties: {need: text('What you need, in one line.'), name: text('The name you expect it under, or the name of something available.')}, required: ['need']}},
    {name: 'done', description: 'Ends your turn with your files delivering everything your prompt asks.',
      parameters: {type: 'object', properties: {summary: text('What you did, in one line.')}, required: ['summary']}},
    {name: 'wait', description: 'Ends your turn while something you asked for is not answered yet. The answer starts your next turn.',
      parameters: {type: 'object', properties: {summary: text('What you did and what you wait for, in one line.')}, required: ['summary']}}
  ]),
  // The builder's functions (src/builder.js): the files it joins, its own
  // files (the glue), renames of names in its copies, and the end of its turn.
  builder: Object.freeze([
    {name: 'read_file', description: 'Shows one of the files as it stands now, your renames and your own files included. The result is its whole text, why an existing file carried as it is has none, or that there is no file at that path, with the paths there are.',
      parameters: {type: 'object', properties: {path: text('The relative path of the file, exactly as the files list it.')}, required: ['path']}},
    {name: 'write_file', description: 'Stores a whole file of your own at a path: a new file that connects names, or the complete new text of one of yours. A delivered or existing file stays the file at its path, so yours written at that path goes in your own folder. The result says where it is written, that the file already holds exactly this text, or why it is not written.',
      parameters: {type: 'object', properties: {path: text('The relative path of the file.'), content: text('The complete text of the file.')}, required: ['path', 'content']}},
    {name: 'delete_file', description: 'Removes one file of your own. The result says it is removed, or that you have no file at that path, with the paths of yours.',
      parameters: {type: 'object', properties: {path: text('The relative path of the file of yours.')}, required: ['path']}},
    {name: 'rename', description: 'Renames one name or reference path throughout one file: every place where from stands whole, as the file\'s language delimits its names, becomes to. It stands whole where no letter, digit or one of name_characters is right before or after it. The result shows each line it changed, or why nothing changed.',
      parameters: {type: 'object', properties: {path: text('The relative path of the file.'), from: text('The name or reference path as the file has it.'), to: text('The name or reference path it becomes.'),
        name_characters: text('Every character besides letters and digits that the file\'s language allows inside a name, written together; empty for none.')}, required: ['path', 'from', 'to', 'name_characters']}},
    {name: 'done', description: 'Ends your turn with every reference among the files reaching what it names.',
      parameters: {type: 'object', properties: {summary: text('What you did, in one line.')}, required: ['summary']}}
  ]),
  // The compiler's functions (src/compiler.js): the files in its box,
  // commands there, its verdict on each validation, and the end of its turn.
  compiler: Object.freeze([
    {name: 'list_files', description: 'Lists the paths of the files you were given, which your box holds.', parameters: {type: 'object', properties: {}, required: []}},
    {name: 'read_file', description: 'Shows one of the files you were given, whole. The result is its text, or that there is no file at that path, with the paths there are.',
      parameters: {type: 'object', properties: {path: text('The relative path of the file, exactly as the files list it.')}, required: ['path']}},
    {name: 'run', description: 'Runs one command in your box, in the folder that holds the files, with the internet on: the program and each argument as given, with no shell unless the argument list names one. What a command changes in the box stays for the next. The result is what the process did: its exit code, its output and error output as printed, and whether it ran out of time.',
      parameters: RUN_PARAMETERS},
    {name: 'result', description: 'Records your verdict on one validation: whether the files meet it, with what you observed. A later result for the same validation replaces the earlier one.',
      parameters: {type: 'object', properties: {validation: text('The id of the validation, exactly as listed.'), passed: {type: 'boolean', description: 'True when the files meet the validation as its check describes.'},
        observed: text('What you observed when you exercised it; on a failure, exactly what happened against what the check expects.')}, required: ['validation', 'passed', 'observed']}},
    {name: 'done', description: 'Ends your turn. A validation you gave no result for has none, and is not passed.', parameters: {type: 'object', properties: {}, required: []}}
  ])
});
// The texts of a role's functions, by name, for the lint.
const toolTexts = (role, list) => Object.fromEntries(list.flatMap(t => [[`TOOLS.${role}.${t.name}`, t.description],
  ...Object.entries(t.parameters.properties).filter(([, p]) => p.description).map(([k, p]) => [`TOOLS.${role}.${t.name}.${k}`, p.description])]));

// §6.4: the Clef questions, all typed noul. {i}, {j} and {contract} are
// filled by clefText; a key's state object travels beside it.
export const CLEF = Object.freeze({
  // Each division a splitter proposes is reviewed in one call: given the original and the pieces, split_valid and split_size.
  split_valid: 'Is this a valid division of the original: do the pieces together deliver all of it, each one something a different maker can produce at the same time against the contracts listed? Answer NO if a piece repeats another, only plans or discusses, or must wait for another piece to be written first.',
  split_size: 'Is every piece large enough to be worth a maker of its own? Answer NO if a piece is only a single small function, a constant, or a few lines that belong with another piece.',
  // A manager's choice: each function it may call on an ask, a complaint or a change is one option, and the highest is called.
  answer: 'Does contract {j} give what the request needs, so the requester can use it instead of making its own? Answer NO if it does something else or only part of it. Judge by what it does, not by its name.',
  grant: 'Does package {j} give what the request needs, so the requester can use it instead of making its own? Answer NO if it does something else or only part of it.',
  route_complaint: 'Does child {i}\'s responsibility, as its contracts and the files it wrote show, cover what this complaint is about?',
  route_change: 'Does this change concern what child {i} delivers, as its contracts show? Answer NO if it leaves everything child {i} delivers as it is.',
  extend_complaint: 'Is this complaint about a contract of the assigned work that no child delivers, as their contracts show?',
  extend_change: 'Does this change ask for something none of the children delivers, as their contracts show, that the assigned work must add?',
  ask_parent: 'Does none of the contracts or packages offered give what the request needs, so it is asked one level up? Answer NO if one of them gives it.',
  // Whether a validation held at a piece can run on the assembled piece alone: everything it reaches is the piece's, an installed package's or the language's.
  piece_reach: 'Piece {name} delivers the contracts listed and is made of the files listed. When check {i} exercises it as described, does everything it reaches come from these files, the installed packages or the language? Answer NO if it reaches what another piece provides, such as a route a page requests, a file read while it runs, or another piece\'s function.'
});
export const clefText = (key, vars = {}) => CLEF[key].replace(/\{(\w+)\}/g, (m, k) => k in vars ? String(vars[k]) : m);

// Why a division the splitter completed was not admitted: done's result
// (problems, beside the division in rejected), and, when its session goes on
// in a new context, previous_answer_problems in its request; never in the system text.
export const RETRY = Object.freeze({
  too_small: count => `The division you completed, listed in rejected, had ${count} pieces, some too small to be worth a task of their own. Divide the assignment into larger pieces: drop_piece takes a piece out and piece declares one; then call done again.`,
  different: 'The division you completed, listed in rejected, was not a valid division of the assignment. Divide it differently: drop_piece takes a piece out and piece declares one; then call done again.'
});

// The texts the room itself composes for a v8 agent, as data. Each is a
// function of one object whose fields are strings the room fills in.
// test/prompt-lint.test.js lints each one.
const it = many => many ? 'them' : 'it';
export const BASE_LABEL = 'from the base repository';
export const MESSAGES = Object.freeze({
  // A splitter's restatement of one piece (restate in its request): what the complaints say, and how it states the piece anew.
  restate: () => 'complaints lists what was observed when the files delivering your assignment ran, and that they did not change in answer: the assignment as stated does not say what was observed should hold. State it anew: piece states its task and the contracts it delivers, under label; contract states one of contracts_you_deliver anew under its own name; a check function states a validation, and drop_validation takes out one whose expected value is not what the contracts should hold. Then call done.',
  // The clause beside existing files whenever their text is quoted.
  base_note: () => 'existing_files lists every file the work starts from, by path and size, and read_file shows any of them whole; base_files quotes the ones given to you.',
  // ------------------------------------------------- what the worker's functions say
  ask_sent: () => 'Sent. Its answer arrives at the start of your next turn, in answers.',
  unchanged: ({path}) => `unchanged: ${path} is already exactly this text.`,
  no_file: ({path, paths}) => paths ? `You have no file ${path}. Your files: ${paths}.` : `You have no file ${path}, and no files yet.`,
  // A place a repository holds no file at (src/validations.js unheldPath): its own records folder, or longer than it holds.
  records_folder: ({path}) => `${path} is in the folder a repository keeps for its own records, outside the files.`,
  too_long: ({path}) => `${path} is longer than a repository holds: a name of up to 255 characters, in a path of up to 512.`,
  // ------------------------------------------------- what the builder's functions say
  no_validation: ({id, ids}) => `There is no validation ${id}. Your validations: ${ids}.`,
  builder_no_file: ({path, paths}) => paths ? `There is no file ${path}. The files: ${paths}.` : `There is no file ${path}, and no files yet.`,
  builder_not_yours: ({path, paths}) => paths ? `You have no file at ${path}. Yours: ${paths}.` : `You have no file at ${path}, and none of your own yet.`,
  builder_beside: ({path, piece, at}) => `${path} is ${piece ? `the file ${piece} delivered` : 'an existing file'}, which stays the file there; yours is written at ${at}.`,
  builder_no_text: ({path, why}) => `${path} is an existing file carried as it is (${why}), with no text to rename in.`,
  builder_no_name: ({name, path, inside}) => `${name} does not stand whole anywhere in ${path}: a rename finds it only where no letter${inside ? `, digit or one of ${inside}` : ' or digit'} is right before or after it.`,
  // ------------------------------------------------------------ answers to asks
  provided: ({contract}) => `${contract}.`,
  own_contract: ({contract}) => `${contract} is in your own prompt: write it in your files under exactly that name.`,
  // ------------------------------------------------------------ the broker
  available_note: () => 'available lists what you can ask for by name with ask: what you deliver, the names you may call, your installed packages, existing files open to you and parts of linked pages. Each answer is labelled with where it comes from.',
  available_package: ({provides}) => provides ? `an installed package for ${provides}` : 'an installed package',
  // What the box observed when it did not install a package (its words), for whoever holds it.
  package_yours: ({names, many}) => `Your packages hold ${names}: use ${it(many)} as ${many ? 'they are' : 'it is'}.`,
  package_granted: ({names, many}) => `${names} ${many ? 'are' : 'is'} now in your packages: install and use ${it(many)} in your box.`,
  // What a piece's ask for a package its split named says (spawn): the name alone.
  package_need: ({name}) => `the package ${name}`,
  available_own: () => 'what you deliver',
  available_use: () => 'a name you may call',
  available_base: () => 'an existing file: the answer quotes its text',
  available_source: ({part, title}) => `part ${part} of the linked page "${title}"`,
  answers_note: () => 'answers holds what your asks returned; each quoted text says where it comes from.'
});
// The label each broker answer carries.
export const BROKER_LABEL = Object.freeze({
  base: BASE_LABEL,
  source: url => `fetched from ${url}`
});

// Every text above that a model reads, by name, for the lint (§8.3).
export function promptTexts() {
  const out = {};
  for (const [k, v] of Object.entries(ROLE)) out[`ROLE.${k}`] = v;
  for (const [k, v] of Object.entries(FORMAT)) out[`FORMAT.${k}`] = v;
  for (const [k, v] of Object.entries(CLEF)) out[`CLEF.${k}`] = v;
  for (const [role, list] of Object.entries(TOOLS)) Object.assign(out, toolTexts(role, list));
  // Each message with every field filled by a sample (a plural where it has one).
  const filled = new Proxy({}, {get: (_, k) => k === 'many' ? true : `sample ${String(k)}`});
  for (const [k, f] of Object.entries(MESSAGES)) out[`MESSAGES.${k}`] = f(filled);
  const sample = {too_small: f => f(5)};
  for (const [k, v] of Object.entries(RETRY)) out[`RETRY.${k}`] = typeof v === 'function' ? sample[k](v) : v;
  return out;
}

// A generative role's whole system prompt: its own job, then its format.
export const systemPrompt = role => `${ROLE[role]}\n\n${FORMAT[role]}`;
