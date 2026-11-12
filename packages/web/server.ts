import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ScanOptions } from '../core/types.js';
import { scan } from '../core/index.js';
import { html, json } from '../reporter/index.js';

export async function serve(options: ScanOptions, port = 0): Promise<{ url: string; close: () => Promise<void> }> {
  const initial = await scan(options);
  const server = createServer(async (req, res) => {
    const address = server.address() as AddressInfo;
    const expected = `127.0.0.1:${address.port}`;
    if (req.headers.host !== expected || req.headers.origin && req.headers.origin !== `http://${expected}`) { res.writeHead(403); res.end('Local origin required.'); return; }
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Frame-Options', 'DENY');
    if (req.method !== 'GET') { res.writeHead(405); res.end('Read-only endpoint.'); return; }
    const url = new URL(req.url ?? '/', `http://${expected}`);
    try {
      if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html(initial, { live: true, portable: false })); }
      else if (url.pathname === '/api/scan') {
        const target = url.searchParams.get('target') ?? '.';
        if (target.length > 2048) throw new Error('Target path is too long.');
        const report = await scan({ ...options, target }); res.setHeader('Content-Type', 'application/json'); res.end(json(report));
      } else if (url.pathname === '/api/export') {
        const report = await scan({ ...options, target: url.searchParams.get('target') ?? options.target });
        res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="agent-sightline-report.html"'); res.end(html(report));
      } else { res.writeHead(404); res.end('Not found.'); }
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Cannot inspect target. Choose a path inside the repository with an existing parent directory.' }));
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve()); });
  const address = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise((resolve, reject) => { server.close(e => e ? reject(e) : resolve()); server.closeAllConnections(); }) };
}
