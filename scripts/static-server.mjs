import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';

export async function serveStatic(root, port = 0, basePath = '/') {
  const directory = path.resolve(root);
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.xml': 'application/xml; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain', '.tgz': 'application/gzip' };
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (!url.pathname.startsWith(basePath)) { response.writeHead(404); response.end('Not found'); return; }
    let file;
    try { file = path.resolve(directory, decodeURIComponent(url.pathname.slice(basePath.length))); } catch { response.writeHead(400); response.end(); return; }
    if (file !== directory && !file.startsWith(directory + path.sep)) { response.writeHead(403); response.end(); return; }
    try {
      if (statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!statSync(file).isFile()) throw new Error();
      response.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
      createReadStream(file).pipe(response);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
