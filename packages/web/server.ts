import { createServer } from 'node:http';
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
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
      if (url.pathname === '/') {
        const report = await scan({ ...options, target: url.searchParams.get('target') ?? options.target, trust: requestedTrust(url, options.trust) });
        res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html(report, { live: true, portable: false }));
      }
      else if (url.pathname === '/demo/') {
        const report = await scan({ repo: fileURLToPath(new URL('../../examples/broken-agent-config', import.meta.url)), target: 'src/payments/refund.ts', user: false, trust: 'trusted', clients: ['codex', 'claude', 'copilot'] });
        res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html(report));
      }
      else if (url.pathname === '/api/scan') {
        const target = url.searchParams.get('target') ?? '.';
        if (target.length > 2048) throw new Error('Target path is too long.');
        const trust = requestedTrust(url, options.trust);
        const report = await scan({ ...options, target, trust }); res.setHeader('Content-Type', 'application/json'); res.end(json(report));
      } else if (url.pathname === '/api/export') {
        const report = await scan({ ...options, trust: requestedTrust(url, options.trust), target: url.searchParams.get('target') ?? options.target });
        res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="agent-sightline-report.html"'); res.end(html(report));
      } else if (url.pathname === '/api/targets') {
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ paths: await listTargets(initial.repository) }));
      } else { res.writeHead(404); res.end('Not found.'); }
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Cannot inspect target. Choose a path inside the repository with an existing parent directory.' }));
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve()); });
  const address = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise((resolve, reject) => { server.close(e => e ? reject(e) : resolve()); server.closeAllConnections(); }) };
}

function requestedTrust(url: URL, fallback: ScanOptions['trust']): ScanOptions['trust'] {
  const value = url.searchParams.get('trust');
  if (value === null) return fallback;
  if (value === 'auto' || value === 'trusted' || value === 'untrusted') return value;
  throw new Error('Invalid workspace trust value.');
}

async function listTargets(repository: string): Promise<string[]> {
  const paths = ['.'];
  const excluded = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor', 'target']);
  let entriesVisited = 0;
  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > 12 || entriesVisited >= 20000 || paths.length >= 1500) return;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : 1)) {
      if (++entriesVisited >= 20000 || paths.length >= 1500) break;
      if (entry.name.startsWith('.') || excluded.has(entry.name) || entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(repository, absolute).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        paths.push(relative + '/');
        await walk(absolute, depth + 1);
      } else if (entry.isFile()) paths.push(relative);
    }
  }
  await walk(repository, 0);
  return paths;
}
