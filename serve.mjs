// 本地服务器: node serve.mjs [端口]
//  - 静态托管游戏: http://localhost:8000 (局域网: http://<本机IP>:8000)
//  - WebSocket 联机中继 (零依赖, 单房间): 浏览器自动连接, 无需复制邀请码
import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'racecar');
const PORT = parseInt(process.argv[2], 10) || 8000;
const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg',
  '.json':'application/json', '.ico':'image/x-icon',
};

// ============================================================
//  WebSocket 中继 (RFC6455 最小实现, 单房间星型拓扑)
//  协议 (JSON 文本帧):
//    客户端 → 服务器: {hello:{role:'host'|'guest'}}
//                      {to:'*'|'host'|'<gid>', msg:<任意>}
//    服务器 → 客户端: {sys:'role', id, isHost}
//                      {sys:'peer', id, ev:'join'|'leave'}   (仅发给房主)
//                      {from:'<id>', msg:<任意>}             (消息中继)
// ============================================================
const clients = new Map(); // id -> { sock, isHost }
let hostId = null;
let guestSeq = 1;

function wsSend(sock, obj){
  if(sock.destroyed) return;
  const payload = Buffer.from(JSON.stringify(obj), 'utf8');
  const len = payload.length;
  let header;
  if(len < 126){
    header = Buffer.from([0x81, len]);
  } else if(len < 65536){
    header = Buffer.alloc(4); header[0]=0x81; header[1]=126; header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10); header[0]=0x81; header[1]=127; header.writeBigUInt64BE(BigInt(len), 2);
  }
  sock.write(Buffer.concat([header, payload]));
}

function relay(fromId, to, msg){
  if(to === '*'){
    for(const [id, c] of clients) if(id !== fromId) wsSend(c.sock, { from: fromId, msg });
  } else {
    const c = clients.get(to);
    if(c) wsSend(c.sock, { from: fromId, msg });
  }
}

function dropClient(id){
  const c = clients.get(id);
  if(!c) return;
  clients.delete(id);
  if(id === hostId){
    hostId = null;
    // 房主离开: 通知所有人 (客户端自行处理, 例如返回主菜单)
    for(const [, c2] of clients) wsSend(c2.sock, { sys:'peer', id, ev:'leave' });
  } else if(hostId && clients.has(hostId)){
    wsSend(clients.get(hostId).sock, { sys:'peer', id, ev:'leave' });
  }
  console.log(`[-] ${id} 离开 (${clients.size} 人在线)`);
}

function handleWsMessage(sock, id, text){
  let m;
  try{ m = JSON.parse(text); }catch{ return; }
  if(m.hello){
    // 角色分配: 第一个声明 host 的成为房主, 其余为客人
    let assigned;
    if(m.hello.role === 'host' && !hostId){
      assigned = 'host'; hostId = 'host';
    } else {
      assigned = 'g' + (guestSeq++);
    }
    clients.delete(id);
    clients.set(assigned, { sock, isHost: assigned === 'host' });
    sock._wsId = assigned;
    wsSend(sock, { sys:'role', id: assigned, isHost: assigned === 'host' });
    if(assigned !== 'host' && hostId && clients.has(hostId)){
      wsSend(clients.get(hostId).sock, { sys:'peer', id: assigned, ev:'join' });
    }
    console.log(`[+] ${assigned} 加入 (${clients.size} 人在线)`);
    return;
  }
  if(m.to && m.msg !== undefined){
    relay(id, m.to, m.msg);
  }
}

// 帧解码 (带缓冲, 处理粘包/分片)
function makeFrameParser(sock, onText, onClose){
  let buf = Buffer.alloc(0);
  let frags = null;
  return chunk => {
    buf = Buffer.concat([buf, chunk]);
    for(;;){
      if(buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const op = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if(len === 126){ if(buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if(len === 127){ if(buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const maskOff = off;
      if(masked) off += 4;
      if(buf.length < off + len) return;
      let payload = buf.subarray(off, off + len);
      if(masked){
        const mask = buf.subarray(maskOff, maskOff + 4);
        payload = Buffer.from(payload);
        for(let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      buf = buf.subarray(off + len);

      if(op === 0x8){ onClose(); return; }            // close
      if(op === 0x9){                                  // ping → pong
        const h = Buffer.from([0x8a, payload.length]);
        sock.write(Buffer.concat([h, payload]));
        continue;
      }
      if(op === 0xa) continue;                         // pong
      if(op === 0x1 || op === 0x0){                    // text / continuation
        frags = frags ? Buffer.concat([frags, payload]) : payload;
        if(fin){ const t = frags.toString('utf8'); frags = null; onText(t); }
      }
    }
  };
}

// ============================================================
//  HTTP 服务器 (静态 + WS upgrade)
// ============================================================
const server = http.createServer(async (req, res)=>{
  try{
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if(p === '/') p = '/racing-game.html';
    const file = path.join(ROOT, p);
    if(!file.startsWith(ROOT)) throw new Error('forbidden');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  }catch{
    if(!res.headersSent) res.writeHead(404);
    res.end('404 Not Found');
  }
});

server.on('upgrade', (req, sock)=>{
  if(!req.url.startsWith('/ws')){ sock.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if(!key){ sock.destroy(); return; }
  const accept = crypto.createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  sock.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  sock.setNoDelay(true);
  const tempId = 'tmp' + Math.random().toString(36).slice(2, 8);
  sock._wsId = tempId;
  clients.set(tempId, { sock, isHost: false });
  const parse = makeFrameParser(sock,
    text => handleWsMessage(sock, sock._wsId, text),
    () => sock.destroy()
  );
  sock.on('data', parse);
  sock.on('close', () => dropClient(sock._wsId));
  sock.on('error', () => dropClient(sock._wsId));
});

server.listen(PORT, ()=>{
  console.log(`\n  本机打开:  http://localhost:${PORT}\n`);
  for(const [name, addrs] of Object.entries(os.networkInterfaces()))
    for(const a of addrs||[])
      if(a.family === 'IPv4' && !a.internal)
        console.log(`  局域网访问: http://${a.address}:${PORT}  (${name})`);
  console.log('\n  联机: 同一局域网内打开上述地址, 点「创建房间/加入房间」即可自动连接');
  console.log('  按 Ctrl+C 停止\n');
});
