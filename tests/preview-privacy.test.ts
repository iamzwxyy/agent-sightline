import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { scan } from '../packages/core/index.js';
import { workspace } from './helpers.js';
import { html, json, portable } from '../packages/reporter/index.js';

test('invalid environment and header containers keep nested string values private', async t => {
  const secrets = ['invalid-env-nested-sentinel', 'invalid-header-array-sentinel', 'invalid-env-string-sentinel'];
  const w = await workspace({ '.mcp.json': JSON.stringify({ mcpServers: {
    nested: { command: 'node', env: { VALUE: { nested: secrets[0] } }, headers: [secrets[1]] },
    scalar: { command: 'node', env: secrets[2] },
  } }) });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['claude'], trust: 'trusted' });
  assert.ok(report.findings.some(finding => finding.ruleId === 'mcp.env-type'));
  for (const output of [json(report), html(report)]) for (const secret of secrets) assert.ok(!output.includes(secret), secret);
});

test('source previews redact credentials and omit private account/session state', async t => {
  const w = await workspace({
    '.mcp.json': JSON.stringify({ mcpServers: { test: { command: 'node', env: { NORMAL_NAME: 'preview-env-sentinel' }, headers: { Header: 'preview-header-sentinel' } } } }),
    'CLAUDE.md': 'API_KEY=preview-markdown-sentinel',
  }, {
    '.claude.json': JSON.stringify({ mcpServers: {}, projects: {}, account: { email: 'private-user-sentinel@example.test' } }),
    '.copilot/config.json': JSON.stringify({ trusted_folders: [], session_history: ['private-session-sentinel'] }),
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const privateAlias = path.join(w.root, 'private-history-alias');
  await symlink(w.repo, privateAlias, process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(path.join(w.home, '.claude.json'), JSON.stringify({ mcpServers: {}, projects: {}, account: { email: 'private-user-sentinel@example.test', lastDirectory: privateAlias } }));
  const report = await scan({ ...w, clients: ['claude', 'copilot'], trust: 'trusted' });
  const text = JSON.stringify(report);
  for (const secret of ['preview-env-sentinel', 'preview-header-sentinel', 'preview-markdown-sentinel', 'private-user-sentinel', 'private-session-sentinel']) assert.ok(!text.includes(secret), secret);
  assert.ok(!text.includes('private-history-alias'));
  assert.ok(report.sources.some(source => source.preview?.includes('REDACTED')));
  assert.ok(report.sources.filter(source => source.path.endsWith('.claude.json') || source.path.endsWith('config.json')).every(source => source.preview === undefined));
});

test('portable findings replace a custom home even when its only configuration source is broken', { skip: process.platform === 'win32' }, async t => {
  const w = await workspace();
  t.after(() => rm(w.root, { recursive: true, force: true }));
  await mkdir(path.join(w.home, '.claude'));
  await symlink(path.join(w.home, 'missing.md'), path.join(w.home, '.claude/CLAUDE.md'));
  const report = await scan({ ...w, clients: ['claude'] });
  const exported = portable(report);
  const broken = exported.findings.find(finding => finding.ruleId === 'source.broken-symlink');
  assert.equal(broken?.location.path, '~/.claude/CLAUDE.md');
  assert.ok(!JSON.stringify(exported).includes(w.home));
});
