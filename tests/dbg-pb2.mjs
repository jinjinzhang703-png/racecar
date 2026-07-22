import { spawn } from 'node:child_process';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'racecar');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const server = http.createServer(async (req,res)=>{
  try{ const p = path.join(ROOT, req.url==='/'?'racing-game.html':decodeURIComponent(req.url));
    const d = await readFile(p); res.writeHead(200,{'Content-Type':p.endsWith('.html')?'text/html':'text/javascript','Cache-Control':'no-cache'}); res.end(d);
  }catch{ if(!res.headersSent) res.writeHead(404); res.end(); }
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const PAGE_URL = `http://127.0.0.1:${server.address().port}/racing-game.html`;
const proc = spawn(CHROME, ['--headless=new','--remote-debugging-port=0','--no-first-run',
  '--user-data-dir='+path.join(ROOT,'..','tests','.chrome-pb2'),'--use-angle=swiftshader','--mute-audio','--window-size=800,600',
  '--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','about:blank']);
const wsUri = await new Promise((res,rej)=>{let b='';proc.stderr.on('data',d=>{b+=d;const m=b.match(/DevTools listening on (ws:\/\/\S+)/);if(m)res(m[1]);});setTimeout(()=>rej(new Error('to')),15000);});
const port = new URL(wsUri).port;
let id=0; const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); const pending=new Map();
ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}};
await new Promise(r=>ws.onopen=r);
const send=(m,p={})=>new Promise(r=>{const i=++id;pending.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:p}));});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});
  if(r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description||r.result.exceptionDetails.text);
  return r.result.result.value;};
await send('Page.navigate',{url:PAGE_URL});
for(let i=0;i<40;i++){ try{ if(await ev('window.__gameOK===true')) break; }catch{} await new Promise(r=>setTimeout(r,300)); }
await ev(`document.getElementById('startBtn').click();document.getElementById('toGarageBtn').click();document.getElementById('confirmCarBtn').click();'ok'`);
await new Promise(r=>setTimeout(r,500));
// 隔离: 所有AI扔到远处
await ev(`(()=>{
  race.phase='racing';
  for(const c of cars){ if(!c.isPlayer){ c.pos.set(1000,0,-1000); c.speed=0; c.velocity.set(0,0,0); c.isRemote=true; } }
  player.pos.set(-312, 0, 336); player.heading = Math.PI*0.8;
  player.speed = 50; player.velocity.set(Math.sin(Math.PI*0.8)*50, 0, Math.cos(Math.PI*0.8)*50);
  player.angularVel=0; player.collisionLock=0; player.crashTimer=0; player.inReverse=false;
  pitGame.active=false; input.acc=true; input.brake=false;
  return true;
})()`);
for(let i=0;i<10;i++){
  await new Promise(r=>setTimeout(r,500));
  console.log(await ev(`JSON.stringify({x:+player.pos.x.toFixed(1), z:+player.pos.z.toFixed(1), sp:+player.speed.toFixed(1), lock:+player.collisionLock.toFixed(2), inPit:isInPitLane(player.pos)})`));
}
await ev(`input.acc=false; 'ok'`);
proc.kill(); server.close(); process.exit(0);
