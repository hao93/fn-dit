'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {eligible,categoryFor,photographedDate} = require('./metadata');
const {FileStability,signature}=require('./stability');

const stat = (p) => fs.statSync(p);
const sleep = (ms) => new Promise(r=>setTimeout(r,ms));

async function sha256(file) {
  const h = crypto.createHash('sha256');
  const stream = fs.createReadStream(file);
  for await (const chunk of stream) h.update(chunk);
  return h.digest('hex');
}

async function copyVerified(source, target, expectedHash) {
  const dir = path.dirname(target);
  fs.mkdirSync(dir, {recursive:true});
  const tmp = path.join(dir, `.fn-dit-${crypto.randomUUID()}.partial`);
  try {
    await new Promise((resolve,reject) => {
      const input = fs.createReadStream(source);
      const output = fs.createWriteStream(tmp, {flags:'wx', mode:0o600});
      input.on('error', reject);
      output.on('error', reject);
      output.on('finish', resolve);
      input.pipe(output);
    });
    const actual = await sha256(tmp);
    if (actual !== expectedHash) throw new Error('源文件与目标临时文件 SHA-256 不一致（可能仍在写入或介质故障）');
    const fd = fs.openSync(tmp, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.linkSync(tmp, target);
    try { fs.unlinkSync(tmp); } catch { /* already committed */ }
    try { const dfd = fs.openSync(dir,'r'); try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); } } catch { /* some FS do not fsync directory */ }
  } finally { try { fs.unlinkSync(tmp); } catch { /* already removed or cleanup failed */ } }
}

class Importer {
  constructor(dataDir, log=()=>{}, options={}) {
    this.dataDir = dataDir;
    this.indexFile = path.join(dataDir, 'index.jsonl');
    this.byHash = new Map();
    this.log = log;
    this.stability=new FileStability(options.now);
    fs.mkdirSync(dataDir,{recursive:true});
    try {
      for (const line of fs.readFileSync(this.indexFile,'utf8').split('\n')) {
        if (!line) continue;
        try {
          const record = JSON.parse(line);
          if (/^[a-f0-9]{64}$/.test(record.hash) && record.target) this.byHash.set(record.hash,record.target);
        } catch { /* power failure may truncate the last line; do not trust it */ }
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  async appendIndex(hash, target, source) {
    const record = {hash,target,source,at:new Date().toISOString()};
    const fd = fs.openSync(this.indexFile,'a',0o600);
    try { fs.writeSync(fd, JSON.stringify(record)+'\n'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    this.byHash.set(hash,target);
  }

  async duplicateTarget(hash) {
    const target = this.byHash.get(hash);
    if (!target) return null;
    try { if ((await sha256(target)) === hash) return target; }
    catch { /* lost or unreadable file: import again */ }
    return null;
  }

  async importFile(source, config) {
    const before = stat(source);
    if (!before.isFile() || before.size === 0) return {kind:'ignored'};
    const observation=this.stability.observe(source,before,config.settleSeconds);
    if(!observation.stable) return {kind:'pending',...observation};
    const hash = await sha256(source);
    const after = stat(source);
    if (signature(before)!==signature(after)) {
      this.stability.reset(source,after);
      return {kind:'pending',reason:'校验期间文件发生变化',remainingSeconds:config.settleSeconds};
    }
    const previous = await this.duplicateTarget(hash);
    if (previous) return {kind:'duplicate',target:previous};
    const date = photographedDate(source, after, config.timezone);
    const subdir = config.folderMode === 'date_flat' ? '' : categoryFor(source);
    const folder = path.join(config.destination, date.date.slice(0,4), date.date, subdir);
    if (!path.resolve(folder).startsWith(path.resolve(config.destination) + path.sep)) throw new Error('非法输出文件夹');
    const name = path.basename(source);
    const ext = path.extname(name), stem = name.slice(0,name.length-ext.length);
    fs.mkdirSync(folder,{recursive:true});
    for (let i=0;i<999;i++) {
      const renamed = i===0 ? name : `${stem}_${hash.slice(0,12)}${i===1?'':'_'+i}${ext}`;
      const target = path.join(folder,renamed);
      try {
        if ((await sha256(target)) === hash) {
          await this.appendIndex(hash,target,source);
          return {kind:'duplicate',target};
        }
        continue;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      try {
        await copyVerified(source,target,hash);
        await this.appendIndex(hash,target,source);
        this.log(`已导入：${name} → ${target} [${date.source}]`);
        return {kind:'imported',target,source:date.source};
      } catch (error) {
        if (error.code === 'EEXIST') continue;
        throw error;
      }
    }
    throw new Error('发生过多重名文件冲突');
  }

  async scanSource(root, config, update=()=>{}) {
    let imported=0,duplicate=0,pending=0,failed=0;
    const dcim = root.dcim;
    const seen=new Set();
    let pendingExample='';
    const walk = async (folder, depth=0) => {
      if (depth > 12) return;
      let entries;
      try { entries = fs.readdirSync(folder,{withFileTypes:true}); }
      catch (error) { this.log(`无法访问 ${folder}: ${error.message}`); failed++; return; }
      for (const entry of entries) {
        const file = path.join(folder,entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) { await walk(file,depth+1); continue; }
        if (!entry.isFile() || !eligible(file)) continue;
        seen.add(file);
        try {
          const r = await this.importFile(file,config);
          if (r.kind==='imported') imported++;
          if (r.kind==='duplicate') duplicate++;
          if (r.kind==='pending') {
            pending++;
            if(!pendingExample) pendingExample=`${entry.name}：${r.reason}，还需观察约 ${r.remainingSeconds} 秒`;
          }
        } catch (error) {failed++; this.log(`导入失败 ${file}: ${error.message}`);}
        update({imported,duplicate,pending,failed,current:entry.name});
        await sleep(0);
      }
    };
    this.log(`开始扫描 ${root.path}`);
    await walk(dcim);
    this.stability.prune(dcim,seen);
    if(pendingExample) this.log(`等待文件稳定：${pendingExample}。将按实际文件变化判断，不受相机时间领先影响。`);
    this.log(`扫描完成 ${root.path}: 新增 ${imported}，重复 ${duplicate}，待稳定 ${pending}，失败 ${failed}`);
    return {imported,duplicate,pending,failed};
  }
}

module.exports = {Importer,sha256,copyVerified};
