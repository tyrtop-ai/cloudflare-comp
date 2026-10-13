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
const {duplicateNames,repairInterfaces,labelNames,normalizeSpawn}=await import('../src/interfaces.js');
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
  assert.deepEqual(placeholders(start,['start']),[{path:'app.js',name:'start',op:'view',local:'view'},{path:'app.js',name:'start',op:'archive',local:'archive'}],'an import and a body that returns a value pass');
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
  assert.equal(message.body,"[contract] update is an empty placeholder: updateTicket(id, updates) — \"updates a ticket by id and returns it\" — is promised by \"Update Ticket Module\"; import it on its own line, const { updateTicket } = require('./updateTicket'), and return it as update. delete is an empty placeholder: deleteTicket(id) — \"deletes a ticket by id and returns true\" — is promised by \"Delete Ticket Module\"; import it on its own line, const { deleteTicket } = require('./deleteTicket'), and return it as delete. Publish the FULL updated file.");
  assert.equal(events(room,'contract_placeholder')[0].body,'Done refused (1/3): update and delete are empty placeholders; back to the worker. update: updateTicket from "Update Ticket Module" (operation word). delete: deleteTicket from "Delete Ticket Module" (operation word).');
  assert.equal(ai.calls.filter(c=>c.kind==='fn').length,0);
  assert.equal(room.get('contract_returns:root.1'),'1','the contract-return limit bounds it');
  assert.equal(room.receive('root').length,0,'no completion report');
});

test('v7.15.1: run9 round 5 (view empty): the manager\'s Clef matcher names getTickets from Data Module',async()=>{
  const round5=run9Entry.replace("function view(id) {\n  const tickets = getTickets();\n  return tickets.find(ticket => ticket.id === id);\n}","function view() {}").replace('function update() {}','function update(id, data) { return updateTicket(id, data); }').replace('function del() {}','function del(id) { return deleteTicket(id); }');
  const ai=fakeAI({leaf:leafOf(round5),fn:(need,name)=>/view/.test(need)&&name==='getTickets'?0.82:0.1});
  const {room}=await entryWorker(ai);
  await room.turn('root.1');
  const [message]=room.receive('root.1');
  assert.equal(message.body,"[contract] view is an empty placeholder: getTickets() — \"returns all stored tickets\" — is promised by \"Data Module\"; import it on its own line, const { getTickets } = require('./getTickets'), and return it as view. Publish the FULL updated file.");
  const asked=ai.calls.filter(c=>c.kind==='fn');
  assert.equal(asked.length,1);
  assert.deepEqual(asked[0].state.functions.map(f=>f.piece+':'+f.signature.split('(')[0]),['Data Module:addTicket','Data Module:getTickets','Create Ticket Module:createTicket','Update Ticket Module:updateTicket','Delete Ticket Module:deleteTicket'],'its direct children\'s promises, its own excluded');
  assert.match(events(room,'contract_placeholder')[0].body,/view: getTickets from "Data Module" \(Clef p=0\.82\)\.$/);
});

test('v7.15.1: a start() returning imported functions is accepted; an empty operation nobody promises is told to implement it here',async()=>{
  const wired="const { createTicket } = require('./createTicket');\nconst { getTickets } = require('./getTickets');\nconst { updateTicket } = require('./updateTicket');\nconst { deleteTicket } = require('./deleteTicket');\nfunction start() { return { create: createTicket, view: getTickets, update: updateTicket, delete: deleteTicket }; }\nmodule.exports = { start };";
  const done=await entryWorker(fakeAI({leaf:leafOf(wired)}));
  await done.room.turn('root.1');
  assert.equal(done.room.node('root.1').status,'done');
  assert.equal(events(done.room,'contract_placeholder').length,0);
  const archive=wired.replace('delete: deleteTicket }','delete: deleteTicket, archive }').replace('function start','function archive() {}\nfunction start');
  const {room}=await entryWorker(fakeAI({leaf:leafOf(archive),fn:()=>0.2}));
  await room.turn('root.1');
  assert.equal(room.receive('root.1')[0].body,'[contract] archive is an empty placeholder and no piece promises it: implement it here. Publish the FULL updated file.');
});

test('v7.15.1: a promised function that only throws not implemented is sent back to be written, its one-line sibling passes, and the third return accepts',async()=>{
  const {room}=setup(fakeAI({leaf:n=>({summary:'Data',files:[{path:'data.js',content:"const tickets = [];\nfunction addTicket(t) { tickets.push(t); return t; }\nfunction getTickets() { throw new Error('getTickets not implemented'); }\nmodule.exports = { addTicket, getTickets };"}],done:true})}));
  await room.provision('root',null,'Root objective',goal,ROOT_PROMISE);room.set('goal',goal);
  await room.spawn('root',[{label:'Entry Module',task:'Write the entry',interfaces:[START]},{label:'Data Module',task:run9Root[1].task,interfaces:run9Root[1].functions.slice(0,2).map(f=>({...f,params:f.params||[]}))}]);
  room.db().exec("UPDATE agents SET phase='manager',status='waiting' WHERE id='root'");
  room.db().exec("UPDATE agents SET phase='implement',status='ready' WHERE id='root.2'");
  await room.turn('root.2');
  assert.equal(room.receive('root.2')[0].body,'[contract] getTickets(): returns all stored tickets is promised by your assignment and is an empty placeholder: write it here. Publish the FULL updated file.');
  await room.turn('root.2');await room.turn('root.2');
  assert.deepEqual(events(room,'contract_placeholder').map(e=>e.body.slice(0,18)),['Done refused (1/3)','Done refused (2/3)','Done refused (3/3)']);
  await room.turn('root.2');
  assert.equal(room.node('root.2').status,'done','the done after the third return is accepted');
  assert.equal(events(room,'contract_missing').length,0,'addTicket\'s one-line body is delivered');
  assert.equal(events(room,'contract_unmet')[0].body,'getTickets is still an empty placeholder after 3 returns; accepted, and the runner\'s test decides.');
});
