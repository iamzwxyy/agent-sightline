import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { realpath, rm } from 'node:fs/promises';
import { environmentValue, executable } from '../packages/core/utils.js';
import { scan } from '../packages/core/index.js';
import { workspace } from './helpers.js';

test('Windows environment lookup follows Node case-insensitive key selection', () => {
  const env = { Path: 'mixed-path', PATH: 'upper-path', path: 'lower-path', pAtHeXt: '.EXE' };
  assert.equal(environmentValue(env, 'path', 'win32'), 'upper-path');
  assert.equal(environmentValue({ Path: 'mixed-path' }, 'PATH', 'win32'), 'mixed-path');
  assert.equal(environmentValue(env, 'PATHEXT', 'win32'), '.EXE');
  assert.equal(environmentValue(env, 'ABSENT', 'win32'), undefined);
});

test('POSIX environment lookup retains case-sensitive names', () => {
  const env = { Path: 'mixed-path', PATH: 'upper-path', path: 'lower-path' };
  assert.equal(environmentValue(env, 'path', 'linux'), 'lower-path');
  assert.equal(environmentValue(env, 'PATH', 'darwin'), 'upper-path');
  assert.equal(environmentValue({ Path: 'mixed-path' }, 'PATH', 'linux'), undefined);
});

test('executable lookup uses the host environment key casing for PATH and PATHEXT', async () => {
  const windows = process.platform === 'win32';
  const env = { [windows ? 'pAtH' : 'PATH']: path.dirname(process.execPath), pAtHeXt: '.EXE' };
  const command = path.basename(process.execPath, path.extname(process.execPath));
  const found = await executable(command, process.cwd(), env);
  assert.ok(found);
  assert.equal(await realpath(found), await realpath(process.execPath));
});

test('MCP checks resolve copied environment keys and referenced executable values', async t => {
  const w = await workspace({ '.mcp.json': JSON.stringify({ mcpServers: { path: { command: 'node' }, reference: { command: '${env:SIGHTLINE_BINARY}' } } }) });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const windows = process.platform === 'win32';
  const env = {
    [windows ? 'Path' : 'PATH']: path.dirname(process.execPath),
    [windows ? 'PathExt' : 'PATHEXT']: '.EXE',
    [windows ? 'Sightline_Binary' : 'SIGHTLINE_BINARY']: process.execPath,
  };
  const report = await scan({ ...w, env, user: false, clients: ['copilot'], trust: 'trusted' });
  assert.ok(report.clients[0].extensions.every(extension => extension.status === 'active'));
  assert.ok(!report.findings.some(finding => finding.ruleId === 'mcp.command-missing' || finding.ruleId === 'mcp.env-missing'));
  assert.equal(report.clients[0].extensions.find(extension => extension.name === 'reference')?.config.command, '${env:SIGHTLINE_BINARY}');
});
