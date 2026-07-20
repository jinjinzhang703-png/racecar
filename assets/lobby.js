// ============================================================
//  lobby.js — 主菜单 / 选赛道 / 联机大厅 UI 逻辑 + 联机协议
//  依赖: tracks.js (TRACKS), game.js (全局函数/变量), net.js (Net)
// ============================================================
(function(){
'use strict';
const $ = id => document.getElementById(id);

// ---------- 屏幕切换 ----------
const SCREENS = ['startScreen','trackScreen','garageScreen','lobbyScreen','overScreen','pauseScreen'];
function showScreen(id){
  for(const s of SCREENS){ const el=$(s); if(el) el.classList.add('hidden'); }
  if(id) $(id).classList.remove('hidden');
}

// ============================================================
//  单人练习: 主菜单 → 选赛道 → 车库 → 比赛
// ============================================================
let selTrackId = TRACKS[0].id;
let selLaps = 5;

function buildTrackCards(){
  const wrap = $('trackCards');
  wrap.innerHTML = '';
  for(const t of TRACKS){
    const card = document.createElement('div');
    card.className = 'track-card' + (t.available ? '' : ' locked') + (t.id===selTrackId && t.available ? ' selected' : '');
    card.innerHTML = `<div class="tname">${t.name}</div><div class="tsub">${t.sub}</div><div class="tdesc">${t.desc}</div>`;
    if(t.available){
      card.addEventListener('click', ()=>{
        selTrackId = t.id;
        wrap.querySelectorAll('.track-card').forEach(c=>c.classList.remove('selected'));
        card.classList.add('selected');
      });
    } else {
      card.innerHTML = `<div class="tname">???</div><div class="tsub">新赛道</div><div class="tdesc">敬请期待</div>`;
    }
    wrap.appendChild(card);
  }
  // 占位: 未来赛道
  const locked = document.createElement('div');
  locked.className = 'track-card locked';
  locked.innerHTML = `<div class="tname">???</div><div class="tsub">新赛道</div><div class="tdesc">敬请期待</div>`;
  wrap.appendChild(locked);
}
buildTrackCards();

$('startBtn').addEventListener('click', ()=>showScreen('trackScreen'));
$('trackBackBtn').addEventListener('click', ()=>showScreen('startScreen'));
$('lapsRow').querySelectorAll('.diff-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    $('lapsRow').querySelectorAll('.diff-btn').forEach(b=>b.classList.remove('selected'));
    btn.classList.add('selected');
    selLaps = parseInt(btn.dataset.laps, 10);
  });
});
$('toGarageBtn').addEventListener('click', ()=>{
  setDefaultRaceConfig({ laps: selLaps, trackId: selTrackId });
  showScreen(null);
  openGarage();
});

// ============================================================
//  联机状态
// ============================================================
// 页面加载时即探测服务器模式 (点击时无需等待)
const serverReady = Net.serverAvailable(1500);
const MP = window.MP = { active:false, isHost:false, inRace:false, myId:null };
let myName = 'HOST';
let players = [];   // {id,name,carIdx,color,tire,ready,slot} — 房主权威
let settings = { laps:5, difficulty:'normal', aiFill:true };
let myReady = false;
const HOST_SLOT = Math.floor(NCARS/2);
let slotPool = [7,8,9,10,11,0,1,2,3,4,5]; // 客人发车格分配顺序 (host=6)
const DIFF_LABEL = { easy:'简单', normal:'普通', hard:'困难' };

// ---------- 工具 ----------
function currentColor(){
  return selectedPaintMode==='team' ? GARAGE_CARS[selectedCarIdx].color : selectedCustomColor;
}
function myCarSel(){
  return { carIdx:selectedCarIdx, color:currentColor(), tire:selectedTireType };
}
// 由大厅玩家记录生成 applyCarLivery 配置 (GARAGE_CARS 来自 game.js)
function carConfigOf(p){
  const car = GARAGE_CARS[p.carIdx] || GARAGE_CARS[0];
  return {
    teamName:car.name, short:car.short, driver:car.driver,
    color:p.color, num:car.num, maxSpeed:car.maxSpeed,
    tireType:p.tire, tireMaxLaps:p.tire==='soft'?3:4,
  };
}
function lobbyStatus(t){ $('lobbyStatus').textContent = t||''; }

// ============================================================
//  大厅渲染
// ============================================================
function renderPlayers(){
  const wrap = $('lobbyPlayers');
  wrap.innerHTML = '';
  for(const p of players){
    const car = GARAGE_CARS[p.carIdx] || GARAGE_CARS[0];
    const hex = '#'+p.color.toString(16).padStart(6,'0');
    const row = document.createElement('div');
    row.className = 'player-row';
    row.innerHTML =
      `<div class="car-color-dot" style="background:${hex};color:${hex};"></div>`+
      `<div class="pname">${p.name}${p.id===MP.myId?' (你)':''}</div>`+
      (p.id==='host'?'<span class="phost">HOST</span>':'')+
      `<div class="pcar">${car.name} · ${car.driver}</div>`+
      `<div class="pready${p.ready?' ready':''}">${p.ready?'READY':'...'}</div>`;
    wrap.appendChild(row);
  }
  // 房主: 全员 ready 才能开赛
  if(MP.isHost){
    const allReady = players.every(p=>p.ready);
    $('hostStartBtn').disabled = !allReady;
    $('hostStartBtn').style.opacity = allReady ? '1' : '.4';
    lobbyStatus(allReady ? '全员就绪, 可以开赛!' : '等待所有玩家 READY...');
  }
}
function renderGuestSettings(){
  $('guestSettingsView').innerHTML =
    `赛道: <b style="color:var(--accent)">MARINA BAY · 滨海湾</b><br>`+
    `圈数: <b>${settings.laps}</b> · AI难度: <b>${DIFF_LABEL[settings.difficulty]||settings.difficulty}</b><br>`+
    `AI 补位: <b>${settings.aiFill?'开':'关'}</b>`;
}

function showLobby(){
  showScreen('lobbyScreen');
  const server = Net.serverMode;
  $('joinPanel').style.display = MP.isHost || server ? 'none' : 'block';
  $('lobbyMain').style.display = MP.isHost || server ? 'block' : 'none';
  $('hostSettings').style.display = MP.isHost ? 'block' : 'none';
  $('guestSettings').style.display = MP.isHost ? 'none' : 'block';
  $('readyBtn').style.display = MP.isHost ? 'none' : 'inline-block';
  $('hostStartBtn').style.display = MP.isHost ? 'inline-block' : 'none';
  $('inviteSection').style.display = MP.isHost && !server ? 'block' : 'none';
  $('lobbyMode').textContent = MP.isHost
    ? (server ? '你是房主 · 玩家可直接加入' : '你是房主 · 生成邀请码发给朋友')
    : (server ? '已连接服务器 · 等待房主开赛' : '加入房间');
  // 步骤指引 (按模式)
  const addr = location.host.includes('localhost') || location.host.includes('127.0.0.1')
    ? 'http://<你的局域网IP>:' + (location.port || '8000') : 'http://' + location.host;
  $('lobbyGuide').innerHTML = MP.isHost
    ? (server
      ? `① 朋友在同一局域网打开 <b>${addr}</b> 点「加入房间」<br>② 等待全员 <b>READY</b> → ③ 点击 <b>START RACE</b>`
      : `① 右侧「生成邀请码」发给朋友 → ② 朋友粘贴后把<b>应答码</b>回传给你<br>③ 粘贴应答码点「接入」→ 全员 READY 后开赛`)
    : (server
      ? `已连接房主 · ① 左侧「选择车辆」→ ② 点 <b>READY</b> → ③ 等房主开赛`
      : `① 向房主索要<b>邀请码</b>并粘贴到下方 → ② 生成<b>应答码</b>回发给房主<br>③ 连接成功后选车 → 点 READY → 等房主开赛`);
  $('myNameInput').value = myName;
  renderPlayers();
}

// ============================================================
//  房主
// ============================================================
function wsUrl(){
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
}

$('hostBtn').addEventListener('click', async ()=>{
  // 优先: 服务器模式 (node serve.mjs, 免邀请码)
  if(await serverReady){
    try{
      MP.active = true; MP.isHost = true; myName = 'HOST';
      setupNet();
      const role = await Net.connectServer(wsUrl(), 'host');
      MP.myId = role.id;
      const sel = myCarSel();
      players = [{ id:MP.myId, name:myName, ...sel, ready:true, slot:HOST_SLOT }];
      showLobby();
      return;
    }catch(e){ console.warn('服务器模式失败, 回退手动 WebRTC', e); }
  }
  // 兜底: 纯浏览器手动信令
  if(!Net.supported){ alert('当前浏览器不支持 WebRTC, 请用最新版 Chrome/Edge'); return; }
  MP.active = true; MP.isHost = true; MP.myId = 'host'; myName = 'HOST';
  Net.host();
  const sel = myCarSel();
  players = [{ id:'host', name:myName, ...sel, ready:true, slot:HOST_SLOT }];
  setupNet();
  showLobby();
});

// 邀请码槽位 UI
$('genInviteBtn').addEventListener('click', async ()=>{
  const btn = $('genInviteBtn');
  btn.disabled = true;
  try{
    const { slot, code } = await Net.createInvite();
    const div = document.createElement('div');
    div.className = 'invite-slot';
    div.innerHTML =
      `<div class="slot-title">邀请码 #${slot+1} — 发给朋友, 然后粘贴TA的应答码</div>`+
      `<textarea class="code-box" readonly></textarea>`+
      `<textarea class="code-box" placeholder="粘贴应答码..." style="margin-top:6px;"></textarea>`+
      `<button class="btn ghost small" style="margin-top:6px;">接入</button>`+
      `<div class="lobby-status"></div>`;
    const [offerTa, answerTa] = div.querySelectorAll('textarea');
    const connBtn = div.querySelector('button');
    const status = div.querySelector('.lobby-status');
    offerTa.value = code;
    offerTa.addEventListener('click', ()=>{ offerTa.select(); });
    connBtn.addEventListener('click', async ()=>{
      try{
        await Net.acceptAnswer(slot, answerTa.value);
        connBtn.disabled = true;
        status.textContent = '已接收应答, 等待连接...';
      }catch(e){
        status.textContent = '应答码无效, 请检查后再试';
      }
    });
    $('inviteSlots').appendChild(div);
  } finally {
    btn.disabled = false;
  }
});

// 房主设置变更 → 广播
function hostSettingsChanged(){
  settings.laps = parseInt(document.querySelector('#lobbyLapsRow .diff-btn.selected').dataset.laps, 10);
  settings.difficulty = document.querySelector('#lobbyDiffRow .diff-btn.selected').dataset.diff;
  settings.aiFill = $('aiFillChk').checked;
  broadcastLobby();
}
$('lobbyLapsRow').querySelectorAll('.diff-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    $('lobbyLapsRow').querySelectorAll('.diff-btn').forEach(b=>b.classList.remove('selected'));
    btn.classList.add('selected');
    hostSettingsChanged();
  });
});
$('lobbyDiffRow').querySelectorAll('.diff-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    $('lobbyDiffRow').querySelectorAll('.diff-btn').forEach(b=>b.classList.remove('selected'));
    btn.classList.add('selected');
    hostSettingsChanged();
  });
});
$('aiFillChk').addEventListener('change', hostSettingsChanged);

function broadcastLobby(){
  Net.broadcast({ t:'lobby', players, settings });
  renderPlayers();
}

// 房主开赛
$('hostStartBtn').addEventListener('click', ()=>{
  if(!players.every(p=>p.ready)) return;
  const config = {
    laps: settings.laps,
    difficulty: settings.difficulty,
    aiFill: settings.aiFill,
    trackId: 'marina-bay',
    lightsOutDelay: 0.7 + Math.random()*1.9, // 各端用同一灭灯延迟, 保证同步起跑
    players: players.map(p=>({ id:p.id, name:p.name, slot:p.slot, ...carConfigOf(p) })),
  };
  Net.broadcast({ t:'start', config });
  startMpRace(config);
});

// ============================================================
//  客人
// ============================================================
$('joinBtn').addEventListener('click', async ()=>{
  // 优先: 服务器模式 (免邀请码, 直接进大厅)
  if(await serverReady){
    try{
      MP.active = true; MP.isHost = false;
      setupNet();
      const role = await Net.connectServer(wsUrl(), 'guest');
      MP.myId = role.id;
      myName = 'PLAYER' + (role.id.replace(/\D/g,'') || '');
      Net.send({ t:'join', name:myName });
      showLobby();
      $('joinPanel').style.display = 'none';
      $('lobbyMain').style.display = 'block';
      $('lobbyMode').textContent = '已连接服务器 · 等待房主开赛';
      renderPlayers();
      return;
    }catch(e){ console.warn('服务器模式失败, 回退手动 WebRTC', e); }
  }
  // 兜底: 纯浏览器手动信令
  if(!Net.supported){ alert('当前浏览器不支持 WebRTC, 请用最新版 Chrome/Edge'); return; }
  MP.active = true; MP.isHost = false;
  Net.setGuest();
  setupNet();
  showLobby();
});
$('joinBackBtn').addEventListener('click', ()=>showScreen('startScreen'));

$('genAnswerBtn').addEventListener('click', async ()=>{
  const btn = $('genAnswerBtn');
  btn.disabled = true;
  $('joinStatus').textContent = '正在生成应答码...';
  try{
    const code = await Net.join($('offerInput').value);
    $('answerOutput').value = code;
    $('joinStatus').textContent = '应答码已生成, 发给房主后等待接入...';
    await Net.waitOpen();
    // 连接成功
    myName = ($('guestNameInput').value || 'PLAYER').trim().toUpperCase() || 'PLAYER';
    Net.send({ t:'join', name:myName });
    $('joinPanel').style.display = 'none';
    $('lobbyMain').style.display = 'block';
    $('lobbyMode').textContent = '已连接 · 等待房主开赛';
    renderPlayers();
  }catch(e){
    $('joinStatus').textContent = '邀请码无效, 请检查后重新粘贴';
    btn.disabled = false;
  }
});

$('readyBtn').addEventListener('click', ()=>{
  myReady = !myReady;
  $('readyBtn').textContent = myReady ? '取消 READY' : 'READY';
  sendMyUpdate();
});

// 同步我的车辆选择/准备状态/名字
function sendMyUpdate(){
  const sel = myCarSel();
  if(MP.isHost){
    const me = players.find(p=>p.id==='host');
    if(me) Object.assign(me, sel, { name:myName });
    broadcastLobby();
  } else {
    Net.send({ t:'update', ...sel, ready:myReady, name:myName });
    const me = players.find(p=>p.id===MP.myId);
    if(me){ Object.assign(me, sel, {ready:myReady, name:myName}); renderPlayers(); }
  }
}

// 名字编辑 (大厅内即时生效)
$('myNameInput').addEventListener('change', ()=>{
  myName = ($('myNameInput').value || (MP.isHost?'HOST':'PLAYER')).trim().toUpperCase()
    || (MP.isHost?'HOST':'PLAYER');
  $('myNameInput').value = myName;
  sendMyUpdate();
});

// ============================================================
//  大厅内车库
// ============================================================
$('lobbyGarageBtn').addEventListener('click', ()=>{
  $('lobbyScreen').classList.add('hidden');
  window.onGarageConfirm = ()=>{
    $('lobbyScreen').classList.remove('hidden');
    sendMyUpdate();
  };
  openGarage();
});

// 离开大厅: 直接刷新页面 (最可靠的连接/状态清理)
$('leaveLobbyBtn').addEventListener('click', ()=>location.reload());

// ============================================================
//  网络消息处理
// ============================================================
function setupNet(){
  Net.onPeer((gid, ev)=>{
    if(!MP.active) return;
    if(!MP.isHost){
      if(ev==='leave' && MP.inRace){ /* 与房主断线 */ flashMsg('DISCONNECTED','与房主失去连接'); }
      return;
    }
    if(ev==='leave'){
      const idx = players.findIndex(p=>p.id===gid);
      if(idx>=0){
        slotPool.push(players[idx].slot);
        players.splice(idx,1);
        broadcastLobby();
      }
      if(MP.inRace) markRemoteDnf(gid);
    }
  });

  Net.onMessage((fromId, m)=>{
    if(MP.inRace && (m.t==='state' || m.t==='ai')){
      handleRaceMessage(fromId, m);
      return;
    }
    if(MP.isHost) handleHostMessage(fromId, m);
    else handleGuestMessage(fromId, m);
  });
}

// ---- 房主收到的消息 ----
const humanFinishes = new Map(); // id -> time
function handleHostMessage(fromId, m){
  switch(m.t){
    case 'join': {
      Net.sendTo(fromId, { t:'welcome', id:fromId });
      players.push({
        id:fromId, name:(m.name||fromId).toUpperCase(),
        carIdx:0, color:GARAGE_CARS[0].color, tire:'soft',
        ready:false, slot: slotPool.length ? slotPool.shift() : 0,
      });
      broadcastLobby();
      break;
    }
    case 'update': {
      const p = players.find(x=>x.id===fromId);
      if(p) Object.assign(p, { carIdx:m.carIdx, color:m.color, tire:m.tire, ready:!!m.ready,
        name: (m.name||p.name||'').toString().toUpperCase() || p.name });
      broadcastLobby();
      break;
    }
    case 'finish': {
      humanFinishes.set(fromId, m.time);
      maybeSendResults();
      break;
    }
  }
}

// ---- 客人收到的消息 ----
function handleGuestMessage(fromId, m){
  switch(m.t){
    case 'welcome':
      MP.myId = m.id;
      break;
    case 'lobby':
      players = m.players;
      settings = m.settings;
      renderPlayers();
      renderGuestSettings();
      break;
    case 'start':
      startMpRace(m.config);
      break;
    case 'results':
      showResults(m.order);
      break;
  }
}

// ============================================================
//  联机比赛
// ============================================================
function startMpRace(config){
  const me = config.players.find(p=>p.id===MP.myId);
  if(!me){ console.error('[MP] 玩家列表中没有自己', config); return; }
  const remotes = config.players.filter(p=>p.id!==MP.myId);
  startRace({
    laps: config.laps,
    difficulty: config.difficulty,
    aiFill: config.aiFill,
    lightsOutDelay: config.lightsOutDelay,
    playerSlot: me.slot,
    playerConfig: carConfigOf(me),
    remotePlayers: remotes,
    guestMode: !MP.isHost,
  });
  // 给网络车辆打标识, 供状态消息匹配
  for(const c of cars){
    if(c.isRemote && c.remoteId) c._netKey = c.remoteId;        // 远程真人
    else if(c.isRemote) c._netKey = 'ai' + c.gridSlot;          // 客人端的 AI (房主广播)
    if(c.isRemote){
      const rp = remotes.find(r=>r.slot===c.gridSlot);
      c._mpName = rp ? rp.name : 'AI';
    }
  }
  humanFinishes.clear();
  MP.inRace = true;
  window.onRaceRetry = onMpRaceEnd;
  window.onLocalFinish = onLocalFinish;
}

// 比赛状态同步 (由 game.js 主循环每帧调用)
let stateTimer = 0;
window.MPraceTick = function(dt){
  if(!MP.inRace) return;
  stateTimer += dt;
  if(stateTimer < 0.05) return; // 20Hz
  stateTimer = 0;
  const s = {
    t:'state', id:MP.myId,
    p:[+player.pos.x.toFixed(2), +player.pos.y.toFixed(2), +player.pos.z.toFixed(2)],
    h:+player.heading.toFixed(3), v:+player.speed.toFixed(1),
    prog:+player.progress.toFixed(4), lap:player.lap,
    // 3D 姿态 (起飞/翻车同步)
    y:+player.y.toFixed(2), vy:+player.vy.toFixed(2),
    rl:+player.roll.toFixed(3), pt:+player.pitch3d.toFixed(3),
    air:player.airborne?1:0, flp:player.flipped?1:0,
  };
  if(MP.isHost){
    Net.broadcast(s);
    // AI 状态由房主广播
    const ai = [];
    for(const c of cars){
      if(!c.isPlayer && !c.isRemote){
        ai.push({ s:c.gridSlot,
          p:[+c.pos.x.toFixed(2), +c.pos.y.toFixed(2), +c.pos.z.toFixed(2)],
          h:+c.heading.toFixed(3), v:+c.speed.toFixed(1),
          prog:+c.progress.toFixed(4), lap:c.lap,
          y:+c.y.toFixed(2), vy:+c.vy.toFixed(2),
          rl:+c.roll.toFixed(3), pt:+c.pitch3d.toFixed(3),
          air:c.airborne?1:0, flp:c.flipped?1:0 });
      }
    }
    if(ai.length) Net.broadcast({ t:'ai', cars:ai });
  } else {
    Net.send(s);
  }
};

function handleRaceMessage(fromId, m){
  if(m.t === 'state'){
    applyNetState(m.id, m);
    if(MP.isHost){
      // 星型中继: 房主把客人状态转发给其他客人
      for(const gid of Net.guestIds()) if(gid !== fromId) Net.sendTo(gid, m);
    }
  } else if(m.t === 'ai' && !MP.isHost){
    for(const a of m.cars) applyNetState('ai'+a.s, a);
  }
}

function applyNetState(key, m){
  const c = cars.find(x=>x._netKey === key);
  if(!c) return;
  c._netPrev = c._netNext;
  c._netNext = { p:m.p, h:m.h, v:m.v, t:performance.now() };
  c.progress = m.prog;
  c.lap = m.lap;
  // 3D 姿态同步
  if(m.y !== undefined){
    c.y = m.y; c.vy = m.vy || 0;
    c.roll = m.rl || 0; c.pitch3d = m.pt || 0;
    c.airborne = !!m.air; c.flipped = !!m.flp;
  }
}

function markRemoteDnf(id){
  const c = cars.find(x=>x._netKey === id);
  if(c && !c.finished){ c.finished = true; c.finishTime = 1e6; c.speed = 0; }
  humanFinishes.set(id, null);
  maybeSendResults();
}

// ---- 完赛与名次 ----
function onLocalFinish(result){
  if(MP.isHost){
    humanFinishes.set('host', result.time);
    maybeSendResults();
  } else {
    Net.send({ t:'finish', time:result.time });
    const el = $('mpResults');
    if(el) el.innerHTML = '<div style="color:var(--muted);font-size:12px;">等待其他选手完赛...</div>';
  }
}

function maybeSendResults(){
  if(!MP.isHost || !MP.inRace) return;
  // 所有真人都完赛才出总表
  const humans = players.map(p=>p.id);
  if(!humans.every(id=>humanFinishes.has(id))) return;
  const ranked = [...cars].sort((a,b)=>rankProgress(b)-rankProgress(a));
  const order = ranked.map((c,i)=>({
    pos:i+1,
    name: c.isPlayer ? '你' : (c._mpName || c.name),
    time: c.finished && c.finishTime < 1e6 ? c.finishTime : null,
  }));
  Net.broadcast({ t:'results', order });
  showResults(order);
}

function showResults(order){
  const el = $('mpResults');
  if(!el) return;
  el.innerHTML = '<div class="section-title" style="margin-top:10px;">最终名次</div>' +
    order.map(o=>
      `<div style="display:flex;gap:14px;justify-content:center;font-size:13px;line-height:1.9;" class="p${o.pos}">`+
      `<span style="font-weight:800;width:34px;text-align:right;" class="pos-num">P${o.pos}</span>`+
      `<span style="min-width:90px;text-align:left;">${o.name}</span>`+
      `<span style="color:var(--mut);">${o.time!=null ? fmtTime(o.time) : 'DNF'}</span></div>`
    ).join('');
}
function fmtTime(t){
  const m = Math.floor(t/60), s = t - m*60;
  return m + ':' + (s<10?'0':'') + s.toFixed(2);
}

// 比赛结束返回大厅
function onMpRaceEnd(){
  MP.inRace = false;
  window.onRaceRetry = null;
  window.onLocalFinish = null;
  race.phase = 'menu';
  myReady = false;
  if(!MP.isHost) $('readyBtn').textContent = 'READY';
  for(const p of players) p.ready = (p.id === 'host');
  if(MP.isHost) broadcastLobby();
  else sendMyUpdate();
  showLobby();
}

// 返回主菜单 (软重置, 无需刷新页面)
function backToMenu(){
  MP.active = false; MP.inRace = false;
  window.onRaceRetry = null;
  window.onLocalFinish = null;
  race.phase = 'menu';
  $('hud').style.display = 'none';
  showScreen('startScreen');
}
$('menuBtn').addEventListener('click', backToMenu);
$('quitBtn').addEventListener('click', backToMenu);
// 主菜单下隐藏 HUD (startRace 会重新显示)
$('hud').style.display = 'none';

})();
