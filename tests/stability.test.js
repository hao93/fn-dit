'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {FileStability}=require('../app/lib/stability');
const stat={size:100,mtimeMs:Date.now()+86400000,ctimeMs:123,dev:1,ino:2};
test('future or old timestamps both require the same observed quiet interval',()=>{
  for(const mtimeMs of [0,stat.mtimeMs]) {
    let now=0;const tracker=new FileStability(()=>now),file={...stat,mtimeMs};
    assert.equal(tracker.observe('photo',file,10).stable,false);
    now=9999;assert.equal(tracker.observe('photo',file,10).stable,false);
    now=10000;assert.equal(tracker.observe('photo',file,10).stable,true);
  }
});
test('growing file resets the full quiet interval',()=>{
  let now=0;const tracker=new FileStability(()=>now);
  tracker.observe('photo',stat,10);now=15000;
  const growing={...stat,size:200};
  assert.equal(tracker.observe('photo',growing,10).stable,false);
  now=24999;assert.equal(tracker.observe('photo',growing,10).stable,false);
  now=25000;assert.equal(tracker.observe('photo',growing,10).stable,true);
});
test('same-size replacement and modification markers reset observation',()=>{
  for(const change of [{mtimeMs:stat.mtimeMs+1},{ctimeMs:124},{ino:3},{dev:2}]) {
    let now=0;const tracker=new FileStability(()=>now);
    tracker.observe('photo',stat,5);now=6000;
    assert.equal(tracker.observe('photo',{...stat,...change},5).stable,false);
  }
});
test('pruning deleted files discards their previous stability',()=>{
  let now=0;const tracker=new FileStability(()=>now);
  const folder=require('node:path').join('card','DCIM');
  const file=require('node:path').join(folder,'photo.jpg');tracker.observe(file,stat,5);
  now=6000;tracker.prune(folder,new Set());
  assert.equal(tracker.observe(file,stat,5).stable,false);
});
