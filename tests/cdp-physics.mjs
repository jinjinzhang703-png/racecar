// CDP 物理测试: Physics2D 求解器单元测试 + 游戏内撞墙集成测试
// 用法: node tests/cdp-physics.mjs
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
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  }catch{ if(!res.headersSent) res.writeHead(404); res.end(); }
});
await new Promise(r=>server.listen(0, '127.0.0.1', r));
const PAGE_URL = `http://127.0.0.1:${server.address().port}/racing-game.html`;

const proc = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0', '--no-first-run',
  '--user-data-dir=' + path.join(ROOT, '..', 'tests', '.chrome-phys'),
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
  if(r.result.exceptionDetails) throw new Error('页面JS异常: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
  return r.result.result.value;
}
const sleep = ms=>new Promise(r=>setTimeout(r,ms));
let failures = 0;
function check(name, ok, extra=''){
  console.log((ok?'  PASS':'  FAIL') + ' | ' + name + (extra?' | '+extra:''));
  if(!ok) failures++;
}

try{
  await send('Page.navigate', { url: PAGE_URL });
  const t0 = Date.now();
  while(Date.now()-t0 < 20000){
    try{ if(await evalJs('window.__gameOK===true')) break; }catch{}
    await sleep(300);
  }

  // ============================================================
  console.log('[1] Physics2D 求解器单元测试 (页面内构造刚体)');
  const unit = await evalJs(`(()=>{
    const P = Physics2D;
    function body(x, z, h, vx, vz){
      return { pos:{x, z}, heading:h, velocity:{x:vx, z:vz}, angularVel:0,
               _invMass:P.CAR.INV_MASS, _invInertia:P.CAR.INV_INERTIA };
    }
    const out = {};

    // --- A: 车对车正面对撞 (等质量对开 25m/s) ---
    {
      const a = body(-300, 340, Math.PI/2, 25, 0);
      const b = body(-296.5, 340, -Math.PI/2, -25, 0);
      const contact = P.obbContact(a, b);
      const before = a.velocity.x + b.velocity.x; // 动量(m相同) ∝ 速度之和
      const res = contact && P.carCarResolve(a, b, contact);
      out.headOn = {
        contact: !!contact,
        vn: res ? res.vn : null,
        avx: a.velocity.x, bvx: b.velocity.x,
        pBefore: before, pAfter: a.velocity.x + b.velocity.x,
        separated: a.pos.x < -300 && b.pos.x > -296.5,
      };
    }

    // --- B: 车对车偏心碰撞 → 打转 ---
    {
      const a = body(-300, 340, Math.PI/2, 25, 0);
      const b = body(-296.5, 340.8, -Math.PI/2, -25, 0); // 横向偏移 0.8m
      const contact = P.obbContact(a, b);
      const res = contact && P.carCarResolve(a, b, contact);
      out.offset = { contact: !!contact, wa: a.angularVel, wb: b.angularVel };
    }

    // --- C: 已在分离 → 不重复加冲量 ---
    {
      const a = body(-300, 340, Math.PI/2, -5, 0);
      const b = body(-296.5, 340, -Math.PI/2, 5, 0);
      const contact = P.obbContact(a, b);
      const res = contact && P.carCarResolve(a, b, contact);
      out.separating = { res: res === null, avx: a.velocity.x, bvx: b.velocity.x };
    }

    // --- D: 正面撞墙 30m/s → 低回弹 ---
    {
      const w = body(0, 0, 0, 0, 30); // 朝 +z 冲向墙 (法线 -z 指向赛道)
      const res = P.wallResolve(w, 0, 2, 0, -1, 0.3);
      out.wallHead = { vn: res ? res.vn : null, vzAfter: w.velocity.z, zAfter: w.pos.z };
    }

    // --- E: 45° 撞墙 → 角点偏离质心产生偏航 ---
    {
      const w = body(0, 0, 0.3, 0, 25);
      const res = P.wallResolve(w, 0.62, 2.2, 0, -1, 0.3); // 前右角触墙
      out.wallCorner = { vn: res ? res.vn : null, omega: w.angularVel, vzAfter: w.velocity.z };
    }

    // --- F: 沿墙刮擦 → 切向速度大部分保留 ---
    {
      const w = body(0, 0, 0.06, 1.5, 50); // 速度主要沿切线
      const res = P.wallResolve(w, 0.62, 1.0, -1, 0, 0.15); // 法线 -x
      const spAfter = Math.hypot(w.velocity.x, w.velocity.z);
      out.wallScrape = { vn: res ? res.vn : null, spAfter, retention: spAfter/50 };
    }
    return out;
  })()`);

  check('A 检测到OBB接触', unit.headOn.contact);
  check('A 接近速度≈50m/s', Math.abs(unit.headOn.vn - 50) < 1, 'vn='+unit.headOn.vn?.toFixed(1));
  check('A 动量守恒 (前后总动量相等)', Math.abs(unit.headOn.pAfter - unit.headOn.pBefore) < 0.01,
    'before='+unit.headOn.pBefore.toFixed(2)+' after='+unit.headOn.pAfter.toFixed(2));
  check('A 低回弹: 双方速度反转且 |v|<6', unit.headOn.avx < 0 && unit.headOn.bvx > 0 && Math.abs(unit.headOn.avx) < 6,
    'a='+unit.headOn.avx.toFixed(2)+' b='+unit.headOn.bvx.toFixed(2));
  check('A 位置分离', unit.headOn.separated);
  check('B 偏心碰撞产生偏航 (|ω|>0.1)', unit.offset.contact && Math.abs(unit.offset.wa) > 0.1 && Math.abs(unit.offset.wb) > 0.1,
    'ωa='+unit.offset.wa?.toFixed(2)+' ωb='+unit.offset.wb?.toFixed(2));
  check('C 分离中不重复冲量', unit.separating.res && unit.separating.avx === -5 && unit.separating.bvx === 5);
  check('D 正面撞墙 vn≈-30', Math.abs(unit.wallHead.vn + 30) < 1, 'vn='+unit.wallHead.vn?.toFixed(1));
  check('D TECPRO吸能: 回弹很小 (vz<3)', unit.wallHead.vzAfter > -3 && unit.wallHead.vzAfter <= 0.5, 'vz='+unit.wallHead.vzAfter.toFixed(2));
  check('E 角点撞墙产生偏航 (|ω|>0.3)', Math.abs(unit.wallCorner.omega) > 0.3, 'ω='+unit.wallCorner.omega?.toFixed(2));
  check('F 刮擦保留大部分切向速度 (>70%)', unit.wallScrape.retention > 0.7, '保留='+(unit.wallScrape.retention*100).toFixed(0)+'%');
  check('F 刮擦法向速度很小 (|vn|<3)', Math.abs(unit.wallScrape.vn) < 3, 'vn='+unit.wallScrape.vn?.toFixed(2));

  // ============================================================
  console.log('[2] 游戏内集成: 正面撞墙 (真实 loop)');
  await evalJs(`(()=>{
    document.getElementById('startBtn').click();
    document.getElementById('toGarageBtn').click();
    document.getElementById('confirmCarBtn').click();
    return true;
  })()`);
  await sleep(500);
  // 传送玩家: 北侧直道 (x≈210, z≈-70), 面向 +x 护墙, 速度 30
  // (避开发车直道 — 该段属维修区, 围栏碰撞按设计被跳过)
  await evalJs(`(()=>{
    player.pos.set(205, 0, -70); player.heading = Math.PI/2; player.speed = 30;
    player.velocity.set(30, 0, 0); player.angularVel = 0;
    race.phase = 'racing'; // 跳过五灯直接测碰撞
    return true;
  })()`);
  await sleep(6000);
  const wall = await evalJs(`JSON.stringify({
    x: player.pos.x, speed: player.speed,
    vel: {x: player.velocity.x, z: player.velocity.z},
    nan: isNaN(player.pos.x) || isNaN(player.pos.z),
    crash: player.crashTimer > 0,
  })`).then(JSON.parse);
  check('未穿墙 (x <= 220.5)', wall.x <= 220.5, 'x='+wall.x.toFixed(2));
  check('撞击后大幅减速 (|speed|<12)', Math.abs(wall.speed) < 12, 'speed='+wall.speed.toFixed(1));
  check('速度向量无 NaN', !wall.nan && !isNaN(wall.vel.x) && !isNaN(wall.vel.z));

  console.log('[3] 游戏内集成: 沿墙高速刮擦');
  await evalJs(`(()=>{
    player.pos.set(216.5, 0, -60); player.heading = Math.PI - 0.06; // 朝南, 微偏东侧墙
    player.speed = 50; player.velocity.set(3, 0, -49.9); player.angularVel = 0;
    player.crashTimer = 0; player.collisionLock = 0;
    return true;
  })()`);
  await sleep(4000);
  const scrape = await evalJs(`JSON.stringify({
    x: player.pos.x, speed: player.speed, nan: isNaN(player.pos.x)||isNaN(player.pos.z),
    crash: player.crashTimer > 0,
  })`).then(JSON.parse);
  check('刮擦未穿墙 (x <= 219.6)', scrape.x <= 219.6, 'x='+scrape.x.toFixed(2));
  check('刮擦保留大部分速度 (>25 m/s)', Math.abs(scrape.speed) > 25, 'speed='+scrape.speed.toFixed(1));
  check('刮擦不触发 CRASH 翻滚', !scrape.crash);
  check('无 NaN', !scrape.nan);

  console.log('[4] 游戏内集成: 玩家追尾静止AI车 (车车碰撞)');
  await evalJs(`(()=>{
    const ai = cars.find(c=>!c.isPlayer);
    // AI车放在玩家正前方 4m (OBB接触距离3.9m), 玩家 35m/s 追尾
    ai.pos.set(205, 0, -74); ai.heading = Math.PI; ai.speed = 0; ai.velocity.set(0,0,0);
    ai.pitting = false;
    player.pos.set(205, 0, -70); player.heading = Math.PI;
    player.speed = 35; player.velocity.set(0, 0, -35); player.angularVel = 0;
    player.crashTimer = 0; player.collisionLock = 0;
    window.__aiCar = ai;
    return true;
  })()`);
  await sleep(3000);
  const rear = await evalJs(`JSON.stringify({
    aiSpeed: window.__aiCar.speed, aiVelX: window.__aiCar.velocity.x,
    playerSpeed: player.speed,
    dist: Math.hypot(window.__aiCar.pos.x-player.pos.x, window.__aiCar.pos.z-player.pos.z),
    nan: [player, ...cars].some(c=>isNaN(c.pos.x)||isNaN(c.pos.z)),
  })`).then(JSON.parse);
  check('AI车被撞后获得速度 (被推走或玩家被阻)', Math.abs(rear.aiVelX) > 0.5 || Math.abs(rear.playerSpeed) < 30,
    'aiVelX='+rear.aiVelX?.toFixed(1)+' playerSpeed='+rear.playerSpeed?.toFixed(1));
  check('无 NaN (全部车辆)', !rear.nan);
  check('玩家速度已被碰撞改变', Math.abs(rear.playerSpeed) < 34, 'speed='+rear.playerSpeed?.toFixed(1));

  console.log(failures===0 ? '\n全部通过' : `\n${failures} 项失败`);
}catch(e){
  console.error('测试执行异常:', e.message);
  failures++;
}finally{
  proc.kill();
  server.close();
  process.exit(failures===0?0:1);
}
