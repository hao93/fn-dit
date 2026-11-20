'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const photos = new Set(['.jpg','.jpeg','.raf','.dng','.heic','.heif','.png','.tif','.tiff']);
const videos = new Set(['.mov','.mp4','.m4v','.avi']);
const raws = new Set(['.raf','.dng']);
const eligible = p => photos.has(path.extname(p).toLowerCase()) || videos.has(path.extname(p).toLowerCase());
function categoryFor(p) {
  const ext=path.extname(p).toLowerCase();
  return raws.has(ext)?'RAW':videos.has(ext)?'VIDEO':['.jpg','.jpeg'].includes(ext)?'JPG':'OTHER';
}
function parseExifDate(value) {
  if(typeof value !== 'string') return null;
  const m=value.trim().match(/^(\d{4})[:\-]?(\d{2})[:\-]?(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if(!m) return null;
  const [y,mo,d,h,mi,s]=m.slice(1).map(Number);
  const dt=new Date(Date.UTC(y,mo-1,d,h,mi,s));
  if(y<1970||y>2100||dt.getUTCFullYear()!==y||dt.getUTCMonth()!==mo-1||dt.getUTCDate()!==d||dt.getUTCHours()!==h||dt.getUTCMinutes()!==mi||dt.getUTCSeconds()!==s)return null;
  return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}
function readExifTiff(buf) {
  if(buf.length<8)return null;
  const little=buf.toString('ascii',0,2)==='II';
  if(!little&&buf.toString('ascii',0,2)!=='MM')return null;
  const u16=o=>o>=0&&o+2<=buf.length?(little?buf.readUInt16LE(o):buf.readUInt16BE(o)):null;
  const u32=o=>o>=0&&o+4<=buf.length?(little?buf.readUInt32LE(o):buf.readUInt32BE(o)):null;
  if(u16(2)!==42)return null;
  const visited=new Set();let fallback=null;
  function readIFD(offset,depth) {
    if(depth>3||offset==null||offset+2>buf.length||visited.has(offset))return null;
    visited.add(offset);
    const count=u16(offset);
    if(count==null||count>4096||offset+2+count*12>buf.length)return null;
    let sub=null;
    for(let i=0;i<count;i++){
      const p=offset+2+i*12,tag=u16(p),type=u16(p+2),len=u32(p+4),val=u32(p+8);
      if(tag===0x8769&&val!=null)sub=val;
      if([0x9003,0x0132,0x9004].includes(tag)&&type===2&&len>0&&len<=64){
        const at=len<=4?p+8:val;
        if(at!=null&&at+len<=buf.length){
          const date=parseExifDate(buf.toString('ascii',at,at+len).replace(/\0/g,''));
          if(date&&tag===0x9003)return date;
          if(date&&!fallback)fallback=date;
        }
      }
    }
    return sub==null?fallback:readIFD(sub,depth+1)||fallback;
  }
  return readIFD(u32(4),0);
}
function jpegExifDate(buf) {
  if(buf.length<4||buf[0]!==255||buf[1]!==216)return null;
  let p=2;
  while(p+4<buf.length&&buf[p]===255){
    const marker=buf[p+1];
    if(marker===218||marker===217)break;
    if(marker===255||marker===0){p++;continue;}
    if(marker>=208&&marker<=215){p+=2;continue;}
    const len=buf.readUInt16BE(p+2);
    if(len<2||p+2+len>buf.length)break;
    if(marker===225&&buf.toString('ascii',p+4,p+10)==='Exif\0\0'){
      const date=readExifTiff(buf.subarray(p+10,p+2+len));if(date)return date;
    }
    p+=len+2;
  }
  return null;
}
function quickTimeDate(buf) {
  function atoms(start,end,depth=0){
    if(depth>5)return null;
    let p=start;
    while(p+8<=end){
      let size=buf.readUInt32BE(p),tag=buf.toString('ascii',p+4,p+8),header=8;
      if(size===1){if(p+16>end)break;const big=buf.readBigUInt64BE(p+8);if(big>BigInt(Number.MAX_SAFE_INTEGER))break;size=Number(big);header=16;}
      if(size===0)size=end-p;
      if(size<header||p+size>end)break;
      if(tag==='mvhd'&&size>=header+20){
        const ver=buf[p+header];let sec;
        if(ver===0)sec=buf.readUInt32BE(p+header+4);
        else if(ver===1&&size>=header+28)sec=Number(buf.readBigUInt64BE(p+header+4));
        if(sec>0){const date=new Date((sec-2082844800)*1000);if(date.getUTCFullYear()>=1970&&date.getUTCFullYear()<=2100)return date;}
      }
      if(tag==='moov'){const found=atoms(p+header,p+size,depth+1);if(found)return found;}
      p+=size;
    }
    return null;
  }
  return atoms(0,buf.length);
}
function quickTimeDateFromFile(fd,size){
  let at=0;const header=Buffer.alloc(16);
  while(at+8<=size){
    if(fs.readSync(fd,header,0,16,at)<8)break;
    let len=header.readUInt32BE(0),tag=header.toString('ascii',4,8),hs=8;
    if(len===1){if(at+16>size)break;const big=header.readBigUInt64BE(8);if(big>BigInt(Number.MAX_SAFE_INTEGER))break;len=Number(big);hs=16;}
    if(len===0)len=size-at;
    if(len<hs||at+len>size)break;
    if(tag==='moov'){if(len>32*1024*1024)return null;const buf=Buffer.alloc(len);if(fs.readSync(fd,buf,0,len,at)!==len)return null;return quickTimeDate(buf);}
    at+=len;
  }
  return null;
}
function dateInZone(date,timezone){
  const p=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const o=Object.fromEntries(p.map(x=>[x.type,x.value]));
  return `${o.year}-${o.month}-${o.day}`;
}
function fromExifTool(filename,timezone){
  const bin=process.env.DIT_EXIFTOOL||'/usr/bin/exiftool';
  if(!fs.existsSync(bin))return null;
  const run=spawnSync(bin,['-api','QuickTimeUTC=1','-j','-DateTimeOriginal','-CreationDate','-CreateDate','-MediaCreateDate',filename],{timeout:9000,maxBuffer:1024*1024,encoding:'utf8',env:{...process.env,TZ:timezone}});
  if(run.status!==0||!run.stdout)return null;
  try{const o=JSON.parse(run.stdout)[0];for(const k of ['DateTimeOriginal','CreationDate','CreateDate','MediaCreateDate']){const date=parseExifDate(o[k]);if(date)return date;}}catch{}
  return null;
}
function photographedDate(file,stat,timezone='Asia/Shanghai'){
  const tool=fromExifTool(file,timezone);
  if(tool)return {date:tool,source:'metadata:exiftool'};
  const ext=path.extname(file).toLowerCase();
  try{
    const fd=fs.openSync(file,'r');
    try{
      const size=Math.min(stat.size,ext==='.raf'?32*1024*1024:4*1024*1024),buf=Buffer.alloc(size);
      fs.readSync(fd,buf,0,size,0);
      if(['.jpg','.jpeg','.raf'].includes(ext)){
        if(ext==='.raf'&&buf.toString('ascii',0,15).startsWith('FUJIFILMCCD-RAW')){
          const at=buf.indexOf(Buffer.from([255,216,255]),16);
          if(at>=0){const date=jpegExifDate(buf.subarray(at));if(date)return {date,source:'metadata:raf-preview-exif'};}
        }else{const date=jpegExifDate(buf);if(date)return {date,source:'metadata:jpeg-exif'};}
      }
      if(['.mov','.mp4','.m4v'].includes(ext)){
        const qt=quickTimeDateFromFile(fd,stat.size);
        if(qt)return {date:dateInZone(qt,timezone),source:'metadata:quicktime-utc'};
      }
    }finally{fs.closeSync(fd);}
  }catch{}
  return {date:dateInZone(stat.mtime,timezone),source:'fallback:file-mtime'};
}
module.exports={eligible,categoryFor,parseExifDate,jpegExifDate,quickTimeDate,quickTimeDateFromFile,photographedDate,dateInZone};
