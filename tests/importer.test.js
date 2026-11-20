'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {Importer,sha256} = require('../app/lib/importer');
const {eligible,categoryFor,parseExifDate,jpegExifDate,quickTimeDate} = require('../app/lib/metadata');

function fixture() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fn-dit-test-'));
  const source=path.join(dir,'source','DCIM','100_FUJI');
  const target=path.join(dir,'library');
  fs.mkdirSync(source,{recursive:true});fs.mkdirSync(target);
  return {dir,source,target,clock:0,cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
const cfg=(f)=>({destination:f.target,settleSeconds:5,timezone:'Asia/Shanghai',folderMode:'date_type'});
function agedWrite(file,content) {fs.writeFileSync(file,content);const t=new Date('2026-11-20T00:00:00Z');fs.utimesSync(file,t,t);}

test('extensions and category are case-insensitive',()=>{
  assert.equal(eligible('DSCF.RAF'),true);
  assert.equal(categoryFor('DSCF.RAF'),'RAW');
  assert.equal(categoryFor('DSCF.JPG'),'JPG');
  assert.equal(categoryFor('DSCF.MOV'),'VIDEO');
  assert.equal(eligible('README.EXE'),false);
});

test('strict calendar dates',()=>{
  assert.equal(parseExifDate('2026:11:20 13:20:30'),'2026-11-20');
  assert.equal(parseExifDate('2026:02:30 13:20:30'),null);
  assert.equal(parseExifDate('0000:00:00 00:00:00'),null);
});

test('JPEG EXIF DateTimeOriginal parser',()=>{
  const tiff=Buffer.alloc(80);
  tiff.write('II',0);tiff.writeUInt16LE(42,2);tiff.writeUInt32LE(8,4);
  tiff.writeUInt16LE(1,8);tiff.writeUInt16LE(0x8769,10);tiff.writeUInt16LE(4,12);tiff.writeUInt32LE(1,14);tiff.writeUInt32LE(26,18);
  tiff.writeUInt16LE(1,26);tiff.writeUInt16LE(0x9003,28);tiff.writeUInt16LE(2,30);tiff.writeUInt32LE(20,32);tiff.writeUInt32LE(44,36);
  tiff.write('2026:11:20 12:34:56\0',44,'ascii');
  const exif=Buffer.concat([Buffer.from('Exif\0\0','ascii'),tiff]);
  const marker=Buffer.alloc(4);marker.writeUInt16BE(0xffe1,0);marker.writeUInt16BE(exif.length+2,2);
  const jpg=Buffer.concat([Buffer.from([0xff,0xd8]),marker,exif,Buffer.from([0xff,0xd9])]);
  assert.equal(jpegExifDate(jpg),'2026-11-20');
});

test('QuickTime mvhd creation date parser',()=>{
  const mvhd=Buffer.alloc(28);mvhd.writeUInt32BE(28,0);mvhd.write('mvhd',4);mvhd[8]=0;
  const stamp=Math.floor(Date.UTC(2026,10,20,4,0,0)/1000)+2082844800;
  mvhd.writeUInt32BE(stamp,12);
  const moov=Buffer.alloc(8);moov.writeUInt32BE(mvhd.length+8,0);moov.write('moov',4);
  assert.equal(quickTimeDate(Buffer.concat([moov,mvhd])).toISOString(),'2026-11-20T04:00:00.000Z');
});

test('import retains RAF/JPG, duplicate does not copy, index survives restart',async(t)=>{
  const f=fixture();t.after(f.cleanup);
  agedWrite(path.join(f.source,'DSCF1234.RAF'),'raw content');
  agedWrite(path.join(f.source,'DSCF1234.JPG'),'jpg content');
  const importer=new Importer(path.join(f.dir,'state'),()=>{},{now:()=>f.clock});
  const root={path:path.dirname(path.dirname(f.source)),dcim:path.dirname(f.source)};
  assert.equal((await importer.scanSource(root,cfg(f))).pending,2);
  f.clock+=6000;
  const one=await importer.scanSource(root,cfg(f));
  assert.deepEqual(one,{imported:2,duplicate:0,pending:0,failed:0});
  assert.equal(fs.readFileSync(path.join(f.target,'2026','2026-11-20','RAW','DSCF1234.RAF'),'utf8'),'raw content');
  assert.equal(fs.readFileSync(path.join(f.target,'2026','2026-11-20','JPG','DSCF1234.JPG'),'utf8'),'jpg content');
  const restarted=new Importer(path.join(f.dir,'state'),()=>{},{now:()=>f.clock});
  assert.equal((await restarted.scanSource(root,cfg(f))).pending,2);
  f.clock+=6000;
  const two=await restarted.scanSource(root,cfg(f));
  assert.deepEqual(two,{imported:0,duplicate:2,pending:0,failed:0});
});

test('same name with different bytes never overwrites original',async(t)=>{
  const f=fixture();t.after(f.cleanup);
  const source=path.join(f.source,'DSCF0001.JPG');
  agedWrite(source,'original');
  const importer=new Importer(path.join(f.dir,'state'),()=>{},{now:()=>f.clock});
  assert.equal((await importer.importFile(source,cfg(f))).kind,'pending');
  f.clock+=6000;
  const first=await importer.importFile(source,cfg(f));
  agedWrite(source,'new but same basename');
  assert.equal((await importer.importFile(source,cfg(f))).kind,'pending');
  f.clock+=6000;
  const second=await importer.importFile(source,cfg(f));
  assert.equal(first.kind,'imported');assert.equal(second.kind,'imported');
  assert.notEqual(first.target,second.target);
  assert.equal(fs.readFileSync(first.target,'utf8'),'original');
  assert.equal(fs.readFileSync(second.target,'utf8'),'new but same basename');
  assert.equal(await sha256(first.target),crypto.createHash('sha256').update('original').digest('hex'));
});

test('unsettled source is deferred without creating a target',async(t)=>{
  const f=fixture();t.after(f.cleanup);
  const source=path.join(f.source,'NEW.JPG');
  fs.writeFileSync(source,'still writing');
  const importer=new Importer(path.join(f.dir,'state'));
  const result=await importer.importFile(source,cfg(f));
  assert.equal(result.kind,'pending');
  assert.equal(fs.readdirSync(f.target).length,0);
});

test('future-dated camera file imports after real observation, without changing source time',async t=>{
  const f=fixture();t.after(f.cleanup);
  const source=path.join(f.source,'FUTURE.JPG');
  fs.writeFileSync(source,'camera clock is ahead');
  const future=new Date(Date.now()+12*60*60*1000);fs.utimesSync(source,future,future);
  const original=fs.statSync(source).mtimeMs;
  const importer=new Importer(path.join(f.dir,'state'),()=>{},{now:()=>f.clock});
  assert.equal((await importer.importFile(source,cfg(f))).kind,'pending');
  f.clock+=6000;
  const result=await importer.importFile(source,cfg(f));
  assert.equal(result.kind,'imported');
  assert.equal(fs.readFileSync(result.target,'utf8'),'camera clock is ahead');
  assert.equal(fs.statSync(source).mtimeMs,original);
});
