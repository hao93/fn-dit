'use strict';
const fs = require('node:fs');
const path = require('node:path');
const p = path.posix;
const EXTERNAL = /^\/(vol0\d+|media|run\/media|mnt\/usb)(\/|$)/;
const LOCAL_FS = /^(vfat|msdos|exfat|ntfs|ntfs3|fuseblk|fuse\.(exfat|ntfs-3g)|ext[234]|btrfs|xfs|hfsplus|udf|iso9660)$/i;
const REMOTE_FS = /^(cifs|smb3|nfs\d*|9p|fuse\.(rclone|sshfs)|davfs)/i;
function unescapeMount(s) {return s.replace(/\\([0-7]{3})/g,(_,o)=>String.fromCharCode(parseInt(o,8)));}
function externalPath(folder) {
  return typeof folder==='string' && folder.startsWith('/') && !folder.includes('\0') && EXTERNAL.test(p.resolve(folder));
}
function readMounts(mountinfo='/proc/self/mountinfo') {
  let lines;
  try {lines=fs.readFileSync(mountinfo,'utf8').split('\n');} catch {return [];}
  return lines.map(line=>{
    const cols=line.split(' '), dash=cols.indexOf('-');
    if(dash<6||cols.length<dash+3) return null;
    return {mount:unescapeMount(cols[4]),device:unescapeMount(cols[dash+2]||''),fstype:cols[dash+1]};
  }).filter(Boolean);
}
function removableDevice(device) {
  if(!device.startsWith('/dev/')) return false;
  let name=path.basename(device);
  try {name=path.basename(fs.realpathSync(device));} catch { /* device aliases may be hidden */ }
  const sd=name.match(/^(sd[a-z]+)\d*$/), mmc=name.match(/^(mmcblk\d+)p?\d*$/);
  try {
    if(sd) return fs.realpathSync(`/sys/class/block/${sd[1]}`).includes('/usb');
    if(mmc) return fs.realpathSync(`/sys/class/block/${mmc[1]}`).includes('/mmc_host/');
  } catch { /* no sysfs access is not proof that an fnOS external mount is absent */ }
  return false;
}
function candidateMount(mount) {
  if(!externalPath(mount.mount)||REMOTE_FS.test(mount.fstype)||mount.device.startsWith('/dev/loop')) return false;
  // fnOS external namespace + a local filesystem is sufficient; sysfs is optional.
  return LOCAL_FS.test(mount.fstype)||removableDevice(mount.device);
}
function findDCIM(folder, io=fs) {
  try {
    if(p.basename(folder).toUpperCase()==='DCIM') return folder;
    const ent=io.readdirSync(folder,{withFileTypes:true}).find(e=>e.isDirectory()&&!e.isSymbolicLink()&&e.name.toUpperCase()==='DCIM');
    return ent?p.join(folder,ent.name):null;
  } catch {return null;}
}
function sourceError(error) {
  if(['EACCES','EPERM'].includes(error.code)) return '存储卡已发现，但 DIT 没有读取权限。请点击「选择存储卡」授权；若仍失败，检查飞牛的外接存储权限。';
  if(error.code==='ENOENT') return '存储卡未连接，或挂载位置已改变，请重新选择存储卡。';
  return `无法读取存储卡（${error.code||'读取失败'}），请检查设备和目录授权。`;
}
function inspectSources(config,options={}) {
  const io=options.fs||fs, sources=new Map(), devices=new Map();
  const mounts=options.mounts||readMounts(options.mountinfo);
  function device(root,origin,state,message,dcim) {
    devices.set(root,{path:root,name:p.basename(root),origin,state,message,...(dcim?{dcim}:{})});
    if(state==='ready') sources.set(root,{path:root,dcim,origin});
    else sources.delete(root);
  }
  function probe(root,origin,nested=true) {
    if(!externalPath(root)) return;
    let real=root;
    try {
      real=io.realpathSync(root);
      if(!externalPath(real)) {device(root,origin,'blocked','来源指向内部存储，已跳过。');return;}
      const mount=mounts.filter(m=>real===m.mount||real.startsWith(m.mount+'/')).sort((a,b)=>b.mount.length-a.mount.length)[0];
      if(mount&&REMOTE_FS.test(mount.fstype)) {device(real,origin,'blocked','远程挂载不作为存储卡来源。');return;}
      if(!io.statSync(real).isDirectory()) {device(real,origin,'blocked','所选位置不是文件夹。');return;}
      const entries=io.readdirSync(real,{withFileTypes:true});
      let dcim;
      if(real.split('/').some(part=>part.toUpperCase()==='DCIM')) dcim=real;
      else {
        const ent=entries.find(e=>e.isDirectory()&&!e.isSymbolicLink()&&e.name.toUpperCase()==='DCIM');
        if(ent) dcim=p.join(real,ent.name);
      }
      if(dcim) {
        io.readdirSync(dcim,{withFileTypes:true}); // verify actual read access, not just existence
        device(real,origin,'ready','已识别相机照片目录，可以导入。',dcim);return;
      }
      let childFound=false;
      if(nested) {
        const container=/^\/vol0\d+$/.test(real);
        for(const ent of entries.filter(e=>e.isDirectory()&&!e.isSymbolicLink()).slice(0,256)) {
          const child=p.join(real,ent.name);
          if(container||findDCIM(child,io)) {
            probe(child,origin,false);childFound=true;
          }
        }
      }
      if(!childFound) device(real,origin,'no-dcim','已发现设备，但未找到 DCIM。请选择存储卡根目录或 DCIM 文件夹。');
    } catch(error) {device(real,origin,error.code==='ENOENT'?'disconnected':'unreadable',sourceError(error));}
  }
  if(options.auto!==false) {
    for(const mount of mounts) {
      if(candidateMount(mount)) probe(mount.mount,'USB/SD 自动发现');
    }
    const granted=options.authorizedPaths??process.env.TRIM_DATA_ACCESSIBLE_PATHS??'';
    for(const root of granted.split(':').filter(externalPath)) probe(root,'应用已授权目录');
  }
  for(const root of config.sourceRoots||[]) probe(root,'已选择的存储卡');
  const deviceDCIM=new Set();
  const list=[...devices.values()].sort((a,b)=>a.path.localeCompare(b.path)).filter(device=>{
    if(device.state!=='ready') return true;
    if(deviceDCIM.has(device.dcim)) return false;
    deviceDCIM.add(device.dcim);return true;
  });
  const seenDCIM=new Set();
  const ready=[...sources.values()].sort((a,b)=>a.path.localeCompare(b.path)).filter(source=>{
    if(seenDCIM.has(source.dcim)) return false;
    seenDCIM.add(source.dcim);return true;
  });
  return {sources:ready,devices:list,message:list.length?
    `检查完成：${ready.length} 个可导入来源，${list.filter(d=>d.state!=='ready').length} 个需要处理。`:
    '未发现可读取的外接存储。飞牛文件管理已能看到卡时，请点击「选择存储卡」授权读取。'};
}
function discoverSources(config,options={}) {return inspectSources(config,options).sources;}
function checkSourceRoot(folder) {
  if(!externalPath(folder)) throw new Error('请在「外接存储」中选择 SD 卡根目录或 DCIM 文件夹。');
  let real;
  try {
    real=fs.realpathSync(folder);
    if(!externalPath(real)) throw new Error('不能将内部存储作为存储卡来源。');
    const mounts=readMounts();
    const mount=mounts.filter(m=>real===m.mount||real.startsWith(m.mount+'/')).sort((a,b)=>b.mount.length-a.mount.length)[0];
    if(mount&&REMOTE_FS.test(mount.fstype)) throw new Error('请选择本机外接存储，不支持将远程挂载作为存储卡。');
    const report=inspectSources({sourceRoots:[real]},{auto:false});
    if(!report.sources.length) throw new Error(report.devices[0]?.message||'没有发现可读取的 DCIM 文件夹。');
  } catch(error) {
    if(error.code) throw new Error(sourceError(error));
    throw error;
  }
  return real;
}
module.exports={readMounts,removableDevice,candidateMount,externalPath,discoverSources,inspectSources,findDCIM,checkSourceRoot};
