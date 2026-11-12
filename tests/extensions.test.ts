import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { chmod, rm, writeFile } from 'node:fs/promises';
import { scan } from '../packages/core/index.js';
import { workspace } from './helpers.js';

test('malformed MCP fields are invalid while valid sibling servers remain discoverable', async t => {
  const servers = {
    badCommand: { command: false },
    badUrl: { command: 'node', url: 42 },
    badCwd: { command: 'node', cwd: 42 },
    badArgs: { command: 'node', args: 'argument' },
    badEnv: { command: 'node', env: { PATH: 42 } },
    badHeaders: { command: 'node', headers: [] },
    badHttpHeaders: { command: 'node', http_headers: { header: false } },
    badEnvHeaders: { command: 'node', env_http_headers: 42 },
    badEndpoint: { url: 'file:///local-server' },
    good: { command: process.execPath },
  };
  const content = JSON.stringify({ mcpServers: servers }, null, 2);
  const w = await workspace({ '.mcp.json': content });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['claude', 'copilot'], trust: 'trusted' });
  for (const client of report.clients) {
    assert.equal(client.extensions.find(extension => extension.name === 'good')?.status, 'active');
    for (const name of Object.keys(servers).filter(name => name !== 'good')) assert.equal(client.extensions.find(extension => extension.name === name)?.status, 'invalid', `${client.client} ${name}`);
    const env = client.findings.find(finding => finding.ruleId === 'mcp.env-type' && finding.location.key === 'mcpServers.badEnv.env.PATH');
    assert.ok(env);
    assert.ok(content.split('\n')[env.location.line - 1].includes('"PATH": 42'));
    assert.ok(client.findings.some(finding => finding.ruleId === 'extension.cwd-type' && finding.location.key === 'mcpServers.badCwd.cwd'));
    assert.ok(!client.findings.some(finding => finding.ruleId === 'mcp.command-missing'));
  }
});

test('MCP collection type errors preserve valid Copilot definitions in another workspace file', async t => {
  const w = await workspace({ '.mcp.json': JSON.stringify({ mcpServers: { good: { command: process.execPath } } }), '.github/mcp.json': '{}' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  for (const value of [null, false, 42, 'wrong', []]) {
    await writeFile(path.join(w.repo, '.github/mcp.json'), JSON.stringify({ mcpServers: value }));
    const report = await scan({ ...w, user: false, clients: ['copilot'], trust: 'trusted' });
    assert.equal(report.clients[0].extensions.find(extension => extension.name === 'good')?.status, 'active');
    assert.ok(report.findings.some(finding => finding.ruleId === 'mcp.servers-type' && finding.location.path === path.join(w.repo, '.github/mcp.json')));
  }
});

test('MCP environment references resolve before endpoint and executable checks', async t => {
  const w = await workspace({ '.mcp.json': JSON.stringify({ mcpServers: {
    remote: { url: '${SIGHTLINE_REMOTE_URL}' },
    local: { command: '${SIGHTLINE_EXECUTABLE}', cwd: '${SIGHTLINE_WORKDIR}' },
    missing: { command: '${SIGHTLINE_MISSING_COMMAND}' },
    unresolved: { url: '${SIGHTLINE_ABSENT_URL}' },
    fallback: { url: '${SIGHTLINE_FALLBACK_URL:-https://example.test/mcp}' },
  } }) });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['claude', 'copilot'], trust: 'trusted', env: {
    ...w.env, SIGHTLINE_REMOTE_URL: 'https://private-remote-sentinel.example.test/mcp', SIGHTLINE_EXECUTABLE: process.execPath, SIGHTLINE_WORKDIR: w.repo, SIGHTLINE_MISSING_COMMAND: path.join(w.repo, 'unavailable-command'),
  } });
  for (const client of report.clients) {
    assert.ok(!client.findings.some(finding => finding.ruleId === 'mcp.url' || finding.ruleId === 'extension.cwd-missing'));
    const missing = client.findings.filter(finding => finding.ruleId === 'mcp.command-missing');
    assert.equal(missing.length, 1);
    assert.ok(missing[0].message.includes('"missing"'));
    assert.ok(client.findings.some(finding => finding.ruleId === 'mcp.env-missing' && finding.message.includes('SIGHTLINE_ABSENT_URL')));
  }
  assert.ok(!JSON.stringify(report).includes('private-remote-sentinel'));
});

test('malformed hook fields and handlers retain valid siblings and precise field locations', async t => {
  const handlers = [null, 42, { type: false }, { type: 'command', command: 42 }, { type: 'command', command: 'echo safe', args: 42 }, { type: 'command', command: 'echo safe' }];
  const content = JSON.stringify({ hooks: { PreToolUse: [{ hooks: handlers }, { hooks: false }] } }, null, 2);
  const w = await workspace({ '.claude/settings.json': content, '.github/hooks/test.json': JSON.stringify({ version: 1, hooks: { sessionStart: [{ type: 'command', bash: 'echo safe', powershell: 'echo safe', cwd: 42 }, { type: 'command', bash: 'echo safe', powershell: 'echo safe', env: [] }, { type: 'command', bash: 'echo safe', powershell: 'echo safe' }] } }, null, 2) });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['claude', 'copilot'] });
  const claude = report.clients[0];
  assert.equal(claude.extensions.filter(extension => extension.kind === 'hook' && extension.status === 'invalid').length, 5);
  assert.equal(claude.extensions.filter(extension => extension.kind === 'hook' && extension.status === 'active').length, 1);
  const args = claude.findings.find(finding => finding.ruleId === 'hook.args-type');
  assert.ok(args);
  assert.equal(args.location.key, 'hooks.PreToolUse.0.hooks.4.args');
  assert.ok(content.split('\n')[args.location.line - 1].includes('"args": 42'));
  assert.ok(claude.findings.some(finding => finding.ruleId === 'hook.type' && finding.location.key === 'hooks.PreToolUse.1.hooks'));
  const copilot = report.clients[1];
  assert.equal(copilot.extensions.filter(extension => extension.kind === 'hook' && extension.status === 'invalid').length, 2);
  assert.equal(copilot.extensions.filter(extension => extension.kind === 'hook' && extension.status === 'active').length, 1);
});

test('invalid hook and permission collections produce findings', async t => {
  const w = await workspace({ '.claude/settings.json': '{}' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  for (const value of [null, false, 42, 'wrong', []]) {
    await writeFile(path.join(w.repo, '.claude/settings.json'), JSON.stringify({ hooks: value, permissions: value }));
    const report = await scan({ ...w, user: false, clients: ['claude'] });
    assert.ok(report.findings.some(finding => finding.ruleId === 'hook.type' && finding.location.key === 'hooks'));
    assert.ok(report.findings.some(finding => finding.ruleId === 'permission.type' && finding.location.key === 'permissions'));
  }
});

test('Claude exec-form hooks resolve literal executables and keep client-specific fields distinct', async t => {
  const w = await workspace({ '.claude/settings.json': JSON.stringify({ hooks: { PreToolUse: [{ hooks: [
    { type: 'command', command: 'echo', args: [] },
    { type: 'command', command: 'echo safe', cwd: 42, env: [], commandWindows: 'unused-command' },
    { type: 'mcp_tool', server: 'fixture', tool: 'inspect' },
  ] }] } }) });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, env: { PATH: '' }, user: false, clients: ['claude'] });
  const missing = report.findings.filter(finding => finding.ruleId === 'hook.command-missing');
  assert.equal(missing.length, 1);
  assert.equal(missing[0].location.key, 'hooks.PreToolUse.0.hooks.0.command');
  assert.equal(report.findings.filter(finding => finding.ruleId === 'hook.unsupported-field').length, 3);
  assert.ok(!report.findings.some(finding => finding.ruleId === 'extension.cwd-type' || finding.ruleId === 'hook.unsupported-type'));
});

test('Copilot hook executable checks use the configured hook environment', async t => {
  const command = 'sightline-hook-fixture';
  const filename = process.platform === 'win32' ? command + '.cmd' : command;
  const w = await workspace({ ['bin/' + filename]: 'fixture', '.github/hooks/test.json': '{}' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  if (process.platform !== 'win32') await chmod(path.join(w.repo, 'bin', filename), 0o700);
  await writeFile(path.join(w.repo, '.github/hooks/test.json'), JSON.stringify({ version: 1, hooks: { sessionStart: [{ type: 'command', bash: command, powershell: command, env: { PATH: path.join(w.repo, 'bin') } }] } }));
  const report = await scan({ ...w, env: { ...w.env, PATH: '' }, user: false, clients: ['copilot'] });
  assert.ok(!report.findings.some(finding => finding.ruleId === 'hook.command-missing'));
});

test('permission precedence findings identify the individual allow and deny array entries', async t => {
  const content = '{\n  "permissions": {\n    "allow": [\n      "Read",\n      "Bash(npm install)"\n    ],\n    "deny": [\n      "Bash"\n    ]\n  }\n}';
  const w = await workspace({ '.claude/settings.json': content });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['claude'] });
  const finding = report.findings.find(finding => finding.ruleId === 'permission.deny-overrides-allow');
  assert.ok(finding);
  assert.equal(finding.location.key, 'permissions.allow.1');
  assert.equal(finding.location.line, 5);
  assert.equal(finding.related[0].key, 'permissions.deny.0');
  assert.equal(finding.related[0].line, 8);
});
