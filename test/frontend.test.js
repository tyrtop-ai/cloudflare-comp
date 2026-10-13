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
  assert.match(html, /src="\/app\.js\?v=7\.13\.8"/);
  assert.match(html, /href="\/styles\.css\?v=7\.13\.8"/);
});

test('v7.13: the split threshold control defaults to 70%',()=>{
  assert.match(html,/<output id="split-threshold-value" for="split-threshold">70%<\/output>/);
  assert.match(html,/<input id="split-threshold" type="range" min="20" max="80" step="5" value="70" \/>/);
  const elements=renderWithPage(true,{settings:{parallel:4,max_agents:64,max_depth:10}});
  assert.equal(elements.get('split-threshold').value,70,'a room snapshot without a threshold shows the 0.7 default');
});

test('agent traffic lists the newest event first',()=>{
  const ids=[...html.matchAll(/\bid="([a-z0-9-]+)"/gi)].map(match=>match[1]);
  const elements=new Map(ids.map(id=>[id,{id,value:'',textContent:'',className:'',innerHTML:'',disabled:false,addEventListener(){},querySelectorAll(){return [];},dispatchEvent(){}}]));
  const context={document:{getElementById(id){return elements.get(id)||null;},querySelectorAll(){return [];}},
    crypto:{randomUUID(){return 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';}},location:{href:'https://example.com/'},history:{replaceState(){}},URL,setInterval(){},Event:class{}};
  runInNewContext(script,context,{filename:'public/app.js'});
  context.render({status:'running',busy:false,step:3,agents:[],files:[],events:[
    {id:1,ts:1,step:1,actor:'root',kind:'start',body:'first'},{id:2,ts:2,step:2,actor:'root',kind:'decompose',body:'second'},{id:3,ts:3,step:3,actor:'root.1',kind:'report',body:'third'}]});
  const list=elements.get('events').innerHTML;
  assert.ok(list.indexOf('third')<list.indexOf('second')&&list.indexOf('second')<list.indexOf('first'),list);
});

test('Start becomes Stop, with a square, while a run is going',()=>{
  const ids=[...html.matchAll(/\bid="([a-z0-9-]+)"/gi)].map(match=>match[1]);
  const elements=new Map(ids.map(id=>[id,{id,value:'',textContent:'',className:'',innerHTML:'',title:'',disabled:false,addEventListener(){},querySelectorAll(){return [];},dispatchEvent(){}}]));
  const context={document:{getElementById(id){return elements.get(id)||null;},querySelectorAll(){return [];}},
    crypto:{randomUUID(){return 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';}},location:{href:'https://example.com/'},history:{replaceState(){}},URL,setInterval(){},Event:class{}};
  runInNewContext(script,context,{filename:'public/app.js'});
  assert.match(html,/id="start"[^>]*>Start <span>/);
  assert.doesNotMatch(html,/<footer|RECURSIVE · OPAQUE OWNERSHIP/);
  context.render({status:'running',busy:true,step:1,agents:[],files:[],events:[]});
  assert.match(elements.get('start').innerHTML,/^Stop <span class="stop-square"/);
  assert.equal(elements.get('start').title,'Stop');
  assert.equal(elements.get('start').disabled,false);
  context.render({status:'running',busy:true,stopping:true,step:1,agents:[],files:[],events:[]});
  assert.match(elements.get('start').innerHTML,/^Stopping /);
  assert.equal(elements.get('start').disabled,true);
  context.render({status:'paused',busy:false,step:1,agents:[],files:[],events:[]});
  assert.match(elements.get('start').innerHTML,/^Start/);
  assert.equal(elements.get('start').title,'Start');
});

// Getting the code out: both controls sit under "Export observation JSON" and
// call the API with the bearer token; the result stays in its own line.
function exportPage(fetch) {
  const ids=[...html.matchAll(/\bid="([a-z0-9-]+)"/gi)].map(match=>match[1]);
  const listeners=new Map(),clicked=[];
  const elements=new Map(ids.map(id=>[id,{id,value:'',textContent:'',className:'',innerHTML:'',title:'',disabled:false,
    addEventListener(type,fn){listeners.set(`${id}:${type}`,fn);},querySelectorAll(){return [];},dispatchEvent(){}}]));
  const context={document:{getElementById(id){return elements.get(id)||null;},querySelectorAll(){return [];},
      createElement(){return {click(){clicked.push({href:this.href,download:this.download});}};}},
    crypto:{randomUUID(){return 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';}},location:{href:'https://example.com/?room=room-abcdefgh'},history:{replaceState(){}},
    URL:Object.assign(class extends URL{},{createObjectURL:()=>'blob:app',revokeObjectURL(){}}),setInterval(){},Event:class{},fetch};
  runInNewContext(script,context,{filename:'public/app.js'});
  elements.get('token').value='app-token';
  return {elements,clicked,click:id=>listeners.get(`${id}:click`)()};
}

test('Download app (.zip) and Push to GitHub sit under Export observation JSON',()=>{
  const at=id=>html.indexOf(`id="${id}"`);
  assert.match(html,/<button class="secondary" id="download-app">Download app \(\.zip\)<\/button>/);
  assert.match(html,/<input id="github-repo"[^>]*placeholder="owner\/repo"/);
  assert.match(html,/<button class="secondary" id="push-github">Push to GitHub<\/button>/);
  assert.ok(at('export')<at('download-app')&&at('download-app')<at('github-repo')&&at('github-repo')<at('push-github')&&at('push-github')<at('reset'));
  assert.match(html,/<p id="export-result" class="helper export-result"/);
});

test('Download app fetches /api/app.zip with the bearer token and saves the blob',async()=>{
  const requests=[];
  const page=exportPage(async(url,init)=>{requests.push({url,init});return new Response('PK',{status:200,headers:{'x-app-passed':'true'}});});
  await page.click('download-app');
  assert.equal(requests[0].url,'/api/app.zip?room=room-abcdefgh');
  assert.equal(requests[0].init.headers.Authorization,'Bearer app-token');
  assert.deepEqual(page.clicked,[{href:'blob:app',download:'recursive-app-room-abc.zip'}]);
  assert.match(page.elements.get('export-result').innerHTML,/passed for exactly these files/);
  const empty=exportPage(async()=>new Response(JSON.stringify({error:'No application yet: <b>'}),{status:409}));
  await empty.click('download-app');
  assert.equal(empty.elements.get('export-result').innerHTML,'No application yet: &lt;b&gt;');
  assert.match(empty.elements.get('export-result').className,/^error /);
  assert.deepEqual(empty.clicked,[]);
});

test('Push to GitHub posts owner/repo and links the pull request, the branch, or the error',async()=>{
  const requests=[];let reply={repo:'octo/app',branch:'control-plane/room-abc',pr_url:'https://github.com/octo/app/pull/3',branch_url:'https://github.com/octo/app/tree/control-plane/room-abc',files:6,passed:false};
  const page=exportPage(async(url,init)=>{requests.push({url,init});return new Response(JSON.stringify(reply),{status:reply.error?502:200});});
  page.elements.get('github-repo').value='not a repo';
  await page.click('push-github');
  assert.equal(requests.length,0);
  assert.match(page.elements.get('export-result').innerHTML,/owner\/repo/);
  page.elements.get('github-repo').value=' octo/app ';
  await page.click('push-github');
  assert.equal(requests[0].url,'/api/export/github');
  assert.equal(requests[0].init.method,'POST');
  assert.equal(requests[0].init.headers.Authorization,'Bearer app-token');
  assert.deepEqual(JSON.parse(requests[0].init.body),{repo:'octo/app',room:'room-abcdefgh'},'the GitHub token never comes from the page');
  const result=page.elements.get('export-result');
  assert.match(result.innerHTML,/^Pull request <a href="https:\/\/github\.com\/octo\/app\/pull\/3" target="_blank" rel="noopener">octo\/app\/pull\/3<\/a> · 6 files · UNVERIFIED$/);
  assert.equal(page.elements.get('push-github').disabled,false);
  reply={...reply,pr_url:null,passed:true,note:'octo/app was empty, so control-plane/room-abc is its first branch.'};
  await page.click('push-github');
  assert.match(result.innerHTML,/^Branch <a href="https:\/\/github\.com\/octo\/app\/tree\/control-plane\/room-abc"[^>]*>octo\/app:control-plane\/room-abc<\/a> · 6 files<br\/>octo\/app was empty/);
  reply={error:'Set GITHUB_TOKEN with wrangler secret put GITHUB_TOKEN'};
  await page.click('push-github');
  assert.equal(result.innerHTML,'Set GITHUB_TOKEN with wrangler secret put GITHUB_TOKEN');
  assert.match(result.className,/^error /);
});
