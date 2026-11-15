import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { rm, symlink } from 'node:fs/promises';
import { scan } from '../packages/core/index.js';
import { makeContext } from '../packages/core/discovery.js';
import { portable, terminal } from '../packages/reporter/index.js';
import { workspace } from './helpers.js';

test('starting directory controls startup instructions while Claude follows an opened descendant target', async t => {
  const w = await workspace({
    'AGENTS.md': 'Root agent instructions.', 'CLAUDE.md': 'Root Claude instructions.',
    'src/AGENTS.md': 'Nested agent instructions.', 'src/CLAUDE.md': 'Nested Claude instructions.',
    'docs/AGENTS.md': 'Session agent instructions.', 'docs/CLAUDE.md': 'Session Claude instructions.',
    'src/file.ts': '',
    '.codex/config.toml': 'model="root-model"', 'src/.codex/config.toml': 'model="nested-model"',
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const options = { ...w, user: false, target: 'src/file.ts', clients: ['codex', 'claude', 'copilot'] as const, trust: 'trusted' as const };
  const root = await scan({ ...options, sessionDirectory: '.' });
  assert.equal(root.sessionDirectory, w.repo);
  assert.equal(root.inputs?.sessionDirectory, w.repo);
  assert.equal(root.clients[0].instructions, 'Root agent instructions.');
  assert.equal(root.clients[1].instructions, 'Root Claude instructions.\n\nNested Claude instructions.');
  assert.ok(!root.clients[2].instructions.includes('Nested'));
  assert.equal(root.clients[0].settings.find(setting => setting.key === 'model' && setting.status === 'active')?.value, 'root-model');
  const automatic = await scan(options);
  assert.equal(automatic.sessionDirectory, path.join(w.repo, 'src'));
  assert.equal(automatic.inputs?.sessionDirectory, undefined);
  assert.ok(automatic.clients[0].instructions.includes('Nested agent'));
  assert.ok(automatic.clients[2].instructions.includes('Nested agent'));
  assert.equal(automatic.clients[0].settings.find(setting => setting.key === 'model' && setting.status === 'active')?.value, 'nested-model');
  const sibling = await scan({ ...options, sessionDirectory: 'docs' });
  assert.ok(sibling.clients.every(client => !client.instructions.includes('Nested')));
  assert.ok(sibling.clients[0].instructions.includes('Session agent'));
  assert.ok(sibling.clients[1].instructions.includes('Session Claude'));
  assert.ok(terminal(root).includes('Starts in:  ' + w.repo));
  assert.equal(portable(root).inputs?.sessionDirectory, '<repo>');
  assert.equal(portable(sibling).inputs?.sessionDirectory?.replaceAll('\\', '/'), '<repo>/docs');
});

test('explicit starting directories require an existing in-repository directory and reject escaping symlinks', async t => {
  const w = await workspace({ 'src/file.ts': '' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  await symlink(w.home, path.join(w.repo, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const sessionDirectory of ['missing', 'src/file.ts', '..', w.home, 'escape']) {
    await assert.rejects(makeContext({ ...w, sessionDirectory }), /Session directory/);
  }
  assert.equal((await makeContext({ ...w, target: 'src/new.ts', sessionDirectory: '.' })).directory, w.repo);
  assert.equal((await makeContext({ ...w, sessionDirectory: path.join(w.repo, 'src') })).directory, path.join(w.repo, 'src'));
});

test('private values matching input field names preserve report input keys', async t => {
  const w = await workspace({
    '.mcp.json': '{"mcpServers":{"fixture":{"command":"node","env":{"FIELD":"sessionDirectory","PROFILE":"codexProfile"}}}}',
  }, { '.codex/review.config.toml': 'model="review-model"' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, clients: ['codex', 'claude'], sessionDirectory: '.', codexProfile: 'review' });
  assert.equal(report.inputs?.sessionDirectory, w.repo);
  assert.equal(report.inputs?.codexProfile, 'review');
  assert.deepEqual(Object.keys(report.inputs!).sort(), ['codexProfile', 'sessionDirectory']);
  assert.deepEqual(Object.keys(portable(report).inputs!).sort(), ['codexProfile', 'sessionDirectory']);
});
