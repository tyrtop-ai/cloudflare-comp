// v8 slice S2: language-neutral contracts (src/contracts.js). A contract is
// a function, a file, a page, a route, a command, a document or a data file;
// a v7 promise {name, does, params, returns, operation} is a function
// contract with nothing lost. Name rules per kind, C4 on paths, C9, one
// renderer by kind, and serves inherited through a split's uses.
import test from 'node:test';
import assert from 'node:assert/strict';
const C=await import('../src/contracts.js');
const I=await import('../src/interfaces.js');
const {normalizeAction}=await import('../src/protocol.js');
const {normalizeContracts,normalizeContract,contractErrors,contractLine,nameError,inheritServes,kindOf,contractInputs,contractOutputs}=C;

// Toolchain rows as data (the shape of src/toolchains.js, §4.5), trimmed to what the name rules read.
const ROWS=[
  {id:'javascript',extensions:['.js','.mjs','.cjs'],identifier:'^[A-Za-z_$][A-Za-z0-9_$]{0,63}$',reserved:'await break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield'},
  {id:'python',extensions:['.py'],identifier:'^[A-Za-z_][A-Za-z0-9_]{0,63}$',reserved:'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'},
  {id:'text',extensions:['.md','.txt','.html','.css','.json']}];
const PY={rows:ROWS,languages:['python','text']};
const piece=(label,...contracts)=>({label,task:'Write it',interfaces:normalizeContracts(contracts)});

test('S2: old {params, returns, operation} rows normalize to function contracts unchanged, and normalizing again changes nothing',()=>{
  const rows=[
    {name:'createTicket',does:'creates a ticket and returns it.',params:['title','description'],returns:'The created ticket.',operation:'create a ticket'},
    {name:'saveTickets',does:'',params:'tickets',returns:'nothing'},
    {name:'readTickets',returns:'returns a promise that resolves when done'},
    'getTickets(): returns all tickets',
    'deleteTicket(id)'];
  const once=normalizeContracts(rows);
  assert.deepEqual(once,[
    {name:'createTicket',does:'creates a ticket and returns it',params:['title','description'],returns:'The created ticket',operation:'create a ticket'},
    {name:'saveTickets',does:'',params:['tickets'],returns:'nothing'},
    {name:'readTickets',does:'',params:[],returns:'nothing'},
    {name:'getTickets',does:'returns all tickets',params:[]},
    {name:'deleteTicket',does:'',params:['id']}]);
  assert.ok(once.every(f=>!('kind' in f)&&kindOf(f)==='function'),'a function contract carries no kind field: kind defaults to function');
  assert.deepEqual(normalizeContracts(once),once,'lossless: a stored row reads back as itself');
  assert.equal(I.normalizeInterfaces,normalizeContracts,'normalizeInterfaces is the alias until S7');
  // Read through the v8 accessors, a v7 row is a function contract: params are its inputs, returns its outputs.
  assert.deepEqual(contractInputs(once[0]),[{name:'title',is:''},{name:'description',is:''}]);
  assert.equal(contractOutputs(once[0]),'The created ticket');
});

test('S2: the v8 spelling of a function keeps params and returns, so v7 readers see the same promise; inputs stay when they say what each is',()=>{
  const [f]=normalizeContracts([{name:'count_words',kind:'function',does:'counts the words in a text.',inputs:[{name:'text',is:'the text to count'}],outputs:'the number of words.',effects:'none',
    examples:[{given:['a b'],expect:2},{given:['x'],expect:1},{given:[''],expect:0},{given:['a  b'],expect:2},{given:['c'],expect:1}],serves:['R1','R1',' R2 ',7],path:'counter.py',operation:'ignored? no: kept'}]);
  assert.deepEqual(f,{name:'count_words',does:'counts the words in a text',params:['text'],inputs:[{name:'text',is:'the text to count'}],returns:'the number of words',effects:'none',
    examples:[{given:['a b'],expect:2},{given:['x'],expect:1},{given:[''],expect:0},{given:['a  b'],expect:2}],path:'counter.py',serves:['R1','R2'],operation:'ignored? no: kept'});
  assert.deepEqual(normalizeContracts([f]),[f]);
  // An unknown kind is a function (old rows); examples without both sides, and oversized values, are dropped.
  assert.deepEqual(normalizeContract({name:'f',kind:'widget',examples:[{given:1},{expect:2},{given:'x'.repeat(400),expect:1},{given:{a:'y'.repeat(400)},expect:1}]}),{name:'f',does:'',params:[],examples:[{given:'x'.repeat(300),expect:1}]});
});

test('S2: other kinds normalize with their own fields: a file, page, doc or data contract is at its path; outputs are kept as written',()=>{
  assert.deepEqual(normalizeContracts([
    {name:'README.md',kind:'doc',does:'how to install and run the converter.'},
    {name:'index.html',kind:'page',does:'the recipe scaler page',outputs:'a form and the scaled list',path:'index.html'},
    {name:'GET /items',kind:'route',does:'lists the items',inputs:['page','size'],outputs:'nothing'},
    {name:'convert',kind:'command',does:'converts a temperature',params:['value','unit'],outputs:'the converted value',path:'convert.py',examples:[{given:'convert 100 C',expect:'212'}]},
    {name:'data/units.json',kind:'data',path:'data/units.json',serves:['R3']},
    {name:'docs/../x.md',kind:'doc'}]),[
    {name:'README.md',kind:'doc',does:'how to install and run the converter',params:[],path:'README.md'},
    {name:'index.html',kind:'page',does:'the recipe scaler page',params:[],outputs:'a form and the scaled list',path:'index.html'},
    {name:'GET /items',kind:'route',does:'lists the items',params:['page','size'],outputs:'nothing'},
    {name:'convert',kind:'command',does:'converts a temperature',params:['value','unit'],outputs:'the converted value',path:'convert.py',examples:[{given:'convert 100 C',expect:'212'}]},
    {name:'data/units.json',kind:'data',does:'',params:[],path:'data/units.json',serves:['R3']},
    {name:'docs/../x.md',kind:'doc',does:'',params:[]}]);
  // A non-function name is never read as a signature.
  assert.equal(normalizeContract({name:'GET /items(x)',kind:'route'}).name,'GET /items(x)');
  // Merged by name: the first keeps its fields, a later one fills what it lacks, serves are joined.
  assert.deepEqual(normalizeContracts([{name:'README.md',kind:'doc',serves:['R1']},{name:'README.md',kind:'doc',does:'usage',serves:['R2']}]),[{name:'README.md',kind:'doc',does:'usage',params:[],path:'README.md',serves:['R1','R2']}]);
});

test('S2: name rules per kind: a function by its toolchain row (a Python reserved word, a JavaScript-only name), a route, a command with its file, a placed path',()=>{
  const fn=(name,extra={})=>normalizeContract({name,...extra});
  assert.equal(nameError(fn('count_words'),PY),'');
  assert.equal(nameError(fn('lambda'),PY),'"lambda" is not a valid python function name (a reserved word)');
  assert.equal(nameError(fn('$count'),PY),'"$count" is not a valid python function name');
  assert.equal(nameError(fn('$count'),{rows:ROWS,languages:['javascript']}),'','a JavaScript name');
  assert.equal(nameError(fn('lambda'),{rows:ROWS,languages:['javascript']}),'');
  assert.equal(nameError(fn('lambda',{path:'app.js'}),PY),'','the function\'s path names its row');
  assert.equal(nameError(fn('$count')),'','without facts a function name is read as JavaScript (v7)');
  assert.equal(nameError(fn('require')),'"require" is not a valid javascript function name (a reserved word)','v7\'s protected names stay JavaScript\'s');
  assert.equal(nameError(fn('lambda'),{rows:ROWS}),'"lambda" is not a valid python function name (a reserved word)','with no language given, a name must hold in every row');
  const route=name=>nameError(normalizeContract({name,kind:'route'}));
  assert.deepEqual(['GET /items','POST /items/:id','DELETE /','get /items','FETCH /items','GET items','GET /a b'].map(route).map(Boolean),[false,false,false,true,true,true,true]);
  const cmd=(name,path)=>nameError(normalizeContract({name,kind:'command',...(path?{path}:{})}));
  assert.equal(cmd('convert','convert.py'),'');
  assert.equal(cmd('convert-units','bin/convert.py'),'');
  assert.equal(cmd('Convert','convert.py'),'"Convert" is not a command name: lowercase letters, digits and hyphens, starting with a letter');
  assert.equal(cmd('convert'),'command "convert" needs the path of the file that implements it');
  assert.equal(nameError(normalizeContract({name:'readme',kind:'doc',path:'README.md'})),'doc "readme" must be named by its path README.md');
  assert.equal(nameError(normalizeContract({name:'glue/x.md',kind:'doc'})),'doc "glue/x.md" cannot be placed at glue/x.md; choose a project path outside components/, memory/, .recursive/, glue/');
  assert.equal(nameError(normalizeContract({name:'docs/../x.md',kind:'doc'})),'doc "docs/../x.md" needs the path of its file');
});

test('S2: contractErrors: C1 by kind, C2, C4 by name and by path, C3 in contracts, C5 quoting the contract, C9; v7 words without facts',()=>{
  const errors=contractErrors([
    piece('CLI',{name:'convert',kind:'command',path:'cli.py'},{name:'lambda'},{name:'get /x',kind:'route'}),
    piece('Export',{name:'export',kind:'command',path:'cli.py'},{name:'example.md',kind:'doc'},{name:'foo'}),
    piece('Docs',{name:'README.md',kind:'doc'},{name:'a.md',kind:'doc'},{name:'b.md',kind:'doc'},{name:'c.md',kind:'doc'},{name:'d.md',kind:'doc'},{name:'e.md',kind:'doc'})],
    [{name:'guide.md',kind:'doc',does:'the user guide',params:[],path:'guide.md'}],{facts:PY});
  assert.deepEqual(errors.map(e=>[e.check,e.text]),[
    ['C1','"CLI": "lambda" is not a valid python function name (a reserved word).'],
    ['C1','"CLI": "get /x" is not a route; name it as a method and a path, such as "GET /path".'],
    ['C2','"Export": "foo" is copied from the example; name the function after what it does.'],
    ['C4','cli.py is placed by both "CLI" and "Export"; give each file to exactly one piece.'],
    ['C3','"Docs" lists 6 contracts; list at most 5, only those another piece uses or your assignment promises.'],
    ['C5','Your assignment promises doc guide.md: the user guide; give it, unchanged, to exactly one piece, the one whose task writes it.']]);
  // "example.md" is a path, not a copied example name; a command and a doc at one path in one piece is one carrier.
  assert.deepEqual(contractErrors([piece('One',{name:'run',kind:'command',path:'run.py'},{name:'run.py',kind:'file'})],[],{facts:PY}).map(e=>e.check),[]);
  // Without facts a function name is JavaScript and C1 keeps v7's words.
  assert.deepEqual(contractErrors([piece('Entry',{name:'create-ticket'})]).map(e=>e.text),['"Entry": "create-ticket" is not a plain JavaScript function name; use an identifier such as createTicket.']);
  // interfaceErrors is contractErrors plus v7's C8 and C7, which read functions only.
  assert.deepEqual(I.interfaceErrors([piece('Files',{name:'readFileSync'},{name:'readFile.md',kind:'doc'})],[]).map(e=>e.check),['C8']);
});

test('S2: C9: a function named as the stem of a placed file in its language is an error on the piece that adds it',()=>{
  const C9=(spawn,promised=[],facts=PY)=>contractErrors(spawn,promised,{facts}).filter(e=>e.check==='C9').map(e=>e.text);
  assert.deepEqual(C9([piece('CLI',{name:'convert',kind:'command',path:'convert.py'}),piece('Core',{name:'convert'})]),['"Core": function convert has the name of the file convert.py; name the function differently.']);
  assert.deepEqual(C9([piece('Core',{name:'convert',path:'lib/convert.py'}),piece('CLI',{name:'convert',kind:'command',path:'convert.py'})]),['"Core": function convert has the name of the file convert.py; name the function differently.']);
  // A promised function is the parent's: the new file is the one to move.
  assert.deepEqual(C9([piece('Core',{name:'convert'}),piece('Data',{name:'convert.py',kind:'file'})],[{name:'convert',does:'',params:[]}]),['"Data": the file convert.py has the name of the function convert; place the file at another path.']);
  // Another language, a text file, or a different stem is no collision.
  assert.deepEqual(C9([piece('CLI',{name:'convert',kind:'command',path:'convert.py'}),piece('Core',{name:'convert',path:'convert.js'})]),[]);
  assert.deepEqual(C9([piece('Docs',{name:'convert.md',kind:'doc'}),piece('Core',{name:'convert'})]),[]);
  assert.deepEqual(C9([piece('CLI',{name:'convert',kind:'command',path:'cli.py'}),piece('Core',{name:'convert'})]),[]);
  // Both promised: the parent's split already passed it.
  assert.deepEqual(C9([piece('A',{name:'convert'}),piece('B',{name:'convert.py',kind:'file'})],[{name:'convert',does:'',params:[]},{name:'convert.py',kind:'file',does:'',params:[],path:'convert.py'}]),[]);
});

test('S2: contractLine renders each kind on one line; promiseText and signature use it for every kind but a function',()=>{
  const line=x=>contractLine(normalizeContract(x));
  assert.equal(line({name:'count_words',does:'counts the words',inputs:['text'],outputs:'the count',examples:[{given:['a b'],expect:2}]}),'function count_words(text): counts the words; returns the count; e.g. count_words("a b") → 2');
  assert.equal(line({name:'scale',params:['recipe','n'],returns:'the scaled recipe',effects:'none',examples:[{given:[{flour:100},2],expect:{flour:200}},{given:'x',expect:'X'}]}),'function scale(recipe, n): returns the scaled recipe; e.g. scale({"flour":100}, 2) → {"flour":200}; scale("x") → "X"');
  assert.equal(line({name:'save',inputs:[{name:'note',is:'the note to keep'}],effects:'the notes file, which this module owns'}),'function save(note): takes note (the note to keep); changes the notes file, which this module owns');
  assert.equal(line({name:'README.md',kind:'doc',does:'how to install and run'}),'doc README.md: how to install and run');
  assert.equal(line({name:'GET /items',kind:'route',does:'lists the items',inputs:['page'],outputs:'a JSON array of items'}),'route GET /items: lists the items; responds with a JSON array of items; takes page');
  assert.equal(line({name:'convert',kind:'command',params:['value','unit'],outputs:'the converted value',path:'convert.py',examples:[{given:'convert 100 C',expect:'212'}]}),'command convert (value, unit) in convert.py: prints the converted value; e.g. convert 100 C → 212');
  assert.equal(line({name:'index.html',kind:'page',outputs:'the scaled ingredient list'}),'page index.html: shows the scaled ingredient list');
  assert.equal(line({name:'units.json',kind:'data'}),'data units.json');
  assert.equal(contractLine({}),'');
  // One renderer: v7's promise text for a function, contractLine otherwise.
  assert.equal(I.promiseText({name:'getTickets',does:'returns all tickets',params:[]}),'getTickets(): returns all tickets');
  assert.equal(I.promiseText(normalizeContract({name:'README.md',kind:'doc',does:'usage'})),'doc README.md: usage');
  assert.equal(I.promiseText(normalizeContract({name:'f',examples:[{given:[1],expect:2}]})),'f(); e.g. f(1) → 2');
  assert.deepEqual(['f','README.md','GET /x','go'].map((name,i)=>I.signature(normalizeContract({name,kind:['function','doc','route','command'][i],params:['a'],path:i===3?'go.py':undefined}))),['f(a)','doc README.md','route GET /x','command go (a) in go.py']);
});

test('S2: serves: a carried contract keeps its own; a contract a split adds serves what the pieces using it serve, through a chain; unused ones serve nothing',()=>{
  const promised=normalizeContracts([{name:'convert',kind:'command',path:'convert.py',serves:['R1','R2']},{name:'README.md',kind:'doc',serves:['R3']}]);
  const spawn=[
    {label:'CLI',task:'t',interfaces:[promised[0]],uses:['to_celsius','to_fahrenheit']},
    {label:'Docs',task:'t',interfaces:[promised[1]],uses:['to_celsius']},
    {label:'Celsius',task:'t',interfaces:normalizeContracts([{name:'to_celsius'}]),uses:['round_to']},
    {label:'Fahrenheit',task:'t',interfaces:normalizeContracts([{name:'to_fahrenheit',serves:['R9']}])},
    {label:'Rounding',task:'t',interfaces:normalizeContracts([{name:'round_to'},{name:'unused_helper'}])}];
  const before=JSON.stringify(spawn),{spawn:out,inherited}=inheritServes(spawn,promised);
  assert.equal(JSON.stringify(spawn),before,'pure: the input is not changed');
  assert.deepEqual(out.map(c=>c.interfaces.map(f=>[f.name,f.serves||[]])),[
    [['convert',['R1','R2']]],[['README.md',['R3']]],
    [['to_celsius',['R1','R2','R3']]],[['to_fahrenheit',['R9','R1','R2']]],
    [['round_to',['R1','R2','R3']],['unused_helper',[]]]]);
  assert.deepEqual(inherited.map(x=>[x.label,x.name]),[['Celsius','to_celsius'],['Fahrenheit','to_fahrenheit'],['Rounding','round_to']]);
  assert.deepEqual(inheritServes([{label:'A',task:'t',interfaces:[{name:'a',does:'',params:[]}]}]).inherited,[],'no serves anywhere: nothing inherited');
});

test('S2: the splitter\'s pieces and contracts keys are read; serves from a model is dropped; uses and requests may name any kind',()=>{
  const action=normalizeAction({pieces:[
    {label:'Docs',task:'Write the user guide',contracts:[{name:'README.md',kind:'doc',does:'usage',serves:['R1']}],uses:['convert','GET /items','not a name']},
    {label:'CLI',task:'Write the command line',contracts:[{name:'convert',kind:'command',path:'convert.py'}],functions:[{name:'ignored'}]}]});
  assert.deepEqual(action.spawn,[
    {label:'Docs',task:'Write the user guide',interfaces:[{name:'README.md',kind:'doc',does:'usage',params:[],path:'README.md'}],uses:['convert','GET /items']},
    {label:'CLI',task:'Write the command line',interfaces:[{name:'convert',kind:'command',does:'',params:[],path:'convert.py'}]}]);
  assert.deepEqual(normalizeAction({spawn:[{label:'A',task:'Write the thing'}],pieces:[{label:'B',task:'Write the other'}]}).spawn.map(c=>c.label),['A'],'spawn first while v7 runs');
  assert.deepEqual(I.normalizeSpawn([{label:'A',task:'t',contracts:[{name:'index.html',kind:'page'}]}]).spawn[0].interfaces,[{name:'index.html',kind:'page',does:'',params:[],path:'index.html'}]);
  assert.deepEqual(I.normalizeUses(['docs/guide.md','POST /notes','convert-units','x y','readTickets']),['docs/guide.md','POST /notes','convert-units','readTickets']);
});
