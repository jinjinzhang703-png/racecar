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
  //  公共
  // ============================================================
  return {
    get isHost(){ return isHost; },
    get guestCount(){ return guests.size; },
    guestIds(){ return [...guests.keys()]; },
    host(){
      isHost = true; myId = 'host';
    },
    setGuest(){
      isHost = false; myId = 'guest';
    },
    get myId(){ return myId; },
    createInvite, acceptAnswer,
    join, waitOpen, send, sendTo, broadcast,
    onMessage(fn){ msgHandlers.push(fn); },
    onPeer(fn){ peerHandlers.push(fn); },
    supported: typeof RTCPeerConnection !== 'undefined',
  };
})();
