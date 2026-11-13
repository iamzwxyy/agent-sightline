import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { chmod, rm, writeFile } from 'node:fs/promises';
import { scan } from '../packages/core/index.js';
import { workspace } from './helpers.js';
import { extensionFieldLocation, hookCommandField } from '../packages/core/extensions.js';

test('merged Codex MCP diagnostics retain each winning field source and array ownership', async t => {
  const w = await workspace({ '.codex/config.toml': '[mcp_servers.fixture]\nargs=["project-argument"]\n' }, {
    '.codex/config.toml': '[mcp_servers.fixture]\ncommand="missing-provenance-fixture"\ncwd="missing-workdir"\nenv_vars=["SIGHTLINE_SOURCE_MISSING"]\nargs=["user-first","user-second"]\n[mcp_servers.fixture.env]\nNORMAL="private-fixture-value"\n',
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, clients: ['codex'], trust: 'trusted' });
  const userFile = path.join(w.home, '.codex/config.toml');
  for (const [rule, line, key] of [
    ['mcp.command-missing', 2, 'mcp_servers.fixture.command'],
    ['extension.cwd-missing', 3, 'mcp_servers.fixture.cwd'],
    ['mcp.env-missing', 4, 'mcp_servers.fixture.env_vars.0'],
  ] as const) {
    const finding = report.findings.find(finding => finding.ruleId === rule)!;
    assert.equal(finding.location.path, userFile, rule);
    assert.equal(finding.location.line, line, rule);
    assert.equal(finding.location.key, key, rule);
  }
  const server = report.clients[0].extensions.find(extension => extension.kind === 'mcp' && extension.status === 'active')!;
  assert.equal(server.origins?.find(origin => origin.key === 'command')?.location.path, userFile);
  assert.equal(server.origins?.find(origin => origin.key === 'args.0')?.location.path, path.join(w.repo, '.codex/config.toml'));
  assert.ok(!server.origins?.some(origin => origin.key === 'args.1'));
  assert.equal(server.origins?.find(origin => origin.key === 'env.NORMAL')?.location.line, 7);
  assert.ok(!JSON.stringify(report).includes('private-fixture-value'));
});

test('conditional Codex MCP layers retain the user baseline and merge the full possible project chain', async t => {
  const w = await workspace({
    '.codex/config.toml': '[mcp_servers.fixture]\nargs=["project-argument"]\n',
    'src/.codex/config.toml': '[mcp_servers.fixture]\ncwd="."\n', 'src/file.ts': '',
  }, { '.codex/config.toml': `[mcp_servers.fixture]\ncommand=${JSON.stringify(process.execPath)}\nargs=["user-argument"]\n` });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, target: 'src/file.ts', clients: ['codex'] });
  assert.ok(!report.findings.some(finding => finding.severity === 'error'));
  const servers = report.clients[0].extensions.filter(extension => extension.kind === 'mcp');
  assert.equal(servers.filter(server => server.status === 'active').length, 1);
  assert.equal(servers.filter(server => server.status === 'conditional').length, 1);
  const possible = servers.find(server => server.status === 'conditional')!;
  assert.equal(possible.config.command, process.execPath);
  assert.deepEqual(possible.config.args, ['project-argument']);
  assert.equal(possible.config.cwd, '.');
  assert.equal(possible.origins?.find(origin => origin.key === 'command')?.location.path, path.join(w.home, '.codex/config.toml'));
  assert.equal(possible.origins?.find(origin => origin.key === 'args')?.location.path, path.join(w.repo, '.codex/config.toml'));
  assert.equal(possible.origins?.find(origin => origin.key === 'cwd')?.location.path, path.join(w.repo, 'src/.codex/config.toml'));
});

test('JSON MCP errors point to individual fields and collect all references to a missing variable', async t => {
  const text = JSON.stringify({ mcpServers: { fixture: {
    command: 'missing-provenance-fixture', cwd: 'missing-workdir',
    args: ['${SIGHTLINE_SOURCE_MISSING}', '${SIGHTLINE_SOURCE_MISSING}'], env: { NORMAL: '${SIGHTLINE_SOURCE_MISSING}' },
  } } }, null, 2);
  const w = await workspace({ '.mcp.json': text });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['claude', 'copilot'], trust: 'trusted' });
  for (const client of report.clients) {
    const command = client.findings.find(finding => finding.ruleId === 'mcp.command-missing')!;
    assert.ok(text.split('\n')[command.location.line - 1].includes('"command"'));
    const cwd = client.findings.find(finding => finding.ruleId === 'extension.cwd-missing')!;
    assert.ok(text.split('\n')[cwd.location.line - 1].includes('"cwd"'));
    const missing = client.findings.filter(finding => finding.ruleId === 'mcp.env-missing');
    assert.equal(missing.length, 1);
    assert.equal(missing[0].location.key, 'mcpServers.fixture.args.0');
    assert.deepEqual(missing[0].related.map(location => location.key), ['mcpServers.fixture.args.1', 'mcpServers.fixture.env.NORMAL']);
  }
});

test('MCP origins follow nested merges, empty arrays and whole-entry replacement', async t => {
  const w = await workspace({
    '.codex/config.toml': '[mcp_servers.fixture]\nargs=[]\n[mcp_servers.fixture.env]\nPROJECT="project-private"\n',
    '.mcp.json': JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: [] } } }, null, 2),
  }, {
    '.codex/config.toml': `[mcp_servers.fixture]\ncommand=${JSON.stringify(process.execPath)}\nargs=["old-argument"]\n[mcp_servers.fixture.env]\nUSER="user-private"\nPROJECT="old-private"\n`,
    '.claude.json': JSON.stringify({ mcpServers: { fixture: { command: process.execPath, env: { USER: 'user-private' } } } }, null, 2),
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, clients: ['codex', 'claude'], trust: 'trusted' });
  const codex = report.clients[0].extensions.find(extension => extension.status === 'active')!;
  assert.deepEqual(codex.config.args, []);
  assert.ok(!codex.origins?.some(origin => origin.key === 'args.0'));
  assert.equal(extensionFieldLocation(codex, 'env.USER').path, path.join(w.home, '.codex/config.toml'));
  assert.equal(extensionFieldLocation(codex, 'env.USER').line, 5);
  assert.equal(extensionFieldLocation(codex, 'env.PROJECT').path, path.join(w.repo, '.codex/config.toml'));
  assert.equal(extensionFieldLocation(codex, 'env.PROJECT').line, 4);
  const claude = report.clients[1].extensions.find(extension => extension.status === 'active')!;
  assert.equal(claude.config.env, undefined);
  assert.ok(claude.origins?.every(origin => origin.location.path === path.join(w.repo, '.mcp.json')));
  const legacy = { ...claude, origins: undefined };
  assert.deepEqual(extensionFieldLocation(legacy, 'args.0'), legacy.location);
  assert.deepEqual(extensionFieldLocation(claude, 'args.0'), extensionFieldLocation(claude, 'args'));
});

test('invalid MCP array values navigate to the first invalid argument', async t => {
  const text = JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: ['valid', 42, false] } } }, null, 2);
  const w = await workspace({ '.mcp.json': text });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['claude'], trust: 'trusted' });
  const finding = report.findings.find(finding => finding.ruleId === 'mcp.args-type')!;
  assert.equal(finding.location.key, 'mcpServers.fixture.args.1');
  assert.equal(text.split('\n')[finding.location.line - 1].trim(), '42,');
});

test('MCP drift points at differing fields and keeps inherited command sources', async t => {
  const w = await workspace({ '.codex/config.toml': '[mcp_servers.fixture]\nargs=["project-argument"]\n' }, {
    '.codex/config.toml': `[mcp_servers.fixture]\ncommand=${JSON.stringify(process.execPath)}\nargs=["user-argument"]\n`,
    '.claude.json': JSON.stringify({ mcpServers: { fixture: { command: 'missing-source-fixture', args: ['project-argument'] } } }, null, 2),
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, clients: ['codex', 'claude'], trust: 'trusted' });
  const finding = report.findings.find(finding => finding.ruleId === 'mcp.cross-client-drift')!;
  assert.equal(finding.location.path, path.join(w.home, '.codex/config.toml'));
  assert.equal(finding.location.line, 2);
  assert.ok(finding.related.every(location => location.key?.endsWith('.command')));
  assert.equal(finding.related[0].path, path.join(w.home, '.claude.json'));
});

test('hook command field selection preserves client and platform semantics', () => {
  for (const field of ['commandWindows', 'command_windows']) {
    const handler = { command: 'echo default', [field]: 'echo windows' };
    assert.equal(hookCommandField('codex', handler, 'config.toml', 'win32'), field);
    for (const platform of ['darwin', 'linux'] as const) assert.equal(hookCommandField('codex', handler, 'config.toml', platform), 'command');
    assert.equal(hookCommandField('claude', handler, 'settings.json', 'win32'), 'command');
  }
  assert.equal(hookCommandField('codex', { command: 'echo fallback' }, 'config.toml', 'win32'), 'command');
  assert.equal(hookCommandField('copilot', {}, 'hooks.json', 'win32'), 'powershell');
  assert.equal(hookCommandField('copilot', {}, 'hooks.json', 'linux'), 'bash');
});

test('Codex command aliases use the host platform and point to the selected TOML handler field', async t => {
  const text = [
    '[[hooks.Stop]]', '[[hooks.Stop.hooks]]', 'type="command"', 'command="missing-posix-hook-fixture"', 'command_windows="echo windows"',
    '[[hooks.Stop.hooks]]', 'type="command"', 'command="echo posix"', 'commandWindows="missing-windows-hook-fixture"',
  ].join('\n');
  const w = await workspace({ '.codex/config.toml': text });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['codex'], trust: 'trusted' });
  const handlers = report.clients[0].extensions.filter(extension => extension.kind === 'hook');
  assert.equal(handlers.length, 2);
  assert.deepEqual(handlers.map(handler => handler.location.line), process.platform === 'win32' ? [5, 9] : [4, 8]);
  assert.deepEqual(handlers.map(handler => handler.location.key), process.platform === 'win32' ? ['hooks.Stop.0.hooks.0.command_windows', 'hooks.Stop.0.hooks.1.commandWindows'] : ['hooks.Stop.0.hooks.0.command', 'hooks.Stop.0.hooks.1.command']);
  const missing = report.findings.filter(finding => finding.ruleId === 'hook.command-missing');
  assert.equal(missing.length, 1);
  assert.equal(missing[0].location.line, process.platform === 'win32' ? 9 : 4);
  assert.ok(handlers.every(handler => handler.status === 'conditional'));
});

test('Codex model events and MCP handlers follow the pinned schema while prompt and agent handlers are skipped', async t => {
  const w = await workspace({ '.codex/hooks.json': JSON.stringify({ hooks: {
    PreModelRequest: [{ hooks: [{ type: 'mcp_tool', server: 'fixture', tool: 'inspect', input: {} }] }],
    PostModelRequest: [{ hooks: [{ type: 'command', command: 'echo safe' }] }],
    Stop: [{ hooks: [{ type: 'prompt', prompt: 'Ignored prompt.' }, { type: 'agent', prompt: 'Ignored agent.' }] }],
  } }, null, 2) });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['codex'], trust: 'trusted' });
  assert.ok(!report.findings.some(finding => finding.ruleId.startsWith('hook.')));
  const hooks = report.clients[0].extensions;
  assert.equal(hooks.find(hook => hook.name === 'PreModelRequest')?.status, 'conditional');
  assert.equal(hooks.find(hook => hook.name === 'PostModelRequest')?.status, 'conditional');
  assert.ok(hooks.filter(hook => hook.name === 'Stop').every(hook => hook.status === 'ignored'));
  assert.ok(hooks.filter(hook => hook.name === 'Stop').every(hook => hook.reason.includes('skipped')));
  assert.ok(hooks.filter(hook => hook.config.type !== 'command').every(hook => hook.location.key?.endsWith('.type')));
});

test('Codex validates inactive command overrides and MCP hook fields while retaining valid JSON siblings', async t => {
  const handlers = [
    { type: 'command', command: 'echo safe', commandWindows: 42 },
    { type: 'command', commandWindows: 'echo windows' },
    { type: 'mcp_tool', server: 42, tool: 'inspect' },
    { type: 'mcp_tool', server: 'fixture', tool: 'inspect', input: [] },
    { type: 'http', url: 'https://example.test/hook' },
    { command: 'echo safe' },
    { type: 'command', command: 'echo valid' },
  ];
  const text = JSON.stringify({ hooks: { Stop: [{ hooks: handlers }] } }, null, 2);
  const w = await workspace({ '.codex/hooks.json': text });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['codex'], trust: 'trusted' });
  assert.equal(report.clients[0].extensions.filter(hook => hook.status === 'invalid').length, 6);
  assert.equal(report.clients[0].extensions.filter(hook => hook.status === 'conditional').length, 1);
  const override = report.findings.find(finding => finding.ruleId === 'hook.command' && finding.location.key === 'hooks.Stop.0.hooks.0.commandWindows')!;
  assert.ok(text.split('\n')[override.location.line - 1].includes('"commandWindows": 42'));
  assert.ok(report.findings.some(finding => finding.ruleId === 'hook.mcp-field' && finding.location.key === 'hooks.Stop.0.hooks.2.server'));
  assert.ok(report.findings.some(finding => finding.ruleId === 'hook.mcp-field' && finding.location.key === 'hooks.Stop.0.hooks.3.input'));
});

test('Codex TOML command aliases retain schema validation and duplicate-alias diagnostics', async t => {
  const base = '[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype="command"\ncommand="echo safe"\n';
  const w = await workspace({ '.codex/config.toml': base + 'command_windows=42\n' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const invalid = await scan({ ...w, user: false, clients: ['codex'], trust: 'trusted' });
  assert.ok(invalid.findings.some(finding => finding.ruleId === 'config.schema' && finding.location.line === 5));
  await writeFile(path.join(w.repo, '.codex/config.toml'), base + 'command_windows="echo snake"\ncommandWindows="echo camel"\n');
  const duplicate = await scan({ ...w, user: false, clients: ['codex'], trust: 'trusted' });
  assert.equal(duplicate.clients[0].extensions[0].status, 'invalid');
  assert.equal(duplicate.findings.find(finding => finding.ruleId === 'hook.command-alias')?.location.line, 5);
});

test('Codex hook executable checks use the session directory and explain ignored command fields', async t => {
  const w = await workspace({ '.codex/hooks.json': JSON.stringify({ hooks: { Stop: [{ hooks: [
    { type: 'command', command: 'echo safe', cwd: 'missing-hook-directory', env: [], args: [] },
    { type: 'command', command: 'echo safe', cwd: 42 },
  ] }] } }, null, 2) });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['codex'], trust: 'trusted' });
  assert.ok(report.clients[0].extensions.every(hook => hook.status === 'conditional'));
  assert.equal(report.findings.filter(finding => finding.ruleId === 'hook.unsupported-field').length, 4);
  assert.ok(!report.findings.some(finding => finding.ruleId === 'extension.cwd-missing' || finding.ruleId === 'extension.cwd-type' || finding.ruleId === 'hook.command-missing'));
});

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
