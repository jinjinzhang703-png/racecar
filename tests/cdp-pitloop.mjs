// CDP 测试: pit 小游戏防卡死 (重复触发/ESC取消/点击字母)
// 用法: node tests/cdp-pitloop.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'racecar');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIME = { '.html':'text/html', '.js':'text/javascript' };

const server = http.createServer(async (req, res)=>{
  try{
    const p = path.join(ROOT, req.url === '/' ? 'racing-game.html' : decodeURIComponent(req.url));
    const data = await readFile(p);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control':'no-cache' });
    res.end(data);
  }catch{ if(!res.headersSent) res.writeHead(404); res.end(); }
});
await new Promise(r=>server.listen(0, '127.0.0.1', r));
const PAGE_URL = `http://127.0.0.1:${server.address().port}/racing-game.html`;

const proc = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0', '--no-first-run',
  '--user-data-dir=' + path.join(ROOT, '..', 'tests', '.chrome-pl'),
  '--use-angle=swiftshader', '--mute-audio', '--window-size=800,600',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank',
]);
const wsUri = await new Promise((res, rej)=>{
  let buf='';
  proc.stderr.on('data', d=>{ buf+=d; const m=buf.match(/DevTools listening on (ws:\/\/\S+)/); if(m) res(m[1]); });
  setTimeout(()=>rej(new Error('devtools timeout')), 15000);
});
const PORT = new URL(wsUri).port;
let msgId = 0;
const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method:'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
const pending = new Map();
ws.onmessage = ev=>{ const m=JSON.parse(ev.data); if(m.id&&pending.has(m.id)){ pending.get(m.id)(m); pending.delete(m.id); } };
await new Promise(r=>ws.onopen=r);
const send = (method, params={})=>new Promise(r=>{ const id=++msgId; pending.set(id,r); ws.send(JSON.stringify({id,method,params})); });
async function evalJs(expression){
  const r = await send('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true });
  if(r.result.exceptionDetails) throw new Error('JS异常: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
  return r.result.result.value;
}
const sleep = ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(expr, timeout=30000, label=expr){
  const t0 = Date.now();
  while(Date.now()-t0 < timeout){
    try{ if(await evalJs(expr)) return; }catch{}
    await sleep(300);
  }
  throw new Error('等待超时: ' + label);
}
let failures = 0;
function check(name, ok, extra=''){
  console.log((ok?'  PASS':'  FAIL') + ' | ' + name + (extra?' | '+extra:''));
  if(!ok) failures++;
}
async function putInLane(tire){
  await evalJs(`(()=>{
    player.pos.set(-320, 0, 318); player.heading = Math.PI/2;
    player.speed = 0; player.velocity.set(0,0,0);
    player.tire = ${tire}; player.pitTimer = 0; player.inReverse = false;
    pitGame.active = false; player._pitServedThisEntry = false;
    return true;
  })()`);
}

try{
  await send('Page.navigate', { url: PAGE_URL });
  await waitFor('window.__gameOK===true');
  await evalJs(`document.body.click(); 'ok'`);
  await evalJs(`document.getElementById('startBtn').click();document.getElementById('toGarageBtn').click();document.getElementById('confirmCarBtn').click();'ok'`);
  await waitFor(`race.phase==='grid'`, 10000, 'grid');
  await evalJs(`race.phase='racing'; 'ok'`);

  console.log('[1] 完成换胎后不再原地重复触发 (死循环修复)');
  await putInLane(50);
  await waitFor(`pitGame.active===true`, 15000, '首次触发');
  check('轮胎磨损进站触发小游戏', true);
  // 点击字母完成 (模拟鼠标点击)
  for(let i=0;i<3;i++){
    await evalJs(`document.querySelector('#pitGameLetters .pit-letter.current')?.click(); 'ok'`);
    await sleep(200);
  }
  await waitFor(`pitGame.active===false`, 10000, '点击完成');
  check('点击字母可完成换胎', true);
  check('换胎后 tire=100', await evalJs(`player.tire===100`));
  // 原地等待 8 秒, 不应再次触发
  await sleep(8000);
  check('停在原地不再重复触发', await evalJs(`pitGame.active===false`));

  console.log('[2] ESC 取消不卡死');
  await evalJs(`player.tire=50; player._pitServedThisEntry=false; 'ok'`);
  await waitFor(`pitGame.active===true`, 15000, '再次触发');
  check('换新入场再次触发', true);
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape'})); 'ok'`);
  await sleep(400);
  check('ESC 取消小游戏', await evalJs(`pitGame.active===false`));
  check('面板已隐藏', await evalJs(`document.getElementById('pitGamePanel').style.display==='none'`));
  // ESC 后同一入场不应立刻再触发 (本次已服务)
  await sleep(3000);
  check('取消后本次入场不纠缠', await evalJs(`pitGame.active===false`));
  // 可以开车走 (不卡死)
  await evalJs(`input.acc=true; 'ok'`);
  await waitFor(`Math.abs(player.speed) > 3`, 15000, '取消后可驶离');
  check('取消后车辆可正常行驶 (无卡死)', true);
  await evalJs(`input.acc=false; 'ok'`);

  console.log('[3] 满胎进站不触发 (无意义进站)');
  await evalJs(`(()=>{
    player.pos.set(-320, 0, 318); player.speed=0; player.velocity.set(0,0,0);
    player.tire=100; player._pitServedThisEntry=false; return true;
  })()`);
  await sleep(4000);
  check('满胎停车不触发小游戏', await evalJs(`pitGame.active===false`));

  check('全程无 JS 错误覆盖层', await evalJs(`!document.querySelector('div[style*="z-index:9999"]')`));
  console.log(failures===0 ? '\n全部通过' : `\n${failures} 项失败`);
}catch(e){
  console.error('测试执行异常:', e.message);
  failures++;
}finally{
  proc.kill();
  server.close();
  process.exit(failures===0?0:1);
}
