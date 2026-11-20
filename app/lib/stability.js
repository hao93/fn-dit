'use strict';
const {performance}=require('node:perf_hooks');

function signature(stat) {
  return [stat.size,stat.mtimeMs,stat.ctimeMs,stat.dev,stat.ino].join(':');
}

class FileStability {
  constructor(now=()=>performance.now()) {this.now=now;this.files=new Map();}
  observe(file,stat,seconds) {
    const now=this.now(), value=signature(stat), old=this.files.get(file);
    if(!old||old.signature!==value) {
      this.files.set(file,{signature:value,since:now});
      return {stable:false,remainingSeconds:seconds,reason:old?'文件仍在变化':'首次发现文件'};
    }
    const remaining=Math.max(0,seconds*1000-(now-old.since));
    return {stable:remaining===0,remainingSeconds:Math.ceil(remaining/1000),reason:'正在观察文件是否保持不变'};
  }
  reset(file,stat) {this.files.set(file,{signature:signature(stat),since:this.now()});}
  prune(folder,seen) {
    const prefix=folder+require('node:path').sep;
    for(const file of this.files.keys()) if(file.startsWith(prefix)&&!seen.has(file)) this.files.delete(file);
  }
}
module.exports={FileStability,signature};
