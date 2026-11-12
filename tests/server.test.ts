import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { serve } from '../packages/web/server.js';
import { workspace } from './helpers.js';
test('read-only local UI serves, scans target, exports portable HTML and rejects external origin', async t => {
  const w = await workspace({ 'CLAUDE.md': 'root', 'src/a.ts': '' }); t.after(() => rm(w.root, { recursive: true, force: true }));
  const server = await serve({ ...w, clients: ['claude'] }); t.after(server.close);
  const page = await fetch(server.url); assert.equal(page.status, 200); assert.ok((await page.text()).includes('Configuration, in focus.'));
  const response = await fetch(server.url + '/api/scan?target=src/a.ts'); const r = await response.json(); assert.equal(response.status, 200); assert.ok(r.target.endsWith('a.ts'));
  assert.equal((await fetch(server.url + '/api/scan?target=../outside')).status, 400);
  assert.equal((await fetch(server.url, { method: 'POST' })).status, 405);
  assert.equal((await fetch(server.url, { headers: { Origin: 'https://other.example' } })).status, 403);
  const output = await (await fetch(server.url + '/api/export?target=src/a.ts')).text(); assert.ok(!output.includes(w.repo)); assert.ok(output.includes('data-live="false"'));
});
