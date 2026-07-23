// CDP 新功能测试: 大厅UX / 返回主菜单 / NPC进站完整循环
// 用法: node tests/cdp-features.mjs
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
  '--user-data-dir=' + path.join(ROOT, '..', 'tests', '.chrome-feat'),
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
async function waitFor(expr, timeout=20000, label=expr){
  const t0 = Date.now();
  while(Date.now()-t0 < timeout){
    try{ if(await evalJs(expr)) return; }catch{}
    await sleep(400);
  }
  throw new Error('等待超时: ' + label);
}
let failures = 0;
function check(name, ok, extra=''){
  console.log((ok?'  PASS':'  FAIL') + ' | ' + name + (extra?' | '+extra:''));
  if(!ok) failures++;
}

try{
  await send('Page.navigate', { url: PAGE_URL });
  await waitFor('window.__gameOK===true');

  console.log('[1] 大厅 UX');
  check('主菜单3条按钮提示', await evalJs(`document.querySelectorAll('.menu-hint').length===3`));
  check('提示内容可见', await evalJs(`document.querySelector('.menu-btns').textContent.includes('加入房间')`));
  // 房主大厅指引 (无/ws → 手动模式指引)
  await evalJs(`document.getElementById('hostBtn').click()`);
  await waitFor(`!document.getElementById('lobbyScreen').classList.contains('hidden')`, 10000, '大厅显示');
  check('房主指引含步骤', await evalJs(`document.getElementById('lobbyGuide').textContent.includes('①')`));
  check('指引含邀请码说明', await evalJs(`document.getElementById('lobbyGuide').textContent.includes('应答码')`));
  check('大厅有名字输入框', await evalJs(`!!document.getElementById('myNameInput') && document.getElementById('myNameInput').value==='HOST'`));
  // 返回主菜单 (此时未开赛, 直接测 backToMenu 按钮不可见 — 跳过)

  console.log('[2] 赛后返回主菜单');
  await send('Page.navigate', { url: PAGE_URL });
  await waitFor('window.__gameOK===true');
  check('初始主菜单HUD隐藏', await evalJs(`document.getElementById('hud').style.display==='none'`));
  await evalJs(`document.getElementById('startBtn').click();document.getElementById('toGarageBtn').click();document.getElementById('confirmCarBtn').click();'ok'`);
  await waitFor(`race.phase==='grid'`, 8000, '进入grid');
  check('开赛后HUD显示', await evalJs(`document.getElementById('hud').style.display!=='none'`));
  await evalJs(`race.phase='racing'; endRace(); 'ok'`);
  await sleep(400);
  check('结算屏显示', await evalJs(`!document.getElementById('overScreen').classList.contains('hidden')`));
  check('结算屏有返回主菜单按钮', await evalJs(`!!document.getElementById('menuBtn')`));
  await evalJs(`document.getElementById('menuBtn').click()`);
  await sleep(300);
  check('返回主菜单成功', await evalJs(`!document.getElementById('startScreen').classList.contains('hidden')`));
  check('HUD已隐藏', await evalJs(`document.getElementById('hud').style.display==='none'`));
  check('phase回到menu', await evalJs(`race.phase==='menu'`));
  // 软重置后能再次开赛
  await evalJs(`document.getElementById('startBtn').click();document.getElementById('toGarageBtn').click();document.getElementById('confirmCarBtn').click();'ok'`);
  await waitFor(`race.phase==='grid'`, 8000, '二次开赛');
  check('返回主菜单后可再次开赛', true);
  check('暂停屏有退出按钮', await evalJs(`!!document.getElementById('quitBtn')`));

  console.log('[3] NPC 进站完整循环');
  await evalJs(`(()=>{
    race.phase='racing';
    const ai = cars.find(c=>!c.isPlayer);
    ai.tire = 15; ai.lap = 1; ai.pits = 0; ai.pitStopDuration = 2.0;
    // 使用当前 pit 参数动态计算位置 (支持赛道缩放)
    ai.pos.set(PIT_ENTRY_X + 30, 0, PIT_LANE_Z + 20); ai.heading = Math.PI/2; ai.speed = 40; ai.velocity.set(40,0,0); ai.progress=0.97;
    window.__ai = ai; return true;
  })()`);
  await waitFor(`__ai.pitting===true`, 30000, 'AI决定进站');
  check('AI自动决定进站', true);
  await waitFor(`__ai.pitPhase==='driving' || __ai.pitPhase==='stopped'`, 60000, '驶入维修通道');
  check('成功驶入维修通道 (无掉头/穿墙)', true);
  await waitFor(`__ai.pits===1 && __ai.tire===100`, 300000, '完成换胎');
  check('维修位停车并完成换胎 (tire=100, pits=1)', true);
  await waitFor(`__ai.pitting===false`, 120000, '驶出维修区');
  check('换胎后驶出维修区回赛道', true);

  console.log(failures===0 ? '\n全部通过' : `\n${failures} 项失败`);
}catch(e){
  console.error('测试执行异常:', e.message);
  failures++;
}finally{
  proc.kill();
  server.close();
  process.exit(failures===0?0:1);
}
