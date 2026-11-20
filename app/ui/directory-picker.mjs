// Native fnOS picker; no NAS filesystem enumeration or editable path fallback.
export const PENDING_KEY='fn-dit:folder-request';
export const RESULT_PREFIX='fn-dit:folder-result:';
export const RESULT_TYPE='fn-dit:folder-selection';
export const MAX_AGE=10*60*1000;
const groups=['myFiles','team','storage','favorites'];

export function matchesRequest(result,pending,now=Date.now()) {
  return Boolean(pending && now>=pending.createdAt && now-pending.createdAt<MAX_AGE &&
    result?.state===pending.state && result.appName==='fn-dit' && result.method==='pickSharedFile' &&
    ['success','cancel','error'].includes(result.status));
}

export function singleFolder(paths,purpose='destination') {
  const allowed=purpose==='source'?/^\/(vol0\d+|media|run\/media|mnt\/usb)(\/|$)/:/^\/vol[1-9]\d*\/.+/;
  if(!Array.isArray(paths)||paths.length!==1||typeof paths[0]!=='string'||!allowed.test(paths[0])||paths[0].includes('\0')) {
    throw new Error(purpose==='source'?'请在外接存储中选择存储卡根目录或 DCIM 文件夹。':'请选择一个 NAS 内部文件夹作为归档目标。');
  }
  return paths[0];
}

export function createDirectoryPicker({sdk,verify,onSelect,onNotice,onBusy=()=>{},browser=window}) {
  let busy=false, pending=null, popup=null, watcher=null, finishing=false;
  const session=browser.sessionStorage, local=browser.localStorage;
  try { pending=JSON.parse(session.getItem(PENDING_KEY)); } catch { /* no pending popup */ }

  function setBusy(value) {busy=value;onBusy(value);}
  function finish() {
    if(pending) {local.removeItem(RESULT_PREFIX+pending.state);session.removeItem(PENDING_KEY);}
    pending=null;popup=null;finishing=false;
    browser.clearInterval(watcher);watcher=null;setBusy(false);
  }
  async function select(paths,purpose='destination') {
    const path=singleFolder(paths,purpose);
    const checked=await verify(path,purpose);
    onSelect(checked,purpose);
    onNotice(purpose==='source'?'存储卡已添加并通过读取检查，可以点击「立即扫描一次」。':'已选择归档文件夹，请点击「保存配置」。');
  }
  async function accept(result) {
    if(finishing||!matchesRequest(result,pending)) return false;
    finishing=true;
    try {
      if(result.status==='success') await select(result.path,pending.purpose||'destination');
      else if(result.status==='cancel') onNotice('已取消选择，原有配置保持不变。');
      else throw new Error('目录授权未完成，请使用 NAS 管理员账户重新选择。');
    } catch(error) {onNotice(error.message,true);}
    finally {finish();}
    return true;
  }
  async function refreshResult() {
    if(!pending) return false;
    let result;
    try {result=JSON.parse(local.getItem(RESULT_PREFIX+pending.state));} catch {return false;}
    return accept(result);
  }
  function watch() {
    watcher=browser.setInterval(async()=>{
      if(finishing||!pending) return;
      if(await refreshResult()) return;
      if(!pending) return;
      if(Date.now()-pending.createdAt>=MAX_AGE || popup?.closed) {
        onNotice(popup?.closed?'已关闭选择窗口，原有配置保持不变。':'选择已超时，请重新选择文件夹。');
        finish();
      }
    },500);
  }
  browser.addEventListener('message',event=>{
    if(event.origin!==browser.location.origin||!popup||event.source!==popup||event.data?.type!==RESULT_TYPE) return;
    void accept(event.data.result);
  });
  browser.addEventListener('storage',event=>{
    if(pending&&event.key===RESULT_PREFIX+pending.state) void refreshResult();
  });
  browser.addEventListener('focus',()=>{void refreshResult();});

  return {
    async ready() {
      let timer;
      try {
        await Promise.race([sdk.ready(),new Promise((_,reject)=>{
          timer=browser.setTimeout(()=>reject(new Error('连接目录选择器超时，请从飞牛客户端重新打开应用。')),10000);
        })]);
      } finally {browser.clearTimeout(timer);}
      if(pending) {setBusy(true);watch();await refreshResult();}
    },
    async choose(purpose='destination') {
      if(busy) return;
      setBusy(true);
      try {
        if(!sdk.isStandaloneWeb) {
          const result=await sdk.pickSharedFile({title:purpose==='source'?'选择相机存储卡':'选择归档目标文件夹',okText:'选择并授权',multiple:false,sidebarGroup:purpose==='source'?['external']:groups});
          if(result==null||(result.code===0&&Array.isArray(result.data)&&result.data.length===0)) {
            onNotice('已取消选择，原有配置保持不变。');
          } else {
            if(result.code!==0) throw new Error(result.msg||'目录授权失败，请使用 NAS 管理员账户重新选择。');
            await select(result.data,purpose);
          }
          setBusy(false);
          return;
        }
        // Open synchronously during the click, before the SDK builds its URL.
        pending={state:browser.crypto.randomUUID(),createdAt:Date.now(),purpose};
        session.setItem(PENDING_KEY,JSON.stringify(pending));
        popup=browser.open('','_blank','width=800,height=680');
        if(!popup) throw new Error('浏览器拦截了选择窗口，请允许弹窗后重试。');
        const url=await sdk.buildAppAuthUrl('pickSharedFile',{
          appName:'fn-dit',sidebarGroup:purpose==='source'?['external']:groups,
          redirectUri:'/app/fn-dit/folder-callback.html',state:pending.state
        });
        popup.location.replace(url);
        onNotice('请在飞牛弹窗中逐层选择文件夹并确认授权。');
        watch();
      } catch(error) {
        popup?.close();
        onNotice(error.message||'无法打开目录选择器，请从飞牛客户端重新打开应用。',true);
        finish();
      }
    },
    refreshResult
  };
}
