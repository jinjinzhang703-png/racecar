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
  }catch{ res.writeHead(404); res.end(); }
});
await new Promise(r=>server.listen(0, '127.0.0.1', r));
const PAGE_URL = `http://127.0.0.1:${server.address().port}/racing-game.html`;

const proc = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0', '--no-first-run',
  '--user-data-dir=' + path.join(ROOT, '..', 'tests', '.chrome-dbgrevstop'),
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
  if(r.result.exceptionDetails) throw new Error('JS异常: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
  return r.result.result.value;
}
const sleep = ms=>new Promise(r=>setTimeout(r,ms));

try{
  await send('Page.navigate', { url: PAGE_URL });
  await sleep(5000);
  await evalJs(`document.getElementById('startBtn').click();document.getElementById('toGarageBtn').click();document.getElementById('confirmCarBtn').click();'ok'`);
  await sleep(3000);
  await evalJs(`race.phase='racing'; player.speed=0; player.velocity.set(0,0,0); input.acc=false; input.brake=false; 'ok'`);
  await sleep(300);
  await evalJs(`input.brake=true; 'ok'`);
  for(let i=0;i<20;i++){ await sleep(250); if(await evalJs('player.inReverse')) break; }
  console.log('inReverse:', await evalJs('player.inReverse'));
  await sleep(1000);
  console.log('speed before release:', await evalJs('player.speed'));
  await evalJs(`input.brake=false; input.acc=false; 'ok'`);
  for(let i=0;i<20;i++){
    await sleep(500);
    const s = await evalJs(`JSON.stringify({speed:player.speed, inRev:player.inReverse, vel:{x:player.velocity.x,z:player.velocity.z}})`).then(JSON.parse);
    console.log(i, JSON.stringify(s));
    if(Math.abs(s.speed) < 0.5) { console.log('OK stopped'); break; }
  }
}catch(e){ console.error(e); }
finally{ proc.kill(); server.close(); process.exit(0); }
