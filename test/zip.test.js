// Export connector: the store-only ZIP writer, read back byte by byte.
import test from 'node:test';
import assert from 'node:assert/strict';
import {crc32 as zcrc} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {zipFiles,crc32} from '../src/zip.js';

const dec=new TextDecoder();
// An independent reader: the end record, then each central entry and the local header it points at.
function unzipBytes(zip) {
  const v=new DataView(zip.buffer,zip.byteOffset,zip.byteLength),u16=at=>v.getUint16(at,true),u32=at=>v.getUint32(at,true);
  const end=zip.length-22;
  assert.equal(u32(end),0x06054b50,'end of central directory record');
  const count=u16(end+10),size=u32(end+12),start=u32(end+16);
  assert.equal(u16(end+8),count);assert.equal(u16(end+20),0,'no comment');
  assert.equal(start+size,end,'central directory ends where the end record starts');
  const entries=[];let at=start,local=0;
  for(let i=0;i<count;i++) {
    assert.equal(u32(at),0x02014b50,'central header');
    const flags=u16(at+8),method=u16(at+10),time=u16(at+12),date=u16(at+14),crc=u32(at+16),csize=u32(at+20),usize=u32(at+24);
    const nlen=u16(at+28),xlen=u16(at+30),clen=u16(at+32),offset=u32(at+42),attrs=u32(at+38);
    const name=dec.decode(zip.subarray(at+46,at+46+nlen));
    assert.equal(offset,local,'local headers are back to back in central order');
    assert.equal(u32(offset),0x04034b50,'local header');
    assert.deepEqual([u16(offset+6),u16(offset+8),u16(offset+10),u16(offset+12),u32(offset+14),u32(offset+18),u32(offset+22)],[flags,method,time,date,crc,csize,usize],'local and central headers agree');
    const lnlen=u16(offset+26),lxlen=u16(offset+28);
    assert.equal(dec.decode(zip.subarray(offset+30,offset+30+lnlen)),name);
    const data=zip.subarray(offset+30+lnlen+lxlen,offset+30+lnlen+lxlen+csize);
    entries.push({name,flags,method,time,date,crc,csize,usize,attrs,data});
    local=offset+30+lnlen+lxlen+csize;at+=46+nlen+xlen+clen;
  }
  assert.equal(local,start,'nothing between the last file and the central directory');
  return entries;
}

test('zip: entries round-trip with UTF-8 names, stored data, fixed times and CRC-32s node agrees with',()=>{
  const files=[{path:'README.md',content:'# App\n'},{path:'components/naïve-日本/app.js',content:'module.exports = { start() { return { ok: () => "✓" }; } };\n'},
    {path:'glue/empty.js',content:''},{path:'bin/raw.dat',content:new Uint8Array([0,255,1,254,10,13])}];
  const zip=zipFiles(files),entries=unzipBytes(zip);
  assert.deepEqual(entries.map(e=>e.name),files.map(f=>f.path),'archive order is the given order');
  for(const [i,e] of entries.entries()) {
    const bytes=typeof files[i].content==='string'?new TextEncoder().encode(files[i].content):files[i].content;
    assert.equal(e.flags&0x0800,0x0800,'UTF-8 name flag');
    assert.equal(e.method,0,'stored');
    assert.deepEqual([e.time,e.date],[0,33],'1980-01-01 00:00:00');
    assert.equal(e.csize,bytes.length);assert.equal(e.usize,bytes.length);
    assert.deepEqual([...e.data],[...bytes]);
    assert.equal(e.crc,zcrc(bytes));assert.equal(crc32(bytes),zcrc(bytes));
    assert.equal(e.attrs>>>16,0o100644);
  }
  assert.equal(entries[2].crc,0,'an empty file has CRC 0 and no data');
  assert.deepEqual(zipFiles(files),zip,'same files, same bytes');
  const empty=zipFiles([]);
  assert.equal(empty.length,22);assert.deepEqual(unzipBytes(empty),[]);
});

test('zip: many files, and names that could escape the extraction directory are refused',()=>{
  const many=Array.from({length:700},(_,i)=>({path:`components/m${i%7}/f${i}.js`,content:i%5?`module.exports=${i};\n`.repeat(i%13):''}));
  const entries=unzipBytes(zipFiles(many));
  assert.equal(entries.length,700);
  assert.ok(entries.every((e,i)=>e.name===many[i].path&&dec.decode(e.data)===many[i].content&&e.crc===zcrc(Buffer.from(many[i].content))));
  for(const path of ['../evil.js','/etc/passwd','a/../../b','a\\b','.git/config','a//b',''])
    assert.throws(()=>zipFiles([{path,content:'x'}]),/unsafe entry name/,path);
  assert.throws(()=>zipFiles([{path:'a.js',content:'1'},{path:'a.js',content:'2'}]),/duplicate entry/);
});

const unzip=spawnSync('unzip',['-v']).status===0;
test('zip: the system unzip tests and extracts the archive byte for byte',{skip:!unzip&&'unzip is not installed'},()=>{
  const dir=mkdtempSync(join(tmpdir(),'zip-test-'));
  try {
    const files=[{path:'package.json',content:'{"private":true}\n'},{path:'components/é/x.js',content:'module.exports=1;\n'},{path:'glue/empty.txt',content:''},
      ...Array.from({length:120},(_,i)=>({path:`components/many/f${i}.js`,content:`// ${i}\n`}))];
    writeFileSync(join(dir,'app.zip'),zipFiles(files));
    const t=spawnSync('unzip',['-t',join(dir,'app.zip')],{encoding:'utf8'});
    assert.equal(t.status,0,t.stdout+t.stderr);
    assert.match(t.stdout,/No errors detected/);
    const x=spawnSync('unzip',['-q','-o',join(dir,'app.zip'),'-d',join(dir,'out')],{encoding:'utf8'});
    assert.equal(x.status,0,x.stdout+x.stderr);
    for(const f of files)assert.equal(readFileSync(join(dir,'out',f.path),'utf8'),f.content,f.path);
    assert.equal(statSync(join(dir,'out','package.json')).mode&0o777,0o644);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
