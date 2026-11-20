'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {east8Time}=require('../app/lib/time');
test('runtime logs show explicit East Asia UTC+8 regardless of host timezone',()=>{
  assert.equal(east8Time(new Date('2026-11-20T07:17:26Z')),'2026-11-20 15:17:26 UTC+8');
});
test('UTC+8 formatting handles midnight and date rollover',()=>{
  assert.equal(east8Time(new Date('2026-11-20T16:00:00Z')),'2026-11-21 00:00:00 UTC+8');
});
