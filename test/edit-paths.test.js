// Correct model path edits must not be rejected or broken on form. The
// strings are the ones the live linker sent in runs 5f85e12b and e89dba35.
import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
register('./cloudflare-loader.mjs',import.meta.url);
const {ControlRoom}=await import('../src/index.js');
const {materializedPath}=await import('../src/assembly.js');
const L=await import('../src/linker.js');

class Sql {constructor(){this.db=new DatabaseSync(':memory:');}exec(s,...p){if(!p.length&&!/^\s*select/i.test(s)){this.db.exec(s);return{toArray:()=>[]};}const q=this.db.prepare(s);const rows=/^\s*select/i.test(s)?q.all(...p):(q.run(...p),[]);return{toArray:()=>rows};}}
class Store {constructor(){this.repos=new Map();}async create(name){this.repos.set(name,new Map());return{name,remote:'https://test/'+name,branch:'main'};}async read(name,path){return this.repos.get(name)?.get(path)??null;}async write({name,path,content}){this.repos.get(name).set(path,content);return{commit:'c'.repeat(40)};}}

const F='components/viewticket-76192817/components/filter-app-9811f10b/components/';
const combine=F+'combine-mu-9a11f431/combineFilters.js',apply=F+'apply-filt-9711ef78/filterApplication.js';
const status=F+'implement--9b11f5c4/statusFilter.js',priority=F+'implement--9c11f757/priorityFilter.js',assignee=F+'implement--9911f29e/assigneeFilter.js';
const parsed=F+'parse-filt-a1512727/components/combine-fi-9e51226e/combineFilters.js',tracker='components/issuetrack-f57fa5c5/issueTrackerApp.js';
const model='components/createtick-d3f57ed3/components/define-tic-d9f58845/ticketModel.js';
const repos=['components/viewticket-76192817/components/ticketrepo-2b13086c/components/apply-filt-2a1306d9/ticketRepository.js',
  'components/viewticket-76192817/components/ticketrepo-2b13086c/components/implement--29130546/ticketRepository.js','components/viewticket-76192817/components/ticketrepo-721921cb/ticketRepository.js'];
const e89=[combine,apply,status,priority,assignee,parsed,tracker,model,...repos];
const combineSource="const { isStatusMatch } = require('../statusFilter');\nconst { isPriorityMatch } = require('../priorityFilter');\nconst { isAssigneeMatch } = require('../assigneeFilter');\n\nfunction combineFilters(ticket) {\n  return isStatusMatch(ticket) && isPriorityMatch(ticket) && isAssigneeMatch(ticket);\n}\n\nmodule.exports = { combineFilters };\n";

test('F3: a bare path find is widened to the module specifier literal that holds it',()=>{
  const {content,applied,rejected}=L.applyEdits(combineSource,[
    {find:'../statusFilter',replace:'../implement--9b11f5c4/statusFilter'},
    {find:'../priorityFilter',replace:'../implement--9c11f757/priorityFilter'},
    {find:'../assigneeFilter',replace:'../implement--9911f29e/assigneeFilter'}]);
  assert.deepEqual(rejected,[]);
  assert.equal(applied.length,3);
  assert.equal(content,combineSource.replace("'../statusFilter'","'../implement--9b11f5c4/statusFilter'").replace("'../priorityFilter'","'../implement--9c11f757/priorityFilter'").replace("'../assigneeFilter'","'../implement--9911f29e/assigneeFilter'"));
  const files=new Map([[combine,content],[status,'module.exports=()=>1;'],[priority,'module.exports={};'],[assignee,'module.exports=()=>1;']]);
  assert.deepEqual(L.unresolvedImports(files),[]);
  // ESM, double quotes, dynamic import and re-export keep their own quote.
  const esm='import { a } from "../a";\nexport * from "../b";\nconst c = () => import("../c");\n';
  const r=L.applyEdits(esm,[{find:'../a',replace:'../x/a.js'},{find:'../b',replace:'../x/b.js'},{find:'../c',replace:'../x/c.js'}]);
  assert.equal(r.applied.length,3,JSON.stringify(r.rejected));
  assert.equal(r.content,'import { a } from "../x/a.js";\nexport * from "../x/b.js";\nconst c = () => import("../x/c.js");\n');
  // The same specifier used twice is one rename, applied at both.
  const twice="const { a } = require('../statusFilter');\nconst { b } = require('../statusFilter');\nmodule.exports = { a, b };\n";
  assert.equal(L.applyEdits(twice,[{find:'../statusFilter',replace:'../implement--9b11f5c4/statusFilter'}]).content.split("'../implement--9b11f5c4/statusFilter'").length,3);
  // Half-quoted edits name the same literal.
  const one="const a = require('../a');\nmodule.exports = a;\n";
  for(const [find,replace] of [['../a',"'../x/a'"],["'../a'",'../x/a']])
    assert.equal(L.applyEdits(one,[{find,replace}]).content,"const a = require('../x/a');\nmodule.exports = a;\n",find);
});

test('F3: a bare find is never widened into an ordinary string or past a whole-token match',()=>{
  const data="const isStatusMatch = require('../statusFilter');\nconsole.log('../statusFilter');\nmodule.exports = isStatusMatch;\n";
  const r1=L.applyEdits(data,[{find:'../statusFilter',replace:'../implement--9b11f5c4/statusFilter'}]);
  assert.equal(r1.rejected[0]?.reason,'find text does not match whole tokens','the same text is also data, so the edit is ambiguous');
  assert.equal(r1.content,data);
  const label="const label = '../statusFilter';\nmodule.exports = label;\n";
  assert.equal(L.applyEdits(label,[{find:'../statusFilter',replace:'../implement--9b11f5c4/statusFilter'}]).rejected[0]?.reason,'find text does not match whole tokens');
  const mixed="const a = require('../statusFilter');\nconst b = require(\"../statusFilter\");\nmodule.exports = { a, b };\n";
  assert.equal(L.applyEdits(mixed,[{find:'../statusFilter',replace:'../implement--9b11f5c4/statusFilter'}]).rejected[0]?.reason,'find text does not match whole tokens','one edit cannot keep two quote styles');
  // Whole-token matches keep their meaning: this is an identifier rename.
  const named="const ticketService = require('ticketService');\nmodule.exports = ticketService;\n";
  const r2=L.applyEdits(named,[{find:'ticketService',replace:'svc'}]);
  assert.equal(r2.content,"const svc = require('ticketService');\nmodule.exports = svc;\n");
  // Widening never lets anything but the path change.
  const r3=L.applyEdits(combineSource,[{find:'../statusFilter',replace:"../implement--9b11f5c4/statusFilter').default; ('"}]);
  assert.match(r3.rejected[0]?.reason,/adds or removes code/);
  assert.equal(r3.content,combineSource);
});

test('F6: a path written from the wrong directory or without nested components/ names the one module it ends with',()=>{
  // Run 5f85e12b: Root wrote the sibling's path as if it were a child.
  const app='components/applicatio-f07f9de6/module.js',svc='components/ticket-ser-f17f9f79/ticketService.js';
  const e1=L.normalizeEditPaths({file:app,find:"const ticketService = require('./ticketService');",replace:"const ticketService = require('./ticket-ser-f17f9f79/ticketService.js');"},
    [app,'components/ticket-int-ee7f9ac0/ticket.js',svc]);
  assert.equal(e1.replace,"const ticketService = require('../ticket-ser-f17f9f79/ticketService.js');");
  // Run e89dba35: sibling paths missing the nested components/ level.
  assert.equal(L.normalizeEditPaths({file:apply,find:"const parseFilterParameters = require('./filterParser');",replace:"const parseFilterParameters = require('./parse-filt-a1512727/combine-fi-9e51226e/combineFilters');"},e89).replace,
    "const parseFilterParameters = require('../parse-filt-a1512727/components/combine-fi-9e51226e/combineFilters.js');");
  assert.equal(L.normalizeEditPaths({file:apply,find:"const statusFilter = require('./statusFilter');",replace:"const statusFilter = require('./implement--9b11f5c4/statusFilter');"},e89).replace,
    "const statusFilter = require('../implement--9b11f5c4/statusFilter.js');");
  // A bare path edit is normalized too, then widened to the literal when applied.
  const bare=L.normalizeEditPaths({file:tracker,find:'./createTicket',replace:'./createtick-d3f57ed3/components/define-tic-d9f58845/ticketModel'},e89);
  assert.equal(bare.replace,'../createtick-d3f57ed3/components/define-tic-d9f58845/ticketModel.js');
  const src="const { createTicket } = require('./createTicket');\nmodule.exports = { createTicket };\n";
  const out=L.applyEdits(src,[bare]);
  assert.equal(out.content,"const { createTicket } = require('../createtick-d3f57ed3/components/define-tic-d9f58845/ticketModel.js');\nmodule.exports = { createTicket };\n");
  assert.deepEqual(L.unresolvedImports(new Map([[tracker,out.content],[model,'module.exports = class Ticket {};']])),[]);
  // A quoted string as the whole replacement is the specifier.
  assert.equal(L.normalizeEditPaths({file:app,find:"'./ticketService'",replace:"'./ticket-ser-f17f9f79/ticketService.js'"},[app,svc]).replace,"'../ticket-ser-f17f9f79/ticketService.js'");
  // Half-quoted and undotted forms of the same edit.
  const mod="const ticketService = require('./ticketService');\nmodule.exports = ticketService;\n";
  for(const [find,replace] of [['./ticketService','ticket-ser-f17f9f79/ticketService.js'],["'./ticketService'",'./ticket-ser-f17f9f79/ticketService.js'],['./ticketService',"'./ticket-ser-f17f9f79/ticketService.js'"]])
    assert.equal(L.applyEdits(mod,[L.normalizeEditPaths({file:app,find,replace},[app,svc])]).content,mod.replace('./ticketService','../ticket-ser-f17f9f79/ticketService.js'),find+' → '+replace);
});

test('F6: ambiguous, resolving, built-in and non-specifier strings are left alone',()=>{
  const same=edit=>assert.equal(L.normalizeEditPaths(edit,e89),edit);
  same({file:apply,find:"require('./x')",replace:"require('./combineFilters')"});
  same({file:tracker,find:"require('./x')",replace:"require('./ticketRepository')"});
  same({file:combine,find:'../statusFilter',replace:'../implement--9b11f5c4/statusFilter'});
  same({file:combine,find:"require('./x')",replace:"require('../implement--9b11f5c4/statusFilter')"});
  same({file:apply,find:"require('./x')",replace:"require('fs')"});
  same({file:apply,find:"log('x')",replace:"log('./implement--9b11f5c4/statusFilter')"});
  same({file:apply,find:'parseFilters',replace:'combineFilters'});
  // A built-in wins over a module of the same name, and a file never names itself.
  const own=['components/x-1/util.js','components/a-1/store.js'];
  for(const edit of [{file:own[1],find:"require('./x')",replace:"require('util')"},{file:own[1],find:"require('./x')",replace:"require('./a-1/store')"}])
    assert.equal(L.normalizeEditPaths(edit,own),edit);
  // Strings the model kept are not rewritten, even when they do not resolve.
  const mods=['components/a-1/app.js','components/store-2/store.js','components/ids-3/uuid.js','components/data-3/data.js','components/x-1/helpers.js','components/t-4/ticket.js'];
  const kept=L.normalizeEditPaths({file:mods[0],find:"const uuid = require('uuid');\nconst h = require('./helpers');\nconst store = require('./store'); log(\"from './data'\");",
    replace:"const uuid = require('uuid');\nconst h = require('./helpers');\nconst store = require('./store-2/store.js'); log(\"from './data'\");"},mods);
  assert.equal(kept.replace,"const uuid = require('uuid');\nconst h = require('./helpers');\nconst store = require('../store-2/store.js'); log(\"from './data'\");");
  const noop={file:mods[0],find:"'ticket'",replace:"'ticket'"};
  assert.equal(L.normalizeEditPaths(noop,mods),noop);
  const app='components/applicatio-f07f9de6/module.js',key={file:app,find:"const { view } = require('ticketService');",replace:"const { read: view } = require('ticketService');"};
  assert.equal(L.normalizeEditPaths(key,[app,'components/ticket-ser-f17f9f79/ticketService.js']),key);
  assert.equal(L.applyEdits("const { view } = require('ticketService');\nmodule.exports = { start: () => view() };\n",[key],{knownNames:new Set(['read'])}).applied.length,1);
  // A json file resolves through the bundle's full file set.
  const files=new Map([...e89.map(p=>[p,'']),['components/issuetrack-f57fa5c5/statusFilter.json','{}']]);
  const edit={file:tracker,find:"require('./x')",replace:"require('./statusFilter')"};
  assert.equal(L.normalizeEditPaths(edit,e89,files),edit);
  assert.equal(L.normalizeEditPaths(edit,e89).replace,"require('../viewticket-76192817/components/filter-app-9811f10b/components/implement--9b11f5c4/statusFilter.js')");
  // Normalizing a path never makes a non-path change acceptable.
  const shape=L.normalizeEditPaths({file:combine,find:"const { isStatusMatch } = require('../statusFilter');",replace:"const isStatusMatch = require('./implement--9b11f5c4/statusFilter');"},e89);
  assert.equal(shape.replace,"const isStatusMatch = require('../implement--9b11f5c4/statusFilter.js');");
  assert.match(L.applyEdits(combineSource,[shape]).rejected[0]?.reason,/adds or removes code/);
});

test('room: linkSnapshot applies the live bare and sibling path edits and nothing is left unresolved',async()=>{
  const edits=new Map();
  const AI={run:async(_model,{messages})=>{
    if(!messages[0].content.startsWith('You are a LINKER'))throw new Error('unexpected model request');
    const user=JSON.parse(messages[1].content);
    return {response:JSON.stringify({edits:user.your_files.flatMap(f=>edits.get(f.path)||[]),entry:null,issues:[]})};
  }};
  const room=new ControlRoom({storage:{sql:new Sql()},waitUntil(){}},{MOCK_AI:'false',TEST_ARTIFACT_STORE:new Store(),AI});
  room.set('room_id','edit-paths-test');
  await room.provision('root',null,'Root objective','Build a small issue tracker');
  await room.spawn('root',[{label:'Ticket Interface',task:'Ticket class'},{label:'Ticket Service',task:'Ticket service'},{label:'Application Entry',task:'Entry exporting start()'}]);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  room.db().exec("UPDATE agents SET phase='implement' WHERE id IN ('root.1','root.2','root.3')");
  await room.putFile('root.1','ticket.js','class Ticket {}\nmodule.exports = Ticket;\n');
  await room.putFile('root.2','ticketService.js','let tickets = [];\nfunction create(t) { tickets.push(t); return t; }\nfunction read(id) { return tickets.find(t => t.id === id); }\nmodule.exports = { create, read };\n');
  await room.putFile('root.3','module.js',"const ticketService = require('./ticketService');\n\nfunction start() {\n  return {\n    create: ticketService.create,\n    view: ticketService.view\n  };\n}\n\nmodule.exports = { start };\n");
  room.db().exec("UPDATE agents SET status='done' WHERE id IN ('root.1','root.2','root.3')");
  const app=materializedPath('Application Entry','module.js','root.3');
  assert.equal(app,'components/applicatio-f07f9de6/module.js','the live run\'s path');
  edits.set(app,[{file:app,find:"const ticketService = require('./ticketService');",replace:"const ticketService = require('./ticket-ser-f17f9f79/ticketService.js');"},
    {file:app,find:'view: ticketService.view',replace:'view: ticketService.read'}]);
  const builder=await room.scheduleAssembly('root');
  const live=await room.linkSnapshot(builder.id,await room.collectLinkSources(builder.id),'',{isRoot:true});
  assert.deepEqual(live.rejected,[]);
  assert.deepEqual(live.unresolved,[]);
  assert.match(live.files.get(app),/require\('\.\.\/ticket-ser-f17f9f79\/ticketService\.js'\)/);
  assert.equal(live.entry,app);
  // Run e89dba35's rejected bare edits, through the same path.
  edits.set(combine,[{file:combine,find:'../statusFilter',replace:'../implement--9b11f5c4/statusFilter'},{file:combine,find:'../assigneeFilter',replace:'../implement--9911f29e/assigneeFilter'}]);
  edits.set(tracker,[{file:tracker,find:'./createTicket',replace:'./createtick-d3f57ed3/components/define-tic-d9f58845/ticketModel'}]);
  const src=[[combine,"const { isStatusMatch } = require('../statusFilter');\nconst { isAssigneeMatch } = require('../assigneeFilter');\nmodule.exports = { combineFilters: t => isStatusMatch(t) && isAssigneeMatch(t) };\n"],
    [status,'module.exports = function isStatusMatch(ticket, filter) { return ticket.status === filter.status; };\n'],
    [assignee,'function isAssigneeMatch(ticket, assigneeFilter) {\n  return ticket.assignee === assigneeFilter;\n}\n\nmodule.exports = isAssigneeMatch;\n'],
    [tracker,"const { createTicket } = require('./createTicket');\nmodule.exports = { start: () => ({ createTicket }) };\n"],[model,'class Ticket {}\nmodule.exports = Ticket;\n']];
  const deep=await room.linkSnapshot(builder.id,src.map(([destination,content])=>({destination,content})),'',{isRoot:true});
  assert.deepEqual(deep.rejected,[]);
  assert.equal(deep.applied.length,3);
  assert.deepEqual(deep.unresolved,[]);
  assert.match(deep.files.get(combine),/require\('\.\.\/implement--9b11f5c4\/statusFilter'\)/);
  assert.match(deep.files.get(tracker),/require\('\.\.\/createtick-d3f57ed3\/components\/define-tic-d9f58845\/ticketModel\.js'\)/);
});
