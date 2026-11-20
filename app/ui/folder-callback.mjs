import {TrimApp} from './vendor/trim-web-app.mjs';
import {PENDING_KEY,RESULT_PREFIX,RESULT_TYPE,matchesRequest} from './directory-picker.mjs';

document.getElementById('close-callback').addEventListener('click',()=>window.close());
try {
  const sdk=new TrimApp();
  sdk.ready().catch(()=>{}); // Parsing the documented callback does not require a host bridge.
  const result=sdk.parseAppAuthCallback(window.location.href);
  const pending=JSON.parse(sessionStorage.getItem(PENDING_KEY));
  if(!matchesRequest(result,pending)) throw new Error('此选择已失效，请回到飞牛 DIT 重新选择文件夹。');
  // Also supports clients that remove window.opener when opening an auth tab.
  localStorage.setItem(RESULT_PREFIX+pending.state,JSON.stringify(result));
  sessionStorage.removeItem(PENDING_KEY);
  if(window.opener&&!window.opener.closed) {
    window.opener.postMessage({type:RESULT_TYPE,result},window.location.origin);
  }
  document.getElementById('callback-title').textContent=result.status==='success'?'已完成目录选择':'目录选择未完成';
  document.getElementById('callback-message').textContent='请回到飞牛 DIT 查看选择结果并保存配置。此窗口可以关闭。';
} catch(error) {
  document.getElementById('callback-title').textContent='无法接收选择结果';
  document.getElementById('callback-message').textContent=error.message;
}
