'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const state=fs.mkdtempSync(path.join(os.tmpdir(),'fn-dit-api-test-'));
process.env.DIT_DATA_DIR=state;
const {legalDestination}=require('../app/server');

test.after(()=>fs.rmSync(state,{recursive:true,force:true}));

test('production destination allows /vol1 and /vol12 folders, rejects external volumes',()=>{
  assert.equal(legalDestination('/vol1/1000/Photos'),true);
  assert.equal(legalDestination('/vol12/1000/Photos'),true);
  assert.equal(legalDestination('/vol00/card'),false);
  assert.equal(legalDestination('/etc'),false);
  assert.equal(legalDestination('/vol1'),false);
});
