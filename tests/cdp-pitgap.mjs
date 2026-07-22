// CDP 测试: pit 入口驶入 / 倒车全场景 / updateWarnings 防护
// 用法: node tests/cdp-pitgap.mjs
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
  '--user-data-dir=' + path.join(ROOT, '..', 'tests', '.chrome-pg'),
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

try{
  await send('Page.navigate', { url: PAGE_URL });
  await waitFor('window.__gameOK===true');
  await evalJs(`document.getElementById('startBtn').click();document.getElementById('toGarageBtn').click();document.getElementById('confirmCarBtn').click();'ok'`);
  await waitFor(`race.phase==='grid'`, 10000, 'grid');
  await evalJs(`race.phase='racing'; 'ok'`);

  console.log('[1] Pit 入口真实存在 (可驶入)');
  // 玩家放到赛道 z=336, 朝北 (-z) 开向维修区入口
  await evalJs(`(()=>{
    player.pos.set(-340, 0, 336); player.heading = Math.PI; // 朝 -z
    player.speed = 15; player.velocity.set(0, 0, -15); player.angularVel = 0;
    player.collisionLock = 0; player.crashTimer = 0;
    input.acc = true; input.brake = false;
    return true;
  })()`);
  // 应能穿过围墙线 z≈331 进入通道 (z<326)
  await waitFor(`player.pos.z < 326`, 30000, '穿过pit入口');
  check('穿过入口进入维修通道 (无隐形墙)', true, 'z='+await evalJs(`player.pos.z.toFixed(1)`));
  check('进入通道判定 isInPitLane', await evalJs(`isInPitLane(player.pos)`));
  await evalJs(`input.acc=false; 'ok'`);

  console.log('[2] 停在维修区 → 自动换胎');
  await evalJs(`player.speed=0; player.velocity.set(0,0,0); player.tire=50; 'ok'`);
  await waitFor(`pitGame.active===true`, 15000, '自动触发换胎小游戏');
  check('停车自动触发换胎小游戏', true);
  // 完成小游戏 (按提示序列按键)
  await evalJs(`(()=>{
    for(const ch of pitGame.sequence) handlePitGameKey('Key'+ch);
    return true;
  })()`);
  await waitFor(`player.pitTimer > 0 || player.tire >= 100`, 15000, '换胎完成');
  check('小游戏完成进入换胎', true);
  check('换胎后轮胎恢复', await evalJs(`player.tire >= 99`), 'tire='+await evalJs(`Math.round(player.tire)`));
  // 驶出: 朝东开出
  await evalJs(`(()=>{
    player.pos.set(30, 0, 320); player.heading = Math.PI/2 + 0.4;
    player.speed = 15; player.velocity.set(15, 0, 0);
    input.acc = true; return true;
  })()`);
  await waitFor(`!isInPitLane(player.pos)`, 30000, '驶出维修区');
  check('从出口驶出维修区', true);
  await evalJs(`input.acc=false; 'ok'`);

  console.log('[3] 倒车全场景');
  // 3.1 基础倒车
  await evalJs(`(()=>{
    player.pos.set(205, 0, -70); player.heading = Math.PI/2;
    player.speed = 0; player.velocity.set(0,0,0); player.inReverse = false; player.reverseTimer = 0;
    input.brake = true; return true;
  })()`);
  await waitFor(`player.inReverse===true`, 20000, '基础进入倒车');
  check('静止长按进入倒车', true);
  check('HUD档位显示R', await evalJs(`document.getElementById('gear').textContent === 'R'`));
  await evalJs(`input.brake=false; input.acc=true; 'ok'`);
  await waitFor(`player.inReverse===false`, 15000, '退出倒车');
  await evalJs(`input.acc=false; 'ok'`);

  // 3.2 撞墙后立即倒车脱困 (锁内计时)
  await evalJs(`(()=>{
    player.pos.set(205, 0, -70); player.heading = Math.PI/2;
    player.speed = 30; player.velocity.set(30, 0, 0); player.inReverse = false; player.reverseTimer = 0;
    input.acc = false; input.brake = false; return true;
  })()`);
  // 等撞墙 (x 接近 219 墙)
  await waitFor(`player.speed < 5`, 30000, '撞墙减速');
  await evalJs(`input.brake = true; 'ok'`);
  await waitFor(`player.inReverse===true`, 25000, '撞墙后倒车');
  check('撞墙后仍能进入倒车 (锁内计时)', true);
  await waitFor(`(()=>{const f={x:Math.sin(player.heading),z:Math.cos(player.heading)}; return player.velocity.x*f.x+player.velocity.z*f.z < -1})()`, 25000, '倒车离开墙');
  check('倒车脱离墙面', true, 'x='+await evalJs(`player.pos.x.toFixed(1)`));
  await evalJs(`input.brake=false; input.acc=true; 'ok'`);
  await waitFor(`player.inReverse===false`, 15000, '脱困后前进');
  await evalJs(`input.acc=false; 'ok'`);

  // 3.3 倒车中转向 (方向反转但有效)
  await evalJs(`(()=>{
    player.speed = 0; player.velocity.set(0,0,0); player.inReverse = false; player.reverseTimer = 0;
    window.__h0 = player.heading; input.brake = true; return true;
  })()`);
  await waitFor(`player.inReverse===true`, 20000, '二次进入倒车');
  await waitFor(`player.speed < -3`, 20000, '倒车加速');
  await evalJs(`input.steerLeft = true; 'ok'`);
  await sleep(1200);
  await evalJs(`input.steerLeft = false; 'ok'`);
  const dh = await evalJs(`Math.abs(player.heading - window.__h0)`);
  check('倒车中可转向', dh > 0.05, 'Δheading='+dh?.toFixed(3));
  await evalJs(`input.brake=false; input.acc=true; 'ok'`);
  await waitFor(`player.inReverse===false`, 15000, '退出');
  await evalJs(`input.acc=false; 'ok'`);

  // 3.4 updateWarnings 防护 (sampleIdx 非法不崩溃)
  await evalJs(`player.sampleIdx = NaN; 'ok'`);
  await sleep(1000);
  check('sampleIdx=NaN 无JS错误', await evalJs(`!document.querySelector('div[style*="z-index:9999"]')`));

  console.log(failures===0 ? '\n全部通过' : `\n${failures} 项失败`);
}catch(e){
  console.error('测试执行异常:', e.message);
  failures++;
}finally{
  proc.kill();
  server.close();
  process.exit(failures===0?0:1);
}
