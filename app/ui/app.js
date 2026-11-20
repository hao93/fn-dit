(() => {
  'use strict';
  const base='/app/fn-dit';
  const el=(id)=>document.getElementById(id);
  let initialized=false, editing=false;
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
    el('destination').value=c.destination;
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
      container.innerHTML='<div class="empty"><div class="empty-icon">▤</div><strong>等待插入存储卡</strong><p>可识别含 DCIM 目录的 USB / SD 卡</p></div>';
      return;
    }
    for(const source of sources) {
      const device=document.createElement('div');device.className='device';
      const title=document.createElement('strong');title.textContent='▣  '+source.path.split('/').filter(Boolean).at(-1);
      const detail=document.createElement('small');detail.textContent=`${source.origin} · ${source.path}`;
      device.append(title,detail);container.append(device);
    }
  }
  function render(result) {
    if(!initialized || !editing) {populate(result.config); initialized=true;}
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
    const logs=el('logs');logs.replaceChildren();
    for(const line of result.logs||[]) {const div=document.createElement('div');div.textContent=line;logs.append(div);}
    if(!logs.children.length) logs.textContent='尚无导入日志。';
  }
  async function refresh() {try {render(await request('/api/status'));}catch(error){el('status-label').textContent='服务不可用';setNotice(error.message,true);}}
  document.querySelectorAll('.settings input,.settings select,.settings textarea').forEach(field=>field.addEventListener('input',()=>{editing=true;}));
  el('save').addEventListener('click',async()=>{try{const result=await request('/api/settings','POST',settings());editing=false;populate(result.config);setNotice('设置已保存。建议先点击「立即扫描一次」测试。');await refresh();}catch(error){setNotice(error.message,true);}});
  el('run').addEventListener('click',async()=>{try{await request('/api/import-now','POST');setNotice('已请求扫描，请查看右侧状态和运行日志。');setTimeout(refresh,400);}catch(error){setNotice(error.message,true);}});
  el('refresh').addEventListener('click',async()=>{await refresh();try{const m=await request('/api/mounts');showSources(m.sources||[]);}catch(error){setNotice(error.message,true);}});
  refresh();setInterval(refresh,2500);
})();
