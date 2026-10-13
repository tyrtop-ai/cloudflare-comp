import test from 'node:test';
import assert from 'node:assert/strict';
import { canContact, canRead, normalizeAction, nextTask, isPath } from '../src/protocol.js';

// v7.15.1: root has workers root.1 and root.3 (builder) and manager root.2;
// root.2 has workers root.2.1, root.2.2, its builder root.2.3, and manager
// root.2.4 with worker root.2.4.1; root.1 became a manager of root.1.1.
const tree = new Map([
  ['root', {id:'root',parent:null}],['root.1',{id:'root.1',parent:'root'}],['root.1.1',{id:'root.1.1',parent:'root.1'}],
  ['root.2',{id:'root.2',parent:'root'}],['root.3',{id:'root.3',parent:'root',label:'Temporary builder'}],
  ['root.2.1',{id:'root.2.1',parent:'root.2'}],['root.2.2',{id:'root.2.2',parent:'root.2'}],
  ['root.2.3',{id:'root.2.3',parent:'root.2',label:'Temporary builder'}],
  ['root.2.4',{id:'root.2.4',parent:'root.2'}],['root.2.4.1',{id:'root.2.4.1',parent:'root.2.4'}]
]);

test('only parent-child communication is permitted: siblings, grandparents and cousins talk through managers', () => {
  const may=(a,b)=>canContact(tree.get(a),tree.get(b));
  for (const [a,b] of [['root','root.1'],['root.2','root.2.1'],['root.2.4','root.2.4.1'],['root','root.3'],['root.2','root.2.3']]) {
    assert.equal(may(a,b),true,`${a} -> ${b}`);
    assert.equal(may(b,a),true,`${b} -> ${a}`);
  }
  for (const [a,b] of [['root.1','root.2'],['root.2.1','root.2.2'],['root.3','root.2'],['root.2.3','root.2.1'],
    ['root','root.2.1'],['root.2','root.2.4.1'],['root.1','root.2.1'],['root.1.1','root.2.1'],['root.1.1','root.2.4.1'],['root.1.1','root.2']]) {
    assert.equal(may(a,b),false,`${a} -> ${b}`);
    assert.equal(may(b,a),false,`${b} -> ${a}`);
  }
  assert.equal(may('root.1','root.1'),false);
  assert.equal(canContact(tree.get('root.1'),undefined),false);
});

test('a builder reads its siblings, its manager\'s children; nothing deeper or wider, and nobody else reads a sibling', () => {
  const reads=(a,b)=>canRead(tree.get(a),tree.get(b));
  assert.equal(reads('root.3','root.1'),true);
  assert.equal(reads('root.3','root.2'),true,'a manager sibling: its linked bundle');
  assert.equal(reads('root.2.3','root.2.1'),true);
  assert.equal(reads('root.2.3','root.2.4'),true);
  assert.equal(reads('root.3','root.2.1'),false,'a grandchild of its manager');
  assert.equal(reads('root.3','root.1.1'),false);
  assert.equal(reads('root.2.3','root.2.4.1'),false,'a grandchild of its manager');
  assert.equal(reads('root.2.3','root.1'),false,'its manager\'s sibling');
  assert.equal(reads('root.2.3','root.1.1'),false,'a cousin');
  assert.equal(reads('root.2.3','root.3'),false,'another manager\'s builder');
  assert.equal(reads('root.2.3','root.2.3'),false);
  assert.equal(reads('root.2.1','root.2.2'),false,'a worker never reads its sibling');
  assert.equal(reads('root.1','root.2'),false,'a manager never reads its sibling');
  assert.equal(reads('root.2.1','root.2'),false,'nor its manager, whose aliases resolve to its siblings');
  assert.equal(reads('root.2','root.2.1'),false,'a manager reads its children through the runtime, not as a builder');
  assert.equal(reads('root.2.1','root.2.3'),false,'nor the builder, which is a sibling too');
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
