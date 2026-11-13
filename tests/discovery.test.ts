import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs, { mkdir, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { scan } from '../packages/core/index.js';
import { findRepositoryRoot, makeContext, readUserTree } from '../packages/core/discovery.js';
import { filter, json, terminal } from '../packages/reporter/index.js';
import { workspace } from './helpers.js';
import { searchTargets } from '../packages/web/targets.js';

test('implicit repository discovery selects the nearest Git directory or worktree marker', async t => {
  const w = await workspace({ 'src/payments/refund.ts': '' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const directory = path.join(w.repo, 'src/payments');
  assert.equal(await findRepositoryRoot(directory), w.repo);
  await rm(path.join(w.repo, '.git'), { recursive: true });
  await writeFile(path.join(w.repo, '.git'), 'gitdir: ../main/.git/worktrees/checkout\n');
  assert.equal(await findRepositoryRoot(directory), w.repo);
  await mkdir(path.join(w.repo, 'src/.git'));
  assert.equal(await findRepositoryRoot(directory), path.join(w.repo, 'src'));
});

test('implicit repository discovery keeps a directory without a Git ancestor as its boundary', async t => {
  const w = await workspace({ 'src/payments/refund.ts': '' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  await rm(path.join(w.repo, '.git'), { recursive: true });
  const directory = path.join(w.repo, 'src/payments');
  assert.equal(await findRepositoryRoot(directory), directory);
});

test('repository discovery reports its actual budget and preserves incomplete status after severity filtering', async t => {
  const w = await workspace({ 'AGENTS.md': 'Repository instructions.', 'other.md': '' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['codex'], trust: 'trusted', maxFiles: 1 });
  assert.equal(report.discovery?.complete, false);
  assert.equal(report.discovery?.repositoryEntries, 1);
  assert.equal(report.discovery?.repositoryEntryLimit, 1);
  const limited = report.findings.find(finding => finding.ruleId === 'source.scan-limit');
  assert.ok(limited);
  assert.ok(limited.why.includes('1 filesystem entry'));
  assert.ok(!limited.why.includes('50,000'));
  const errorsOnly = filter(report, 'error');
  assert.equal(JSON.parse(json(errorsOnly)).discovery.complete, false);
  assert.ok(terminal(errorsOnly).includes('Configuration discovery is incomplete.'));
  assert.ok(!terminal(errorsOnly).includes('No deterministic configuration problems found.'));
});

test('an exact entry budget is complete and a zero budget inspects no repository entries', async t => {
  const w = await workspace({ 'AGENTS.md': 'Repository instructions.' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const complete = await scan({ ...w, user: false, clients: ['codex'], maxFiles: 2 });
  assert.equal(complete.discovery?.complete, true);
  assert.equal(complete.discovery?.repositoryEntries, 2);
  assert.ok(!complete.findings.some(finding => finding.ruleId === 'source.scan-limit'));
  const limited = await scan({ ...w, user: false, clients: ['codex'], maxFiles: 0 });
  assert.equal(limited.discovery?.complete, false);
  assert.equal(limited.discovery?.repositoryEntries, 0);
});

test('repository configuration remains discoverable beyond 48 directory levels', async t => {
  const filename = Array.from({ length: 49 }, () => 'd').join('/') + '/AGENTS.md';
  const w = await workspace({ [filename]: 'Deep repository instructions.' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['codex'] });
  assert.ok(report.sources.some(source => source.path === path.join(w.repo, filename)));
  assert.equal(report.discovery?.complete, true);
  const targets = await searchTargets(w.repo, { query: 'AGENTS.md' });
  assert.equal(targets.paths[0], filename);
  assert.equal(targets.truncated, false);
});

test('user rules remain discoverable beyond eight directory levels', async t => {
  const filename = '.claude/rules/' + Array.from({ length: 10 }, () => 'd').join('/') + '/policy.md';
  const w = await workspace({}, { [filename]: 'Deep personal instructions.' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, clients: ['claude'] });
  assert.ok(report.clients[0].instructions.includes('Deep personal instructions.'));
  assert.equal(report.discovery?.complete, true);
});

test('user discovery counts its own files and applies the limit within flat directories', async t => {
  const w = await workspace({ 'AGENTS.md': 'Seed instructions.' }, {
    '.claude/rules/a.md': 'First rule.', '.claude/rules/b.md': 'Second rule.', '.claude/rules/c.md': 'Third rule.',
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const ctx = await makeContext({ ...w, maxUserFiles: 2 });
  const seed = await ctx.read(path.join(w.repo, 'AGENTS.md'), 'codex', 'instructions');
  assert.ok(seed);
  ctx.sources = Array.from({ length: 4001 }, (_, index) => ({ ...seed, id: String(index), path: path.join(w.repo, String(index), 'AGENTS.md') }));
  const read: string[] = [];
  ctx.read = async file => { read.push(path.basename(file)); return null; };
  await readUserTree(ctx, path.join(w.home, '.claude/rules'), 'claude', 'rules', '.md');
  assert.deepEqual(read, ['a.md', 'b.md']);
  assert.equal(ctx.discovery?.complete, false);
  assert.ok(ctx.findings.some(finding => finding.ruleId === 'source.user-file-limit'));
});

test('invalid discovery budgets fail before inspection', async t => {
  const w = await workspace();
  t.after(() => rm(w.root, { recursive: true, force: true }));
  for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(scan({ ...w, user: false, maxFiles: value }), /limit/i);
    await assert.rejects(scan({ ...w, user: false, maxUserFiles: value }), /limit/i);
  }
});


test('scan cancellation also applies during final portable-path mapping', async t => {
  const w = await workspace({ 'AGENTS.md': 'Repository instructions.' });
  const controller = new AbortController();
  const originalRealpath = fs.realpath;
  t.mock.method(fs, 'realpath', async (filename: Parameters<typeof fs.realpath>[0], options: any) => {
    if (filename === w.home) controller.abort();
    return originalRealpath(filename, options);
  });
  syncBuiltinESMExports();
  t.after(async () => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    await rm(w.root, { recursive: true, force: true });
  });
  await assert.rejects(scan({ ...w, user: false, clients: ['codex'], signal: controller.signal }), { name: 'AbortError' });
});
