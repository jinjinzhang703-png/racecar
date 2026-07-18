// 本地静态服务器: node serve.mjs [端口]
// 打开 http://localhost:8000 即可玩游戏; 局域网内其他设备访问 http://<本机IP>:8000
import http from 'node:http';
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

http.createServer(async (req, res)=>{
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
}).listen(PORT, ()=>{
  console.log(`\n  本机打开:  http://localhost:${PORT}\n`);
  for(const [name, addrs] of Object.entries(os.networkInterfaces()))
    for(const a of addrs||[])
      if(a.family === 'IPv4' && !a.internal)
        console.log(`  局域网访问: http://${a.address}:${PORT}  (${name})`);
  console.log('\n按 Ctrl+C 停止\n');
});
