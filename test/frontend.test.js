import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

function renderWithPage(includeParallel, snapshot = {}) {
  const markup = includeParallel ? html : html.replace('id="parallel"', 'id="absent-parallel"');
  const ids = [...markup.matchAll(/\bid="([a-z0-9-]+)"/gi)].map(match => match[1]);
  const elements = new Map(ids.map(id => [id, {
    id,
    value:'', textContent:'', className:'', innerHTML:'', disabled:false,
    addEventListener(){}, querySelectorAll(){return []},
  }]));
  const document = {
    getElementById(id){return elements.get(id)||null;},
    querySelectorAll(){return [];},
  };
  const context = {
    document,
    crypto:{randomUUID(){return 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';}},
    location:{href:'https://example.com/'},
    history:{replaceState(){}},
    URL,
    setInterval(){},
  };
  // No token is provided, so the initial refresh does not call fetch.
  runInNewContext(script,context,{filename:'public/app.js'});
  context.render({status:'paused',busy:false,step:4,max_parallel:4,
    active_agents:['root.1','root.2'],agents:[],files:[],events:[],...snapshot});
  return elements;
}

test('v4.5 app renders against cached v4.2 HTML without a parallel counter',()=>{
  const elements=renderWithPage(false);
  assert.equal(elements.get('status').textContent,'PAUSED');
  assert.equal(elements.get('steps').textContent,4);
});

test('current HTML displays concurrent agent count',()=>{
  const elements=renderWithPage(true);
  assert.equal(elements.get('active-parallel').textContent,'2 / 4');
});

test('HTML uses versioned JS and CSS asset URLs',()=>{
  assert.match(html, /src="\/app\.js\?v=7\.13\.2"/);
  assert.match(html, /href="\/styles\.css\?v=7\.13\.2"/);
});

test('v7.13: the split threshold control defaults to 70%',()=>{
  assert.match(html,/<output id="split-threshold-value" for="split-threshold">70%<\/output>/);
  assert.match(html,/<input id="split-threshold" type="range" min="20" max="80" step="5" value="70" \/>/);
  const elements=renderWithPage(true,{settings:{parallel:4,max_agents:64,max_depth:10}});
  assert.equal(elements.get('split-threshold').value,70,'a room snapshot without a threshold shows the 0.7 default');
});
