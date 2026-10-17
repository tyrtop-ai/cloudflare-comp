// v8 slice S2: language-neutral contracts (src/contracts.js). A contract is
// a function, a file, a page, a route, a command, a document or a data file;
// a v7 promise {name, does, params, returns, operation} is a function
// contract with nothing lost. The v8 fields are read only in v8 mode
// ({v8:true}, which S3 passes from the room's pipeline setting); without it
// every answer reads as ef7eebf read it. Name rules per kind, C4 on paths,
// C9, one renderer by kind, and serves inherited through a split's uses.
import test from 'node:test';
import assert from 'node:assert/strict';
const C=await import('../src/contracts.js');
const I=await import('../src/interfaces.js');
const P=await import('../src/problems.js');
const {normalizeAction,normalizeAsk,splitPieces,splitShape}=await import('../src/protocol.js');
const {validKnowledgeKey}=await import('../src/knowledge.js');
const {normalizeContracts,normalizeContract,contractErrors,contractLine,nameError,inheritServes,kindOf,contractInputs,contractOutputs,textNames}=C;

// Toolchain rows as data (the shape of src/toolchains.js, §4.5), trimmed to what the name rules read.
const ROWS=[
  {id:'javascript',extensions:['.js','.mjs','.cjs'],identifier:'^[A-Za-z_$][A-Za-z0-9_$]{0,63}$',reserved:'await break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield'},
  {id:'python',extensions:['.py'],identifier:'^[A-Za-z_][A-Za-z0-9_]{0,63}$',reserved:'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'},
  {id:'text',extensions:['.md','.txt','.html','.css','.json']}];
const PY={rows:ROWS,languages:['python','text']};
// v8 rows as the runtime stores them (serves kept), and as a model writes them (serves dropped).
const V8={v8:true,serves:true};
const N=xs=>normalizeContracts(xs,V8),N1=x=>normalizeContract(x,V8);
const piece=(label,...contracts)=>({label,task:'Write it',interfaces:N(contracts)});

test('S2: old {params, returns, operation} rows normalize to function contracts unchanged in both modes, and normalizing again changes nothing',()=>{
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
  // v8 keeps each text as written: no filler dropped, no final stop, no leading "returns" cut, no no-value phrasing turned into "nothing", and a function's name is never read as a signature (any language's name, Store::create, is stored whole).
  assert.deepEqual(normalizeContracts(rows,V8),[
    {name:'createTicket',does:'creates a ticket and returns it.',params:['title','description'],returns:'The created ticket.',operation:'create a ticket'},
    {name:'saveTickets',does:'',params:['tickets'],returns:'nothing'},
    {name:'readTickets',does:'',params:[],returns:'returns a promise that resolves when done'},
    {name:'getTickets(): returns all tickets',does:'',params:[]},
    {name:'deleteTicket(id)',does:'',params:[]}],'a v8 row keeps its texts as written');
  assert.deepEqual(['Store::create','Vec::new','std::sort'].map(name=>N1({name,path:'src/lib.rs'}).name),['Store::create','Vec::new','std::sort']);
  assert.deepEqual(N1({name:'list_items',does:'What it does.',inputs:[{name:'argument',is:'argument'}],outputs:'the list of items, or an empty list if none exist'}),
    {name:'list_items',does:'What it does.',params:['argument'],inputs:[{name:'argument',is:'argument'}],returns:'the list of items, or an empty list if none exist'},'v8 matches no filler and rewrites no output');
  assert.ok(once.every(f=>!('kind' in f)&&kindOf(f)==='function'),'a function contract carries no kind field: kind defaults to function');
  assert.deepEqual(normalizeContracts(once),once,'lossless: a stored row reads back as itself');
  assert.deepEqual(normalizeContracts(normalizeContracts(rows,V8),V8),normalizeContracts(rows,V8));
  assert.equal(I.normalizeInterfaces,normalizeContracts,'normalizeInterfaces is the alias until S7');
  assert.deepEqual(contractInputs(once[0]),[{name:'title',is:''},{name:'description',is:''}]);
  assert.equal(contractOutputs(once[0]),'The created ticket');
});

test('S2: without v8 every v8 field is ignored as ef7eebf did; with v8 they are read, and a function keeps params and returns',()=>{
  const raw={name:'count_words',kind:'function',does:'counts the words in a text.',inputs:[{name:'text',is:'the text to count'}],outputs:'the number of words.',effects:'none',
    examples:[{given:['a b'],expect:2},{given:['x'],expect:1},{given:[''],expect:0},{given:['a  b'],expect:2},{given:['c'],expect:1}],serves:['R1','R1',' R2 ',7],path:'counter.py',operation:'count words'};
  assert.deepEqual(normalizeContract(raw),{name:'count_words',does:'counts the words in a text',params:[],operation:'count words'},'v7: inputs, outputs, effects, examples, path and serves are not read');
  assert.deepEqual(normalizeContract({name:'parse',params:[{name:'text'}],kind:'route'}),{name:'parse',does:'',params:[]},'v7: object params dropped, kind ignored');
  const f=N1(raw);
  assert.deepEqual(f,{name:'count_words',does:'counts the words in a text.',params:['text'],inputs:[{name:'text',is:'the text to count'}],returns:'the number of words.',effects:'none',
    examples:[{given:['a b'],expect:2},{given:['x'],expect:1},{given:[''],expect:0},{given:['a  b'],expect:2},{given:['c'],expect:1}],path:'counter.py',serves:['R1','R2'],operation:'count words'});
  assert.deepEqual(N([f]),[f]);
  assert.equal(normalizeContract(raw,{v8:true}).serves,undefined,'a model\'s serves is dropped unless the runtime asks to keep it');
  // Each example as given: no count, no length.
  assert.deepEqual(N1({name:'f',kind:'widget',examples:[{given:1},{expect:2},{given:'x'.repeat(400),expect:1},{given:{a:'y'.repeat(400)},expect:1}]}),{name:'f',does:'',params:[],examples:[{given:'x'.repeat(400),expect:1},{given:{a:'y'.repeat(400)},expect:1}]});
});

test('v8: a level\'s contracts are kept whole and every one of them: no count of contracts, inputs or serves, and no text clipped; v7 keeps its 8 and its lengths',()=>{
  const long=t=>`${t} `.repeat(60).trim();
  const many=Array.from({length:12},(_,i)=>({name:`f${i}`,kind:'function',path:`f${i}.py`,does:long('does'),outputs:long('the value'),effects:long('changes'),
    inputs:Array.from({length:9},(_,j)=>({name:`a${j}`,is:long('is')})),serves:Array.from({length:40},(_,k)=>`V${k+1}`),run:undefined}));
  const out=normalizeContracts(many,{v8:true,serves:true});
  assert.equal(out.length,12);
  for(const c of out){assert.equal(c.does,long('does'));assert.equal(c.returns,long('the value'));assert.equal(c.effects,long('changes'));assert.equal(c.inputs.length,9);assert.equal(c.inputs[8].is,long('is'));assert.equal(c.serves.length,40);}
  const cmd=N1({name:'serve',kind:'command',path:'serve.py',run:{run:long('serve --flag'),argv:long('arg').split(' '),port:true,ready:`/${'r'.repeat(300)}`}});
  assert.deepEqual(cmd.run,{run:long('serve --flag'),argv:long('arg').split(' '),port:true,ready:`/${'r'.repeat(300)}`});
  // v7 reads as it always did.
  assert.equal(normalizeContracts(many.map(({name,does})=>({name,does}))).length,8);
  assert.ok(normalizeContracts([{name:'f',does:long('does')}])[0].does.length<=160);
});

test('S2: other kinds (v8): a file, page, doc or data contract is named by its path; outputs are kept as written',()=>{
  assert.deepEqual(N([
    {name:'README.md',kind:'doc',does:'how to install and run the converter.'},
    {name:'index.html',kind:'page',does:'the recipe scaler page',outputs:'a form and the scaled list',path:'index.html'},
    {name:'GET /items',kind:'route',does:'lists the items',inputs:['page','size'],outputs:'nothing'},
    {name:'convert',kind:'command',does:'converts a temperature',params:['value','unit'],outputs:'the converted value',path:'convert.py',examples:[{given:'convert 100 C',expect:'212'}]},
    {name:'data/units.json',kind:'data',path:'data/units.json',serves:['R3']},
    {name:'docs/../x.md',kind:'doc'}]),[
    {name:'README.md',kind:'doc',does:'how to install and run the converter.',params:[],path:'README.md'},
    {name:'index.html',kind:'page',does:'the recipe scaler page',params:[],outputs:'a form and the scaled list',path:'index.html'},
    {name:'GET /items',kind:'route',does:'lists the items',params:['page','size'],outputs:'nothing'},
    {name:'convert',kind:'command',does:'converts a temperature',params:['value','unit'],outputs:'the converted value',path:'convert.py',examples:[{given:'convert 100 C',expect:'212'}]},
    {name:'data/units.json',kind:'data',does:'',params:[],path:'data/units.json',serves:['R3']},
    {name:'docs/../x.md',kind:'doc',does:'',params:[]}]);
  // A valid path renames the contract; prose after a path is its does; a name without an extension or a directory is no path.
  assert.deepEqual(N1({name:'Readme',kind:'doc',path:'README.md'}),{name:'README.md',kind:'doc',does:'',params:[],path:'README.md'});
  assert.deepEqual(N1({name:'README.md: how to run',kind:'doc'}),{name:'README.md',kind:'doc',does:'how to run',params:[],path:'README.md'});
  assert.deepEqual(N1({name:'renderPage',kind:'page'}),{name:'renderPage',kind:'page',does:'',params:[]});
  assert.equal(nameError(N1({name:'renderPage',kind:'page'})),'page "renderPage" needs the path of its file');
  assert.equal(N1({name:'GET /items(x)',kind:'route'}).name,'GET /items(x)','a non-function name is never read as a signature');
  assert.deepEqual(N([{name:'README.md',kind:'doc',serves:['R1']},{name:'README.md',kind:'doc',does:'usage',serves:['R2']}]),[{name:'README.md',kind:'doc',does:'usage',params:[],path:'README.md',serves:['R1','R2']}]);
});

test('S2: name rules per kind: a function by its toolchain row (a Python reserved word, a JavaScript-only name), a route, a command with its file, a placed path',()=>{
  const fn=(name,extra={})=>N1({name,...extra});
  assert.equal(nameError(fn('count_words'),PY),'');
  assert.equal(nameError(fn('lambda'),PY),'"lambda" is not a valid python function name (a reserved word)');
  assert.equal(nameError(fn('$count'),PY),'"$count" is not a valid python function name');
  assert.equal(nameError(fn('$count'),{rows:ROWS,languages:['javascript']}),'','a JavaScript name');
  assert.equal(nameError(fn('lambda'),{rows:ROWS,languages:['javascript']}),'');
  assert.equal(nameError(fn('lambda',{path:'app.js'}),PY),'','the function\'s path names its row');
  assert.equal(nameError(fn('$count')),'','without facts a function name is read as JavaScript (v7)');
  assert.equal(nameError(fn('require')),'"require" is not a valid javascript function name (a reserved word)','v7\'s protected names stay JavaScript\'s');
  assert.equal(nameError(fn('lambda'),{rows:ROWS}),'"lambda" is not a valid python function name (a reserved word)','with no language given, a name must hold in every row');
  const route=name=>nameError(N1({name,kind:'route'}));
  assert.deepEqual(['GET /items','POST /items/:id','GET /items/{id}','DELETE /','get /items','FETCH /items','GET items','GET /a b'].map(route).map(Boolean),[false,false,false,false,true,true,true,true]);
  const cmd=(name,path)=>nameError(N1({name,kind:'command',...(path?{path}:{})}));
  assert.equal(cmd('convert','convert.py'),'');
  assert.equal(cmd('convert-units','bin/convert.py'),'');
  assert.equal(cmd('Convert','convert.py'),'"Convert" is not a command name: lowercase letters, digits, hyphens and underscores, starting with a letter');
  assert.equal(cmd('convert'),'command "convert" needs the path of the file that implements it');
  assert.equal(nameError({name:'readme',kind:'doc',path:'README.md',params:[]}),'doc "readme" must be named by its path README.md','a row normalize did not rename');
  // No path is the runtime's: a placed file may sit in any folder (the runtime's own files live outside the agents' world).
  for(const name of ['glue/x.md','memory/x.md','components/x.md','.recursive/x.md'])assert.equal(nameError(N1({name,kind:'doc'})),'',name);
  assert.equal(nameError(N1({name:'docs/../x.md',kind:'doc'})),'doc "docs/../x.md" needs the path of its file');
});

test('S2: contractErrors: C1 by kind, C2, C4 by name and by path, C3 in contracts, C5 quoting the contract; v7 words without facts',()=>{
  const errors=contractErrors([
    piece('CLI',{name:'convert',kind:'command',path:'cli.py'},{name:'lambda'},{name:'get /x',kind:'route'}),
    piece('Export',{name:'export',kind:'command',path:'cli.py'},{name:'example.md',kind:'doc'},{name:'foo'}),
    piece('Docs',{name:'README.md',kind:'doc'},{name:'a.md',kind:'doc'},{name:'b.md',kind:'doc'},{name:'c.md',kind:'doc'},{name:'d.md',kind:'doc'},{name:'e.md',kind:'doc'})],
    N([{name:'guide.md',kind:'doc',does:'the user guide'}]),{facts:PY});
  assert.deepEqual(errors.map(e=>[e.check,e.path??null,e.text]),[
    ['C1',null,'"CLI": "lambda" is not a valid python function name (a reserved word).'],
    ['C1',null,'"CLI": "get /x" is not a route; name it as a method and a path, such as "GET /path".'],
    ['C2',null,'"Export": "foo" is copied from the example; name the function after what it does.'],
    ['C4','cli.py','cli.py is placed by both "CLI" and "Export"; give each file to exactly one piece.'],
    ['C3',null,'"Docs" lists 6 contracts; list at most 5, only those another piece uses or your assignment promises.'],
    ['C5',null,'Your assignment promises doc guide.md: the user guide; give it, unchanged, to exactly one piece, the one whose task writes it.']]);
  assert.deepEqual(contractErrors([piece('One',{name:'run',kind:'command',path:'run.py'},{name:'run.py',kind:'file'})],[],{facts:PY}).map(e=>e.check),[],'one piece may place one path twice');
  // The same doc on two pieces is C4 by name only, never twice.
  assert.deepEqual(contractErrors([piece('A',{name:'README.md',kind:'doc'}),piece('B',{name:'README.md',kind:'doc'})]).map(e=>[e.check,e.path??null]),[['C4',null]]);
  assert.deepEqual(contractErrors([piece('Entry',{name:'create-ticket'})]).map(e=>e.text),['"Entry": "create-ticket" is not a plain JavaScript function name; use an identifier such as createTicket.']);
  assert.deepEqual(I.interfaceErrors([piece('Files',{name:'readFileSync'},{name:'readFile.md',kind:'doc'})],[]).map(e=>e.check),['C8']);
  // A same-path, different-name pair is left to the split's bounce: the repairs keep both.
  assert.deepEqual(I.repairInterfaces([piece('Docs',{name:'tools/notes.py',kind:'file'}),piece('CLI',{name:'notes',kind:'command',path:'tools/notes.py'})],[]).removed,[]);
});

test('S2: C9: a function named as the stem of a placed file in its language is an error on the piece that adds it',()=>{
  const C9=(spawn,promised=[],facts=PY)=>contractErrors(spawn,promised,{facts}).filter(e=>e.check==='C9').map(e=>e.text);
  assert.deepEqual(C9([piece('CLI',{name:'convert',kind:'command',path:'convert.py'}),piece('Core',{name:'convert'})]),['"Core": function convert has the name of the file convert.py; name the function differently.']);
  assert.deepEqual(C9([piece('Core',{name:'convert',path:'lib/convert.py'}),piece('CLI',{name:'convert',kind:'command',path:'convert.py'})]),['"Core": function convert has the name of the file convert.py; name the function differently.']);
  assert.deepEqual(C9([piece('Core',{name:'convert'}),piece('Data',{name:'convert.py',kind:'file'})],[{name:'convert',does:'',params:[]}]),['"Data": the file convert.py has the name of the function convert; place the file at another path.']);
  assert.deepEqual(C9([piece('CLI',{name:'convert',kind:'command',path:'convert.py'}),piece('Core',{name:'convert',path:'convert.js'})]),[]);
  assert.deepEqual(C9([piece('Docs',{name:'convert.md',kind:'doc'}),piece('Core',{name:'convert'})]),[]);
  assert.deepEqual(C9([piece('CLI',{name:'convert',kind:'command',path:'cli.py'}),piece('Core',{name:'convert'})]),[]);
  assert.deepEqual(C9([piece('A',{name:'convert'}),piece('B',{name:'convert.py',kind:'file'})],[{name:'convert',does:'',params:[]},{name:'convert.py',kind:'file',does:'',params:[],path:'convert.py'}]),[]);
});

test('S2: contractLine renders each kind on one line, and promiseText is that one renderer for any contract with a v8 field; a v7 promise reads as before',()=>{
  const line=x=>contractLine(N1(x));
  assert.equal(line({name:'count_words',does:'counts the words',inputs:['text'],outputs:'the count',examples:[{given:['a b'],expect:2}]}),'function count_words(text): counts the words; returns the count; e.g. count_words("a b") → 2');
  assert.equal(line({name:'scale',params:['recipe','n'],returns:'the scaled recipe',effects:'none',examples:[{given:[{flour:100},2],expect:{flour:200}},{given:'x',expect:'X'}]}),'function scale(recipe, n): returns the scaled recipe; e.g. scale({"flour":100}, 2) → {"flour":200}; scale("x") → "X"');
  assert.equal(line({name:'save',inputs:[{name:'note',is:'the note to keep'}],effects:'the notes file, which this module owns'}),'function save(note): takes note (the note to keep); changes the notes file, which this module owns');
  assert.equal(line({name:'README.md',kind:'doc',does:'how to install and run'}),'doc README.md: how to install and run');
  assert.equal(line({name:'GET /items',kind:'route',does:'lists the items',inputs:['page'],outputs:'a JSON array of items'}),'route GET /items: lists the items; responds with a JSON array of items; takes page');
  assert.equal(line({name:'convert',kind:'command',params:['value','unit'],outputs:'the converted value',path:'convert.py',examples:[{given:'convert 100 C',expect:'212'}]}),'command convert (value, unit) in convert.py: prints the converted value; e.g. convert 100 C → 212');
  assert.equal(line({name:'index.html',kind:'page',outputs:'the scaled ingredient list'}),'page index.html: shows the scaled ingredient list');
  assert.equal(line({name:'units.json',kind:'data'}),'data units.json');
  assert.equal(contractLine({}),'');
  assert.equal(I.promiseText({name:'getTickets',does:'returns all tickets',params:[]}),'getTickets(): returns all tickets');
  assert.equal(I.promiseText({name:'getTickets',does:'returns all tickets',params:[],returns:'the tickets'},[{name:'getTickets',async:true}]),'async getTickets(): returns all tickets; returns the tickets');
  assert.equal(I.promiseText(N1({name:'README.md',kind:'doc',does:'usage'})),'doc README.md: usage');
  // One renderer (review probe render.mjs): a function's path, input descriptions, effects and examples all show.
  const f=N1({name:'saveTicket',does:'stores a ticket',inputs:[{name:'ticket',is:'the ticket object'}],returns:'the id',effects:'appends to data/tickets.json',path:'src/store.py',examples:[{given:[{title:'a'}],expect:1}]});
  assert.equal(I.promiseText(f),'saveTicket(ticket) in src/store.py: stores a ticket; returns the id; takes ticket (the ticket object); changes appends to data/tickets.json; e.g. saveTicket({"title":"a"}) → 1');
  assert.equal(I.promiseText(f),contractLine(f).replace(/^function /,''));
  assert.equal(I.promiseText(f,[{name:'saveTicket',async:true}]),'async '+contractLine(f).replace(/^function /,''));
  assert.equal(I.promiseText(N1({name:'f',examples:[{given:[1],expect:2}]})),'f(): e.g. f(1) → 2');
  assert.deepEqual(['f','README.md','GET /x','go'].map((name,i)=>I.signature(N1({name,kind:['function','doc','route','command'][i],params:['a'],path:i===3?'go.py':undefined}))),['f(a)','doc README.md','route GET /x','command go (a) in go.py']);
});

test('S2: serves: a carried contract keeps its own; a contract a split adds serves what the pieces using it serve, through a chain; unused ones serve nothing',()=>{
  const promised=N([{name:'convert',kind:'command',path:'convert.py',serves:['R1','R2']},{name:'README.md',kind:'doc',serves:['R3']}]);
  const spawn=[
    {label:'CLI',task:'t',interfaces:[promised[0]],uses:['to_celsius','to_fahrenheit']},
    {label:'Docs',task:'t',interfaces:[promised[1]],uses:['to_celsius']},
    {label:'Celsius',task:'t',interfaces:N([{name:'to_celsius'}]),uses:['round_to']},
    {label:'Fahrenheit',task:'t',interfaces:N([{name:'to_fahrenheit',serves:['R9']}])},
    {label:'Rounding',task:'t',interfaces:N([{name:'round_to'},{name:'unused_helper'}])}];
  const before=JSON.stringify(spawn),{spawn:out,inherited}=inheritServes(spawn,promised);
  assert.equal(JSON.stringify(spawn),before,'pure: the input is not changed');
  assert.deepEqual(out.map(c=>c.interfaces.map(f=>[f.name,f.serves||[]])),[
    [['convert',['R1','R2']]],[['README.md',['R3']]],
    [['to_celsius',['R1','R2','R3']]],[['to_fahrenheit',['R9','R1','R2']]],
    [['round_to',['R1','R2','R3']],['unused_helper',[]]]]);
  assert.deepEqual(inherited.map(x=>[x.label,x.name]),[['Celsius','to_celsius'],['Fahrenheit','to_fahrenheit'],['Rounding','round_to']]);
  assert.deepEqual(inheritServes([{label:'A',task:'t',interfaces:[{name:'a',does:'',params:[]}]}]).inherited,[],'no serves anywhere: nothing inherited');
});

test('S2: serves past the cap: two carried contracts of 20 ids each give a helper the first 32, and inheritServes ends (review must-fix)',()=>{
  const ids=(p,n)=>Array.from({length:n},(_,i)=>`${p}${i}`);
  const promised=[{name:'p1',does:'',params:[],serves:ids('A',20)},{name:'p2',does:'',params:[],serves:ids('B',20)}];
  const spawn=[{label:'P',task:'t',interfaces:promised,uses:['h']},{label:'H',task:'t',interfaces:[{name:'h',does:'',params:[]}],uses:['g']},{label:'G',task:'t',interfaces:[{name:'g',does:'',params:[]}]}];
  const {spawn:out,inherited}=inheritServes(spawn,promised);
  assert.deepEqual(out[1].interfaces[0].serves,[...ids('A',20),...ids('B',12)]);
  assert.deepEqual(out[2].interfaces[0].serves,[...ids('A',20),...ids('B',12)]);
  assert.deepEqual(inherited.map(x=>[x.name,x.serves.length]),[['h',32],['g',32]]);
});

test('S2: the v8 keys are read only in v8 mode: pieces win over spawn, an empty contracts never hides functions, serves from a model is dropped',()=>{
  const raw={pieces:[
    {label:'Docs',task:'Write the user guide',contracts:[{name:'README.md',kind:'doc',does:'usage',serves:['R1']}],uses:['convert','GET /items','not a name']},
    {label:'CLI',task:'Write the command line',contracts:[{name:'convert',kind:'command',path:'convert.py'}],functions:[{name:'ignored'}]}]};
  assert.deepEqual(normalizeAction(raw,{v8:true}).spawn,[
    {label:'Docs',task:'Write the user guide',interfaces:[{name:'README.md',kind:'doc',does:'usage',params:[],path:'README.md'}],uses:['convert','GET /items']},
    {label:'CLI',task:'Write the command line',interfaces:[{name:'convert',kind:'command',does:'',params:[],path:'convert.py'}]}]);
  assert.deepEqual(normalizeAction(raw).spawn,[],'v7: pieces is not a key');
  const both={spawn:[{label:'A',task:'Write the thing'}],pieces:[{label:'B',task:'Write the other'}]};
  assert.deepEqual([normalizeAction(both).spawn.map(c=>c.label),normalizeAction(both,{v8:true}).spawn.map(c=>c.label)],[['A'],['B']]);
  assert.deepEqual(normalizeAction({spawn:[{label:'A',task:'Write the thing'}],pieces:[]},{v8:true}).spawn.map(c=>c.label),['A'],'an empty pieces never hides spawn');
  const empty={spawn:[{label:'S',task:'Write the store module that keeps tickets',functions:['a()'],contracts:[]}]};
  assert.deepEqual([normalizeAction(empty).spawn[0].interfaces,normalizeAction(empty,{v8:true}).spawn[0].interfaces],[[{name:'a',does:'',params:[]}],[{name:'a()',does:'',params:[]}]],'v7 reads a signature; v8 stores the name as written');
  assert.deepEqual(normalizeAction({spawn:[{label:'S',task:'Write the store module that keeps tickets',functions:['a()'],contracts:['b()']}]}).spawn[0].interfaces.map(f=>f.name),['a'],'v7 never reads contracts');
  assert.deepEqual(I.normalizeSpawn([{label:'A',task:'t',contracts:[{name:'index.html',kind:'page'}]}],[],{v8:true}).spawn[0].interfaces,[{name:'index.html',kind:'page',does:'',params:[],path:'index.html'}]);
  assert.deepEqual(I.normalizeSpawn([{label:'A',task:'t',contracts:[{name:'index.html',kind:'page'}]}]).spawn[0].interfaces,[]);
  assert.deepEqual(I.normalizeUses(['docs/guide.md','POST /notes','convert-units','x y','readTickets'],{v8:true}),['docs/guide.md','POST /notes','convert-units','readTickets']);
  assert.deepEqual(I.normalizeUses(['docs/guide.md','POST /notes','convert-units','x y','readTickets']),['readTickets'],'v7 uses are identifiers');
  // The splitter's checks read the same helper: a v8 pieces answer is a split.
  const split={pieces:[{label:'A',task:'Write the first part'},{label:'B',task:'Write the second part'}]};
  assert.deepEqual([splitShape(split),splitShape(split,{v8:true}),splitPieces(split).length,splitPieces(split,{v8:true}).length],[false,true,0,2]);
});

test('S2: v7\'s decompose reads an answer keyed pieces as no split, and asks its splitter again',async()=>{
  const {decompose}=await import('../src/model.js');
  const pieces=[{label:'Validation',task:'Write code to validate ticket titles',contracts:[{name:'validateTitle'}]},{label:'Guide',task:'Write the guide to creating tickets',contracts:[{name:'docs/guide.md',kind:'doc'}]}];
  let calls=0;
  const env={AI:{run:async()=>{calls++;return {response:JSON.stringify({summary:'Split',pieces})};}}};
  const ctx={your_responsibility:'Write code to create validated ticket records',neighbor_owners:[]};
  const v7=await decompose(env,ctx);
  assert.equal(calls,2,'v7: no spawn, the splitter is asked again');
  assert.deepEqual(normalizeAction(v7).spawn,[]);
});

test('S2: a v7 room reads the review\'s kindv7 answer as ef7eebf did: kinds are ignored, so a route and a doc fail C1 and are repaired away',()=>{
  const raw={spawn:[
    {label:'API routes',task:'Write the HTTP routes for tickets',functions:[{name:'GET /tickets',kind:'route',does:'lists tickets'},{name:'listTickets',kind:'function'}]},
    {label:'Docs',task:'Write the README for the project',functions:[{name:'README.md',kind:'doc',does:'how to run'}]},
    {label:'CLI',task:'Write the command line tool',functions:[{name:'tickets',kind:'command',does:'cli'}]}]};
  const a=normalizeAction(raw);
  assert.deepEqual(a.spawn.map(c=>c.interfaces),[[{name:'GET /tickets',does:'lists tickets',params:[]},{name:'listTickets',does:'',params:[]}],[{name:'README.md',does:'how to run',params:[]}],[{name:'tickets',does:'cli',params:[]}]]);
  assert.deepEqual(I.interfaceErrors(a.spawn,[],{goal:''}).map(e=>e.check+' '+e.text),[
    'C1 "API routes": "GET /tickets" is not a plain JavaScript function name; use an identifier such as createTicket.',
    'C1 "Docs": "README.md" is not a plain JavaScript function name; use an identifier such as createTicket.']);
  assert.deepEqual(I.repairInterfaces(a.spawn,[]).spawn.map(c=>c.interfaces.map(f=>I.promiseText(f))),[['listTickets()'],[],['tickets(): cli']]);
  // v7 asks: no other kind's name, no kind (review nit c).
  assert.deepEqual(normalizeAsk([{need:'parse dates',name:'parse-date'},{need:'the readme',name:'README.md'},{need:'x',name:'getUser',kind:'function'}]),[
    {to:'parent',key:'fn parse dates',question:'parse dates'},{to:'parent',key:'fn the readme',question:'the readme'},{to:'parent',key:'fn getUser',question:'x',name:'getUser'}]);
});

test('S2: request keys are valid knowledge keys for any contract name; v7 keys are as before',()=>{
  assert.equal(I.requestKey({name:'loadTickets'}),'fn loadTickets');
  assert.equal(I.requestKey({name:'$load'}),'fn _load');
  assert.equal(I.requestKey({need:' Returns EVERY stored ticket! (sorted) '}),'fn returns every stored ticket sorted');
  for(const name of ['GET /items/{id}','GET /users/@me','docs/notes (draft).md','README.md','GET /items','convert-units','src/'+'a'.repeat(120)+'/x.md']) {
    const [req]=normalizeAsk({need:'need it',name},{v8:true});
    assert.ok(validKnowledgeKey(req.key),req.key);
    assert.equal(normalizeAction({answers:[{to:'root.1',key:req.key,value:'it is at ...'}]}).answers.length,1,name);
  }
  assert.equal(I.requestKey({name:'GET /items/{id}'}),'fn GET /items/_id_');
});

test('S2: a contract of another kind is named by its whole name only: ./ paths, route templates, never a word of a longer name',()=>{
  const fns=[{name:'README.md',kind:'doc'},{name:'GET /items',kind:'route'},{name:'GET /items/:id',kind:'route'},{name:'GET /items/{id}/tags',kind:'route'},{name:'GET /',kind:'route'},
    {name:'convert',kind:'command'},{name:'convert-units',kind:'command'},{name:'public/index.html',kind:'page'},{name:'index.html',kind:'page'},{name:'data/tickets.json',kind:'data'},{name:'tickets',does:'',params:[]}];
  const named=t=>P.namedFunctions(t,fns).map(f=>f.name);
  assert.deepEqual(named('cat: ./README.md: No such file or directory'),['README.md']);
  assert.deepEqual(named('docs/README.md is missing'),[]);
  assert.deepEqual(named('GET /items?limit=2 returned 3 items'),['GET /items']);
  assert.deepEqual(named('GET /items/42 returned 404'),['GET /items/:id']);
  assert.deepEqual(named('GET /items/42/tags is empty'),['GET /items/{id}/tags']);
  assert.deepEqual(named('GET / returned the page; GET /health is fine'),['GET /']);
  assert.deepEqual(named('convert-units 5 km mi printed 3.1'),['convert-units']);
  assert.deepEqual(named('public/index.html shows the list'),['public/index.html']);
  assert.deepEqual(named('./index.html shows the list'),['index.html']);
  assert.deepEqual(named('data/tickets.json holds the tickets'),['data/tickets.json','tickets'],'a function is named by its word as before');
  assert.equal(textNames('see README.md.',{name:'README.md',kind:'doc'}),true);
  assert.equal(textNames('see README.mdx',{name:'README.md',kind:'doc'}),false);
});

test('S2: a manager\'s retask never brings a model\'s serves: new contracts lose them, carried ones keep the parent\'s',()=>{
  const ctx={kindOf:id=>id==='root.1'?'worker':null,statusOf:()=>'waiting',production:['root.1','root.2'],scope:()=>0.9,
    promise:{items:[{name:'createTicket',does:'creates a ticket',params:['title'],serves:['R1']}]}};
  for(const v8 of [false,true]) {
    const r=P.validateManagerActions([{action:'retask',child:'root.1',task:'Write the ticket creation and listing again.',interfaces:[{name:'createTicket',serves:['R9']},{name:'listTickets',serves:['R7']}]}],[],{...ctx,v8});
    assert.deepEqual(r.retask[0].interfaces,[{name:'createTicket',does:'creates a ticket',params:['title'],serves:['R1']},{name:'listTickets',does:'',params:[]}],`v8=${v8}`);
  }
});
