// v7.15.1 from live run9 (room 92cc686b): two manager decisions. A name two
// pieces of one split list is placed on one piece, not deleted from all; a
// worker's empty placeholder is not delivered, and its manager says from its
// plan which child's promise performs the operation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
register('./cloudflare-loader.mjs',import.meta.url);
const {ControlRoom}=await import('../src/index.js');
const {duplicateNames,repairInterfaces,labelNames,performsOp,normalizeSpawn}=await import('../src/interfaces.js');
const {pickPiece,ROOT_PROMISE}=await import('../src/model.js');
const {placeholders}=await import('../src/linker.js');
class Sql {
  constructor(db){this.db=db||new DatabaseSync(':memory:');}
  exec(sql,...args){
    if(!args.length&&!/^\s*select/i.test(sql)){this.db.exec(sql);return {toArray:()=>[]};}
    const q=this.db.prepare(sql);
    const rows=/^\s*select/i.test(sql)?q.all(...args):(q.run(...args),[]);
    return {toArray:()=>rows};
  }
}
class Store {
  constructor(){this.repos=new Map();}
  async create(name){this.repos.set(name,new Map());return {name,remote:'https://example.invalid/'+name,branch:'main'};}
  async read(name,path){return this.repos.get(name)?.get(path)??null;}
  async write({name,path,content}){this.repos.get(name).set(path,content);return {commit:'c'.repeat(40)};}
}
function setup(ai) {
  const pending=[],room=new ControlRoom({storage:{sql:new Sql()},waitUntil:p=>pending.push(p)},{AI:ai,TEST_ARTIFACT_STORE:new Store()});
  return {room,drain:async()=>{await Promise.all(pending.splice(0));}};
}
const events=(room,kind)=>room.snapshot().events.filter(e=>e.kind===kind);
const START={name:'start',does:ROOT_PROMISE[0].does,params:[]};
// A scripted Clef and Qwen: piece(label,name) answers the placement
// question, fn(need,name) the function matcher; both may throw.
function fakeAI({split,names=()=>0.9,piece=()=>{throw new Error('no piece answer');},fn=()=>{throw new Error('no fn answer');},leaf}={}) {
  const calls=[];
  return {calls,run:async(_model,input)=>{
    if(input.questions?.should_split){calls.push({kind:'gate'});return {answers:{should_split:{noul:0.85}}};}
    if(input.questions) {
      const keys=Object.keys(input.questions),kids=input.state.proposed_children||[];
      if(keys[0].startsWith('within_'))return {answers:Object.fromEntries(keys.map(k=>[k,{noul:0.9}]))};
      if(keys[0].startsWith('names_'))return {answers:Object.fromEntries(keys.map(k=>{const [,i,j]=k.split('_').map(Number),c=kids.find(x=>x.slot===i);return [k,{noul:names(c.label,c.functions[j].split('(')[0])}];}))};
      if(keys[0].startsWith('piece_')) {
        calls.push({kind:'piece',state:input.state,questions:input.questions});
        return {answers:Object.fromEntries(keys.map(k=>[k,{noul:piece(input.state.pieces[Number(k.slice(6))].label,input.state.function.signature.split('(')[0])}]))};
      }
      if(keys[0].startsWith('fn_')) {
        calls.push({kind:'fn',state:input.state});
        return {answers:Object.fromEntries(keys.map(k=>[k,{noul:fn(input.state.request.need,input.state.functions[Number(k.slice(3))].signature.split('(')[0])}]))};
      }
    }
    const system=input.messages?.[0]?.content||'',request=input.messages?.[1]?.content;
    if(system.includes('CODE SPLITTER')){calls.push({kind:'split'});return {response:JSON.stringify({summary:'Split',spawn:split()})};}
    if(system.includes('LEAF CODE WRITER')&&leaf){calls.push({kind:'leaf',request:JSON.parse(request)});return {response:JSON.stringify(leaf(calls.filter(c=>c.kind==='leaf').length))};}
    throw new Error('Unexpected model call');
  }};
}
const goal='Build a small issue tracker that lets someone create, view, update, and delete tickets.';
// Root's split in run9, with the names its splitter gave.
const run9Root=[
  {label:'Entry Module',task:'Write code that imports the ticket operations and exports start(), which returns an object with create, view, update and delete.',functions:[{name:'start',does:'returns the tracker API'}]},
  {label:'Data Module',task:'Write code that keeps tickets in memory and lets the other modules add, read, change and remove them.',functions:[
    {name:'addTicket',does:'stores a ticket with a new id and returns it',params:['ticket']},{name:'getTickets',does:'returns all stored tickets'},
    {name:'updateTicket',does:'changes a stored ticket',params:['id','updates']},{name:'deleteTicket',does:'removes a stored ticket',params:['id']}]},
  {label:'Create Ticket Module',task:'Write code that creates a ticket from the given data.',functions:[{name:'createTicket',does:'creates a ticket and returns it',params:['data']}]},
  {label:'View Tickets Module',task:'Write code that retrieves tickets.',functions:[{name:'viewTickets',does:'returns tickets'}]},
  {label:'Update Ticket Module',task:'Write code that updates a ticket by id.',functions:[{name:'updateTicket',does:'updates a ticket by id and returns it',params:['id','updates']}]},
  {label:'Delete Ticket Module',task:'Write code that deletes a ticket by id.',functions:[{name:'deleteTicket',does:'deletes a ticket by id and returns true',params:['id']}]}];
const promisedNames=room=>Object.fromEntries(room.children('root').map(c=>[c.label,room.promisedOf(c.id).map(f=>f.name)]));

test('v7.15.1: labelNames reads a label as the name\'s words, without filler words or a plural s',()=>{
  assert.ok(labelNames('Update Ticket Module','updateTicket'));
  assert.ok(labelNames('update-ticket','updateTicket'));
  assert.ok(labelNames('Delete Tickets Module','deleteTicket'));
  assert.ok(!labelNames('Data Module','updateTicket'));
  assert.ok(!labelNames('Update Ticket Status Module','updateTicket'));
});

test('v7.15.1: run9\'s split keeps updateTicket and deleteTicket on the pieces named for them; an ambiguous name has no plain pick',()=>{
  const {spawn}=normalizeSpawn(run9Root,[START]);
  const dups=duplicateNames(spawn,[START]);
  assert.deepEqual(dups.map(d=>[d.name,d.holders,d.pick,d.why]),[['updateTicket',[1,4],4,'label matches'],['deleteTicket',[1,5],5,'label matches']]);
  assert.equal(dups[0].item.does,'changes a stored ticket','the first item with a hint');
  const owners=new Map(dups.map(d=>[d.name,{index:d.pick,why:d.why}]));
  const {spawn:out,removed}=repairInterfaces(spawn,[START],new Set(),owners);
  assert.deepEqual(out.map(c=>c.interfaces.map(f=>f.name)),[['start'],['addTicket','getTickets'],['createTicket'],['viewTickets'],['updateTicket'],['deleteTicket']]);
  assert.deepEqual(removed.map(r=>[r.label,r.name,r.why]),[['Data Module','updateTicket','listed by two pieces; kept on "Update Ticket Module", label matches'],['Data Module','deleteTicket','listed by two pieces; kept on "Delete Ticket Module", label matches']]);
  // A task that says it exports NAME( decides; a label and a task that disagree do not.
  const piece=(label,task,...names)=>({label,task,interfaces:names.map(name=>({name,does:'',params:[]}))});
  assert.deepEqual(duplicateNames([piece('Store','Write code that exports formatTicket(ticket) for the views','formatTicket'),piece('Views','Write code that renders tickets','formatTicket')]).map(d=>[d.pick,d.why]),[[0,'task exports it']]);
  assert.deepEqual(duplicateNames([piece('Store','Write code that exports formatTicket(ticket)','formatTicket'),piece('Format Ticket','Write code','formatTicket')]).map(d=>d.pick),[null]);
  assert.deepEqual(duplicateNames([piece('Views','Write code that renders tickets','formatTicket'),piece('Printer','Write code that prints tickets','formatTicket')]).map(d=>d.pick),[null]);
  assert.deepEqual(duplicateNames([piece('A','x','start','helper'),piece('B','y','start','helper')],[START],new Set(['helper'])),[],'promised and elsewhere names are not placed here');
  assert.deepEqual(repairInterfaces([piece('A','x','shared'),piece('B','y','shared')]).spawn.map(c=>c.interfaces.length),[0,0],'with no owner it is deleted from all, as before');
});

test('v7.15.1: run9 replay: Root keeps updateTicket on Update Ticket Module and deleteTicket on Delete Ticket Module by the label, with no Clef placement call',async()=>{
  const ai=fakeAI({split:()=>run9Root,names:(label,name)=>name==='viewTickets'?0.413:0.9});
  const {room,drain}=setup(ai);
  await room.start(goal,1);await drain();
  assert.equal(ai.calls.filter(c=>c.kind==='piece').length,0,'the plain pick needs no model call');
  assert.deepEqual(promisedNames(room),{'Entry Module':['start'],'Data Module':['addTicket','getTickets'],'Create Ticket Module':['createTicket'],'View Tickets Module':[],'Update Ticket Module':['updateTicket'],'Delete Ticket Module':['deleteTicket']});
  assert.equal(room.promisedOf(room.children('root')[4].id)[0].does,'updates a ticket by id and returns it','the winner keeps its own item');
  assert.deepEqual(events(room,'interfaces_repaired').map(e=>e.body),['Deleted updateTicket from "Data Module" (listed by two pieces; kept on "Update Ticket Module", label matches); deleteTicket from "Data Module" (listed by two pieces; kept on "Delete Ticket Module", label matches); the pieces are kept.']);
});

const ambiguous=[
  {label:'Entry Module',task:'Write code that exports start().',functions:[{name:'start'}]},
  {label:'Ticket views',task:'Write code that renders tickets as text.',functions:[{name:'formatTicket',does:'renders one ticket as a line of text',params:['ticket']},{name:'renderList'}]},
  {label:'Ticket printer',task:'Write code that prints tickets to the console.',functions:[{name:'formatTicket'},{name:'printTickets'}]}];

test('v7.15.1: an ambiguous duplicate goes to Clef once, over the candidate pieces only, and lands on the winner',async()=>{
  const ai=fakeAI({split:()=>ambiguous,piece:label=>label==='Ticket views'?0.82:0.3});
  const {room,drain}=setup(ai);
  await room.start(goal,1);await drain();
  const asked=ai.calls.filter(c=>c.kind==='piece');
  assert.equal(asked.length,1,'one call for the one shared name');
  assert.deepEqual(asked[0].state.pieces.map(p=>p.label),['Ticket views','Ticket printer'],'only the pieces that list it');
  assert.deepEqual(asked[0].state.function,{signature:'formatTicket(ticket)',does:'renders one ticket as a line of text'});
  assert.equal(Object.keys(asked[0].questions).length,2,'one question per candidate');
  assert.deepEqual(promisedNames(room),{'Entry Module':['start'],'Ticket views':['formatTicket','renderList'],'Ticket printer':['printTickets']});
  assert.equal(events(room,'interfaces_repaired')[0].body,'Deleted formatTicket from "Ticket printer" (listed by two pieces; kept on "Ticket views", Clef p=0.82); the pieces are kept.');
});

test('v7.15.1: Clef below the threshold, or erroring, deletes a duplicate from all pieces, as before',async()=>{
  for(const [piece,why] of [[()=>0.4,'Clef named none (best p=0.40)'],[()=>{throw new Error('down');},'Clef failed']]) {
    const ai=fakeAI({split:()=>ambiguous,piece});
    const {room,drain}=setup(ai);
    await room.start(goal,1);await drain();
    assert.deepEqual(promisedNames(room),{'Entry Module':['start'],'Ticket views':['renderList'],'Ticket printer':['printTickets']});
    assert.equal(events(room,'interfaces_repaired')[0].body,`Deleted formatTicket from "Ticket views" (listed by two pieces; ${why}); formatTicket from "Ticket printer" (listed by two pieces; ${why}); the pieces are kept.`);
  }
});

test('v7.15.1: pickPiece under MOCK_AI picks the one piece whose words share the most with the name and its hint, or none',async()=>{
  const env={MOCK_AI:'true'},pieces=[{label:'Ticket views',task:'renders tickets as text'},{label:'Ticket printer',task:'prints tickets'}];
  assert.deepEqual(await pickPiece(env,{name:'printTicket',does:'prints one ticket'},pieces),{index:1,p:1});
  assert.equal(await pickPiece(env,{name:'saveTicket',does:''},pieces),null);
});

test('v7.15.1: placeholders reads empty promised functions and start\'s empty operations, and passes real or delegating bodies',()=>{
  const files={'a.js':[
    "const { getTickets } = require('./getTickets');",
    "function helper() {}",
    "export function empty() {}",
    "export const nothing = () => null;",
    "export function thrower() { throw new Error('Not implemented'); }",
    "export function guard(t) { throw new TypeError('ticket ' + t + ' is invalid'); }",
    "export function oneLine(t) { return t.id; }",
    "export function delegates() { return getTickets(); }",
    "export function strict() { 'use strict'; return undefined; }"].join('\n')};
  assert.deepEqual(placeholders(files,['empty','nothing','thrower','guard','oneLine','delegates','strict','helper']).map(x=>x.name),['empty','nothing','thrower','strict'],'a helper nobody promised is not read');
  const cjs={'b.js':"exports.later = function () { return; };\nmodule.exports.todo = () => { throw 'TODO'; };\nexports.real = x => x * 2;"};
  assert.deepEqual(placeholders(cjs,['later','todo','real']).map(x=>x.name),['later','todo']);
  const start={'app.js':"const { createTicket } = require('./createTicket');\nfunction view() {}\nconst api = { create: createTicket, view, archive() {}, list: () => [] };\nmodule.exports = { start() { return api; } };"};
  assert.deepEqual(placeholders(start,['start']),[{path:'app.js',name:'start',op:'view',params:[]},{path:'app.js',name:'start',op:'archive',params:[]}],'an import and a body that returns a value pass');
});

test('v7.15.1: placeholders passes a void that does the work, start\'s getters, setters and lifecycle no-ops, and names start or a later assignment rebinds',()=>{
  const one=(src,names=['start'])=>placeholders({'a.js':src},names).map(x=>x.op||x.name);
  assert.deepEqual(one("const tickets = new Map();\nexports.deleteTicket = id => void tickets.delete(id);",['deleteTicket']),[],'void of a call does the work');
  assert.deepEqual(one("const tickets = new Map();\nfunction deleteTicket(id) { return void tickets.delete(id); }\nmodule.exports = { deleteTicket };",['deleteTicket']),[]);
  assert.deepEqual(one("const s = require('./store');\nfunction start() { return { delete: id => void s.remove(id) }; }\nmodule.exports = { start };"),[]);
  assert.deepEqual(one("exports.init = function () { return void 0; };",['init']),['init'],'void 0 is still nothing');
  assert.deepEqual(one("const { createTicket } = require('./createTicket');\nfunction start() { return { create: createTicket, close() {}, stop: () => {}, get current() { return null; }, set current(v) {} }; }\nmodule.exports = { start };"),[],'not operations');
  assert.deepEqual(one("function update() {}\nfunction start() { const { update } = require('./u'); return { update }; }\nmodule.exports = { start };"),[],'destructured inside start');
  assert.deepEqual(one("function update() {}\nfunction start(update) { return { update }; }\nmodule.exports = { start };"),[],'a parameter of start');
  assert.deepEqual(one("const store = require('./store');\nlet update = () => {};\nupdate = (id, d) => store.update(id, d);\nfunction start() { return { update }; }\nmodule.exports = { start };"),[],'assigned again');
  assert.deepEqual(placeholders({'a.js':"function update(id, changes) {}\nfunction start() { return { update }; }\nmodule.exports = { start };"},['start']),[{path:'a.js',name:'start',op:'update',params:['id','changes']}],'an empty operation still counts, with its parameters');
});

test('v7.15.1: performsOp needs every word of the operation, the verb first, and reads del, delete and remove as one verb only as the verb',()=>{
  const f=(name,operation)=>({name,...(operation?{operation}:{})});
  assert.ok(performsOp('update',f('updateTicket')));
  assert.ok(performsOp('del',f('deleteTicket')));
  assert.ok(performsOp('delete',f('removeTicket')));
  assert.ok(performsOp('addComment',f('addCommentToTicket')));
  assert.ok(performsOp('addComment',f('commentOnTicket','add comments to tickets')),'by its operation');
  assert.ok(!performsOp('addComment',f('addTicket')),'not by its first word');
  assert.ok(!performsOp('removeTag',f('deleteTicket')));
  assert.ok(!performsOp('view',f('getTickets')));
  assert.ok(!performsOp('update',f('ticketUpdater')),'the verb first');
});

// Root after fix A, as run9's split is now admitted: the entry worker
// carries start, the operations are its siblings' promises.
async function entryWorker(ai) {
  const {room,drain}=setup(ai);
  await room.provision('root',null,'Root objective',goal,ROOT_PROMISE);room.set('goal',goal);
  const after={'Data Module':['addTicket','getTickets'],'View Tickets Module':[]};
  await room.spawn('root',run9Root.map(c=>({label:c.label,task:c.task,interfaces:c.functions.filter(f=>!after[c.label]||after[c.label].includes(f.name)).map(f=>f.name==='start'?START:{...f,params:f.params||[]})})));
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  for(const c of room.children('root'))room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id=?",c.id);
  room.db().exec("UPDATE agents SET status='ready' WHERE id='root.1'");
  return {room,drain};
}
const leafOf=content=>()=>({summary:'Entry',files:[{path:'entry.js',content}],done:true});
// run9's final entry.js (root.1), after six repair rounds.
const run9Entry="const { createTicket } = require('../create-tic-f07f9de6/createTicket.js');\nconst { getTickets } = require('../data');\n\nfunction create() {\n  const ticket = { title: 'Sample Ticket', description: 'This is a sample ticket' };\n  return createTicket(ticket);\n}\n\nfunction view(id) {\n  const tickets = getTickets();\n  return tickets.find(ticket => ticket.id === id);\n}\n\nfunction update() {}\nfunction del() {}\n\nfunction start() {\n  return { create, view, update, delete: del };\n}\n\nmodule.exports = { start };";

test('v7.15.1: run9 replay: the start carrier\'s update() {} and del() {} are sent back naming updateTicket from Update Ticket Module and deleteTicket from Delete Ticket Module, with no model call',async()=>{
  const ai=fakeAI({leaf:leafOf(run9Entry)});
  const {room}=await entryWorker(ai);
  await room.turn('root.1');
  assert.equal(room.node('root.1').status,'ready','sent back before any linking');
  const [message]=room.receive('root.1');
  assert.equal(message.from,'runtime:contract');
  assert.equal(message.body,"[contract] Your promise: start(). update is an empty placeholder: updateTicket(id, updates) — \"updates a ticket by id and returns it\" — is promised by \"Update Ticket Module\"; import it on its own line, const { updateTicket } = require('./updateTicket'), and return it as update. delete is an empty placeholder: deleteTicket(id) — \"deletes a ticket by id and returns true\" — is promised by \"Delete Ticket Module\"; import it on its own line, const { deleteTicket } = require('./deleteTicket'), and return it as delete. Publish the FULL updated file.");
  assert.equal(events(room,'contract_returned')[0].body,'Done refused (1/3): rules: [empty]; back to the worker. update: updateTicket from "Update Ticket Module" (operation word). delete: deleteTicket from "Delete Ticket Module" (operation word).');
  assert.equal(ai.calls.filter(c=>c.kind==='fn').length,0);
  assert.equal(room.get('contract_returns:root.1'),'1','the contract-return limit bounds it');
  assert.equal(room.receive('root').length,0,'no completion report');
});

// Following "return getTickets as view" fails run9's own test: app.view(id)
// must deepStrictEqual the created ticket, and run9's round-4 view was
// getTickets().find(...). A Clef hit is what to write view with.
test('v7.15.1: run9 round 5 (view empty): the manager\'s Clef matcher names getTickets from Data Module to write view with, not to return as view',async()=>{
  const round5=run9Entry.replace("function view(id) {\n  const tickets = getTickets();\n  return tickets.find(ticket => ticket.id === id);\n}","function view() {}").replace('function update() {}','function update(id, data) { return updateTicket(id, data); }').replace('function del() {}','function del(id) { return deleteTicket(id); }');
  const ai=fakeAI({leaf:leafOf(round5),fn:(need,name)=>/view/.test(need)&&name==='getTickets'?0.82:0.1});
  const {room}=await entryWorker(ai);
  await room.turn('root.1');
  const [message]=room.receive('root.1');
  assert.equal(message.body,"[contract] Your promise: start(). view is an empty placeholder: write view with getTickets() — \"returns all stored tickets\" — which \"Data Module\" promises; import it on its own line, const { getTickets } = require('./getTickets'), and call it from view. Publish the FULL updated file.");
  assert.doesNotMatch(message.body,/return it as view/);
  const asked=ai.calls.filter(c=>c.kind==='fn');
  assert.equal(asked.length,1);
  assert.equal(asked[0].state.request.need,'the view operation that start() returns as view');
  assert.deepEqual(asked[0].state.functions.map(f=>f.piece+':'+f.signature.split('(')[0]),['Data Module:addTicket','Data Module:getTickets','Create Ticket Module:createTicket','Update Ticket Module:updateTicket','Delete Ticket Module:deleteTicket'],'its direct children\'s promises, its own excluded');
  assert.match(events(room,'contract_returned')[0].body,/view: write it with getTickets from "Data Module" \(Clef p=0\.82\)\.$/);
});

// Root with an entry worker and the given other children.
async function rootWith(ai,kids) {
  const {room}=setup(ai);
  await room.provision('root',null,'Root objective',goal,ROOT_PROMISE);room.set('goal',goal);
  await room.spawn('root',[{label:'Entry Module',task:'Write the entry',interfaces:[START]},...kids]);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  for(const c of room.children('root'))room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id=?",c.id);
  room.db().exec("UPDATE agents SET status='ready' WHERE id='root.1'");
  return room;
}
const piece=(label,...fns)=>({label,task:`Write code for ${label}.`,interfaces:fns.map(([name,does,params=[],operation])=>({name,does,params,...(operation?{operation}:{})}))});

test('v7.15.1: a multi-word operation is never answered by its first word: addComment is not addTicket, removeTag is not deleteTicket; Clef hears the whole operation and its hit is what to write it with',async()=>{
  const entry="const { createTicket } = require('./createTicket');\nconst { deleteTicket } = require('./deleteTicket');\nfunction addComment(ticketId, text) {}\nconst removeTag = (id, tag) => {};\nfunction start() { return { create: createTicket, delete: deleteTicket, addComment, removeTag }; }\nmodule.exports = { start };";
  const kids=[piece('Data Module',['addTicket','stores a ticket with a new id and returns it',['ticket']]),piece('Create Ticket Module',['createTicket','creates a ticket',['data']]),piece('Delete Ticket Module',['deleteTicket','deletes a ticket by id',['id']]),
    piece('Comments Module',['commentOnTicket','adds a comment to a ticket and returns the ticket',['ticketId','text']]),piece('Tags Module',['untagTicket','removes a tag from a ticket',['id','tag']])];
  const ai=fakeAI({leaf:leafOf(entry),fn:(need,name)=>/add comment/.test(need)&&name==='commentOnTicket'||/remove tag/.test(need)&&name==='untagTicket'?0.9:0.1});
  const room=await rootWith(ai,kids);
  await room.turn('root.1');
  assert.equal(room.receive('root.1')[0].body,"[contract] Your promise: start(). addComment is an empty placeholder: write addComment(ticketId, text) with commentOnTicket(ticketId, text) — \"adds a comment to a ticket and returns the ticket\" — which \"Comments Module\" promises; import it on its own line, const { commentOnTicket } = require('./commentOnTicket'), and call it from addComment. removeTag is an empty placeholder: write removeTag(id, tag) with untagTicket(id, tag) — \"removes a tag from a ticket\" — which \"Tags Module\" promises; import it on its own line, const { untagTicket } = require('./untagTicket'), and call it from removeTag. Publish the FULL updated file.");
  assert.deepEqual(ai.calls.filter(c=>c.kind==='fn').map(c=>[c.state.request.need,c.state.functions.length]),[['the add comment operation that start() returns as addComment(ticketId, text)',5],['the remove tag operation that start() returns as removeTag(id, tag)',5]]);
  // The function's operation says it performs addComment: returned as it, no model call.
  const named=await rootWith(fakeAI({leaf:leafOf(entry.replace(',\n  removeTag','').replace('const removeTag = (id, tag) => {};\n','').replace(', removeTag }',' }'))}),
    [kids[0],kids[1],kids[2],piece('Comments Module',['commentOnTicket','adds a comment to a ticket and returns the ticket',['ticketId','text'],'add comments to tickets'])]);
  await named.turn('root.1');
  assert.match(named.receive('root.1')[0].body,/^\[contract\] Your promise: start\(\)\. addComment is an empty placeholder: commentOnTicket\(ticketId, text\) .* is promised by "Comments Module"; .* and return it as addComment\./);
});

test('v7.15.1: a word hit whose arguments differ from the operation\'s is what to write it with, not the operation',async()=>{
  const entry="function update(id, changes) {}\nfunction start() { return { update }; }\nmodule.exports = { start };";
  const ai=fakeAI({leaf:leafOf(entry)});
  const room=await rootWith(ai,[piece('Update Ticket Module',['updateTicket','saves a whole edited ticket',['ticket']])]);
  await room.turn('root.1');
  assert.equal(room.receive('root.1')[0].body,"[contract] Your promise: start(). update is an empty placeholder: write update(id, changes) with updateTicket(ticket) — \"saves a whole edited ticket\" — which \"Update Ticket Module\" promises; import it on its own line, const { updateTicket } = require('./updateTicket'), and call it from update. Publish the FULL updated file.");
  assert.equal(ai.calls.filter(c=>c.kind==='fn').length,0);
  // Two promises perform view by their words: Clef picks between them only, and a word hit is the operation.
  const views=[piece('View Ticket Module',['viewTicket','returns one ticket by id',['id']]),piece('List Module',['viewTickets','returns all tickets'])],viewEntry=leafOf("function view(id) {}\nfunction start() { return { view }; }\nmodule.exports = { start };");
  const pick=fakeAI({leaf:viewEntry,fn:(need,name)=>name==='viewTicket'?0.9:0.3}),picked=await rootWith(pick,views);
  await picked.turn('root.1');
  assert.equal(picked.receive('root.1')[0].body,"[contract] Your promise: start(). view is an empty placeholder: viewTicket(id) — \"returns one ticket by id\" — is promised by \"View Ticket Module\"; import it on its own line, const { viewTicket } = require('./viewTicket'), and return it as view. Publish the FULL updated file.");
  assert.deepEqual(pick.calls.filter(c=>c.kind==='fn').map(c=>c.state.functions.map(f=>f.signature)),[['viewTicket(id)','viewTickets()']]);
  // Clef down there: ask the manager, not a level up and not "implement it here".
  const down=await rootWith(fakeAI({leaf:viewEntry}),views);
  await down.turn('root.1');
  assert.equal(down.receive('root.1')[0].body,'[contract] Your promise: start(). view is an empty placeholder: ask your manager for the function that performs it. Publish the FULL updated file.');
});

// Root -> App Shell (a manager, carries start) -> Entry (carries start) and
// CLI Parser; Root's other children promise updateTicket and deleteTicket.
async function nested(ai) {
  const {room}=setup(ai);
  await room.provision('root',null,'Root objective',goal,ROOT_PROMISE);room.set('goal',goal);
  await room.spawn('root',[piece('App Shell'),piece('Ticket Store',['createTicket','creates a ticket',['data']]),piece('Update Ticket Module',['updateTicket','updates a ticket by id and returns it',['id','updates']]),piece('Delete Ticket Module',['deleteTicket','deletes a ticket by id',['id']])].map((c,i)=>i?c:{...c,interfaces:[START]}));
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id IN ('root','root.1')");
  await room.spawn('root.1',[{label:'Entry',task:'Write start().',interfaces:[START]},piece('CLI Parser',['parseArgs','parses command-line arguments',['argv']])]);
  for(const c of [...room.children('root'),...room.children('root.1')])if(c.id!=='root.1')room.db().exec("UPDATE agents SET phase='implement',status='waiting' WHERE id=?",c.id);
  room.db().exec("UPDATE agents SET status='ready' WHERE id='root.1.1'");
  return room;
}
const nestedEntry="const { createTicket } = require('./createTicket');\nfunction update() {}\nfunction del() {}\nfunction start() { return { create: createTicket, update, delete: del }; }\nmodule.exports = { start };";

test('v7.15.1: a nested start carrier\'s empty operation is answered from a level up, as a function request is, not "implement it here"',async()=>{
  const ai=fakeAI({leaf:()=>({summary:'Entry',files:[{path:'entry.js',content:nestedEntry}],done:true}),fn:()=>0.1});
  const room=await nested(ai);
  await room.turn('root.1.1');
  assert.equal(room.receive('root.1.1')[0].body,"[contract] Your promise: start(). update is an empty placeholder: updateTicket(id, updates) — \"updates a ticket by id and returns it\" — is promised by \"Update Ticket Module\"; import it on its own line, const { updateTicket } = require('./updateTicket'), and return it as update. delete is an empty placeholder: deleteTicket(id) — \"deletes a ticket by id\" — is promised by \"Delete Ticket Module\"; import it on its own line, const { deleteTicket } = require('./deleteTicket'), and return it as delete. Publish the FULL updated file.");
  assert.deepEqual(ai.calls.filter(c=>c.kind==='fn').map(c=>c.state.functions.map(f=>f.signature)),[['parseArgs(argv)'],['parseArgs(argv)']],'Clef at its own level first, then the operation word a level up');
  // Clef failing below and nothing a level up: ask, not implement.
  const failing=await nested(fakeAI({leaf:()=>({summary:'Entry',files:[{path:'entry.js',content:nestedEntry.replace(/update/g,'archive').replace('delete: del','').replace('function del() {}\n','')}],done:true})}));
  await failing.turn('root.1.1');
  // v7.15.5: and the update and delete the plan's pieces perform are owed (run12); create, named after its operation, is kept (review).
  assert.equal(failing.receive('root.1.1')[0].body,"[contract] Your promise: start(). start() returns no method for updateTicket (Update Ticket Module) and deleteTicket (Delete Ticket Module): import each on its own line, by exactly its name, with the name as the path: const { updateTicket } = require('./updateTicket'); const { deleteTicket } = require('./deleteTicket'); and return each under its name. "+
    'archive is an empty placeholder: ask your manager for the function that performs it. Publish the FULL updated file.');
  assert.match(events(failing,'contract_returned')[0].body,/archive: Clef failed; ask\.$/);
});

test('v7.15.1: a start() returning imported functions is accepted; an empty operation nobody promises is imported, and its manager grows a promise with it (v7.15.7, T3)',async()=>{
  const wired="const { createTicket } = require('./createTicket');\nconst { getTickets } = require('./getTickets');\nconst { updateTicket } = require('./updateTicket');\nconst { deleteTicket } = require('./deleteTicket');\nfunction start() { return { create: createTicket, view: getTickets, update: updateTicket, delete: deleteTicket }; }\nmodule.exports = { start };";
  const done=await entryWorker(fakeAI({leaf:leafOf(wired)}));
  await done.room.turn('root.1');
  assert.equal(done.room.node('root.1').status,'done');
  assert.equal(events(done.room,'contract_returned').length,0);
  const archive=wired.replace('delete: deleteTicket }','delete: deleteTicket, archive }').replace('function start','function archive() {}\nfunction start');
  const {room}=await entryWorker(fakeAI({leaf:leafOf(archive),fn:()=>0.2}));
  await room.turn('root.1');
  // v7.15.7 (T3, the audit's #18): never "implement it here" while a sibling's assignment may cover it: the carrier imports it, and one row at Root grows a piece's promise with it (R5), as a reader's unpromised import does.
  assert.equal(room.receive('root.1')[0].body,"[contract] Your promise: start(). archive is an empty placeholder and no piece promises it: your manager places archive() on the promise of the piece whose assignment covers it. Import it on its own line, const { archive } = require('./archive'), and return it as archive; do not write it here. Publish the FULL updated file.");
  const [row,...more]=room.problems("holder='root' AND status!='closed'");
  assert.equal(more.length,0);
  assert.deepEqual([row.kind,row.source,row.facts.names,row.facts.operation.op,row.facts.operation.name,row.facts.unpromised,row.parties.map(x=>[x.role,x.owner,x.owner_path])],['unresolved','root.1',['archive'],'archive','archive',true,[['reader','root.1','entry.js']]]);
  assert.match(events(room,'problems_reported').at(-1).body,/^1 problem goes to the manager: Entry Module returns archive from start\(\) as an empty placeholder that no piece promises; the manager grows a piece's promise with archive\(\)\.$/);
  assert.equal(room.read('operation_grown:root.1',[]).join(),'archive','once per operation per carrier');
});

test('v7.15.1: a promised function that only throws not implemented is sent back to be written, its one-line sibling passes, and the third return accepts',async()=>{
  const {room}=setup(fakeAI({leaf:n=>({summary:'Data',files:[{path:'data.js',content:"const tickets = [];\nfunction addTicket(t) { tickets.push(t); return t; }\nfunction getTickets() { throw new Error('getTickets not implemented'); }\nmodule.exports = { addTicket, getTickets };"}],done:true})}));
  await room.provision('root',null,'Root objective',goal,ROOT_PROMISE);room.set('goal',goal);
  await room.spawn('root',[{label:'Entry Module',task:'Write the entry',interfaces:[START]},{label:'Data Module',task:run9Root[1].task,interfaces:run9Root[1].functions.slice(0,2).map(f=>({...f,params:f.params||[]}))}]);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  room.db().exec("UPDATE agents SET phase='implement',status='ready' WHERE id='root.2'");
  await room.turn('root.2');
  assert.equal(room.receive('root.2')[0].body,'[contract] Your promise: addTicket(ticket), getTickets(). getTickets(): returns all stored tickets is promised by your assignment and is an empty placeholder: write it here. Publish the FULL updated file.');
  await room.turn('root.2');await room.turn('root.2');
  assert.deepEqual(events(room,'contract_returned').map(e=>e.body.slice(0,18)),['Done refused (1/3)','Done refused (2/3)','Done refused (3/3)']);
  await room.turn('root.2');
  assert.equal(room.node('root.2').status,'done','the done after the third return is accepted');
  assert.ok(events(room,'contract_returned').every(e=>e.body.includes('rules: [empty];')),'addTicket\'s one-line body is delivered');
  assert.equal(events(room,'contract_unmet')[0].body,'After 3 returns: getTickets still an empty placeholder; accepted, and the compiler\'s checks decide.');
});

test('v7.15.1: an export the worker fixed closes its contract problem though a placeholder remains',async()=>{
  const data=["const tickets = [];\nfunction addTicket(t) { tickets.push(t); return t; }\nmodule.exports = { addTicket };","const tickets = [];\nfunction addTicket(t) { tickets.push(t); return t; }\nfunction getTickets() {}\nmodule.exports = { addTicket, getTickets };"];
  const {room}=setup(fakeAI({leaf:n=>({summary:'Data',files:[{path:'data.js',content:data[Math.min(n,2)-1]}],done:true})}));
  await room.provision('root',null,'Root objective',goal,ROOT_PROMISE);room.set('goal',goal);
  await room.spawn('root',[{label:'Entry Module',task:'Write the entry',interfaces:[START]},{label:'Data Module',task:run9Root[1].task,interfaces:run9Root[1].functions.slice(0,2).map(f=>({...f,params:f.params||[]}))}]);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  room.db().exec("UPDATE agents SET phase='implement',status='ready' WHERE id='root.2'");
  room.set('contract_returns:root.2',3);
  await room.turn('root.2');
  assert.deepEqual(room.problems("source='root.2' AND kind='contract'").map(p=>p.status),['open'],'getTickets not exported after 3 returns');
  room.db().exec("UPDATE agents SET status='ready' WHERE id='root.2'");
  await room.turn('root.2');
  assert.deepEqual(room.problems("source='root.2' AND kind='contract'").map(p=>[p.status,p.outcome]),[['closed','resolved']]);
  assert.equal(events(room,'contract_unmet').at(-1).body,'After 3 returns: getTickets still an empty placeholder; accepted, and the compiler\'s checks decide.');
});

test('v7.15.1: a Clef tie goes to the tied piece named for the function, else the event says it was a tie',async()=>{
  const split=[{label:'Entry Module',task:'Write code that exports start().',functions:[{name:'start'}]},
    {label:'Ticket store',task:'Write code that keeps tickets and exports printTicket(ticket) for the console.',functions:[{name:'printTicket',does:'prints one ticket',params:['ticket']},{name:'addTicket'}]},
    {label:'Print Ticket',task:'Write code that prints tickets.',functions:[{name:'printTicket'}]}];
  const ai=fakeAI({split:()=>split,piece:()=>0.9});
  const {room,drain}=setup(ai);
  await room.start(goal,1);await drain();
  assert.equal(ai.calls.filter(c=>c.kind==='piece').length,1,'the task and the label disagree: Clef decides');
  assert.equal(events(room,'interfaces_repaired')[0].body,'Deleted printTicket from "Ticket store" (listed by two pieces; kept on "Print Ticket", Clef tie, label matches); the pieces are kept.');
  const tie=setup(fakeAI({split:()=>ambiguous,piece:()=>0.9}));
  await tie.room.start(goal,1);await tie.drain();
  assert.equal(events(tie.room,'interfaces_repaired')[0].body,'Deleted formatTicket from "Ticket printer" (listed by two pieces; kept on "Ticket views", Clef p=0.90, tied with "Ticket printer"); the pieces are kept.');
});
