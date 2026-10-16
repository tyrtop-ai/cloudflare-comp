// v7.13: a module bound whole whose only export is one function is bound as
// that function, and a model edit that renames an imported name but not its
// uses is applied as an alias. Fixtures are worker files from live runs run3b,
// run3 and run6, copied exactly; three earlier revisions of run3b files and
// one of run6 are reconstructed from the run's rejected edits and reproduce
// the live rejection messages token for token.
import test from 'node:test';
import assert from 'node:assert/strict';
import {register,createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
register('./cloudflare-loader.mjs',import.meta.url);
const {ControlRoom}=await import('../src/index.js');
const {materializedPath}=await import('../src/assembly.js');
const L=await import('../src/linker.js');
const {LINKER_SYSTEM}=await import('../src/model.js');

class Sql {constructor(){this.db=new DatabaseSync(':memory:');}exec(s,...p){if(!p.length&&!/^\s*select/i.test(s)){this.db.exec(s);return{toArray:()=>[]};}const q=this.db.prepare(s);const rows=/^\s*select/i.test(s)?q.all(...p):(q.run(...p),[]);return{toArray:()=>rows};}}
class Store {constructor(){this.repos=new Map();}async create(name){this.repos.set(name,new Map());return{name,remote:'https://test/'+name,branch:'main'};}async read(name,path){return this.repos.get(name)?.get(path)??null;}async write({name,path,content}){this.repos.get(name).set(path,content);return{commit:'c'.repeat(40)};}}
function linkRoom(link=()=>({edits:[],entry:null,issues:[]})) {
  const calls=[];
  const AI={run:async(_model,{messages})=>{
    if(!messages[0].content.startsWith('You are a LINKER'))throw new Error('unexpected model request: '+messages[0].content.slice(0,80));
    const user=JSON.parse(messages[1].content);calls.push(user);return {response:JSON.stringify(link(user))};
  }};
  const store=new Store(),room=new ControlRoom({storage:{sql:new Sql()},waitUntil(){}},{MOCK_AI:'false',TEST_ARTIFACT_STORE:store,AI});
  room.set('room_id','linker-alias-test');
  return {room,store,calls};
}
// Workers under manager `under`, done, then that manager's builder links them.
async function linkBranch(room,under,workers) {
  await room.spawn(under,workers.map(([label,file])=>({label,task:'Write '+file})));
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id=?",under);
  const ids=workers.map((_,i)=>`${under}.${i+1}`);
  for(const [i,[,file,content]] of workers.entries()){room.db().exec("UPDATE agents SET phase='implement' WHERE id=?",ids[i]);await room.putFile(ids[i],file,content);}
  for(const id of ids)room.db().exec("UPDATE agents SET status='done' WHERE id=?",id);
  const builder=await room.scheduleAssembly(under);
  await room.turn(builder.id);
  return {builder,paths:workers.map(([label,file],i)=>materializedPath(label,file,ids[i]))};
}
async function managers(room,chain) {
  const goal='Build a small issue tracker that lets someone create, view, update, and delete tickets.';
  await room.provision('root',null,'Root objective',goal);
  room.set('goal',goal);
  let id='root';
  for(const label of chain){await room.spawn(id,[{label,task:'Own '+label}]);room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id=?",id);id+='.1';}
  return id;
}
const surfacesOf=files=>new Map([...files].map(([p,c])=>[p,L.exportSurface(p,c)]));
const knownFor=(files,file)=>L.knownNamesFrom([...files].filter(([p])=>p!==file).map(([,c])=>c));
// Linked CommonJS modules loaded from a directory, as the Container loads them.
function load(files,entry) {
  const dir=mkdtempSync(join(tmpdir(),'linker-alias-'));
  writeFileSync(join(dir,'package.json'),'{"type":"commonjs"}\n');
  for(const [p,c] of files){mkdirSync(dirname(join(dir,p)),{recursive:true});writeFileSync(join(dir,p),c);}
  return createRequire(join(dir,'package.json'))('./'+entry);
}

// ------------------------------------------------ run3b (v7.12, threshold 0.7)
const REPO="const tickets = [];\nlet nextId = 1;\n\nfunction createTicket(title, description, status) {\n  const ticket = {\n    id: nextId++,\n    title,\n    description,\n    status,\n    createdAt: new Date().toISOString()\n  };\n  tickets.push(ticket);\n  return ticket;\n}\n\nfunction getTickets() {\n  return [...tickets];\n}\n\nfunction getTicketById(id) {\n  return tickets.find(ticket => ticket.id === id);\n}\n\nfunction updateTicket(id, updates) {\n  const ticket = tickets.find(ticket => ticket.id === id);\n  if (!ticket) return null;\n  Object.assign(ticket, updates);\n  return ticket;\n}\n\nfunction deleteTicket(id) {\n  const index = tickets.findIndex(ticket => ticket.id === id);\n  if (index === -1) return false;\n  tickets.splice(index, 1);\n  return true;\n}\n\nmodule.exports = {\n  createTicket,\n  getTickets,\n  getTicketById,\n  updateTicket,\n  deleteTicket\n};";
const CREATE="const { createTicket } = require('../ticket-rep-f17f9f79/ticketRepository.js');\n\nfunction generateId() {\n  let id = 1;\n  return () => id++;\n}\n\nconst idGenerator = generateId();\n\nfunction addTicket(args) {\n  if (!args.title) {\n    throw new Error('Title is required');\n  }\n  const ticket = {\n    id: idGenerator(),\n    title: args.title,\n    description: args.description || '',\n    status: 'open',\n    createdAt: new Date()\n  };\n  createTicket(ticket);\n}\n\nmodule.exports = { addTicket };";
const VIEW="const { getTickets } = require('../ticket-rep-f17f9f79/ticketRepository.js');\n\nfunction getAllTickets() {\n  const tickets = getTickets();\n  if (tickets.length === 0) {\n    console.log('No tickets found.');\n    return;\n  }\n  console.log('All Tickets:');\n  tickets.forEach(ticket => {\n    console.log(`ID: ${ticket.id}`);\n    console.log(`Title: ${ticket.title}`);\n    console.log(`Description: ${ticket.description}`);\n    console.log(`Status: ${ticket.status}`);\n    console.log(`Created At: ${ticket.createdAt}`);\n    console.log('------------------------');\n  });\n}\n\nmodule.exports = { getAllTickets };";
const UPDATE="const { updateTicket } = require('../ticket-rep-f17f9f79/ticketRepository');\n\nexports.updateTicket = function handleUpdateCommand(args) {\n  const { id, ...updates } = args;\n  if (!id) {\n    throw new Error('Ticket ID is required');\n  }\n  const updated = updateTicket(id, updates);\n  return updated ? 'Ticket updated successfully' : 'Ticket not found';\n};";
const DELETE="const ticketRepository = require('../ticket-rep-f17f9f79/ticketRepository.js');\n\nmodule.exports = function deleteTicketCommand(id) {\n  const ticketId = parseInt(id, 10);\n  ticketRepository.deleteTicket(ticketId);\n};";
const DISPATCH="const createTicket = require('../create-tic-f37fa29f/createTicketCommand.js');\nconst viewTickets = require('../view-ticke-f27fa10c/viewTicketsCommand.js');\nconst updateTicket = require('../update-tic-f57fa5c5/updateTicketCommand.js');\nconst deleteTicket = require('../delete-tic-f47fa432/deleteTicketCommand.js');\n\nconst commandMap = {\n  'create': createTicket,\n  'view': viewTickets,\n  'update': updateTicket,\n  'delete': deleteTicket\n};\n\nmodule.exports = {\n  dispatch: (command, args) => {\n    const handler = commandMap[command];\n    if (handler) {\n      handler(args);\n    } else {\n      console.error(`Unknown command: ${command}`);\n    }\n  }\n};";
// Root's paths in run3b (agent root.10).
const P={repo:'components/ticket-rep-f17f9f79/ticketRepository.js',create:'components/create-tic-f37fa29f/createTicketCommand.js',view:'components/view-ticke-f27fa10c/viewTicketsCommand.js',update:'components/update-tic-f57fa5c5/updateTicketCommand.js',del:'components/delete-tic-f47fa432/deleteTicketCommand.js',dispatch:'components/cli-contro-f77fa8eb/commandDispatcher.js',parser:'components/command-pa-f07f9de6/commandParser.js',app:'components/applicatio-f67fa758/app.js'};
const commands=()=>new Map([[P.repo,REPO],[P.create,CREATE],[P.view,VIEW],[P.update,UPDATE],[P.del,DELETE],[P.dispatch,DISPATCH]]);
const BOUND=DISPATCH.replace('const createTicket =','const { addTicket: createTicket } =').replace('const viewTickets =','const { getAllTickets: viewTickets } =').replace('const updateTicket =','const { updateTicket } =');

test('shape: a module bound whole whose only export is one function is bound as that function (run3b commandDispatcher.js)',()=>{
  const files=commands(),sur=surfacesOf(files);
  assert.deepEqual(L.importMismatches(files,sur),[],'the static check sees nothing: no member is read off a whole binding');
  const edits=L.shapeFixes(files,sur);
  assert.deepEqual(edits.map(e=>[e.file,e.replace]),[
    [P.dispatch,"const { addTicket: createTicket } = require('../create-tic-f37fa29f/createTicketCommand.js');"],
    [P.dispatch,"const { getAllTickets: viewTickets } = require('../view-ticke-f27fa10c/viewTicketsCommand.js');"],
    [P.dispatch,"const { updateTicket } = require('../update-tic-f57fa5c5/updateTicketCommand.js');"]],
    'module.exports = { addTicket }, { getAllTickets } and exports.updateTicket = …; deleteTicketCommand.js exports a single function, so its whole binding is already right');
  const fixed=L.applyEdits(DISPATCH,edits,{shapes:{path:P.dispatch,files,surfaces:sur}});
  assert.equal(fixed.content,BOUND);
  assert.ok(fixed.applied.every(e=>e.shape));
  // The builder's own proposals at step 35 (events 86-89): kept where they are the runtime's fix.
  const step35=L.applyEdits(DISPATCH,[
    {find:"const createTicket = require('../create-tic-f37fa29f/createTicketCommand.js');",replace:"const { addTicket: createTicket } = require('../create-tic-f37fa29f/createTicketCommand.js');"},
    {find:"const viewTickets = require('../view-ticke-f27fa10c/viewTicketsCommand.js');",replace:"const { getAllTickets: viewTickets } = require('../view-ticke-f27fa10c/viewTicketsCommand.js');"},
    {find:"const updateTicket = require('../update-tic-f57fa5c5/updateTicketCommand.js');",replace:"const { updateTicket } = require('../update-tic-f57fa5c5/updateTicketCommand.js');"},
    {find:"const deleteTicket = require('../delete-tic-f47fa432/deleteTicketCommand.js');",replace:"const { deleteTicketCommand } = require('../delete-tic-f47fa432/deleteTicketCommand.js');"}],{knownNames:knownFor(files,P.dispatch),shapes:{path:P.dispatch,files,surfaces:sur}});
  assert.equal(step35.content,BOUND);
  assert.equal(step35.rejected.length,1);
  assert.match(step35.rejected[0].reason,/how "\{ deleteTicketCommand \}" is bound, which the target module's exports do not call for/);
  // Step 31: the model resolved app.js's path, and the Container then failed with
  // "dispatchCommand is not a function". The runtime now binds it in the same link.
  const app="const { createTicket, getTickets, updateTicket, deleteTicket } = require('../ticket-rep-f17f9f79/ticketRepository.js');\nconst parseCommand = require('../command-pa-f07f9de6/commandParser.js');\nconst dispatchCommand = require('../cli-contro-f77fa8eb/commandDispatcher.js');\n\nconst repository = { createTicket, getTickets, updateTicket, deleteTicket };\nconst command = parseCommand(process.argv);\ndispatchCommand(command, repository);";
  const withApp=new Map([...files,[P.app,app],[P.parser,'const parseCommandLineArgs = () => ({});\nmodule.exports = parseCommandLineArgs;']]);
  assert.deepEqual(L.shapeFixes(withApp,surfacesOf(withApp)).filter(e=>e.file===P.app).map(e=>e.replace),["const { dispatch: dispatchCommand } = require('../cli-contro-f77fa8eb/commandDispatcher.js');"],'parseCommand is bound whole to a single function, which is right');
  assert.match(LINKER_SYSTEM,/fixes four binding shapes[^]*a module bound whole whose only export is one function, when the file only calls it, directly or from a table of handlers \(const f = require\(p\) where p exports only \{ g \}\)/,'the linker is told, so it fixes only the path');
});

test('shape: a whole binding is left alone when the target exports more, or the file may read a member of it',()=>{
  const fixes=(app,target,file='components/b/x.js')=>{const m=new Map([['components/a/app.js',app],[file,target]]);return L.shapeFixes(m,surfacesOf(m)).map(e=>e.replace);};
  const table="const run = require('../b/x');\nconst table = { go: run };\nmodule.exports = { dispatch: (op, a) => table[op](a) };\n";
  const one='module.exports = { add(a){ return a; } };\n';
  assert.deepEqual(fixes(table,one),["const { add: run } = require('../b/x');"],'a method, kept in a handler table');
  assert.deepEqual(fixes(table,'exports.add = (a) => a;\n'),["const { add: run } = require('../b/x');"],'exports.m = an arrow');
  assert.deepEqual(fixes(table,'class Add {}\nmodule.exports = { Add };\n'),["const { Add: run } = require('../b/x');"],'a class');
  assert.deepEqual(fixes(table,'module.exports = { add(a){ return a; }, remove(a){ return a; } };\n'),[],'two members exported');
  assert.deepEqual(fixes(table,'exports.add = (a) => a;\nexports.remove = (a) => a;\n'),[],'two members exported by name');
  assert.deepEqual(fixes(table,'module.exports = { add: 1 };\n'),[],'a member that is not a function');
  assert.deepEqual(fixes(table,"const make = require('../c/make');\nmodule.exports = { add: make() };\n"),[],'a member that may not be a function');
  assert.deepEqual(fixes(table,'module.exports = function add(a){ return a; };\n'),[],'the module is the function: the whole binding is right');
  assert.deepEqual(fixes(table+'const h = table.go || run;\nif (typeof h === \'function\' && !(\'go\' in table)) h(1);\n',one),["const { add: run } = require('../b/x');"],'kept in a variable, tested and called');
  for(const [how,line] of [['x.member','run.add(1);'],['x[key]',"run['add'](1);"],['destructured','const { add } = run;'],['spread','const copy = { ...run };'],['key listing','Object.keys(run);'],['copied','Object.assign({}, run);'],
    ['in',"'add' in run;"],['for…in','for (const k in run) {}'],['exported as is','module.exports.run = run;'],['exported in an object','exports.api = { run };'],['shadowed','function f(run) { return run; }'],
    ['returned','function f() { return run; }'],['returned in an object','function f() { return { tickets: run }; }'],['passed to a call','setup(run);'],['in an array','[run].forEach(c => c.add(1));'],
    ["a table entry's member",'table.go.add(1);'],['a table entry passed on','const h = table.go; setup(h);'],['the table returned','function f() { return table; }'],['the table exported','exports.table = table;'],['the table copied','Object.values(table);'],
    ['a table method that reads entries through this',"table.call = function (op) { return this[op].add(); };"]])
    assert.deepEqual(fixes(table+line+'\n',one),[],how);
  const esm=(app,target)=>{const m=new Map([['components/a/app.mjs',app],['components/b/x.mjs',target]]);return L.shapeFixes(m,surfacesOf(m)).map(e=>e.replace);};
  const use="import run from '../b/x.mjs';\nconst table = { go: run };\nexport function start(op){ return table[op](); }\n";
  assert.deepEqual(esm(use,'export function add(a){ return a; }\n'),["import { add as run } from '../b/x.mjs';"],'ESM: one named function and no default');
  const m=new Map([['components/a/app.mjs',use],['components/b/x.mjs','export function add(a){ return a; }\n']]),shapes={path:'components/a/app.mjs',files:m,surfaces:surfacesOf(m)};
  assert.equal(L.applyEdits(use,[{find:'import run from',replace:'import { add as run } from'}],{shapes}).applied[0]?.shape,true,'the same edit from the model is the runtime fix');
  assert.equal(L.applyEdits(use,[{find:'import run from',replace:'import { add } from'}],{shapes}).applied.length,0,'one that drops the local name is not');
  assert.deepEqual(esm(use,'export function add(a){ return a; }\nexport default add;\n'),[],'ESM: the target exports a default');
  assert.deepEqual(esm(use,'export function add(a){ return a; }\nexport const ALL = 1;\n'),[],'ESM: two named exports');
  assert.deepEqual(esm("import run from '../b/x.mjs';\nexport function start(){ return run.add; }\n",'export function add(a){ return a; }\n'),[],'ESM: read as a namespace');
  assert.deepEqual(esm("import run from '../b/x.mjs';\nexport const api = run;\n",'export function add(a){ return a; }\n'),[],'ESM: exported as is');
  assert.deepEqual(esm("import run from '../b/x.mjs';\nconst table = { go: run };\nexport { table };\n",'export function add(a){ return a; }\n'),[],'ESM: its table exported');
});

test('shape: command objects kept in a table and read for their one method stay bound whole, and the program runs',()=>{
  const files=new Map([['components/add/addCommand.js',"function execute(args) { return 'added ' + args.title; }\nmodule.exports = { execute };"],['components/list/listCommand.js',"module.exports = { execute(args) { return 'listed'; } };"],
    ['components/cli/dispatcher.js',"const addCommand = require('../add/addCommand.js');\nconst listCommand = require('../list/listCommand.js');\n\nconst commands = { add: addCommand, list: listCommand };\n\nfunction start() {\n  return { run: (name, args) => commands[name].execute(args) };\n}\nmodule.exports = { start };"]]);
  assert.deepEqual(L.shapeFixes(files,surfacesOf(files)),[]);
  const app=load(files,'components/cli/dispatcher.js').start();
  assert.deepEqual([app.run('add',{title:'x'}),app.run('list',{})],['added x','listed']);
});

test('room: the live run3b command branch links with no model call, and its dispatcher runs every command',async()=>{
  const {room,store,calls}=linkRoom();
  const {builder,paths}=await linkBranch(room,await managers(room,['Ticket commands']),[
    ['Ticket Repository','ticketRepository.js',REPO],['Create Ticket Command','createTicketCommand.js',CREATE],['View Tickets Command','viewTicketsCommand.js',VIEW],
    ['Update Ticket Command','updateTicketCommand.js',UPDATE],['Delete Ticket Command','deleteTicketCommand.js',DELETE],['CLI Controller','commandDispatcher.js',DISPATCH]]);
  const events=room.snapshot().events;
  assert.equal(room.node(builder.id).status,'done',events.slice(-8).map(e=>e.kind+': '+e.body).join('\n'));
  assert.equal(calls.length,0,'no model call: every path and binding was mechanical');
  assert.match(events.find(e=>e.kind==='link_auto').body,/^Applied 8 rename\(s\) and 3 import binding fix\(es\) without the model/);
  const linked=new Map();
  for(const p of paths)linked.set(p,await store.read(room.node(builder.id).repo_name,p));
  const dispatcher=paths[5],rel=i=>L.relativeSpecifier(dispatcher,paths[i]);
  assert.equal(linked.get(dispatcher),BOUND.replace('../create-tic-f37fa29f/createTicketCommand.js',rel(1)).replace('../view-ticke-f27fa10c/viewTicketsCommand.js',rel(2))
    .replace('../update-tic-f57fa5c5/updateTicketCommand.js',rel(3)).replace('../delete-tic-f47fa432/deleteTicketCommand.js',rel(4)));
  const {dispatch}=load(linked,dispatcher),log=console.log,lines=[];
  console.log=(...a)=>lines.push(a.join(' '));
  try {
    dispatch('create',{title:'Printer jam'});
    dispatch('update',{id:1,status:'closed'});
    dispatch('view');
    dispatch('delete','1');
    dispatch('view');
  } finally {console.log=log;}
  assert.match(lines.join('\n'),/^All Tickets:\nID: 1\n[^]*\nStatus: closed\n[^]*\nNo tickets found\.$/);
});

// Earlier revisions, reconstructed from run3b's rejected edits: createTicketCommand.js
// and viewTicketsCommand.js at step 17, app.js at step 35 (paths as Root had linked them).
const CREATE_17="const { addTicket } = require('../ticket-rep-f17f9f79/ticketRepository.js');\n\nfunction generateId() {\n  let id = 1;\n  return () => id++;\n}\n\nconst idGenerator = generateId();\n\nmodule.exports = function createTicketCommand(args) {\n  if (!args.title) {\n    throw new Error('Title is required');\n  }\n  const ticket = {\n    id: idGenerator(),\n    title: args.title,\n    description: args.description || '',\n    status: 'open',\n    createdAt: new Date()\n  };\n  addTicket(ticket);\n};";
const VIEW_17=VIEW.replace('{ getTickets }','{ getAllTickets }').replace('function getAllTickets()','function handleViewTickets()').replace('= getTickets()','= getAllTickets()').replace('{ getAllTickets };','{ handleViewTickets };');
const APP_35="const { createTicket, getTickets, updateTicket, deleteTicket } = require('../ticket-rep-f17f9f79/ticketRepository.js');\nconst parseCommand = require('../command-pa-f07f9de6/commandParser.js');\nconst { dispatchCommand } = require('../cli-contro-f77fa8eb/commandDispatcher.js');\n\nconst repository = { createTicket, getTickets, updateTicket, deleteTicket };\nconst command = parseCommand(process.argv);\ndispatchCommand(command, repository);";
const PARSER="const parseCommandLineArgs = () => {\n  const args = process.argv.slice(2);\n  const command = args[0];\n  const options = {};\n  \n  for (let i = 1; i < args.length; i++) {\n    const arg = args[i];\n    if (arg.startsWith('--')) {\n      const [key, value] = arg.slice(2).split('=');\n      options[key] = value || true;\n    }\n  }\n  \n  return { command, options };\n};\n\nmodule.exports = parseCommandLineArgs;";
const IMPORT_REPO="require('../ticket-rep-f17f9f79/ticketRepository.js');";

test('alias: a model edit that renames an imported name but not its uses binds the target\'s name to the old one (run3b)',()=>{
  const files=new Map([...commands(),[P.create,CREATE_17],[P.view,VIEW_17],[P.app,APP_35],[P.parser,PARSER],[P.dispatch,BOUND]]),sur=surfacesOf(files);
  const edit=(file,find,replace)=>L.applyEdits(files.get(file),[{find,replace}],{knownNames:knownFor(files,file),shapes:{path:file,files,surfaces:sur}});
  const live=[[P.create,'addTicket','createTicket',100],[P.view,'getAllTickets','getTickets',21],[P.app,'dispatchCommand','dispatch',76]];
  for(const [file,from,to,token] of live) {
    const find=`const { ${from} } = `+(file===P.app?"require('../cli-contro-f77fa8eb/commandDispatcher.js');":IMPORT_REPO),replace=find.replace(`{ ${from} }`,`{ ${to} }`);
    const before=files.get(file);
    assert.equal(L.renameOnlyError(before,before.replace(find,replace)),`edit renames "${from}" in some places but not at token ${token}`,'the reconstruction gives the live rejection');
    const r=edit(file,find,replace);
    assert.deepEqual(r.rejected,[],from);
    assert.deepEqual(r.applied,[{find,replace:find.replace(`{ ${from} }`,`{ ${to}: ${from} }`),alias:replace}]);
    assert.equal(r.content,before.replace(`{ ${from} }`,`{ ${to}: ${from} }`),'only the imported name changed; every use keeps the local name');
    assert.equal(L.applyEdits(before,[{find,replace}],{knownNames:knownFor(files,file)}).rejected.length,1,'without the target, still refused');
  }
  const app=edit(P.app,"const { dispatchCommand } = require('../cli-contro-f77fa8eb/commandDispatcher.js');","const { dispatch } = require('../cli-contro-f77fa8eb/commandDispatcher.js');").content;
  assert.deepEqual(L.importMismatches(new Map([...files,[P.app,app]]),sur).filter(m=>m.path===P.app),[],'app.js now reads dispatch, which the dispatcher exports');
  // Not an imported name: the local name of a whole binding (event 73) and a use (event 85).
  assert.match(edit(P.app,"const parseCommand = require('../command-pa-f07f9de6/commandParser.js');","const parseCommandLineArgs = require('../command-pa-f07f9de6/commandParser.js');").rejected[0].reason,/renames "parseCommand" in some places but not at token 69/);
  assert.match(edit(P.app,'dispatchCommand(command, repository);','dispatch(command, repository);').rejected[0].reason,/renames "dispatchCommand" in some places but not at token 37/);
  // A relink that sends the same edit again finds it in place.
  const first=edit(P.create,`const { addTicket } = ${IMPORT_REPO}`,`const { createTicket } = ${IMPORT_REPO}`);
  const again=L.applyEdits(first.content,[{find:`const { addTicket } = ${IMPORT_REPO}`,replace:`const { createTicket } = ${IMPORT_REPO}`}],{done:first.applied});
  assert.deepEqual([again.content,again.rejected],[first.content,[]]);
});

test('alias: only an imported name, and only to a name the target exports',()=>{
  const files=new Map([['components/a/app.js',"const { make } = require('../b/x');\nconst { load: read } = require('../b/x');\nmodule.exports = () => make(read());\n"],['components/b/x.js','module.exports = { create(){ return 1; }, get(){ return 2; } };\n'],
    ['components/a/app.mjs',"import { make } from '../b/x.mjs';\nexport function start(){ return make(); }\n"],['components/b/x.mjs','export function create(){ return 1; }\n']]),sur=surfacesOf(files);
  const edit=(file,find,replace)=>L.applyEdits(files.get(file),[{find,replace}],{knownNames:new Set(['create','get','other']),shapes:{path:file,files,surfaces:sur}});
  assert.equal(edit('components/a/app.js','{ make }','{ create }').content,files.get('components/a/app.js').replace('{ make }','{ create: make }'));
  assert.equal(edit('components/a/app.mjs','{ make }','{ create }').content,files.get('components/a/app.mjs').replace('{ make }','{ create as make }'),'ESM');
  const missing=edit('components/a/app.js','{ make }','{ other }');
  assert.match(missing.rejected[0]?.reason,/renames "make" in some places but not at token/,'the target does not export other');
  const renamed=edit('components/a/app.js','{ load: read }','{ get: read }');
  assert.deepEqual(renamed.applied,[{find:'{ load: read }',replace:'{ get: read }'}],'an alias stays a rename of its key');
  const local=edit('components/a/app.js','{ load: read }','{ load: get }');
  assert.equal(local.applied.length,0,'the local name of an alias is a variable: renaming it alone is refused');
  const lost=new Map([...files,['components/a/app.js',files.get('components/a/app.js').replace("'../b/x'","'./nowhere'")]]);
  assert.equal(L.applyEdits(lost.get('components/a/app.js'),[{find:'{ make }',replace:'{ create }'}],{knownNames:new Set(['create']),shapes:{path:'components/a/app.js',files:lost,surfaces:sur}}).applied.length,0,'a path that names no module');
});

test('alias: only an import that did not match, still of the same module, where the find text occurs once',()=>{
  const edit=(files,file,find,replace)=>L.applyEdits(files.get(file),[{find,replace}],{knownNames:knownFor(files,file),original:files.get(file),shapes:{path:file,files,surfaces:surfacesOf(files)}});
  // run3 branch builder root.5.4.3.3, step 106: the model pointed Ticket at another module.
  const json='components/jsontotick-a83fb27d/jsonToTicket.js',r3=new Map([['components/tickettojs-a53fadc4/ticketToJson.js',"function ticketToJson(ticket) {\n  return JSON.stringify(ticket);\n}\n\nmodule.exports = ticketToJson;"],
    [json,"const { Ticket } = require('./Ticket');\n\nfunction jsonToTicket(jsonString) {\n  const data = JSON.parse(jsonString);\n  return new Ticket(data);\n}\n\nmodule.exports = { jsonToTicket };"]]);
  let r=edit(r3,json,"const { Ticket } = require('./Ticket');","const { ticketToJson } = require('../tickettojs-a53fadc4/ticketToJson.js');");
  assert.match(r.rejected[0]?.reason,/renames "Ticket" in some places but not at token 31/,'another module: the live rejection stands');
  assert.equal(r.content,r3.get(json));
  // An import that matched: the target exports both names.
  const view='components/view/viewTicket.js',both=new Map([['components/repo/ticketRepository.js',"function getTicketById(id) { return { id }; }\nfunction getTickets() { return []; }\nmodule.exports = { getTicketById, getTickets };"],
    [view,"const { getTicketById } = require('../repo/ticketRepository.js');\n\nfunction viewTicket(id) {\n  return getTicketById(id);\n}\nmodule.exports = { viewTicket };"]]);
  r=edit(both,view,"const { getTicketById } = require('../repo/ticketRepository.js');","const { getTickets } = require('../repo/ticketRepository.js');");
  assert.match(r.rejected[0]?.reason,/renames "getTicketById" in some places/,'the target provides the old name too');
  assert.equal(r.content,both.get(view));
  // The find text is also an object literal, whose key would change.
  const v='components/v/validators.js',lit=new Map([['components/t/titleValidator.js',"function isValidTitle(s) { return typeof s === 'string' && s.length > 0; }\nmodule.exports = { isValidTitle };"],
    [v,"const { validateTitle } = require('./titleValidator');\nfunction check(t) { return validateTitle(t.title); }\nmodule.exports = { check, validators: { validateTitle } };"]]);
  r=edit(lit,v,'{ validateTitle }','{ isValidTitle }');
  assert.match(r.rejected[0]?.reason,/renames "validateTitle" in some places/);
  assert.equal(r.content,lit.get(v));
  // The same module by its resolved path: the import alone becomes the alias.
  r=edit(lit,v,"const { validateTitle } = require('./titleValidator');","const { isValidTitle } = require('../t/titleValidator.js');");
  assert.deepEqual(r.rejected,[]);
  assert.equal(r.content,lit.get(v).replace("{ validateTitle } = require('./titleValidator')","{ isValidTitle: validateTitle } = require('../t/titleValidator.js')"));
});

// ------------------------------------------- run3 (v7.12, threshold 0.5), root.3.3.1
const VALIDATORS=[
  ['Validate title presence and type','titleValidator.js',"function isValidTitle(title) {\n  return typeof title === 'string' && title.length > 0;\n}\n\nmodule.exports = { isValidTitle };"],
  ['Validate description presence and type','descriptionValidator.js',"module.exports = function isValidDescription(description) {\n  return description !== undefined && description !== null && typeof description === 'string' && description.trim() !== '';\n};"],
  ['Validate priority range and type','priorityValidator.js',"function isValidPriority(priority) {\n  return Number.isFinite(priority) && priority >= 1 && priority <= 100;\n}\n\nmodule.exports = { isValidPriority };"],
  ['Combine validation checks','TicketValidator.js',"const { validateTitle } = require('./titleValidator');\nconst { validateDescription } = require('./descriptionValidator');\nconst { validatePriority } = require('./priorityValidator');\n\nfunction validateTicket(data) {\n  const errors = [];\n  \n  if (!validateTitle(data.title)) {\n    errors.push('Title is required and must be a non-empty string');\n  }\n  \n  if (!validateDescription(data.description)) {\n    errors.push('Description is required and must be a non-empty string');\n  }\n  \n  if (!validatePriority(data.priority)) {\n    errors.push('Priority must be a valid number within acceptable bounds');\n  }\n  \n  return errors;\n}\n\nmodule.exports = { validateTicket };"]];
const RENAMED=[['validateTitle','titleValidator','isValidTitle'],['validateDescription','descriptionValidator','isValidDescription'],['validatePriority','priorityValidator','isValidPriority']];

test('room: the live run3 validator branch keeps the builder\'s three name edits as aliases, and the builder above links the rest without the model',async()=>{
  // The branch builder's edits at step 92, each rejected live as "renames validateTitle in some places".
  const {room,store,calls}=linkRoom(user=>{
    const file=user.your_files.find(f=>f.path.endsWith('/TicketValidator.js'))?.path;
    return {edits:file?RENAMED.map(([from,mod,to])=>({file,find:`const { ${from} } = require('./${mod}');`,replace:`const { ${to} } = require('./${mod}');`})):[],entry:null,issues:[]};
  });
  const manager=await managers(room,['Create Ticket Service','TicketValidator.js']);
  const {builder,paths}=await linkBranch(room,manager,VALIDATORS);
  const events=room.snapshot().events,mine=e=>e.actor===builder.id;
  assert.equal(room.node(builder.id).status,'done',events.slice(-8).map(e=>e.kind+': '+e.body).join('\n'));
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].your_files.map(f=>f.path),[paths[3]]);
  assert.ok(!events.some(e=>mine(e)&&e.kind==='link_edit_rejected'),events.filter(e=>e.kind==='link_edit_rejected').map(e=>e.body).join('\n'));
  assert.match(events.find(e=>mine(e)&&e.kind==='link_done').body,/ with 3 rename\(s\); 3 import\(s\) point outside this branch and are left for the builder above\.$/);
  let aliased=VALIDATORS[3][2];
  for(const [from,,to] of RENAMED)aliased=aliased.replace(`{ ${from} }`,`{ ${to}: ${from} }`);
  assert.equal(await store.read(room.node(builder.id).repo_name,paths[3]),aliased);
  // The builder above finds each module by the name the import now reads, and binds the lone function.
  room.db().exec("UPDATE agents SET status='done' WHERE id=?",manager);
  const above=await room.scheduleAssembly('root.1');
  await room.turn(above.id);
  const up=room.snapshot().events.filter(e=>e.actor===above.id);
  assert.equal(room.node(above.id).status,'done',up.slice(-8).map(e=>e.kind+': '+e.body).join('\n'));
  assert.equal(calls.length,1,'no model call above');
  assert.match(up.find(e=>e.kind==='link_auto').body,/^Applied 3 rename\(s\) and 1 import binding fix\(es\) without the model/);
  assert.match(up.find(e=>e.kind==='link_done').body,/ with 3 rename\(s\) and 1 import binding fix\(es\)\.$/);
  const top=[...(await room.collectLinkSources(above.id))].find(s=>s.destination.endsWith('/TicketValidator.js'));
  const linked=await store.read(room.node(above.id).repo_name,top.destination);
  assert.match(linked,/^const \{ isValidTitle: validateTitle \} = require\('\.\.\/[^']+\/titleValidator\.js'\);\nconst validateDescription = require\('\.\.\/[^']+\/descriptionValidator\.js'\);\nconst \{ isValidPriority: validatePriority \} = require\('\.\.\/[^']+\/priorityValidator\.js'\);\n/);
});

// ------------------------------------------- run6 (v7.13.1, threshold 0.5), root.6
// Root's builder sent the same edit three times at step 28, each rejected live as
// "edited file does not parse": the file declares getTickets itself, so the import
// could only become the alias { getTickets: loadTickets }. ticketStorage.js and
// filterApplication.js are copied exactly; ticketRetrieval.js at step 28 is its
// revision 3 with the import the rejected edit names and without start(), which
// step 28 still reported missing.
const STORAGE_6="const fs = require('fs');\nconst path = require('path');\n\nconst TICKETS_FILE = path.join(__dirname, 'tickets.json');\n\nfunction getTickets() {\n  if (!fs.existsSync(TICKETS_FILE)) {\n    fs.writeFileSync(TICKETS_FILE, '[]');\n  }\n  const data = fs.readFileSync(TICKETS_FILE, 'utf8');\n  return JSON.parse(data);\n}\n\nfunction saveTickets(tickets) {\n  fs.writeFileSync(TICKETS_FILE, JSON.stringify(tickets, null, 2));\n}\n\nmodule.exports = {\n  getTickets,\n  saveTickets\n};";
const FILTER_6="exports.applyFilters = function(tickets, filters) {\n  return tickets.filter(ticket => {\n    return Object.keys(filters).every(key => {\n      return ticket[key] === filters[key];\n    });\n  });\n};\n";
const RETRIEVAL_28="const { loadTickets } = require('../../../ticket-sto-ee7f9ac0/ticketStorage.js');\nconst { applyFilters } = require('../filter-app-721921cb/filterApplication.js');\n\nfunction getTickets(filters) {\n  const tickets = loadTickets();\n  return applyFilters(tickets, filters);\n}\n\nmodule.exports = { getTickets };";
const P6={store:'components/ticket-sto-ee7f9ac0/ticketStorage.js',filter:'components/view-ticke-741924f1/components/filter-app-721921cb/filterApplication.js',ret:'components/view-ticke-741924f1/components/ticket-ret-7319235e/ticketRetrieval.js'};
const run6=()=>new Map([[P6.store,STORAGE_6],[P6.filter,FILTER_6],[P6.ret,RETRIEVAL_28]]);
const FIND_6="const { loadTickets } = require('../../../ticket-sto-ee7f9ac0/ticketStorage.js');",REPLACE_6=FIND_6.replace('{ loadTickets }','{ getTickets }');
const REDECLARED="edited file does not parse: Identifier 'getTickets' has already been declared (4:9)";

test('alias: an imported name renamed onto a function the file declares is bound as an alias, not refused as a redeclaration (run6 ticketRetrieval.js)',()=>{
  const files=run6(),sur=surfacesOf(files),before=files.get(P6.ret);
  assert.equal(L.renameOnlyError(before,before.replace(FIND_6,REPLACE_6)),REDECLARED,'the reconstruction gives the live rejection');
  assert.deepEqual(L.importMismatches(files,sur).map(m=>m.detail),["destructures 'loadTickets' from components/ticket-sto-ee7f9ac0/ticketStorage.js, which exports: getTickets, saveTickets"],'the live link_retry problem');
  const r=L.applyEdits(before,[{find:FIND_6,replace:REPLACE_6}],{knownNames:knownFor(files,P6.ret),original:before,shapes:{path:P6.ret,files,surfaces:sur}});
  const alias="const { getTickets: loadTickets } = require('../../../ticket-sto-ee7f9ac0/ticketStorage.js');";
  assert.deepEqual(r.rejected,[]);
  assert.deepEqual(r.applied,[{find:FIND_6,replace:alias,alias:REPLACE_6}]);
  assert.equal(r.content,before.replace(FIND_6,alias));
  assert.match(r.content,/\n\nfunction getTickets\(filters\) \{\n  const tickets = loadTickets\(\);\n[^]*\nmodule\.exports = \{ getTickets \};$/,'the file\'s own getTickets and its call of loadTickets are untouched');
  const linked=new Map([...files,[P6.ret,r.content]]);
  assert.deepEqual(L.importMismatches(linked,surfacesOf(linked)),[]);
  const {getTickets}=load(new Map([...linked,['components/ticket-sto-ee7f9ac0/tickets.json','[{"id":1,"status":"open"},{"id":2,"status":"closed"}]']]),P6.ret);
  assert.deepEqual(getTickets({status:'open'}),[{id:1,status:'open'}],'the linked module reads the store through the alias');
  assert.equal(L.applyEdits(before,[{find:FIND_6,replace:REPLACE_6}],{knownNames:knownFor(files,P6.ret)}).rejected[0]?.reason,REDECLARED,'without the target, still refused');
  const again=L.applyEdits(r.content,[{find:FIND_6,replace:REPLACE_6}],{done:r.applied});
  assert.deepEqual([again.content,again.rejected],[r.content,[]],'a relink that sends the same edit again finds it in place');
  // The path resolved in the same edit: the unresolved path names the same module.
  const unresolved=new Map([...files,[P6.ret,before.replace('../../../ticket-sto-ee7f9ac0/ticketStorage.js','./ticketStorage')]]);
  const both=L.applyEdits(unresolved.get(P6.ret),[{find:FIND_6.replace('../../../ticket-sto-ee7f9ac0/ticketStorage.js','./ticketStorage'),replace:REPLACE_6}],{knownNames:knownFor(unresolved,P6.ret),original:unresolved.get(P6.ret),shapes:{path:P6.ret,files:unresolved,surfaces:surfacesOf(unresolved)}});
  assert.deepEqual([both.rejected,both.content],[[],r.content]);
});

test('alias: the same collision in an ES module is bound as import { b as a }',()=>{
  const store='components/ticket-sto/ticketStorage.mjs',ret='components/view/ticket-ret/ticketRetrieval.mjs';
  const files=new Map([[store,"export function getTickets() {\n  return [];\n}\n\nexport function saveTickets(tickets) {}\n"],
    [ret,"import { loadTickets } from '../../ticket-sto/ticketStorage.mjs';\n\nexport function getTickets(filters) {\n  return loadTickets().filter(t => t.status === filters.status);\n}\n"]]);
  const before=files.get(ret),find='import { loadTickets } from',replace='import { getTickets } from';
  assert.match(L.renameOnlyError(before,before.replace(find,replace)),/^edited file does not parse: Identifier 'getTickets' has already been declared/);
  const r=L.applyEdits(before,[{find,replace}],{knownNames:knownFor(files,ret),original:before,shapes:{path:ret,files,surfaces:surfacesOf(files)}});
  assert.deepEqual([r.rejected,r.applied],[[],[{find,replace:'import { getTickets as loadTickets } from',alias:replace}]]);
  assert.equal(r.content,before.replace('{ loadTickets }','{ getTickets as loadTickets }'));
});

test('alias on a collision: only an imported name, of the same module, which exports the new name and not the old',()=>{
  const edit=(files,find,replace,file=P6.ret)=>L.applyEdits(files.get(file),[{find,replace}],{knownNames:knownFor(files,file),original:files.get(file),shapes:{path:file,files,surfaces:surfacesOf(files)}});
  const refused=(r,files,reason,how,file=P6.ret)=>{assert.equal(r.applied.length,0,how);assert.match(r.rejected[0]?.reason??'',reason,how);assert.equal(r.content,files.get(file),how);};
  // The target does not export getTickets, or exports loadTickets too.
  let files=new Map([...run6(),[P6.store,STORAGE_6.replaceAll('getTickets','readTickets')]]);
  refused(edit(files,FIND_6,REPLACE_6),files,/^edited file does not parse: Identifier 'getTickets' has already been declared/,'the target does not export the new name');
  files=new Map([...run6(),[P6.store,STORAGE_6.replace('  getTickets,\n','  getTickets,\n  loadTickets: getTickets,\n')]]);
  refused(edit(files,FIND_6,REPLACE_6),files,/^edited file does not parse/,'the target provides the old name too');
  // Pointed at another module that exports getTickets.
  files=new Map([...run6(),['components/archive-a1/archive.js','function getTickets() { return []; }\nmodule.exports = { getTickets };']]);
  refused(edit(files,FIND_6,"const { getTickets } = require('../../../archive-a1/archive.js');"),files,/^edited file does not parse/,'another module');
  // Collisions that are not an imported name renamed.
  files=run6();
  refused(edit(files,'function getTickets(filters)','function loadTickets(filters)'),files,/^edited file does not parse: Identifier 'loadTickets' has already been declared/,'the file\'s function renamed onto the imported name');
  refused(edit(files,'const { loadTickets } =','let { getTickets } ='),files,/^edited file does not parse/,'a keyword changed too');
  const local=new Map([...run6(),[P6.ret,RETRIEVAL_28.replace(FIND_6,"const storage = require('../../../ticket-sto-ee7f9ac0/ticketStorage.js');\nconst { loadTickets } = storage;")]]);
  refused(edit(local,'const { loadTickets } = storage;','const { getTickets } = storage;'),local,/^edited file does not parse: Identifier 'getTickets' has already been declared/,'a destructured local value, not an import');
});

// Root's first link bound createTicket.js's { createTicket } to saveTickets, which
// replaces the whole store. Token for token that is a rename, so only the
// prompt can tell the builder it is a missing function.
test('prompt: binding a name to another operation is a missing function, not a rename (run6 createTicket.js)',()=>{
  const before="const { createTicket } = require('./ticketStore');\n\nmodule.exports = { addTicket: (data) => createTicket(data) };\n";
  assert.equal(L.renameOnlyError(before,before.replace("{ createTicket } = require('./ticketStore')","{ saveTickets: createTicket } = require('../ticket-sto-ee7f9ac0/ticketStorage.js')"),{knownNames:L.knownNamesFrom([STORAGE_6])}),null,'the live rename passes the rename-only check');
  assert.match(LINKER_SYSTEM,/Rename only to an export that performs what the caller expects: binding a name to a different operation \(for example createTicket to saveTickets, which replaces the whole store\) is not a rename but a missing function, so report it as an issue instead\./);
});

test('room: the run6 retrieval branch applies the colliding rename as an alias, and nothing goes back to the worker',async()=>{
  const under='root.1',labels=[['Ticket storage','ticketStorage.js'],['Filter application logic','filterApplication.js'],['Ticket retrieval function','ticketRetrieval.js']];
  const [store,filter,ret]=labels.map(([label,file],i)=>materializedPath(label,file,`${under}.${i+1}`));
  const source=RETRIEVAL_28.replace('../../../ticket-sto-ee7f9ac0/ticketStorage.js',L.relativeSpecifier(ret,store)).replace('../filter-app-721921cb/filterApplication.js',L.relativeSpecifier(ret,filter));
  const find=source.split('\n')[0],replace=find.replace('{ loadTickets }','{ getTickets }');
  const {room,store:repos,calls}=linkRoom(user=>({edits:user.your_files.some(f=>f.path===ret)?[{file:ret,find,replace}]:[],entry:null,issues:[]}));
  assert.equal(await managers(room,['view ticket']),under);
  const {builder}=await linkBranch(room,under,[[...labels[0],STORAGE_6],[...labels[1],FILTER_6],[...labels[2],source]]);
  const events=room.snapshot().events,mine=e=>e.actor===builder.id;
  assert.equal(room.node(builder.id).status,'done',events.slice(-8).map(e=>e.kind+': '+e.body).join('\n'));
  assert.equal(calls.length,1,'one model call: the edit is not sent again');
  assert.ok(!events.some(e=>mine(e)&&['link_edit_rejected','link_retry','sent_to_workers'].includes(e.kind)),events.filter(mine).map(e=>e.kind+': '+e.body).join('\n'));
  assert.equal(await repos.read(room.node(builder.id).repo_name,ret),source.replace('{ loadTickets }','{ getTickets: loadTickets }'));
});

// v8 (S6): the linker's prompt is PRINCIPLES + ROLE.linker + FORMAT.linker,
// with no example names; a toolchain row's binding rules travel as data
// (binding_rules) for that row's files only. LINKER_SYSTEM above stays v7's.
test('prompt, v8: the linker is ROLE.linker with no example names, and the binding rules are data for the files of their row',async()=>{
  const {linkComponents}=await import('../src/model.js');
  const {systemPrompt}=await import('../src/prompts.js');
  const {toolchainById}=await import('../src/toolchains.js');
  const seen=[];
  const env={PIPELINE:'v8',AI:{run:async(_m,args)=>{seen.push(args.messages);return {response:seen.length===1?'nope':JSON.stringify({edits:[{file:'app.js',find:"require('./addItem')",replace:"require('./add-item')"}],issues:[]})};}}};
  const out=await linkComponents(env,{goal:'A list page',files:[{path:'app.js',content:"const { addItem } = require('./addItem');\n"}],interfaces:[],allPaths:['app.js','add-item.js'],scope:'branch'});
  assert.equal(out.edits.length,1);
  assert.equal(seen[0][0].content,systemPrompt('linker'));
  assert.doesNotMatch(seen[0][0].content,/createTicket|saveTickets|inmemoryti|require\(/);
  const user=JSON.parse(seen[0][1].content);
  assert.deepEqual(user.binding_rules,[toolchainById('javascript').binding_rules]);
  assert.match(user.scope_means,/joined again later with more files/);
  assert.ok(!('application_goal' in user),'the linker reads its files, not a goal');
  assert.deepEqual(JSON.parse(seen[1][1].content).previous_answer_problems.length,1,'the retry hears why in its user JSON');
  // A file of a row with no binding rules gets none.
  const other=[];
  await linkComponents({PIPELINE:'v8',AI:{run:async(_m,args)=>{other.push(JSON.parse(args.messages[1].content));return {response:'{"edits":[],"issues":[]}'};}}},{goal:'x',files:[{path:'convert.py',content:'from to_c import to_c\n'}],interfaces:[],allPaths:['convert.py']});
  assert.equal(other[0].binding_rules,undefined);
});
