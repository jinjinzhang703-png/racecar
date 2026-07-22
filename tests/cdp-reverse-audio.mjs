// CDP 倒车逻辑 + 音效系统测试
// 用法: node tests/cdp-reverse-audio.mjs
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
  '--user-data-dir=' + path.join(ROOT, '..', 'tests', '.chrome-rev'),
  '--use-angle=swiftshader', '--mute-audio', '--window-size=800,600',
  '--autoplay-policy=no-user-gesture-required',
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
    await sleep(250);
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
  await evalJs(`document.body.click()`); // 触发音频初始化
  await evalJs(`document.getElementById('startBtn').click();document.getElementById('toGarageBtn').click();document.getElementById('confirmCarBtn').click();'ok'`);
  await waitFor(`race.phase==='grid'`);

  console.log('[1] 倒车逻辑');
  // 直接进 racing, 停车
  await evalJs(`race.phase='racing'; player.speed=0; player.velocity.set(0,0,0); input.acc=false; input.brake=false; 'ok'`);
  await sleep(300);

  // Bug复现场景: 多次点刹不应累积进入倒车
  for(let i=0;i<3;i++){
    await evalJs(`input.brake=true; 'ok'`); await sleep(250);
    await evalJs(`input.brake=false; 'ok'`); await sleep(250);
  }
  check('点刹不误入倒车', await evalJs(`player.inReverse===false`));

  // 长按刹车 → 进入倒车 (等待游戏内 0.5s 计时)
  await evalJs(`input.brake=true; 'ok'`);
  await waitFor(`player.inReverse===true`, 30000, '进入倒车模式');
  check('静止长按刹车进入倒车', true);
  // 等 speed 真正变负
  await waitFor(`player.speed < -1`, 20000, '倒车加速');
  const revSpeed = await evalJs(`player.speed`);
  check('倒车加速 (speed<0)', revSpeed < -1, 'speed='+revSpeed?.toFixed(1));
  // 位置后移验证 (velocity 滞后于 speed, 等到 velocity 真正朝后)
  await waitFor(`(()=>{const f={x:Math.sin(player.heading),z:Math.cos(player.heading)}; return player.velocity.x*f.x+player.velocity.z*f.z < -1})()`, 30000, '速度向量朝后');
  check('速度向量朝后 (velocity·fwd<-1)', true);

  // 松刹车 → 自然减速到 0 (等待 |speed|<0.5, 以游戏内状态为准)
  await evalJs(`input.brake=false; input.acc=false; 'ok'`);
  await waitFor(`Math.abs(player.speed) < 0.5`, 30000, '倒车自然停车');
  check('松刹车后减速停车', true, 'speed='+await evalJs(`player.speed.toFixed(1)`));

  // 按油门 → 退出倒车并前进
  await evalJs(`input.acc=true; 'ok'`);
  await waitFor(`player.inReverse===false && player.speed > 0.5`, 20000, '退出倒车');
  const fwd2 = await evalJs(`JSON.stringify({rev:player.inReverse, sp:player.speed})`).then(JSON.parse);
  check('给油退出倒车', fwd2.rev === false);
  check('恢复前进 (speed>0)', fwd2.sp > 0.5, 'speed='+fwd2.sp?.toFixed(1));
  await evalJs(`input.acc=false; 'ok'`);

  console.log('[2] 音效系统');
  check('音频已初始化', await evalJs(`audioInitialized===true`));
  check('引擎节点存在', await evalJs(`!!(engOsc1 && engOsc2 && engSub && engFilter && engGain)`));
  check('风噪节点存在', await evalJs(`!!(windSrc && windFilter && windGain)`));
  check('轮胎噪声节点存在', await evalJs(`!!(tireSrc && tireFilter && tireGain)`));
  check('压缩器存在', await evalJs(`!!audioMaster`));
  // 高速行驶一段, 检查音量参数有限且随油门/RPM变化
  await evalJs(`input.acc=true; player.speed=60; 'ok'`);
  await sleep(1500);
  const audioState = await evalJs(`JSON.stringify({
    eng: engGain.gain.value, wind: windGain.gain.value,
    f1: engOsc1.frequency.value, filt: engFilter.frequency.value,
  })`).then(JSON.parse);
  await evalJs(`input.acc=false; 'ok'`);
  check('引擎音量有效 (>0.05)', audioState.eng > 0.05, 'eng='+audioState.eng?.toFixed(3));
  check('风噪随速度开启 (>0.003)', audioState.wind > 0.003, 'wind='+audioState.wind?.toFixed(3));
  check('引擎频率合理 (150~450Hz)', audioState.f1 > 150 && audioState.f1 < 450, 'f='+audioState.f1?.toFixed(0));
  check('滤波器频率有限', isFinite(audioState.filt));

  // 撞墙触发碰撞音 + 爆震, 全程不应有 JS 错误
  await evalJs(`player.pos.set(205,0,-70); player.heading=Math.PI/2; player.speed=30; player.velocity.set(30,0,0); 'ok'`);
  await sleep(4000);
  check('碰撞后无 JS 错误覆盖层', await evalJs(`!document.querySelector('div[style*="z-index:9999"]')`));
  check('碰撞后 rpm 有限', await evalJs(`isFinite(player.rpm)`));
  check('碰撞后速度有限', await evalJs(`isFinite(player.speed) && isFinite(player.velocity.x)`));

  console.log(failures===0 ? '\n全部通过' : `\n${failures} 项失败`);
}catch(e){
  console.error('测试执行异常:', e.message);
  failures++;
}finally{
  proc.kill();
  server.close();
  process.exit(failures===0?0:1);
}
