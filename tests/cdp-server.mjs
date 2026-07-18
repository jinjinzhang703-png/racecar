// CDP 服务器模式联机测试: serve.mjs (HTTP+WS中继) + 双浏览器自动连接
// 用法: node tests/cdp-server.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WS_PORT = 8123;
const PAGE_URL = `http://127.0.0.1:${WS_PORT}/racing-game.html`;

// ---------- 启动 serve.mjs ----------
const srv = spawn(process.execPath, [path.join(ROOT, 'serve.mjs'), String(WS_PORT)], { stdio:['ignore','pipe','pipe'] });
srv.stderr.on('data', d=>process.stderr.write('[serve] '+d));
await new Promise(r=>setTimeout(r, 800));

// ---------- Chrome 实例 ----------
const instances = [];
let profileSeq = 0;
async function launchChrome(){
  const proc = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', '--no-first-run',
    '--user-data-dir=' + path.join(ROOT, 'tests', '.chrome-srv' + (profileSeq++)),
    '--use-angle=swiftshader', '--mute-audio', '--window-size=800,600',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank',
  ]);
  const uri = await new Promise((res, rej)=>{
    let buf='';
    proc.stderr.on('data', d=>{ buf+=d; const m=buf.match(/DevTools listening on (ws:\/\/\S+)/); if(m) res(m[1]); });
    setTimeout(()=>rej(new Error('devtools timeout')), 15000);
  });
  const i = { proc, port: new URL(uri).port };
  instances.push(i);
  return i;
}

let msgId = 0;
async function newTab(){
  const inst = await launchChrome();
  const t = await (await fetch(`http://127.0.0.1:${inst.port}/json/new?about:blank`, { method:'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  const pending = new Map();
  ws.onmessage = ev=>{ const m=JSON.parse(ev.data); if(m.id&&pending.has(m.id)){ pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise(r=>ws.onopen=r);
  const send = (method, params={})=>new Promise(r=>{ const id=++msgId; pending.set(id,r); ws.send(JSON.stringify({id,method,params})); });
  await send('Runtime.enable');
  return {
    send,
    async eval(expression){
      const r = await send('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true });
      if(r.result.exceptionDetails) throw new Error('页面JS异常: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
      return r.result.result.value;
    },
    async nav(url){ await send('Page.navigate', { url }); },
  };
}
const sleep = ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(tab, expr, timeout=15000, label=expr){
  const t0 = Date.now();
  while(Date.now()-t0 < timeout){
    try{ if(await tab.eval(expr)) return true; }catch{}
    await sleep(300);
  }
  throw new Error('等待超时: ' + label);
}
let failures = 0;
function check(name, ok, extra=''){
  console.log((ok?'  PASS':'  FAIL') + ' | ' + name + (extra?' | '+extra:''));
  if(!ok) failures++;
}

try{
  console.log('[服务器模式联机 — 免邀请码]');
  const host = await newTab();
  const guest = await newTab();
  await host.nav(PAGE_URL); await guest.nav(PAGE_URL);
  await waitFor(host, 'window.__gameOK===true', 20000, '房主页面加载');
  await waitFor(guest, 'window.__gameOK===true', 20000, '客人页面加载');

  await host.eval(`document.getElementById('hostBtn').click()`);
  await waitFor(host, `Net.serverMode===true`, 8000, '房主服务器模式');
  check('房主进入服务器模式', true);
  check('房主直接进大厅', await host.eval(`!document.getElementById('lobbyScreen').classList.contains('hidden') && document.getElementById('lobbyMain').style.display==='block'`));
  check('服务器模式隐藏邀请码区', await host.eval(`document.getElementById('inviteSection').style.display==='none'`));

  await guest.eval(`document.getElementById('joinBtn').click()`);
  await waitFor(guest, `Net.serverMode===true`, 8000, '客人服务器模式');
  check('客人进入服务器模式', true);
  await waitFor(guest, `document.getElementById('lobbyMain').style.display==='block'`, 8000, '客人直进大厅');
  check('客人免邀请码直进大厅', true);
  await waitFor(host, `document.querySelectorAll('#lobbyPlayers .player-row').length===2`, 8000, '房主看到2人');
  check('房主玩家列表=2', true);
  await waitFor(guest, `document.querySelectorAll('#lobbyPlayers .player-row').length===2`, 8000, '客人看到2人');
  check('客人玩家列表=2', true);

  await guest.eval(`document.getElementById('readyBtn').click()`);
  await waitFor(host, `!document.getElementById('hostStartBtn').disabled`, 8000, 'START解锁');
  check('全员READY后房主可开赛', true);

  await host.eval(`document.querySelector('#lobbyLapsRow [data-laps="3"]').click()`);
  await host.eval(`document.getElementById('hostStartBtn').click()`);
  await waitFor(host, `race.phase==='grid'`, 8000, '房主grid');
  await waitFor(guest, `race.phase==='grid'`, 8000, '客人grid');
  check('双端同步进入发车格', true);
  check('房主端远程车存在', await host.eval(`cars.some(c=>c.isRemote)`));
  check('客人端远程车存在', await guest.eval(`cars.some(c=>c.isRemote)`));

  await waitFor(host, `race.phase==='racing'`, 240000, '房主起跑');
  await waitFor(guest, `race.phase==='racing'`, 240000, '客人起跑');
  check('双端同步起跑', true);

  await guest.eval(`input.acc=true`);
  await sleep(2500);
  await guest.eval(`input.acc=false`);
  const guestSpeed = await guest.eval(`player.speed`);
  await waitFor(host, `cars.find(c=>c.isRemote) && cars.find(c=>c.isRemote).speed > 1`, 30000, '房主看到客人车动');
  check('客人本地车已加速', guestSpeed > 3, 'speed='+guestSpeed?.toFixed(1));
  check('房主端客人车速度同步 (服务器中继)', true, 'remote='+await host.eval(`cars.find(c=>c.isRemote).speed.toFixed(1)`));
  check('客人端收到房主AI广播', await guest.eval(`cars.filter(c=>c._netKey&&c._netKey.startsWith('ai')).some(c=>c._netNext)`));

  console.log(failures===0 ? '\n全部通过' : `\n${failures} 项失败`);
}catch(e){
  console.error('测试执行异常:', e.message);
  failures++;
}finally{
  for(const i of instances) i.proc.kill();
  srv.kill();
  process.exit(failures===0?0:1);
}
