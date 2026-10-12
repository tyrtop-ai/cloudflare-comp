import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {sourceDependencyError} from '../src/code-work.js';
import {decide,generateFile} from '../src/model.js';
register('./cloudflare-loader.mjs',import.meta.url);
const {ControlRoom}=await import('../src/index.js');

class Sql {
  constructor(){this.db=new DatabaseSync(':memory:');}
  exec(sql,...args){
    if(!args.length && !/^\s*select/i.test(sql)){this.db.exec(sql);return{toArray:()=>[]};}
    const stmt=this.db.prepare(sql);
    const rows=/^\s*select/i.test(sql)?stmt.all(...args):(stmt.run(...args),[]);
    return{toArray:()=>rows};
  }
}
class Artifacts {
  constructor(){this.repos=new Map();}
  async create(name){this.repos.set(name,new Map());return{name,remote:'https://example.invalid/'+name,branch:'main'};}
  async read(name,path){return this.repos.get(name)?.get(path)??null;}
  async write({name,path,content}){this.repos.get(name).set(path,content);return{commit:'a'.repeat(40)};}
}
const response=x=>({response:JSON.stringify(x)});
async function leafRoom(run){
  const artifacts=new Artifacts();
  const room=new ControlRoom({storage:{sql:new Sql()},waitUntil(){}},{AI:{run},TEST_ARTIFACT_STORE:artifacts});
  await room.provision('root',null,'Root','Write code for ticket operations');
  room.set('goal','Write code for ticket operations');
  room.db().exec("UPDATE agents SET phase='implement' WHERE id='root'");
  return{room,artifacts};
}

test('leaf source rejects an npm package but allows a relative import of a collaborator it expects',()=>{
  assert.match(sourceDependencyError('src/tickets.js',"import express from 'express';"),/external package 'express'/);
  assert.equal(sourceDependencyError('src/tickets.js',"const storage = require('./storage');"),null);
  assert.equal(sourceDependencyError('src/tickets.js',"const storage = require('../ticketStore');"),null);
});

test('leaf source accepts Node built-ins, injected collaborators, and other files it authored',()=>{
  assert.equal(sourceDependencyError('src/index.js',"import {createServer} from 'node:http'; import {readFile} from 'fs/promises'; export const build = ({store}) => store.get();",['src/index.js']),null);
  assert.equal(sourceDependencyError('src/index.js',"import {store} from './store.js'; export const get = id => store(id);",['src/index.js','src/store.js']),null);
  assert.equal(sourceDependencyError('src/index.js',"const store=require('./store'); export const get = id => store(id);",['src/index.js','src/store.js']),null);
});

test('a collaborator import is committed as written; the builder renames it later',async()=>{
  let calls=0;
  const source="const storage=require('./storage'); exports.listTickets=()=>storage.list();";
  const {room,artifacts}=await leafRoom(async()=>{calls++;return response({summary:'Tickets',done:true,files:[{path:'tickets.js',content:source}]});});
  await room.turn('root');
  assert.equal(calls,1);
  assert.equal(await artifacts.read(room.node('root').repo_name,'tickets.js'),source);
  assert.ok(!room.snapshot().events.some(e=>e.kind==='code_retry'));
});

test('source that does not parse goes back to the same worker before it is committed',async()=>{
  let calls=0;let correction='';
  const clean="function tokenize(s){ return s.split(' '); }\nmodule.exports={tokenize};";
  const {room,artifacts}=await leafRoom(async(_model,p)=>{
    calls++;
    if(calls===1)return response({summary:'Tokenizer',done:true,files:[{path:'tokenize.js',content:"function tokenize(c){ if (c === '\\') { return []; } }\nmodule.exports={tokenize};"}]});
    correction=p.messages[1].content;
    return {response:clean};
  });
  await room.turn('root');
  assert.equal(calls,2);
  assert.equal(await artifacts.read(room.node('root').repo_name,'tokenize.js'),clean);
  assert.match(correction,/does not parse as JavaScript/);
  assert.match(correction,/Unterminated string constant/);
  assert.ok(room.snapshot().events.some(e=>e.kind==='code_retry'&&/does not parse/.test(e.body)));
});

test('a duplicate declaration is a parse failure, not a container failure',async()=>{
  let calls=0;
  const clean="const util=require('node:util');\nfunction isText(v){return typeof v==='string';}\nmodule.exports={isText};";
  const {room,artifacts}=await leafRoom(async()=>{
    calls++;
    return calls===1?response({summary:'Validation',done:true,files:[{path:'v.js',content:"const { isString } = require('util');\nfunction isString(v){ return typeof v==='string'; }\nmodule.exports={isString};"}]}):{response:clean};
  });
  await room.turn('root');
  assert.equal(calls,2);
  assert.equal(await artifacts.read(room.node('root').repo_name,'v.js'),clean);
});

test('npm import is corrected without committing the rejected leaf source',async()=>{
  let calls=0;
  const clean="import { createServer } from 'node:http'; export function createApp(handler) { return createServer(handler); }";
  const {room,artifacts}=await leafRoom(async()=>{
    calls++;
    return calls===1?response({summary:'HTTP server',done:true,files:[{path:'server.js',content:"const express=require('express'); module.exports=express();"}]}):{response:clean};
  });
  await room.turn('root');
  assert.equal(calls,2);
  assert.equal(await artifacts.read(room.node('root').repo_name,'server.js'),clean);
});

test('two source files authored by one leaf can refer to each other even if emitted out of order',async()=>{
  const {room,artifacts}=await leafRoom(async()=>response({summary:'Both functions',done:true,files:[
    {path:'src/main.js',content:"import {get} from './storage.js'; export const read = id => get(id);"},
    {path:'src/storage.js',content:'export const get = id => ({id});'}
  ]}));
  await room.turn('root');
  const repo=room.node('root').repo_name;
  assert.match(await artifacts.read(repo,'src/main.js'),/storage\.js/);
  assert.match(await artifacts.read(repo,'src/storage.js'),/export const get/);
  assert.ok(!room.snapshot().events.some(e=>e.kind==='code_retry'));
});

test('both generation prompts contain the identical ownership rule and mock builds omit Express',async()=>{
  const prompts=[];
  const AI={run:async(_name,args)=>{prompts.push(args.messages[0].content);return response({summary:'Source',done:true,files:[{path:'logic.js',content:'export const main = x => x;'}]});}};
  await decide({AI},{your_label:'Leaf',phase:'implement',your_responsibility:'Write logic',your_private_children:[],neighbor_owners:[]});
  await generateFile({AI:{run:async(_name,args)=>{prompts.push(args.messages[0].content);return{response:'export const main = x => x;'};}}},
    {node:{id:'root.1',label:'Leaf'},path:'logic.js',task:'Write logic',files:[],inbox:[],children:[]});
  for(const prompt of prompts){
    assert.match(prompt,/Node\.js built-in modules/);
    assert.match(prompt,/import it with a relative path and the export name you expect/);
    assert.match(prompt,/receive collaborators as function or constructor parameters/);
  }
  const packageJSON=JSON.parse(await generateFile({MOCK_AI:'true'}, {node:{id:'root.3',label:'Temporary builder'},path:'package.json'}));
  assert.equal(packageJSON.dependencies,undefined);
  assert.equal(packageJSON.devDependencies,undefined);
  const api=await generateFile({MOCK_AI:'true'},{node:{id:'root.2.2'},path:'api.js'});
  assert.doesNotMatch(api,/['"]express['"]/);
  assert.match(api,/createTicketHandler/);
});
