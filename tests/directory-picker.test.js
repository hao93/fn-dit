'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const loaded=import('../app/ui/directory-picker.mjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function storage() {
  const data=new Map();
  return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
}
function fixture(options={}) {
  const handlers={},events=[],notices=[],choices=[];
  const popup={closed:false,location:{replace:url=>events.push(['navigate',url])},close(){this.closed=true;}};
  const browser={sessionStorage:storage(),localStorage:storage(),location:{origin:'https://nas.example'},
    crypto:{randomUUID:()=> 'test-random-state'},setTimeout,clearTimeout,
    setInterval(fn){this.poll=fn;return 1;},clearInterval(){},
    open(){events.push(['open']);return options.blocked?null:popup;},
    addEventListener(name,fn){handlers[name]=fn;}};
  const sdk={isStandaloneWeb:!!options.standalone,ready:async()=>{},
    pickSharedFile:async params=>{events.push(['native',params]);return options.result??{code:0,data:['/vol1/1000/Photos']};},
    buildAppAuthUrl:async(method,params)=>{events.push(['auth',method,params]);return 'https://nas.example/app-auth/pick-shared-file';}};
  let busy=false;
  const config={sdk,browser,verify:options.verify??(async path=>path),onSelect:path=>choices.push(path),
    onNotice:(message,error)=>notices.push({message,error}),onBusy:value=>{busy=value;}};
  return {config,browser,sdk,popup,handlers,events,notices,choices,get busy(){return busy;}};
}

test('native selector requests one internal directory and verifies it before applying',async()=>{
  const {createDirectoryPicker}=await loaded;
  const f=fixture({verify:async path=>{f.events.push(['verify',path]);return path;}});
  const picker=createDirectoryPicker(f.config);await picker.ready();await picker.choose();
  assert.equal(f.events[0][0],'native');
  assert.equal(f.events[0][1].multiple,false);
  assert.ok(f.events[0][1].sidebarGroup.includes('storage'));
  assert.ok(!f.events[0][1].sidebarGroup.includes('external'));
  assert.deepEqual(f.choices,['/vol1/1000/Photos']);assert.equal(f.busy,false);
});
test('native cancel preserves the previous target',async()=>{
  const {createDirectoryPicker}=await loaded;const f=fixture({result:{code:0,data:[]}});
  await createDirectoryPicker(f.config).choose();
  assert.deepEqual(f.choices,[]);assert.match(f.notices.at(-1).message,/取消/);
});
test('grant denial preserves the target and releases the selection button',async()=>{
  const {createDirectoryPicker}=await loaded;const f=fixture({result:{code:1,msg:'无权授权'}});
  await createDirectoryPicker(f.config).choose();
  assert.deepEqual(f.choices,[]);assert.equal(f.busy,false);assert.equal(f.notices.at(-1).error,true);
});
test('unwritable directory never replaces the current target',async()=>{
  const {createDirectoryPicker}=await loaded;const f=fixture({verify:async()=>{throw new Error('目录没有写入权限');}});
  await createDirectoryPicker(f.config).choose();
  assert.deepEqual(f.choices,[]);assert.match(f.notices.at(-1).message,/写入权限/);
});
test('external volumes and multi-selection are rejected',async()=>{
  const {singleFolder}=await loaded;
  for(const value of [['/vol00/card'],['/etc'],['/vol1/a','/vol1/b'],[],null]) assert.throws(()=>singleFolder(value));
  assert.equal(singleFolder(['/vol12/1000/照片']),'/vol12/1000/照片');
});
test('standalone window opens before awaiting the auth URL',async()=>{
  const {createDirectoryPicker}=await loaded;const f=fixture({standalone:true});
  await createDirectoryPicker(f.config).choose();
  assert.deepEqual(f.events.map(e=>e[0]),['open','auth','navigate']);
  assert.equal(f.events[1][2].redirectUri,'/app/fn-dit/folder-callback.html');
  assert.equal(f.busy,true);
});
test('blocked popup preserves selection and clears pending state',async()=>{
  const {createDirectoryPicker,PENDING_KEY}=await loaded;const f=fixture({standalone:true,blocked:true});
  await createDirectoryPicker(f.config).choose();
  assert.equal(f.browser.sessionStorage.getItem(PENDING_KEY),null);
  assert.equal(f.busy,false);assert.deepEqual(f.choices,[]);assert.match(f.notices.at(-1).message,/拦截/);
});
test('callback checks origin, source and nonce; successful callback is used once',async()=>{
  const {createDirectoryPicker,RESULT_TYPE}=await loaded;const f=fixture({standalone:true});
  await createDirectoryPicker(f.config).choose();
  const result={status:'success',appName:'fn-dit',method:'pickSharedFile',state:'test-random-state',path:['/vol1/1000/New']};
  const event={origin:'https://nas.example',source:f.popup,data:{type:RESULT_TYPE,result}};
  f.handlers.message({...event,origin:'https://evil.example'});
  f.handlers.message({...event,source:{}});
  f.handlers.message({...event,data:{type:RESULT_TYPE,result:{...result,state:'wrong'}}});
  await tick();assert.deepEqual(f.choices,[]);
  f.handlers.message(event);await tick();f.handlers.message(event);await tick();
  assert.deepEqual(f.choices,['/vol1/1000/New']);assert.equal(f.busy,false);
});
test('result can be recovered without window.opener',async()=>{
  const {createDirectoryPicker,RESULT_PREFIX}=await loaded;const f=fixture({standalone:true});
  const picker=createDirectoryPicker(f.config);await picker.choose();
  f.browser.localStorage.setItem(RESULT_PREFIX+'test-random-state',JSON.stringify({
    status:'success',appName:'fn-dit',method:'pickSharedFile',state:'test-random-state',path:['/vol1/1000/Recovered']}));
  assert.equal(await picker.refreshResult(),true);assert.deepEqual(f.choices,['/vol1/1000/Recovered']);
  assert.equal(await picker.refreshResult(),false);
});
test('popup close cancels without changing the old destination',async()=>{
  const {createDirectoryPicker}=await loaded;const f=fixture({standalone:true});
  await createDirectoryPicker(f.config).choose();f.popup.closed=true;await f.browser.poll();
  assert.equal(f.busy,false);assert.deepEqual(f.choices,[]);
});
test('expired or unrelated authorization callbacks cannot change settings',async()=>{
  const {matchesRequest,MAX_AGE}=await loaded;const pending={state:'a',createdAt:100};
  const result={state:'a',appName:'fn-dit',method:'pickSharedFile',status:'success'};
  assert.equal(matchesRequest(result,pending,101),true);
  assert.equal(matchesRequest(result,pending,100+MAX_AGE),false);
  assert.equal(matchesRequest({...result,appName:'other'},pending,101),false);
  assert.equal(matchesRequest({...result,method:'pickUserFile'},pending,101),false);
});
test('source picker opens external storage and cannot replace the archive target',async()=>{
  const {createDirectoryPicker}=await loaded;
  const f=fixture({result:{code:0,data:['/vol00/SD_Card_Reader']}});
  const selected=[];f.config.onSelect=(value,purpose)=>selected.push({value,purpose});
  await createDirectoryPicker(f.config).choose('source');
  assert.deepEqual(f.events[0][1].sidebarGroup,['external']);
  assert.deepEqual(selected,[{value:'/vol00/SD_Card_Reader',purpose:'source'}]);
});
test('standalone source callback retains its source purpose',async()=>{
  const {createDirectoryPicker,RESULT_PREFIX}=await loaded;const f=fixture({standalone:true});
  const selected=[];f.config.onSelect=(value,purpose)=>selected.push({value,purpose});
  const picker=createDirectoryPicker(f.config);await picker.choose('source');
  f.browser.localStorage.setItem(RESULT_PREFIX+'test-random-state',JSON.stringify({
    status:'success',appName:'fn-dit',method:'pickSharedFile',state:'test-random-state',path:['/vol00/SD_Card_Reader/DCIM']}));
  await picker.refreshResult();
  assert.deepEqual(selected,[{value:'/vol00/SD_Card_Reader/DCIM',purpose:'source'}]);
});
