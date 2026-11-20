'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {RunHistory}=require('../app/lib/history');
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fn-dit-history-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return {dir,history:new RunHistory(dir)};
}
const counts={imported:12,duplicate:3,pending:1,failed:0};
test('per-run counts and file logs survive a new application instance',async t=>{
  const {dir,history}=fixture(t);
  const run=history.begin({trigger:'manual',destination:'/vol1/Photos',sources:['/vol00/Card']});
  history.append(run.id,'2026-11-20 16:00:00 UTC+8 已导入：照片.JPG → /vol1/Photos/照片.JPG');
  history.finish(run,counts);
  const restored=new RunHistory(dir);assert.equal(restored.list().total,1);
  const detail=await restored.detail(run.id);
  assert.deepEqual(detail.run.summary,counts);assert.equal(detail.run.state,'waiting');
  assert.ok(detail.lines.some(line=>line.includes('照片.JPG')));
  assert.ok(detail.lines.some(line=>line.includes('新增 12，重复 3，待稳定 1，失败 0')));
});
test('interrupted runs retain checkpointed file counts after restart',t=>{
  const {dir,history}=fixture(t),run=history.begin({trigger:'auto',destination:'/vol1/Photos'});
  history.progress(run,counts);
  const restored=new RunHistory(dir).get(run.id);
  assert.equal(restored.state,'interrupted');assert.deepEqual(restored.summary,counts);
  assert.match(restored.error,/重启/);assert.ok(restored.finishedAt);
});
test('listing and large logs are paginated without dropping lines',async t=>{
  const {history}=fixture(t);
  for(let i=0;i<23;i++) history.finish(history.begin({trigger:'manual',destination:'/vol1/Photos'}),{imported:i,duplicate:0,pending:0,failed:0});
  assert.equal(history.list(0,20).runs.length,20);assert.equal(history.list(20,20).runs.length,3);
  assert.equal(history.list(0,20).hasMore,true);assert.equal(history.list(20,20).hasMore,false);
  const id=history.list().runs[0].id;
  for(let i=0;i<8;i++) history.append(id,'file-'+i);
  let offset=0,lines=[];
  for(;;) {const result=await history.detail(id,offset,2);lines.push(...result.lines);offset=result.nextOffset;if(!result.hasMore) break;}
  assert.deepEqual(lines,fs.readFileSync(history.file(id,'.log'),'utf8').trimEnd().split('\n'));
});
test('history IDs cannot read or overwrite files outside the history directory',async t=>{
  const {history}=fixture(t);
  for(const id of ['../../config','/etc/passwd','abc','..']) assert.throws(()=>history.get(id),/无效/);
});
test('actual imported file events and counts are available in persistent run history',async t=>{
  const {dir,history}=fixture(t);const {Importer}=require('../app/lib/importer');
  const source=path.join(dir,'card','DCIM'),destination=path.join(dir,'photos');
  fs.mkdirSync(source,{recursive:true});fs.mkdirSync(destination);
  fs.writeFileSync(path.join(source,'A.JPG'),'sample photo A');fs.writeFileSync(path.join(source,'B.JPG'),'sample photo B');
  const run=history.begin({trigger:'manual',destination,sources:[source]});
  let clock=0;
  const importer=new Importer(dir,line=>history.append(run.id,line),{now:()=>clock});
  const config={destination,settleSeconds:5,timezone:'Asia/Shanghai',folderMode:'date_flat'};
  await importer.scanSource({path:source,dcim:source},config);clock=6000;
  const summary=await importer.scanSource({path:source,dcim:source},config,s=>history.progress(run,{imported:s.imported,duplicate:s.duplicate,pending:s.pending,failed:s.failed}));
  history.finish(run,summary);
  const detail=await new RunHistory(dir).detail(run.id);
  assert.equal(detail.run.summary.imported,2);assert.equal(detail.run.state,'completed');
  assert.ok(detail.lines.some(line=>line.includes('已导入：A.JPG')));
  assert.ok(detail.lines.some(line=>line.includes('已导入：B.JPG')));
});
