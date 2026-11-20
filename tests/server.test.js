'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const state=fs.mkdtempSync(path.join(os.tmpdir(),'fn-dit-api-test-'));
process.env.DIT_DATA_DIR=state;
const {legalDestination,runState}=require('../app/server');

test.after(()=>fs.rmSync(state,{recursive:true,force:true}));

test('production destination allows /vol1 and /vol12 folders, rejects external volumes',()=>{
  assert.equal(legalDestination('/vol1/1000/Photos'),true);
  assert.equal(legalDestination('/vol12/1000/Photos'),true);
  assert.equal(legalDestination('/vol00/card'),false);
  assert.equal(legalDestination('/etc'),false);
  assert.equal(legalDestination('/vol1'),false);
});
test('pending files stay visible while the worker waits between automatic scans',()=>{
  const state=runState({pending:12},'',true);
  assert.equal(state.phase,'waiting');assert.match(state.current,/12.*下一轮自动重试/);
  assert.match(runState({pending:12},'',false).current,/再次扫描或开启自动导入/);
});
test('completed and failed scans do not masquerade as waiting jobs',()=>{
  assert.equal(runState({pending:0},'',true).phase,'idle');
  assert.equal(runState({pending:12},'无法写入',true).phase,'error');
});
