// 抓拍: T骨碰撞起飞瞬间 + 翻车倒扣
import { spawn } from 'node:child_process';
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'racecar');
const OUT = path.join(ROOT, '..', 'tests', 'shots');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const server = http.createServer(async (req,res)=>{
  try{ const p = path.join(ROOT, req.url==='/'?'racing-game.html':decodeURIComponent(req.url));
    const d = await readFile(p); res.writeHead(200,{'Content-Type':p.endsWith('.html')?'text/html':'text/javascript','Cache-Control':'no-cache'}); res.end(d);
  }catch{ if(!res.headersSent) res.writeHead(404); res.end(); }
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const PAGE_URL = `http://127.0.0.1:${server.address().port}/racing-game.html`;
const proc = spawn(CHROME, ['--headless=new','--remote-debugging-port=0','--no-first-run',
  '--user-data-dir='+path.join(ROOT,'..','tests','.chrome-fs'),'--use-angle=swiftshader','--mute-audio','--window-size=1600,900',
  '--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','about:blank']);
const wsUri = await new Promise((res,rej)=>{let b='';proc.stderr.on('data',d=>{b+=d;const m=b.match(/DevTools listening on (ws:\/\/\S+)/);if(m)res(m[1]);});setTimeout(()=>rej(new Error('to')),15000);});
const port = new URL(wsUri).port;
let id=0; const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
const ws = new WebSocket(t.webSocketDebuggerUrl); const pending=new Map();
ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}};
await new Promise(r=>ws.onopen=r);
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;pending.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:p}));setTimeout(()=>j(new Error('timeout')),30000);});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});
  if(r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description||r.result.exceptionDetails.text);
  return r.result.result.value;};
const shot=async name=>{ const r=await send('Page.captureScreenshot',{format:'png'});
  await writeFile(path.join(OUT,name+'.png'), Buffer.from(r.result.data,'base64')); console.log('shot:',name); };
await send('Emulation.setDeviceMetricsOverride',{width:1600,height:900,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url:PAGE_URL});
for(let i=0;i<40;i++){ try{ if(await ev('window.__gameOK===true')) break; }catch{} await new Promise(r=>setTimeout(r,300)); }
await ev(`document.getElementById('startBtn').click();document.getElementById('toGarageBtn').click();document.getElementById('confirmCarBtn').click();'ok'`);
await new Promise(r=>setTimeout(r,500));
await ev(`race.phase='racing'; 'ok'`);
// T骨: 玩家撞 AI 侧面, 相机跟拍
await ev(`(()=>{
  const b = cars.find(c=>!c.isPlayer);
  b.pos.set(15, 0, 340); b.heading = 0; b.speed = 0; b.velocity.set(0,0,0);
  player.pos.set(0, 0, 340); player.heading = Math.PI/2;
  player.speed = 55; player.velocity.set(55, 0, 0); player.angularVel = 0;
  window.__b = b; return true;
})()`);
// 等 B 起飞后连拍
for(let i=0;i<60;i++){ try{ if(await ev(`window.__b.y > 0.5 || window.__b.airborne`)) break; }catch{} await new Promise(r=>setTimeout(r,100)); }
await shot('flip-01-airborne');
await new Promise(r=>setTimeout(r,600));
await shot('flip-02-airborne2');
for(let i=0;i<80;i++){ try{ if(await ev(`window.__b.flipped`)) break; }catch{} await new Promise(r=>setTimeout(r,100)); }
await shot('flip-03-flipped');
proc.kill(); server.close(); process.exit(0);
