'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ScanSchedule}=require('../app/lib/schedule');
function fixture() {
  let now=Date.parse('2026-11-20T08:00:00Z'),id=0,fired=0;
  const timers=new Map();
  const schedule=new ScanSchedule(()=>{fired++;},{now:()=>now,
    setTimer:(callback,delay)=>{timers.set(++id,{callback,delay});return id;},clearTimer:id=>timers.delete(id)});
  return {schedule,timers,advance:value=>{now+=value;},get fired(){return fired;}};
}
test('displayed next scan matches the actual scheduled timer',()=>{
  const f=fixture();assert.equal(f.schedule.schedule(15000),'2026-11-20T08:00:15.000Z');
  assert.equal([...f.timers.values()][0].delay,15000);
  [...f.timers.values()][0].callback();assert.equal(f.fired,1);assert.equal(f.schedule.nextAt,null);
});
test('changing interval replaces the previous timer and advertised time',()=>{
  const f=fixture();f.schedule.schedule(15000);f.advance(3000);f.schedule.schedule(30000);
  assert.equal(f.timers.size,1);assert.equal(f.schedule.nextAt,'2026-11-20T08:00:33.000Z');
});
test('disabled/manual/busy schedule cancellation leaves no stale next time',()=>{
  const f=fixture();f.schedule.schedule(15000);f.schedule.cancel();
  assert.equal(f.timers.size,0);assert.equal(f.schedule.nextAt,null);assert.equal(f.fired,0);
});
