import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { once } from 'node:events';
import path from 'node:path';
import { serve } from '../packages/web/server.js';
import { portable } from '../packages/reporter/index.js';
import { workspace } from './helpers.js';
test('read-only local UI serves, scans target, exports portable HTML and rejects external origin', async t => {
  const w = await workspace({ 'CLAUDE.md': 'root', 'src/a.ts': '' }); t.after(() => rm(w.root, { recursive: true, force: true }));
  const server = await serve({ ...w, clients: ['claude'] }); t.after(server.close);
  const page = await fetch(server.url); assert.equal(page.status, 200); assert.ok((await page.text()).includes('Sightline — Agent configuration'));
  const response = await fetch(server.url + '/api/scan?target=src/a.ts'); const r = await response.json(); assert.equal(response.status, 200); assert.ok(r.target.endsWith('a.ts'));
  assert.equal((await fetch(server.url + '/api/scan?target=../outside')).status, 400);
  assert.equal((await fetch(server.url, { method: 'POST' })).status, 405);
  assert.equal((await fetch(server.url, { headers: { Origin: 'https://other.example' } })).status, 403);
  const paths = await (await fetch(server.url + '/api/targets')).json(); assert.ok(paths.paths.includes('src/a.ts'));
  await writeFile(path.join(w.repo, 'src/new.ts'), '');
  const updatedPaths = await (await fetch(server.url + '/api/targets')).json(); assert.ok(updatedPaths.paths.includes('src/new.ts'));
  for (const query of ['limit=0', 'limit=1501', 'limit=wrong', 'q=' + 'x'.repeat(2049)]) assert.equal((await fetch(server.url + '/api/targets?' + query)).status, 400);
  const trusted = await (await fetch(server.url + '/api/scan?target=src/a.ts&trust=untrusted')).json(); assert.ok(trusted.assumptions.some((value: string) => value.includes('Trust: untrusted;')));
  const output = await (await fetch(server.url + '/api/export?target=src/a.ts')).text(); assert.ok(!output.includes(w.repo)); assert.ok(output.includes('data-live="false"'));
  const demo = await (await fetch(server.url + '/demo/')).text(); assert.ok(demo.includes('instructions.truncated')); assert.ok(!demo.includes(w.repo)); assert.ok(!demo.includes(w.home)); assert.ok(demo.includes('data-live="false"'));
});

test('server file search and scans retain filesystem paths when report paths are redacted', async t => {
  const w = await workspace({ 'src/a.ts': '' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  await writeFile(path.join(w.repo, '.mcp.json'), JSON.stringify({ mcpServers: { fixture: { command: 'node', env: { PROJECT_ROOT: w.repo } } } }));
  const server = await serve({ ...w, user: false, clients: ['claude'] });
  t.after(server.close);
  const page = await fetch(server.url);
  assert.equal(page.status, 200);
  const report = await (await fetch(server.url + '/api/scan?target=src/a.ts')).json();
  assert.equal(report.repository, '[REDACTED]');
  const targets = await (await fetch(server.url + '/api/targets')).json();
  assert.ok(targets.paths.includes('src/a.ts'));
  assert.equal(targets.truncated, false);
});

test('profile selection and clearing survive local scans, reloads and portable exports', async t => {
  const w = await workspace({}, { '.codex/config.toml': 'model = "base"', '.codex/review.config.toml': 'model = "review"' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const server = await serve({ ...w, clients: ['codex'], codexProfile: 'review' });
  t.after(server.close);
  const selected = await (await fetch(server.url + '/api/scan')).json();
  assert.equal(selected.inputs.codexProfile, 'review');
  const cleared = await (await fetch(server.url + '/api/scan?profile=')).json();
  assert.equal(cleared.inputs?.codexProfile, undefined);
  assert.equal(cleared.clients[0].settings.find((setting: any) => setting.key === 'model').value, 'base');
  const page = await (await fetch(server.url + '/?profile=')).text();
  assert.ok(!page.includes('"codexProfile":"review"'));
  const snapshot = await (await fetch(server.url + '/api/export?profile=review')).text();
  assert.ok(snapshot.includes('"codexProfile":"review"'));
  assert.ok(!snapshot.includes(w.home));
  assert.equal((await fetch(server.url + '/api/scan?profile=..%2Fprivate')).status, 400);
});

test('scan responses can pair their report with a portable HTML snapshot from the same inspection', async t => {
  const w = await workspace({ 'CLAUDE.md': 'Instructions before editing.\nAPI_KEY=private-export-sentinel' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const server = await serve({ ...w, user: false, clients: ['claude'] });
  t.after(server.close);
  const response = await fetch(server.url + '/api/scan?include=html');
  assert.equal(response.status, 200);
  const result = await response.json();
  const exported = JSON.parse(result.html.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(exported, portable(result.report));
  assert.equal(exported.repository, '<repo>');
  assert.equal(exported.target, '<repo>');
  assert.ok(!result.html.includes(w.repo));
  assert.ok(!result.html.includes('private-export-sentinel'));
  await writeFile(path.join(w.repo, 'CLAUDE.md'), 'Instructions after editing.');
  const current = await (await fetch(server.url + '/api/scan')).json();
  assert.equal(current.clients[0].instructions, 'Instructions after editing.');
  assert.ok(result.report.clients[0].instructions.includes('Instructions before editing.'));
  assert.ok(result.html.includes('Instructions before editing.'));
  const refreshedExport = await (await fetch(server.url + '/api/export')).text();
  assert.ok(refreshedExport.includes('Instructions after editing.'));
});


test('local inspector cancels disconnected scans and preserves caller cancellation', { timeout: 15000 }, async t => {
  const w = await workspace({ 'AGENTS.md': 'Root instructions.', 'nested/AGENTS.md': 'Nested instructions.' });
  const caller = new AbortController();
  const server = await serve({ ...w, user: false, clients: ['codex'], trust: 'trusted', signal: caller.signal });
  let pendingRead = {
    file: '',
    started: Promise.withResolvers<AbortSignal | undefined>(),
    release: Promise.withResolvers<void>(),
  };
  const originalRead = fs.readFile;
  t.mock.method(fs, 'readFile', async (filename: Parameters<typeof fs.readFile>[0], options: any) => {
    if (filename === pendingRead.file) {
      const pending = pendingRead;
      pending.file = '';
      pending.started.resolve(typeof options === 'object' ? options?.signal : undefined);
      await pending.release.promise;
    }
    return originalRead(filename, options);
  });
  syncBuiltinESMExports();
  t.after(async () => {
    pendingRead.release.resolve();
    t.mock.restoreAll();
    syncBuiltinESMExports();
    await server.close();
    await rm(w.root, { recursive: true, force: true });
  });
  for (const route of ['/', '/api/scan?include=html', '/api/export', '/demo/']) {
    pendingRead = {
      file: route === '/demo/' ? path.resolve('examples/broken-agent-config/AGENTS.md') : path.join(w.repo, 'AGENTS.md'),
      started: Promise.withResolvers<AbortSignal | undefined>(),
      release: Promise.withResolvers<void>(),
    };
    const pending = pendingRead;
    const client = new AbortController();
    const request = fetch(server.url + route, { signal: client.signal });
    const disconnected = assert.rejects(request, { name: 'AbortError' });
    try {
      const signal = await pending.started.promise;
      assert.ok(signal instanceof AbortSignal, route);
      assert.notEqual(signal, caller.signal, route);
      const cancelled = once(signal, 'abort');
      client.abort();
      await cancelled;
      assert.equal(signal.aborted, true, route);
      assert.equal(caller.signal.aborted, false, route);
    } finally {
      client.abort();
      pending.release.resolve();
      await disconnected;
    }
  }
  const healthy = await fetch(server.url + '/api/scan?target=nested/new.ts');
  assert.equal(healthy.status, 200);
  const report = await healthy.json();
  assert.ok(report.clients[0].instructions.includes('Nested instructions.'));
  pendingRead = {
    file: path.join(w.repo, 'AGENTS.md'),
    started: Promise.withResolvers<AbortSignal | undefined>(),
    release: Promise.withResolvers<void>(),
  };
  const request = fetch(server.url + '/api/scan');
  const signal = await pendingRead.started.promise;
  assert.ok(signal);
  const cancelled = once(signal, 'abort');
  caller.abort();
  await cancelled;
  pendingRead.release.resolve();
  assert.equal((await request).status, 400);
});
