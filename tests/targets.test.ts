import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { rm, symlink, writeFile } from 'node:fs/promises';
import { workspace } from './helpers.js';
import { searchTargets } from '../packages/web/targets.js';
import { serve } from '../packages/web/server.js';

test('file search reaches beyond the initial 1500 suggestions through the local API', async t => {
  const files: Record<string, string> = { 'src/payments/refund.ts': '' };
  for (let index = 0; index < 1600; index++) files[`alpha/file-${String(index).padStart(4, '0')}.ts`] = '';
  const w = await workspace(files);
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const server = await serve({ ...w, user: false, clients: ['codex'] });
  t.after(server.close);
  const initial = await (await fetch(server.url + '/api/targets')).json();
  assert.equal(initial.paths.length, 1500);
  assert.equal(initial.hasMore, true);
  assert.ok(!initial.paths.includes('src/payments/refund.ts'));
  const result = await (await fetch(server.url + '/api/targets?q=refund.ts&limit=10')).json();
  assert.equal(result.paths[0], 'src/payments/refund.ts');
  assert.equal(result.truncated, false);
  const limited = await searchTargets(w.repo, { query: 'refund.ts', maxEntries: 5 });
  assert.equal(limited.truncated, true);
});

test('file search ranks exact names, supports fuzzy and Windows-style queries, and includes hidden project files', async t => {
  const w = await workspace({ 'src/refund.ts': '', 'lib/refund-log.ts': '', '.github/workflows/ci.yml': '', 'node_modules/lib/refund.ts': '', 'dist/refund.ts': '', 'build': '' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const exact = await searchTargets(w.repo, { query: 'refund.ts' });
  assert.equal(exact.paths[0], 'src/refund.ts');
  assert.ok(exact.paths.every(value => !value.startsWith('node_modules/') && !value.startsWith('dist/')));
  assert.equal((await searchTargets(w.repo, { query: 'srcrefts' })).paths[0], 'src/refund.ts');
  assert.equal((await searchTargets(w.repo, { query: 'src\\ref' })).paths[0], 'src/refund.ts');
  assert.equal((await searchTargets(w.repo, { query: 'src/' })).paths[0], 'src/');
  assert.equal((await searchTargets(w.repo, { query: path.join(w.repo, 'src/refund.ts') })).paths[0], 'src/refund.ts');
  assert.equal((await searchTargets(w.repo, { query: 'ci.yml' })).paths[0], '.github/workflows/ci.yml');
  assert.ok((await searchTargets(w.repo)).paths.includes('build'));
});

test('file search skips external directory symlinks', { skip: process.platform === 'win32' }, async t => {
  const w = await workspace();
  t.after(() => rm(w.root, { recursive: true, force: true }));
  await writeFile(path.join(w.home, 'private-target.ts'), '');
  await symlink(w.home, path.join(w.repo, 'external'));
  const result = await searchTargets(w.repo, { query: 'private-target' });
  assert.deepEqual(result.paths, []);
});
