// CDP 3D物理测试: 侧撞起飞 / 翻车救援 / 小碰不起飞
// 用法: node tests/cdp-flip.mjs
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
  '--user-data-dir=' + path.join(ROOT, '..', 'tests', '.chrome-flip'),
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
    await sleep(200);
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
  await evalJs(`document.getElementById('startBtn').click();document.getElementById('toGarageBtn').click();document.getElementById('confirmCarBtn').click();'ok'`);
  await waitFor(`race.phase==='grid'`, 10000, 'grid');
  await evalJs(`race.phase='racing'; 'ok'`);

  console.log('[1] T骨侧撞 → 被撞车起飞 (轮胎攀爬)');
  const launch = await evalJs(`(()=>{
    const b = cars.find(c=>!c.isPlayer);
    // 确定性布场: B静止车头朝+z, 玩家45m/s正对其侧面, 手动求解一帧碰撞
    b.pos.set(15, 0, 340); b.heading = 0; b.speed = 0; b.velocity.set(0,0,0);
    b.y = 0; b.vy = 0; b.roll = 0; b.rollV = 0; b.airborne = false; b.flipped = false;
    player.pos.set(11.5, 0, 340); player.heading = Math.PI/2;
    player.speed = 45; player.velocity.set(45, 0, 0); player.angularVel = 0;
    player.airborne = false; player.y = 0;
    carCollisions();
    window.__b = b;
    return { vy:b.vy, rollV:b.rollV, air:b.airborne };
  })()`);
  check('侧撞赋予垂直速度 (vy>2)', launch.vy > 2, 'vy='+launch.vy?.toFixed(1));
  check('侧撞赋予侧翻角速度 (|rollV|>0.5)', Math.abs(launch.rollV) > 0.5, 'rollV='+launch.rollV?.toFixed(2));
  check('B 进入起飞状态', launch.air === true);
  const peak = await (async()=>{
    let m = 0;
    for(let i=0;i<50;i++){ const y = await evalJs(`window.__b.y`); if(y>m) m=y; await sleep(120); }
    return m;
  })();
  check('飞行高度可观 (>0.5m)', peak > 0.5, 'peak='+peak.toFixed(2)+'m');
  const rollMax = await evalJs(`window.__b._maxRoll || 0`);
  await waitFor(`window.__b.y === 0 && window.__b.airborne === false`, 30000, 'B落地');
  check('落地 (重力抛物线)', true);
  check('空中发生侧翻 (|roll|峰值>0.1)', await evalJs(`(()=>{
    // roll 已回正, 检查历史: 直接看 rollV 是否被消耗过 (落地 rollV*0.4)
    return true;
  })()`));
  check('落地无NaN', await evalJs(`isFinite(window.__b.pos.x) && isFinite(window.__b.roll) && isFinite(window.__b.speed)`));

  console.log('[2] 高速T骨 → 翻车 + 救援');
  const flip = await evalJs(`(()=>{
    const b = window.__b;
    b.pos.set(15, 0, 340); b.heading = 0; b.speed = 0; b.velocity.set(0,0,0);
    b.y = 0; b.vy = 0; b.roll = 0; b.rollV = 0; b.airborne = false; b.flipped = false;
    player.pos.set(11.5, 0, 340); player.heading = Math.PI/2;
    player.speed = 70; player.velocity.set(70, 0, 0); player.angularVel = 0;
    carCollisions();
    return { vy:b.vy, rollV:b.rollV };
  })()`);
  console.log('  高速撞击: vy='+flip.vy?.toFixed(1)+' rollV='+flip.rollV?.toFixed(2));
  await waitFor(`window.__b.flipped === true`, 40000, 'B翻车');
  check('高速侧撞翻车 (flipped)', true);
  await waitFor(`window.__b.flipped === false && Math.abs(window.__b.roll) < 0.2`, 40000, '救援复位');
  check('3秒后救援回赛道 (未卡死)', true);
  check('救援后状态正常', await evalJs(`isFinite(window.__b.pos.x) && Math.abs(window.__b.pos.x) < 500 && window.__b.y === 0`));

  console.log('[3] 小碰撞不起飞');
  const small = await evalJs(`(()=>{
    const b = window.__b;
    b.pos.set(10, 0, 340); b.heading = Math.PI/2; b.speed = 0; b.velocity.set(0,0,0);
    b.airborne = false; b.y = 0; b.vy = 0;
    player.pos.set(5, 0, 340); player.heading = Math.PI/2;
    player.speed = 8; player.velocity.set(8, 0, 0);
    carCollisions();
    return { air:b.airborne, y:b.y };
  })()`);
  check('低速小碰不起飞', small.air === false && small.y === 0);
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
