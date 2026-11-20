'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {inspectSources,externalPath,checkSourceRoot} = require('./lib/discovery');
const {Importer} = require('./lib/importer');
const {east8Time}=require('./lib/time');
const {ScanSchedule}=require('./lib/schedule');
const {RunHistory}=require('./lib/history');

const BASE = '/app/fn-dit';
const DEV = process.env.DIT_DEV === '1';
const dataDir = process.env.DIT_DATA_DIR || process.env.TRIM_PKGVAR || path.join(__dirname,'../.state');
const publicDir = path.join(__dirname,'ui');
const configFile = path.join(dataDir,'config.json');
const logFile = path.join(dataDir,'import.log');

fs.mkdirSync(dataDir,{recursive:true});

const defaults = {
  enabled:false,
  destination:'',
  sourceRoots:[],
  autoDiscover:true,
  intervalSeconds:15,
  settleSeconds:10,
  timezone:'Asia/Shanghai',
  folderMode:'date_type'
};
let config;
try { config = {...defaults,...JSON.parse(fs.readFileSync(configFile,'utf8'))}; }
catch { config={...defaults}; }

const status = {busy:false,phase:'idle',startedAt:null,lastRun:null,nextScanAt:null,lastError:'',historyError:'',latestRunId:null,lastSummary:{imported:0,duplicate:0,pending:0,failed:0},current:'',devices:[],deviceMessage:''};
const history=new RunHistory(dataDir);
let activeRun=null,stopping=false;
const recentLogs=[];
function log(message) {
  const line = `${east8Time()} ${message}`;
  recentLogs.push(line);
  if (recentLogs.length>100) recentLogs.shift();
  try { fs.appendFileSync(logFile,line+'\n',{mode:0o600}); }
  catch (error) { console.error('log write failed:',error.message); }
  if(activeRun) {
    try {history.append(activeRun.id,line);}
    catch {status.historyError='本轮详细日志保存失败，请检查应用数据存储空间。';}
  }
  console.log(line);
}
const importer = new Importer(dataDir,log);
const schedule=new ScanSchedule(()=>{void scan(false).catch(error=>log(error.message));});
function scheduleNext(delay=config.intervalSeconds*1000) {
  schedule.cancel();status.nextScanAt=null;
  if(config.enabled&&!status.busy&&!stopping) status.nextScanAt=schedule.schedule(delay);
}
const completedSources = new Set();

function legalDestination(folder) {
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) return false;
  if (folder.includes('\0')) return false;
  const full = path.resolve(folder);
  if (!DEV && !/^\/vol[1-9]\d*\/.+/.test(full)) return false;
  if (DEV && (full === '/' || full === '/tmp')) return false;
  for (const source of config.sourceRoots) {
    if (full === source || source.startsWith(full+path.sep)) return false;
  }
  return true;
}

function authorizedDestination(folder) {
  if (!legalDestination(folder)) throw new Error('目标路径必须是飞牛内部存储 /vol1/...（非外接盘）；不能是扫描来源的上级目录');
  const real = fs.realpathSync(folder);
  if (!legalDestination(real)) throw new Error('目标目录解析到不可用或未经许可的位置');
  const handle = fs.mkdtempSync(path.join(real,'.fn-dit-write-'));
  fs.rmdirSync(handle);
  return real;
}

function validateSettings(input) {
  if (typeof input !== 'object' || input == null || Array.isArray(input)) throw new Error('设置格式不正确');
  const next={...defaults};
  next.enabled = input.enabled === true;
  next.autoDiscover = input.autoDiscover !== false;
  next.destination = typeof input.destination==='string' ? input.destination.trim() : '';
  next.sourceRoots = Array.isArray(input.sourceRoots) ? input.sourceRoots.map(s=>String(s).trim()).filter(Boolean) : [];
  if (next.sourceRoots.length>20) throw new Error('手动来源不能多于 20 个');
  next.intervalSeconds=Number(input.intervalSeconds);
  next.settleSeconds=Number(input.settleSeconds);
  next.timezone=String(input.timezone||'Asia/Shanghai');
  next.folderMode = input.folderMode === 'date_flat' ? 'date_flat':'date_type';
  if (!Number.isInteger(next.intervalSeconds)|| next.intervalSeconds<5|| next.intervalSeconds>3600) throw new Error('扫描间隔需在 5-3600 秒内');
  if (!Number.isInteger(next.settleSeconds)||next.settleSeconds<5||next.settleSeconds>3600) throw new Error('稳定等待需在 5-3600 秒内');
  try { new Intl.DateTimeFormat('en',{timeZone:next.timezone}); } catch { throw new Error('时区名称无效'); }
  for (const root of next.sourceRoots) {
    if (!externalPath(root)) throw new Error('来源必须是已选择的外接存储目录。');
    try {
      if(!externalPath(fs.realpathSync(root))) throw new Error('存储卡来源不能指向内部存储。');
    } catch(error) {
      // Saved removable sources survive unplugging; discovery reports their state.
      if(!['ENOENT','EACCES','EPERM'].includes(error.code)) throw error;
    }
  }
  if (next.destination) {
    const previous=config; config=next;
    try { next.destination=authorizedDestination(next.destination); }
    finally { config=previous; }
  } else if (next.enabled) throw new Error('请先配置目标照片目录');
  return next;
}

function saveConfig(next) {
  const temp=path.join(dataDir,`config-${process.pid}.tmp`);
  fs.writeFileSync(temp,JSON.stringify(next,null,2),{mode:0o600,flag:'w'});
  fs.renameSync(temp,configFile);
  if (config.destination !== next.destination || config.folderMode !== next.folderMode) completedSources.clear();
  config=next;
  if(!status.busy) Object.assign(status,runState(status.lastSummary,status.lastError,config.enabled));
  scheduleNext();
}

function runState(summary,error,enabled) {
  return {
    phase:error?'error':summary.pending>0?'waiting':'idle',
    current:summary.pending>0&&!error?
      `${summary.pending} 个文件等待稳定，${enabled?'下一轮自动重试':'请稍后再次扫描或开启自动导入'}`:''
  };
}

async function scan(force=false) {
  if (status.busy) return;
  if (!force && !config.enabled) return;
  schedule.cancel();status.nextScanAt=null;
  const runConfig={...config,sourceRoots:[...config.sourceRoots]};
  status.busy=true;
  status.phase='scanning';
  status.startedAt=new Date().toISOString();
  status.lastError='';
  status.historyError='';
  status.current='';
  const summary={imported:0,duplicate:0,pending:0,failed:0};
  function beginHistory(sources=[]) {
    activeRun=history.begin({trigger:force?'manual':'auto',destination:runConfig.destination,sources});
    status.latestRunId=activeRun.id;
  }
  try {
    if(force) beginHistory(runConfig.sourceRoots);
    const report=inspectSources(runConfig,{auto:runConfig.autoDiscover});
    const roots=report.sources;
    status.devices=report.devices;
    status.deviceMessage=report.message;
    const active=new Set(roots.map(root=>root.path));
    for (const old of completedSources) if (!active.has(old)) completedSources.delete(old);
    if (!roots.length) {status.lastError=report.message;log(report.message);return;}
    const eligibleRoots=roots.filter(root=>force||!completedSources.has(root.path));
    if(!activeRun&&eligibleRoots.length) beginHistory(eligibleRoots.map(root=>root.path));
    if(activeRun) {activeRun.sources=eligibleRoots.map(root=>root.path);history.save(activeRun);}
    if (!runConfig.destination) throw new Error('请先设置目标目录');
    const dest=authorizedDestination(runConfig.destination);
    for (const root of roots) {
      if (!force && completedSources.has(root.path)) continue;
      if (root.path === dest || root.path.startsWith(dest+path.sep)||dest.startsWith(root.path+path.sep)) {
        log(`跳过不安全来源（与目标目录重叠）: ${root.path}`); continue;
      }
      status.current=root.path;
      const stats=await importer.scanSource(root,{...runConfig,destination:dest},values=>{
        status.current=`${root.path}：${values.current}`;
        if(activeRun) {
          const live=Object.fromEntries(Object.keys(summary).map(key=>[key,summary[key]+values[key]]));
          try {history.progress(activeRun,live);}
          catch {status.historyError='运行数量保存失败，请检查应用数据存储空间。';}
        }
      });
      for (const key of Object.keys(summary)) summary[key]+=stats[key];
      if (stats.pending === 0 && stats.failed === 0) completedSources.add(root.path);
    }
  } catch (error) {status.lastError=error.message;log(`扫描异常：${error.message}`);}
  finally {
    status.lastSummary=summary;status.lastRun=new Date().toISOString();status.busy=false;
    if(activeRun) {
      try {history.finish(activeRun,summary,status.lastError);}
      catch {status.historyError='本轮记录未能完整保存，请检查应用数据存储空间。';}
      activeRun=null;
    }
    Object.assign(status,runState(summary,status.lastError,config.enabled));
    scheduleNext();
  }
}

function json(res,obj,code=200) {
  res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(JSON.stringify(obj));
}

async function bodyJSON(req) {
  const pieces=[];
  let size=0;
  for await (const part of req) {
    size+=part.length;
    if (size>128*1024) throw new Error('请求内容太大');
    pieces.push(part);
  }
  return JSON.parse(Buffer.concat(pieces).toString('utf8'));
}

const files = {
  '/': ['index.html','text/html; charset=utf-8'],
  '/app.js':['app.js','text/javascript; charset=utf-8'],
  '/styles.css':['styles.css','text/css; charset=utf-8'],
  '/directory-picker.mjs':['directory-picker.mjs','text/javascript; charset=utf-8'],
  '/vendor/trim-web-app.mjs':['vendor/trim-web-app.mjs','text/javascript; charset=utf-8'],
  '/folder-callback.html':['folder-callback.html','text/html; charset=utf-8'],
  '/folder-callback.mjs':['folder-callback.mjs','text/javascript; charset=utf-8'],
  '/icon.png':['icon.png','image/png']
};

async function handle(req,res) {
  let pathname,requestURL;
  try { requestURL=new URL(req.url,'http://localhost');pathname=decodeURIComponent(requestURL.pathname); }
  catch {json(res,{error:'非法 URL'},400);return;}
  if (!pathname.startsWith(BASE)) {json(res,{error:'未找到页面'},404);return;}
  const tail=pathname.slice(BASE.length)||'/';
  const isAdmin=DEV || ['1','true'].includes(String(req.headers['x-trim-isadmin']||'').toLowerCase());
  if (!isAdmin) {json(res,{error:'需要 NAS 管理员账户'},403);return;}
  if(req.method==='GET'&&tail==='/api/history') {
    json(res,history.list(requestURL.searchParams.get('offset'),requestURL.searchParams.get('limit')));return;
  }
  if(req.method==='GET'&&tail.startsWith('/api/history/')) {
    const match=tail.match(/^\/api\/history\/([^/]+)(\/download)?$/);
    if(!match) {json(res,{error:'未找到运行记录'},404);return;}
    try {
      const id=match[1];history.get(id);
      if(match[2]) {
        const file=history.file(id,'.log');fs.accessSync(file,fs.constants.R_OK);
        res.writeHead(200,{'content-type':'text/plain; charset=utf-8','content-disposition':`attachment; filename="fn-dit-${id}.log"`,'cache-control':'no-store'});
        fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);
      } else json(res,await history.detail(id,requestURL.searchParams.get('offset'),requestURL.searchParams.get('limit')));
    } catch {json(res,{error:'运行记录不存在或无法读取'},404);}
    return;
  }
  if(req.method==='GET'&&tail==='/api/logs/download') {
    try {fs.accessSync(logFile,fs.constants.R_OK);} catch {json(res,{error:'暂无运行日志'},404);return;}
    res.writeHead(200,{'content-type':'text/plain; charset=utf-8','content-disposition':'attachment; filename="fn-dit-import.log"','cache-control':'no-store'});
    fs.createReadStream(logFile).on('error',()=>res.destroy()).pipe(res);return;
  }
  if (req.method==='GET' && tail==='/api/status') {
    if (!status.busy) {
      try {
        const report=inspectSources(config,{auto:config.autoDiscover});
        status.devices=report.devices;
        status.deviceMessage=report.message;
        const active=new Set(report.sources.map(root=>root.path));
        for (const old of completedSources) if (!active.has(old)) completedSources.delete(old);
      }
      catch { /* device is being inserted or unmounted */ }
    }
    json(res,{status,config,logs:recentLogs.slice(-60)});return;
  }
  if (req.method==='GET' && tail==='/api/mounts') {
    try {
      const report=inspectSources(config,{auto:config.autoDiscover});
      status.devices=report.devices;status.deviceMessage=report.message;
      json(res,report);
    }
    catch (error) {json(res,{error:error.message},500);}
    return;
  }
  if (req.method==='POST') {
    if (req.headers['x-dit-request'] !== '1') {json(res,{error:'缺少请求标识'},403);return;}
    try {
      if (tail==='/api/source/add') {
        const input=await bodyJSON(req);
        const source=checkSourceRoot(input?.source);
        const sourceRoots=[...new Set([...config.sourceRoots,source])];
        if(sourceRoots.length>20) throw new Error('最多保存 20 个存储卡来源。');
        saveConfig({...config,sourceRoots});
        const report=inspectSources(config,{auto:config.autoDiscover});
        status.devices=report.devices;status.deviceMessage=report.message;
        json(res,{source,...report});return;
      }
      if (tail==='/api/destination/check') {
        const input=await bodyJSON(req);
        const destination=authorizedDestination(input?.destination);
        json(res,{destination});return;
      }
      if (tail==='/api/settings') {
        const next=validateSettings(await bodyJSON(req));
        saveConfig(next);
        log('设置已保存'+(next.enabled?'，已开启自动导入':'，自动导入保持关闭'));
        json(res,{ok:true,config});return;
      }
      if (tail==='/api/import-now') {
        if (status.busy) {json(res,{error:'已有扫描任务正在运行'},409);return;}
        if (!config.destination) {json(res,{error:'请先保存目标目录'},400);return;}
        setImmediate(()=>scan(true));
        json(res,{ok:true});return;
      }
    } catch(error) {json(res,{error:error.message},400);return;}
  }
  if (req.method==='GET' && files[tail]) {
    const [name,mime]=files[tail];
    res.writeHead(200,{'content-type':mime,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'self'"});
    fs.createReadStream(path.join(publicDir,name)).pipe(res);
    return;
  }
  json(res,{error:'没有这个接口'},404);
}

function start() {
  const server=http.createServer((req,res)=>{handle(req,res).catch(e=>{log(`接口错误：${e.message}`); if(!res.headersSent) json(res,{error:'内部错误'},500);else res.end();});});
  if (DEV) {
    server.listen(17681,'127.0.0.1',()=>log('测试模式：http://127.0.0.1:17681'+BASE+'/'));
  } else {
    const sock=process.env.DIT_SOCKET||path.join(process.env.TRIM_APPDEST||__dirname,'app.sock');
    try { if (fs.existsSync(sock)) fs.unlinkSync(sock); } catch { /* service manager owns socket lifecycle */ }
    server.listen(sock,()=>log('正在通过 fnOS 网关服务'));
  }
  scheduleNext(1000);
  for (const sig of ['SIGTERM','SIGINT']) process.on(sig,()=>{stopping=true;schedule.cancel();status.nextScanAt=null;server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),15000).unref();});
}
if (require.main===module) start();
module.exports = {validateSettings,legalDestination,start,runState};
