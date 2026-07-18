// ============================================================
//  Net — 纯浏览器 WebRTC 局域网联机 (手动信令, 星型拓扑)
//
//  无需任何服务器: 房主生成「邀请码」(SDP offer, base64),
//  客人粘贴后生成「应答码」(SDP answer) 回传给房主, 连接建立.
//  同局域网无需 STUN (host candidate 即可互通).
//
//  拓扑: 星型 — 客人只与房主直连, 房主负责中继/广播.
//  消息: JSON over RTCDataChannel.
// ============================================================
const Net = (function(){
  let isHost = false;
  let myId = null;
  // 客人端: 与房主的唯一连接
  let pc = null, dc = null;
  // 房主端: 已接入的客人 guestId -> { pc, dc }
  const guests = new Map();
  // 房主端: 等待应答码的槽位 [{ slot, pc, dc, guestId }]
  const pendings = [];
  let nextGuestNum = 1;

  const msgHandlers = [];       // fn(fromId, obj)  fromId='host' 表示来自房主
  const peerHandlers = [];      // fn(guestId, 'join'|'leave') 仅房主端触发
  let openResolve = null;

  // ---------- 编码 ----------
  const encode = desc => btoa(unescape(encodeURIComponent(JSON.stringify(desc))));
  function decode(code){
    code = (code||'').trim().replace(/\s+/g,'');
    return JSON.parse(decodeURIComponent(escape(atob(code))));
  }

  // 等待 ICE gathering 完成 (3s 超时兜底, 避免卡死)
  function waitIce(conn){
    return new Promise(res=>{
      if(conn.iceGatheringState==='complete') return res();
      const to = setTimeout(res, 3000);
      conn.addEventListener('icegatheringstatechange', ()=>{
        if(conn.iceGatheringState==='complete'){ clearTimeout(to); res(); }
      });
    });
  }

  function newPC(){
    return new RTCPeerConnection({ iceServers: [] }); // 局域网不需要 STUN
  }

  function emitMsg(fromId, text){
    let obj;
    try{ obj = JSON.parse(text); }catch(e){ return; }
    msgHandlers.forEach(fn=>{ try{ fn(fromId, obj); }catch(e){ console.error('[Net] handler', e); } });
  }

  // ============================================================
  //  房主端
  // ============================================================

  // 生成一个邀请码槽位, 返回 { slot, code }
  async function createInvite(){
    const conn = newPC();
    const channel = conn.createDataChannel('game', { ordered: true });
    const pending = { slot: pendings.length, pc: conn, dc: channel, guestId: null };
    pendings.push(pending);

    channel.onopen = ()=>{
      // 连接建立: 分配 guestId, 移入 guests
      const gid = 'g' + (nextGuestNum++);
      pending.guestId = gid;
      guests.set(gid, { pc: conn, dc: channel });
      channel.onmessage = ev => emitMsg(gid, ev.data);
      channel.onclose = ()=> dropGuest(gid);
      peerHandlers.forEach(fn=>fn(gid, 'join'));
    };
    channel.onclose = ()=>{ if(pending.guestId) dropGuest(pending.guestId); };

    await conn.setLocalDescription(await conn.createOffer());
    await waitIce(conn);
    return { slot: pending.slot, code: encode(conn.localDescription) };
  }

  // 粘贴客人的应答码, 完成握手
  async function acceptAnswer(slot, code){
    const pending = pendings[slot];
    if(!pending) throw new Error('无效的邀请槽位');
    await pending.pc.setRemoteDescription(decode(code));
    // 连接结果通过 channel.onopen / ICE 失败体现
  }

  function dropGuest(gid){
    if(guests.delete(gid)) peerHandlers.forEach(fn=>fn(gid, 'leave'));
  }

  function sendTo(gid, obj){
    const g = guests.get(gid);
    if(g && g.dc.readyState==='open') g.dc.send(JSON.stringify(obj));
  }

  function broadcast(obj){
    const text = JSON.stringify(obj);
    guests.forEach(g=>{ if(g.dc.readyState==='open') g.dc.send(text); });
  }

  // ============================================================
  //  客人端
  // ============================================================

  // 粘贴房主邀请码, 返回应答码 (Promise<string>)
  async function join(offerCode){
    pc = newPC();
    pc.ondatachannel = ev=>{
      dc = ev.channel;
      dc.onopen = ()=>{ if(openResolve){ openResolve(); openResolve=null; } };
      dc.onmessage = e2 => emitMsg('host', e2.data);
      dc.onclose = ()=>{ peerHandlers.forEach(fn=>fn('host', 'leave')); };
    };
    await pc.setRemoteDescription(decode(offerCode));
    await pc.setLocalDescription(await pc.createAnswer());
    await waitIce(pc);
    return encode(pc.localDescription);
  }

  // 等待与房主的 DataChannel 打通
  function waitOpen(){
    if(dc && dc.readyState==='open') return Promise.resolve();
    return new Promise(res=>{ openResolve = res; });
  }

  // 客人 → 房主
  function send(obj){
    if(dc && dc.readyState==='open') dc.send(JSON.stringify(obj));
  }

  // ============================================================
  //  服务器模式 (serve.mjs 内置 WebSocket 中继, 无需复制邀请码)
  // ============================================================
  let ws = null;
  let serverMode = false;
  const serverGuests = new Set();

  function wsSendJson(obj){
    if(ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  // 连接服务器并声明角色 ('host'|'guest'), 返回 {id, isHost}
  function connectServer(url, role){
    return new Promise((resolve, reject)=>{
      let settled = false;
      const fail = e => { if(!settled){ settled = true; reject(e); } };
      try{ ws = new WebSocket(url); }catch(e){ fail(e); return; }
      ws.onopen = ()=> ws.send(JSON.stringify({ hello:{ role } }));
      ws.onerror = ()=> fail(new Error('WebSocket 连接失败'));
      ws.onclose = ()=>{
        if(!settled){ fail(new Error('连接已关闭')); return; }
        if(!isHost) peerHandlers.forEach(fn=>fn('host', 'leave'));
      };
      ws.onmessage = ev=>{
        let m; try{ m = JSON.parse(ev.data); }catch{ return; }
        if(m.sys === 'role'){
          serverMode = true;
          isHost = m.isHost; myId = m.id;
          if(!settled){ settled = true; resolve(m); }
          return;
        }
        if(m.sys === 'peer'){
          if(m.ev === 'join') serverGuests.add(m.id); else serverGuests.delete(m.id);
          peerHandlers.forEach(fn=>fn(m.id, m.ev));
          return;
        }
        if(m.from !== undefined) emitMsg(m.from, JSON.stringify(m.msg));
      };
    });
  }

  // 探测服务器模式是否可用 (http 页面 + WS 可连)
  function serverAvailable(timeoutMs = 1500){
    if(!location.protocol.startsWith('http')) return Promise.resolve(false);
    if(typeof WebSocket === 'undefined') return Promise.resolve(false);
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    return new Promise(res=>{
      let done = false;
      const finish = ok => { if(!done){ done = true; try{ probe.close(); }catch(e){} res(ok); } };
      let probe;
      try{ probe = new WebSocket(url); }catch(e){ res(false); return; }
      const timer = setTimeout(()=>finish(false), timeoutMs);
      probe.onopen = ()=>{ clearTimeout(timer); finish(true); };
      probe.onerror = ()=>{ clearTimeout(timer); finish(false); };
    });
  }

  // ============================================================
  //  公共
  // ============================================================
  return {
    get isHost(){ return isHost; },
    get serverMode(){ return serverMode; },
    get guestCount(){ return serverMode ? serverGuests.size : guests.size; },
    guestIds(){ return serverMode ? [...serverGuests] : [...guests.keys()]; },
    host(){
      isHost = true; myId = 'host';
    },
    setGuest(){
      isHost = false; myId = 'guest';
    },
    get myId(){ return myId; },
    createInvite, acceptAnswer,
    join, waitOpen,
    connectServer, serverAvailable,
    send(obj){
      if(serverMode){ wsSendJson({ to:'host', msg:obj }); return; }
      if(dc && dc.readyState==='open') dc.send(JSON.stringify(obj));
    },
    sendTo(gid, obj){
      if(serverMode){ wsSendJson({ to:gid, msg:obj }); return; }
      const g = guests.get(gid);
      if(g && g.dc.readyState==='open') g.dc.send(JSON.stringify(obj));
    },
    broadcast(obj){
      if(serverMode){ wsSendJson({ to:'*', msg:obj }); return; }
      const text = JSON.stringify(obj);
      guests.forEach(g=>{ if(g.dc.readyState==='open') g.dc.send(text); });
    },
    onMessage(fn){ msgHandlers.push(fn); },
    onPeer(fn){ peerHandlers.push(fn); },
    supported: typeof RTCPeerConnection !== 'undefined',
  };
})();
