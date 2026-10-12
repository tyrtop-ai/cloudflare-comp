import test from 'node:test';
import assert from 'node:assert/strict';
import { canContact, normalizeAction, nextTask, isPath } from '../src/protocol.js';

test('only parent-child and sibling communication is permitted', () => {
  const nodes = new Map([
    ['root', {id:'root',parent:null}],['root.1',{id:'root.1',parent:'root'}],
    ['root.2',{id:'root.2',parent:'root'}],['root.2.1',{id:'root.2.1',parent:'root.2'}],
    ['root.2.1.1',{id:'root.2.1.1',parent:'root.2.1'}],['root.2.2',{id:'root.2.2',parent:'root.2'}]
  ]);
  const may=(a,b)=>canContact(nodes.get(a),nodes.get(b));
  assert.equal(may('root.1','root.2'),true);
  assert.equal(may('root.1','root.2.1'),false);
  assert.equal(may('root','root.2.1'),false);
  assert.equal(may('root.2','root.2.1'),true);
  assert.equal(may('root.2.1','root.2.2'),true);
  assert.equal(may('root.2.1.1','root.2'),false);
  assert.equal(may('root.1','root.1'),false);
});

test('normalize bounded action and block traversal filenames',()=>{
  const a=normalizeAction({ summary:'hey',done:true,spawn:Array.from({length:7},()=>({task:'Implement a component that does work'})),files:[{path:'../escape'},{path:'ok.js'}] });
  assert.equal(a.spawn.length,7,'all splitter children are preserved; room agent capacity is enforced at spawn');
  assert.deepEqual(a.files.map(x=>x.path),['ok.js']);
  assert.equal(isPath('src/index.js'),true);
  assert.equal(isPath('.git/config'),false);
});

test('queue chooses only ready agents and does not infer a hierarchy',()=>{
  const agents=new Map([['root',{status:'waiting'}],['root.1',{status:'ready'}],['root.2',{status:'done'}]]);
  const result=nextTask(['root','root.2','root.1'],agents);
  assert.equal(result.id,'root.1');
});
