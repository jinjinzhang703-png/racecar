// CDP 第二赛道(sakhir)验证: 切换/AI巡检/AI进站/联机同步
// 用法: node tests/cdp-track2.mjs
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

const instances = [];
let profileSeq = 0;
async function launchChrome(){
  const proc = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', '--no-first-run',
    '--user-data-dir=' + path.join(ROOT, '..', 'tests', '.chrome-t2' + (profileSeq++)),
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
async function waitFor(tab, expr, timeout=30000, label=expr){
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
  // ---------- A: 切赛道 + AI 巡检 ----------
  console.log('[A] sakhir 切换与 AI 巡检');
  const t1 = await newTab();
  await t1.nav(PAGE_URL);
  await waitFor(t1, 'window.__gameOK===true', 20000);
  const marinaLen = await t1.eval(`curve.getLength()`);
  await t1.eval(`document.getElementById('startBtn').click()`);
  await t1.eval(`document.querySelectorAll('#trackCards .track-card')[1].click()`);
  await t1.eval(`document.getElementById('toGarageBtn').click()`);
  await t1.eval(`document.getElementById('confirmCarBtn').click()`);
  await sleep(1000);
  check('赛道已切换到 sakhir', await t1.eval(`currentTrack.id==='sakhir'`));
  const sakhirLen = await t1.eval(`curve.getLength()`);
  check('新赛道几何已重建 (长度不同)', Math.abs(sakhirLen - marinaLen) > 100, (sakhirLen|0)+'m vs '+(marinaLen|0)+'m');
  check('白天车头灯关闭', await t1.eval(`window.__headlightOn===false`));
  check('小地图边界已重算', await t1.eval(`(()=>{const b=miniBounds; return b && b.maxx-b.minx > 500;})()`));
  check('无 JS 错误', await t1.eval(`!document.querySelector('div[style*="z-index:9999"]')`));
  await t1.eval(`race.phase='racing'; 'ok'`);

  // AI 巡检 30s: 无 NaN / 无越界 / 有速度
  let allOk = true, speeds = [];
  for(let i=0;i<30;i++){
    await sleep(1000);
    const s = await t1.eval(`JSON.stringify(cars.map(c=>({x:c.pos.x,z:c.pos.z,sp:c.speed,nan:isNaN(c.pos.x)||isNaN(c.pos.z)})))`);
    for(const c of JSON.parse(s)){
      if(c.nan || Math.abs(c.x)>600 || Math.abs(c.z)>600) allOk = false;
      speeds.push(c.sp);
    }
  }
  check('AI 巡检 30s: 无NaN/无越界', allOk);
  const avgSp = speeds.reduce((a,b)=>a+b,0)/speeds.length;
  check('AI 均速合理 (>20 m/s)', avgSp > 20, 'avg='+avgSp.toFixed(1));
  const lapEst = sakhirLen / avgSp;
  check('圈速估计在 35~90s 合理带', lapEst > 35 && lapEst < 90, '≈'+lapEst.toFixed(0)+'s');

  // ---------- B: AI 在 sakhir 进站 ----------
  console.log('[B] AI 在 sakhir 进站');
  await t1.eval(`(()=>{
    const ai = cars.find(c=>!c.isPlayer);
    ai.tire = 15; ai.lap = 1; ai.pits = 0; ai.pitStopDuration = 2.0;
    ai.pos.set(-372, 0, 338); ai.heading = Math.PI/2; ai.speed = 40; ai.velocity.set(40,0,0); ai.progress=0.97;
    window.__ai = ai; return true;
  })()`);
  await waitFor(t1, `__ai.pitting===true`, 30000, 'AI决定进站');
  check('AI 在 sakhir 决定进站', true);
  await waitFor(t1, `__ai.pits===1 && __ai.tire===100`, 300000, '完成换胎');
  check('AI 在 sakhir 完成进站换胎', true);

  // ---------- C: 联机赛道同步 ----------
  console.log('[C] 联机赛道同步 (手动信令)');
  const host = await newTab();
  const guest = await newTab();
  await host.nav(PAGE_URL); await guest.nav(PAGE_URL);
  await waitFor(host, 'window.__gameOK===true', 20000);
  await waitFor(guest, 'window.__gameOK===true', 20000);
  await host.eval(`document.getElementById('hostBtn').click()`);
  await waitFor(host, `document.getElementById('lobbyScreen') && !document.getElementById('lobbyScreen').classList.contains('hidden')`, 10000, '房主大厅');
  await host.eval(`document.getElementById('genInviteBtn').click()`);
  await waitFor(host, `document.querySelector('#inviteSlots textarea') && document.querySelector('#inviteSlots textarea').value.length>100`, 20000, '邀请码');
  const offer = await host.eval(`document.querySelector('#inviteSlots textarea').value`);
  await guest.eval(`document.getElementById('joinBtn').click()`);
  await guest.eval(`document.getElementById('offerInput').value=${JSON.stringify(offer)}`);
  await guest.eval(`document.getElementById('genAnswerBtn').click()`);
  await waitFor(guest, `document.getElementById('answerOutput').value.length>100`, 25000, '应答码');
  const answer = await guest.eval(`document.getElementById('answerOutput').value`);
  await host.eval(`document.querySelectorAll('#inviteSlots textarea')[1].value=${JSON.stringify(answer)}`);
  await host.eval(`document.querySelector('#inviteSlots button').click()`);
  await waitFor(guest, `document.getElementById('lobbyMain').style.display==='block'`, 15000, '客人入厅');
  // 房主选 sakhir
  await host.eval(`document.querySelector('#lobbyTrackRow [data-track="sakhir"]').click()`);
  await waitFor(guest, `document.getElementById('guestSettingsView').textContent.includes('SAKHIR')`, 10000, '客人看到赛道同步');
  check('客人端设置同步显示 SAKHIR', true);
  // READY + 开赛
  await guest.eval(`document.getElementById('readyBtn').click()`);
  await waitFor(host, `!document.getElementById('hostStartBtn').disabled`, 10000, 'START解锁');
  await host.eval(`document.getElementById('hostStartBtn').click()`);
  await waitFor(host, `race.phase==='grid'`, 10000, '房主grid');
  await waitFor(guest, `race.phase==='grid'`, 10000, '客人grid');
  check('房主端赛道=sakhir', await host.eval(`currentTrack.id==='sakhir'`));
  check('客人端赛道=sakhir (同步重建)', await guest.eval(`currentTrack.id==='sakhir'`));
  check('双端赛道长度一致', Math.abs(await host.eval(`curve.getLength()`) - await guest.eval(`curve.getLength()`)) < 1);
  check('客人端也是白天', await guest.eval(`window.__headlightOn===false`));

  console.log(failures===0 ? '\n全部通过' : `\n${failures} 项失败`);
}catch(e){
  console.error('测试执行异常:', e.message);
  failures++;
}finally{
  for(const i of instances) i.proc.kill();
  server.close();
  process.exit(failures===0?0:1);
}
