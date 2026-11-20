'use strict';
class ScanSchedule {
  constructor(onDue,{now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}={}) {
    this.onDue=onDue;this.now=now;this.setTimer=setTimer;this.clearTimer=clearTimer;
    this.timer=null;this.nextAt=null;
  }
  cancel() {
    if(this.timer!==null) this.clearTimer(this.timer);
    this.timer=null;this.nextAt=null;
  }
  schedule(delay) {
    this.cancel();this.nextAt=new Date(this.now()+delay).toISOString();
    this.timer=this.setTimer(()=>{this.timer=null;this.nextAt=null;this.onDue();},delay);
    this.timer?.unref?.();return this.nextAt;
  }
}
module.exports={ScanSchedule};
