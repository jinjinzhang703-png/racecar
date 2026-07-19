// CDP 截图工具: 逐屏截取 UI 用于视觉审查
// 用法: node tests/cdp-shots.mjs [输出目录前缀]   例: node tests/cdp-shots.mjs before
import { spawn } from 'node:child_process';
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'racecar');
const OUT = path.join(ROOT, '..', 'tests', 'shots');
const PREFIX = process.argv[2] ? process.argv[2] + '-' : '';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIME = { '.html':'text/html', '.js':'text/javascript' };

await mkdir(OUT, { recursive: true });
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
  '--user-data-dir=' + path.join(ROOT, '..', 'tests', '.chrome-shots'),
  '--use-angle=swiftshader', '--mute-audio', '--window-size=1600,900',
  '--force-device-scale-factor=1',
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
const send = (method, params={})=>new Promise((r, j)=>{
  const id = ++msgId; pending.set(id, r);
  ws.send(JSON.stringify({ id, method, params }));
  setTimeout(()=>j(new Error('cdp timeout '+method)), 30000);
});
async function evalJs(expression){
  const r = await send('Runtime.evaluate', { expression, awaitPromise:true, returnByValue:true });
  if(r.result.exceptionDetails) throw new Error('JS异常: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
  return r.result.result.value;
}
const sleep = ms=>new Promise(r=>setTimeout(r,ms));
async function shot(name){
  const r = await send('Page.captureScreenshot', { format:'png' });
  await writeFile(path.join(OUT, PREFIX + name + '.png'), Buffer.from(r.result.data, 'base64'));
  console.log('shot:', PREFIX + name + '.png');
}
async function waitFor(expr, timeout=20000){
  const t0 = Date.now();
  while(Date.now()-t0 < timeout){
    try{ if(await evalJs(expr)) return; }catch{}
    await sleep(300);
  }
  throw new Error('等待超时: ' + expr);
}

try{
  await send('Emulation.setDeviceMetricsOverride', { width:1600, height:900, deviceScaleFactor:1, mobile:false });
  await send('Page.navigate', { url: PAGE_URL });
  await waitFor('window.__gameOK===true');
  await sleep(1500);
  await shot('01-menu');

  await evalJs(`document.getElementById('startBtn').click()`);
  await sleep(400);
  await shot('02-track');

  await evalJs(`document.getElementById('toGarageBtn').click()`);
  await sleep(500);
  await shot('03-garage');

  await evalJs(`document.getElementById('confirmCarBtn').click()`);
  await waitFor(`race.phase==='racing'`, 90000);
  await evalJs(`input.acc=true`);
  await sleep(2500);
  await shot('04-race');

  // 结算屏 (直接触发)
  await evalJs(`input.acc=false; endRace(); 'ok'`);
  await sleep(400);
  await shot('05-results');

  // 大厅 (房主视角, 新页面)
  await send('Page.navigate', { url: PAGE_URL });
  await waitFor('window.__gameOK===true');
  await sleep(800);
  await evalJs(`document.getElementById('hostBtn').click()`);
  await sleep(1000);
  await shot('06-lobby-host');

  console.log('done →', OUT);
}catch(e){
  console.error('异常:', e.message);
  process.exitCode = 1;
}finally{
  proc.kill();
  server.close();
}
