'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const readline=require('node:readline');
const {east8Time}=require('./time');
const ID=/^\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const zero=()=>({imported:0,duplicate:0,pending:0,failed:0});
class RunHistory {
  constructor(dataDir) {
    this.checkpoints=new WeakMap();
    this.directory=path.join(dataDir,'history');
    fs.mkdirSync(this.directory,{recursive:true,mode:0o700});
    for(const name of this.names()) {
      try {
        const run=this.get(name.slice(0,-5));
        if(run.state==='running') {
          run.state='interrupted';run.finishedAt=new Date().toISOString();
          run.error='应用重启时任务尚未完成，请核对目标文件后重新扫描。';
          this.save(run);this.append(run.id,`${east8Time()} ${run.error}`);
        }
      } catch { /* Preserve unreadable records; do not delete history. */ }
    }
  }
  names() {return fs.readdirSync(this.directory).filter(name=>name.endsWith('.json')&&ID.test(name.slice(0,-5))).sort().reverse();}
  file(id,extension) {
    if(!ID.test(id)) throw new Error('无效的运行记录编号');
    return path.join(this.directory,id+extension);
  }
  save(run) {
    const target=this.file(run.id,'.json'),temp=target+'.tmp';
    const fd=fs.openSync(temp,'w',0o600);
    try {fs.writeSync(fd,JSON.stringify(run));fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
    fs.renameSync(temp,target);
  }
  get(id) {return JSON.parse(fs.readFileSync(this.file(id,'.json'),'utf8'));}
  begin({trigger,destination,sources=[]}) {
    const run={id:`${Date.now()}-${crypto.randomUUID()}`,startedAt:new Date().toISOString(),finishedAt:null,
      trigger,destination,sources,state:'running',summary:zero(),error:''};
    this.save(run);
    this.checkpoints.set(run,Date.now());
    this.append(run.id,`${east8Time()} ${trigger==='manual'?'手动':'自动'}扫描开始\n归档目标：${destination||'尚未配置'}`);
    return run;
  }
  append(id,line) {
    const fd=fs.openSync(this.file(id,'.log'),'a',0o600);
    try {fs.writeSync(fd,line+'\n');fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
  }
  progress(run,summary) {
    const transferred=summary.imported!==run.summary.imported||summary.failed!==run.summary.failed;
    run.summary={...summary};
    if(transferred||Date.now()-(this.checkpoints.get(run)||0)>=1000) {
      this.save(run);this.checkpoints.set(run,Date.now());
    }
  }
  finish(run,summary,error='') {
    run.summary={...summary};run.error=error;run.finishedAt=new Date().toISOString();
    run.state=error||summary.failed?'failed':summary.pending?'waiting':'completed';
    this.append(run.id,`${east8Time()} 本轮结束：新增 ${summary.imported}，重复 ${summary.duplicate}，待稳定 ${summary.pending}，失败 ${summary.failed}${error?'；'+error:''}`);
    this.save(run);
  }
  list(offset=0,limit=20) {
    offset=Math.max(0,Math.floor(Number(offset)||0));limit=Math.min(100,Math.max(1,Math.floor(Number(limit)||20)));
    const names=this.names(),runs=[];
    for(const name of names.slice(offset,offset+limit)) {
      try {runs.push(this.get(name.slice(0,-5)));} catch { /* leave corrupt entries untouched */ }
    }
    return {runs,total:names.length,offset,limit,hasMore:offset+limit<names.length};
  }
  async detail(id,offset=0,limit=200) {
    const run=this.get(id);offset=Math.max(0,Math.floor(Number(offset)||0));
    limit=Math.min(500,Math.max(1,Math.floor(Number(limit)||200)));
    const input=fs.createReadStream(this.file(id,'.log'),{encoding:'utf8'});
    const reader=readline.createInterface({input,crlfDelay:Infinity});
    const lines=[];let index=0,hasMore=false;
    try {
      for await(const line of reader) {
        if(index++<offset) continue;
        if(lines.length===limit) {hasMore=true;break;}
        lines.push(line);
      }
    } finally {reader.close();input.destroy();}
    return {run,lines,offset,hasMore,nextOffset:offset+lines.length};
  }
}
module.exports={RunHistory};
