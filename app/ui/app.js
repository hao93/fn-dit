(() => {
  'use strict';
  const base='/app/fn-dit';
  const el=(id)=>document.getElementById(id);
  let editing=false;
  let picker;
  function showDestination(value) {
    el('destination').value=value||'';
    el('destination-name').textContent=value?value.split('/').filter(Boolean).at(-1):'尚未选择归档文件夹';
    el('destination-path').textContent=value||'在飞牛目录中逐层选择，无需填写路径';
    el('choose-destination').textContent=value?'更换文件夹':'选择文件夹';
  }
  async function request(endpoint,method='GET',data) {
    const options={method,headers:{'x-dit-request':'1'}};
    if(data!==undefined) {options.headers['content-type']='application/json';options.body=JSON.stringify(data);}
    const response=await fetch(base+endpoint,options);
    const json=await response.json();
    if(!response.ok) throw new Error(json.error||`HTTP ${response.status}`);
    return json;
  }
  function setNotice(message,error=false) {
    el('message').textContent=message;
    el('message').className='message'+(error?' error':'');
  }
  function populate(c) {
    el('enabled').checked=c.enabled;
    showDestination(c.destination);
    el('sources').value=(c.sourceRoots||[]).join('\n');
    el('auto-discover').checked=c.autoDiscover;
    el('interval').value=c.intervalSeconds;
    el('settle').value=c.settleSeconds;
    el('timezone').value=c.timezone;
    el('folder-mode').value=c.folderMode;
  }
  function settings() {
    return {
      enabled:el('enabled').checked,
      destination:el('destination').value.trim(),
      sourceRoots:el('sources').value.split('\n').map(s=>s.trim()).filter(Boolean),
      autoDiscover:el('auto-discover').checked,
      intervalSeconds:Number(el('interval').value),
      settleSeconds:Number(el('settle').value),
      timezone:el('timezone').value.trim(),
      folderMode:el('folder-mode').value
    };
  }
  function showSources(sources) {
    const container=el('devices');
    container.replaceChildren();
    if(!sources.length) {
      container.innerHTML='<div class="empty"><div class="empty-icon">▤</div><strong>尚未发现可读取的存储卡</strong><p>可点击「选择存储卡」，选择 SD_Card_Reader 或 DCIM 并授权。</p></div>';
      return;
    }
    for(const source of sources) {
      const device=document.createElement('div');device.className='device';
      if(source.state&&source.state!=='ready') device.classList.add('device-warning');
      const title=document.createElement('strong');title.textContent='▣  '+source.path.split('/').filter(Boolean).at(-1);
      const detail=document.createElement('small');detail.textContent=`${source.origin} · ${source.path}`;
      device.append(title,detail);container.append(device);
      if(source.message) {const message=document.createElement('span');message.className='device-detail';message.textContent=source.message;device.append(message);}
    }
  }
  function render(result) {
    if(!editing) populate(result.config);
    const s=result.status;
    el('count-imported').textContent=s.lastSummary.imported;
    el('count-duplicate').textContent=s.lastSummary.duplicate;
    el('count-pending').textContent=s.lastSummary.pending;
    el('count-failed').textContent=s.lastSummary.failed;
    el('status-label').textContent=s.busy?'正在导入':result.config.enabled?'自动导入已开启':'自动导入未开启';
    el('pill').textContent=s.busy?'正在处理':s.lastError?'执行异常':'待机';
    el('pill').className='pill'+(s.busy?' running':'');
    el('progress').className='progress-inner'+(s.busy?' running':'');
    el('current').textContent=s.current||s.lastError||'暂无任务';
    el('last-run').textContent=s.lastRun?new Date(s.lastRun).toLocaleString('zh-CN'):'尚未扫描';
    showSources(s.devices||[]);
    el('device-message').textContent=s.deviceMessage||'';
    const logs=el('logs');logs.replaceChildren();
    for(const line of result.logs||[]) {const div=document.createElement('div');div.textContent=line;logs.append(div);}
    if(!logs.children.length) logs.textContent='尚无导入日志。';
  }
  async function refresh() {try {render(await request('/api/status'));}catch(error){el('status-label').textContent='服务不可用';setNotice(error.message,true);}}
  async function initPicker() {
    try {
      const [{TrimApp},{createDirectoryPicker}]=await Promise.all([
        import(base+'/vendor/trim-web-app.mjs'),import(base+'/directory-picker.mjs')
      ]);
      const sdk=new TrimApp();
      picker=createDirectoryPicker({sdk,
        verify:async(value,purpose)=>{
          if(purpose==='source') {
            const result=await request('/api/source/add','POST',{source:value});
            showSources(result.devices||[]);el('device-message').textContent=result.message;
            return result.source;
          }
          return (await request('/api/destination/check','POST',{destination:value})).destination;
        },
        onSelect:(value,purpose)=>{
          editing=true;
          if(purpose==='source') {
            const sources=new Set(el('sources').value.split('\n').map(v=>v.trim()).filter(Boolean));
            sources.add(value);el('sources').value=[...sources].join('\n');
          } else showDestination(value);
        },
        onNotice:setNotice,
        onBusy:(busy)=>{
          if(busy) editing=true;
          el('choose-destination').disabled=busy;
          el('choose-source').disabled=busy;
          el('save').disabled=busy;
          el('refresh-selection').hidden=!(busy&&sdk.isStandaloneWeb);
        }
      });
      await picker.ready();
      // ready() may have resumed a pending authorization tab.
      if(el('refresh-selection').hidden) {el('choose-destination').disabled=false;el('choose-source').disabled=false;}
    } catch(error) {
      el('choose-destination').disabled=true;
      el('choose-source').disabled=true;
      setNotice(error.message||'目录选择器连接失败，请从飞牛客户端重新打开应用。',true);
    }
  }
  el('choose-destination').addEventListener('click',()=>{void picker?.choose();});
  el('choose-source').addEventListener('click',()=>{void picker?.choose('source');});
  el('refresh-selection').addEventListener('click',async()=>{
    if(!await picker?.refreshResult()) setNotice('尚未收到选择结果，请先在飞牛弹窗中确认授权。');
  });
  document.querySelectorAll('.settings input,.settings select,.settings textarea').forEach(field=>field.addEventListener('input',()=>{editing=true;}));
  el('save').addEventListener('click',async()=>{try{const result=await request('/api/settings','POST',settings());editing=false;populate(result.config);setNotice('设置已保存。建议先点击「立即扫描一次」测试。');await refresh();}catch(error){setNotice(error.message,true);}});
  el('run').addEventListener('click',async()=>{try{await request('/api/import-now','POST');setNotice('已请求扫描，请查看右侧状态和运行日志。');setTimeout(refresh,400);}catch(error){setNotice(error.message,true);}});
  el('refresh').addEventListener('click',async()=>{
    el('refresh').disabled=true;el('device-message').textContent='正在检查挂载设备与读取权限…';
    try {const report=await request('/api/mounts');showSources(report.devices||[]);el('device-message').textContent=report.message;}
    catch(error){el('device-message').textContent='检查失败：'+error.message;}
    finally{el('refresh').disabled=false;}
  });
  refresh();initPicker();setInterval(refresh,2500);
})();
