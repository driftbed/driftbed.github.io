import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.md':'text/markdown; charset=utf-8','.png':'image/png','.wav':'audio/wav'};
const server = http.createServer(async (req,res)=>{
  try {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const path = normalize(join(root, rel));
    if (!path.startsWith(root)) throw new Error('forbidden');
    const s = await stat(path); if (!s.isFile()) throw new Error('not file');
    const data = await readFile(path);
    res.writeHead(200, {'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-cache'}); res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
});
const port = Number(process.env.PORT || 8080);
server.listen(port, '127.0.0.1', ()=>console.log(`Open http://127.0.0.1:${port}`));
