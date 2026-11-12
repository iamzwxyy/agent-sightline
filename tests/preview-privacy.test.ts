import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { scan } from '../packages/core/index.js';
import { workspace } from './helpers.js';
import { html, json } from '../packages/reporter/index.js';

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
  const report = await scan({ ...w, clients: ['claude', 'copilot'], trust: 'trusted' });
  const text = JSON.stringify(report);
  for (const secret of ['preview-env-sentinel', 'preview-header-sentinel', 'preview-markdown-sentinel', 'private-user-sentinel', 'private-session-sentinel']) assert.ok(!text.includes(secret), secret);
  assert.ok(report.sources.some(source => source.preview?.includes('REDACTED')));
  assert.ok(report.sources.filter(source => source.path.endsWith('.claude.json') || source.path.endsWith('config.json')).every(source => source.preview === undefined));
});
