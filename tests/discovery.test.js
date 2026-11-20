'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {candidateMount,inspectSources,externalPath,readMounts}=require('../app/lib/discovery');
const card='/vol00/SD_Card_Reader';
const mount={mount:card,device:'/dev/disk/by-uuid/ABCD',fstype:'exfat'};
function fakeFs(tree,errors={},links={}) {
  function check(folder) {
    if(errors[folder]) throw Object.assign(new Error('test'),{code:errors[folder]});
    if(!Object.hasOwn(tree,folder)) throw Object.assign(new Error('test'),{code:'ENOENT'});
  }
  return {
    realpathSync(folder) {if(links[folder]) return links[folder];check(folder);return folder;},
    statSync(folder) {check(folder);return {isDirectory:()=>true};},
    readdirSync(folder) {check(folder);return tree[folder].map(name=>({name,isDirectory:()=>true,isSymbolicLink:()=>false}));}
  };
}
const tree=()=>({[card]:['DCIM'],[card+'/DCIM']:['133_FUJI'],[card+'/DCIM/133_FUJI']:[]});
function inspect(io,config={},options={}) {
  return inspectSources(config,{fs:io,mounts:[mount],authorizedPaths:'',...options});
}
test('fnOS exFAT card remains a candidate when device alias/sysfs is unavailable',()=>{
  assert.equal(candidateMount(mount),true);
  assert.equal(candidateMount({...mount,device:'exfat',fstype:'fuseblk'}),true);
});
test('internal, remote, system and loop mounts are never automatic card sources',()=>{
  for(const m of [{...mount,mount:'/vol1/1000/Photos'}, {...mount,mount:'/boot'},
    {...mount,fstype:'cifs'}, {...mount,fstype:'fuse.rclone'}, {...mount,device:'/dev/loop0'}]) {
    assert.equal(candidateMount(m),false);
  }
  assert.equal(externalPath('/vol00/../vol1/Photos'),false);
});
test('the reported SD_Card_Reader/DCIM/133_FUJI layout is discovered',()=>{
  const result=inspect(fakeFs(tree()));
  assert.equal(result.sources.length,1);assert.equal(result.sources[0].dcim,card+'/DCIM');
  assert.equal(result.devices[0].state,'ready');
});
test('permission denied is shown as a detected but unreadable card',()=>{
  const result=inspect(fakeFs(tree(),{[card]:'EACCES'}));
  assert.deepEqual(result.sources,[]);assert.equal(result.devices[0].state,'unreadable');
  assert.match(result.devices[0].message,/读取权限/);
});
test('DCIM without read access cannot become an import source',()=>{
  const result=inspect(fakeFs(tree(),{[card+'/DCIM']:'EPERM'}));
  assert.deepEqual(result.sources,[]);assert.equal(result.devices[0].state,'unreadable');
});
test('mounted card with no DCIM is still visible',()=>{
  const result=inspect(fakeFs({[card]:[]}));
  assert.deepEqual(result.sources,[]);assert.equal(result.devices[0].state,'no-dcim');
});
test('explicitly selected DCIM or FUJI directory works without mountinfo',()=>{
  for(const source of [card+'/DCIM',card+'/DCIM/133_FUJI']) {
    const result=inspect(fakeFs(tree()),{sourceRoots:[source]},{mounts:[],auto:false});
    assert.equal(result.sources[0].dcim,source);
  }
});
test('nested card discovery is not truncated at the old 20-folder limit',()=>{
  const children=Array.from({length:31},(_,i)=>'card-'+i);
  const t={'/vol00':children,'/vol00/card-30':['dcim'],'/vol00/card-30/dcim':[]};
  for(const child of children.slice(0,30)) t['/vol00/'+child]=[];
  const result=inspect(fakeFs(t),{},{mounts:[{...mount,mount:'/vol00'}]});
  assert.equal(result.sources.length,1);assert.equal(result.sources[0].dcim,'/vol00/card-30/dcim');
});
test('missing saved card remains visible as disconnected',()=>{
  const result=inspect(fakeFs({}),{sourceRoots:[card]},{mounts:[],auto:false});
  assert.equal(result.devices[0].state,'disconnected');assert.deepEqual(result.sources,[]);
});
test('external symlink resolving to an internal library is blocked',()=>{
  const result=inspect(fakeFs(tree(),{},{[card]:'/vol1/1000/Photos'}));
  assert.deepEqual(result.sources,[]);assert.equal(result.devices[0].state,'blocked');
});
test('auto discovery and a selected DCIM do not import the same directory twice',()=>{
  const result=inspect(fakeFs(tree()),{sourceRoots:[card+'/DCIM']});
  assert.equal(result.sources.length,1);
  assert.equal(result.devices.length,1);
});
test('authorized remote mounts cannot enter automatic discovery through granted paths',()=>{
  const result=inspect(fakeFs(tree()),{},{mounts:[{...mount,fstype:'cifs'}],authorizedPaths:card});
  assert.deepEqual(result.sources,[]);assert.equal(result.devices[0].state,'blocked');
});
test('mountinfo octal escapes and malformed lines are handled',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fn-dit-mounts-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'mountinfo');
  fs.writeFileSync(file,'malformed\n40 30 8:1 / /vol00/SD\\040Card rw,nosuid - exfat /dev/sda1 rw\n');
  assert.deepEqual(readMounts(file),[{mount:'/vol00/SD Card',device:'/dev/sda1',fstype:'exfat'}]);
});
