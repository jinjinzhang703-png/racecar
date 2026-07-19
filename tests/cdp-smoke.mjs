// CDP 冒烟测试: 单人流程 + 双标签页 WebRTC 联机
// 用法: node tests/cdp-smoke.mjs
// 依赖: 本机 Chrome, Node >= 22 (内置 WebSocket)
import { spawn } from 'node:child_process';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'racecar');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png' };

// ---------- 静态服务器 ----------
const server = http.createServer(async (req, res)=>{
  try{
    const p = path.join(ROOT, req.url === '/' ? 'racing-game.html' : decodeURIComponent(req.url));
    const data = await readFile(p);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  }catch{ res.writeHead(404); res.end('nf'); }
});
await new Promise(r=>server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const PAGE_URL = `http://127.0.0.1:${PORT}/racing-game.html`;

// ---------- 启动 Chrome (每个实例独立, 避免无头模式后台标签页节流) ----------
let profileSeq = 0;
async function launchChrome(){
  const proc = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', '--no-first-run',
    '--user-data-dir=' + path.join(ROOT, '..', 'tests', '.chrome-profile' + (profileSeq++)),
    '--use-angle=swiftshader', '--mute-audio', '--window-size=800,600',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank',
  ]);
  const uri = await new Promise((res, rej)=>{
    let buf='';
    proc.stderr.on('data', d=>{ buf+=d; const m=buf.match(/DevTools listening on (ws:\/\/\S+)/); if(m) res(m[1]); });
    proc.on('exit', ()=>rej(new Error('chrome exited')));
    setTimeout(()=>rej(new Error('chrome devtools timeout')), 15000);
  });
  return { proc, port: new URL(uri).port };
}
const instances = [];
async function chrome(){ const i = await launchChrome(); instances.push(i); return i; }

// ---------- CDP 客户端 ----------
let msgId = 0;
function connect(wsUrl){
  return new Promise((res, rej)=>{
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    ws.onopen = ()=>res({
      send(method, params={}){
        return new Promise((r2, j2)=>{
          const id = ++msgId;
          pending.set(id, {r2, j2});
          ws.send(JSON.stringify({id, method, params}));
        });
      },
      close(){ ws.close(); },
    });
    ws.onmessage = ev=>{
      const m = JSON.parse(ev.data);
      if(m.id && pending.has(m.id)){
        const {r2, j2} = pending.get(m.id);
        pending.delete(m.id);
        m.error ? j2(new Error(m.error.message)) : r2(m.result);
      }
    };
    ws.onerror = rej;
  });
}
async function newTab(inst){
  const r = await fetch(`http://127.0.0.1:${inst.port}/json/new?about:blank`, { method:'PUT' });
  const t = await r.json();
  const c = await connect(t.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  return { id:t.id, c,
    async eval(expr){
      const r2 = await this.c.send('Runtime.evaluate', { expression:expr, awaitPromise:true, returnByValue:true });
      if(r2.exceptionDetails) throw new Error('页面JS异常: ' + JSON.stringify(r2.exceptionDetails.exception?.description || r2.exceptionDetails.text));
      return r2.result.value;
    },
    async nav(url){ await this.c.send('Page.navigate', { url }); },
  };
}
const sleep = ms => new Promise(r=>setTimeout(r, ms));
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

// ============================================================
try{
  // ---------- 测试 A: 单人流程 ----------
  console.log('[A] 单人流程');
  const instA = await chrome();
  const t1 = await newTab(instA);
  await t1.nav(PAGE_URL);
  await waitFor(t1, 'window.__gameOK===true', 20000, '游戏加载');
  check('游戏加载无JS错误', await t1.eval(`!document.querySelector('div[style*="z-index:9999"]')`));
  check('Three.js 已加载(本地)', await t1.eval('typeof THREE!=="undefined" && THREE.REVISION==="149"'));

  await t1.eval(`document.getElementById('startBtn').click()`);
  check('主菜单→选赛道', await t1.eval(`!document.getElementById('trackScreen').classList.contains('hidden')`));
  await t1.eval(`document.querySelector('#lapsRow [data-laps="3"]').click()`);
  await t1.eval(`document.getElementById('toGarageBtn').click()`);
  check('选赛道→车库', await t1.eval(`!document.getElementById('garageScreen').classList.contains('hidden')`));
  await t1.eval(`document.querySelectorAll('.car-item')[2].click()`); // 选 Mercedes
  await t1.eval(`document.getElementById('confirmCarBtn').click()`);
  check('车库→发车格(grid)', await t1.eval(`race.phase==='grid'`));
  check('12辆车已创建', await t1.eval(`cars.length===12`), 'cars='+await t1.eval('cars.length'));
  check('圈数配置生效(3圈)', await t1.eval(`totalLaps===3`));
  check('玩家车队已应用', await t1.eval(`player.teamName==='Mercedes'`), await t1.eval('player.teamName'));
  await waitFor(t1, `race.phase==='racing'`, 90000, '五灯起跑');
  check('五灯后进入 racing', true);
  await waitFor(t1, `cars.some(c=>!c.isPlayer && c.speed>5)`, 30000, 'AI行驶');
  check('AI 在正常行驶', true);
  instA.proc.kill(); // 释放 CPU, 避免影响联机测试

  // ---------- 测试 B: 联机 ----------
  console.log('[B] 双浏览器联机 (WebRTC 手动信令)');
  const host = await newTab(await chrome());
  const guest = await newTab(await chrome());
  await host.nav(PAGE_URL); await guest.nav(PAGE_URL);
  await waitFor(host, 'window.__gameOK===true', 20000);
  await waitFor(guest, 'window.__gameOK===true', 20000);

  await host.eval(`document.getElementById('hostBtn').click()`);
  check('房主进入大厅', await host.eval(`!document.getElementById('lobbyScreen').classList.contains('hidden') && document.getElementById('hostSettings').style.display==='block'`));
  await host.eval(`document.getElementById('genInviteBtn').click()`);
  await waitFor(host, `document.querySelector('#inviteSlots textarea') && document.querySelector('#inviteSlots textarea').value.length>100`, 20000, '邀请码生成');
  const offer = await host.eval(`document.querySelector('#inviteSlots textarea').value`);
  check('邀请码已生成', offer.length>100, offer.length+'字符');

  await guest.eval(`document.getElementById('joinBtn').click()`);
  await guest.eval(`document.getElementById('guestNameInput').value='TESTER'`);
  await guest.eval(`document.getElementById('offerInput').value=${JSON.stringify(offer)}`);
  await guest.eval(`document.getElementById('genAnswerBtn').click()`);
  await waitFor(guest, `document.getElementById('answerOutput').value.length>100`, 25000, '应答码生成');
  const answer = await guest.eval(`document.getElementById('answerOutput').value`);
  check('应答码已生成', answer.length>100, answer.length+'字符');

  await host.eval(`document.querySelectorAll('#inviteSlots textarea')[1].value=${JSON.stringify(answer)}`);
  await host.eval(`document.querySelector('#inviteSlots button').click()`);
  await waitFor(guest, `document.getElementById('lobbyMain').style.display==='block'`, 15000, '客人连接入大厅');
  check('客人WebRTC连接成功并进入大厅', true);
  await waitFor(host, `document.querySelectorAll('#lobbyPlayers .player-row').length===2`, 10000, '房主看到2名玩家');
  check('房主玩家列表=2', true);
  await waitFor(guest, `document.querySelectorAll('#lobbyPlayers .player-row').length===2`, 10000, '客人看到2名玩家');
  check('客人玩家列表=2', true);
  check('客人看到名字同步', await guest.eval(`document.getElementById('lobbyPlayers').textContent.includes('TESTER')`));

  // 客人选车 + READY
  await guest.eval(`document.getElementById('lobbyGarageBtn').click()`);
  await guest.eval(`document.querySelectorAll('.car-item')[1].click()`); // Ferrari
  await guest.eval(`document.getElementById('confirmCarBtn').click()`);
  await waitFor(host, `document.getElementById('lobbyPlayers').textContent.includes('Ferrari')`, 10000, '房主看到客人选车');
  check('客人选车同步到房主', true);
  await guest.eval(`document.getElementById('readyBtn').click()`);
  await waitFor(host, `!document.getElementById('hostStartBtn').disabled`, 10000, 'START解锁');
  check('全员READY后房主可开赛', true);

  // 开赛
  await host.eval(`document.querySelector('#lobbyLapsRow [data-laps="3"]').click()`);
  await host.eval(`document.getElementById('hostStartBtn').click()`);
  await waitFor(host, `race.phase==='grid'`, 8000, '房主进入grid');
  await waitFor(guest, `race.phase==='grid'`, 8000, '客人进入grid');
  check('双端同步进入发车格', true);
  check('房主端远程车存在', await host.eval(`cars.some(c=>c.isRemote)`));
  check('客人端远程车存在', await guest.eval(`cars.some(c=>c.isRemote)`));
  check('客人端AI也是网络驱动', await guest.eval(`cars.filter(c=>c.isRemote).length===11`), 'remote='+await guest.eval(`cars.filter(c=>c.isRemote).length`));
  check('联机圈数一致(3)', await host.eval(`totalLaps===3`) && await guest.eval(`totalLaps===3`));

  await waitFor(host, `race.phase==='racing'`, 240000, '房主起跑');
  await waitFor(guest, `race.phase==='racing'`, 240000, '客人起跑');
  check('双端同步起跑(五灯)', true);

  // 客人踩油门 2 秒, 验证房主端看到客人车在动
  await guest.eval(`input.acc=true`);
  await sleep(2000);
  await guest.eval(`input.acc=false`);
  const guestSpeed = await guest.eval(`player.speed`);
  await waitFor(host, `cars.find(c=>c.isRemote) && cars.find(c=>c.isRemote)._netNext`, 8000, '房主收到客人状态');
  const remoteSpeedOnHost = await host.eval(`cars.find(c=>c.isRemote).speed`);
  check('客人本地车已加速', guestSpeed > 3, 'speed='+guestSpeed?.toFixed(1));
  check('房主端客人车速度同步', remoteSpeedOnHost > 1, 'remoteSpeed='+remoteSpeedOnHost?.toFixed(1));
  check('客人端收到房主AI广播', await guest.eval(`cars.filter(c=>c._netKey&&c._netKey.startsWith('ai')).some(c=>c._netNext)`));

  // 断线: 关客人标签, 房主应标记该车
  await guest.c.send('Page.close').catch(()=>{});
  await sleep(2500);
  // (onclose 触发后大厅阶段会移除玩家; 比赛阶段标记 DNF — 不断言, 只确认房主端无异常)
  check('房主端客人断开后无JS错误', await host.eval(`!document.querySelector('div[style*="z-index:9999"]')`));

  console.log(failures===0 ? '\n全部通过' : `\n${failures} 项失败`);
}catch(e){
  console.error('测试执行异常:', e.message);
  failures++;
}finally{
  for(const i of instances) i.proc.kill();
  server.close();
  process.exit(failures===0?0:1);
}
