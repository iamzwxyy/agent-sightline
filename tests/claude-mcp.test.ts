import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { scan } from '../packages/core/index.js';
import { workspace } from './helpers.js';

test('Claude MCP transport declarations validate the selected transport and retain valid siblings', async t => {
  const servers = {
    implicit: { command: process.execPath },
    stdio: { type: 'stdio', command: process.execPath },
    http: { type: 'http', url: 'https://example.test/mcp' },
    alias: { type: 'streamable-http', url: 'https://example.test/mcp' },
    sse: { type: 'sse', url: 'https://example.test/mcp' },
    ws: { type: 'ws', url: 'wss://example.test/mcp' },
    placeholder: { type: 'http', url: '' },
    noType: { url: 'https://example.test/mcp' },
    sdk: { type: 'sdk', name: 'fixture' },
    unknown: { type: 'unsupported', command: process.execPath },
    malformed: { type: false, command: process.execPath },
    nullType: { type: null, command: process.execPath },
    noUrl: { type: 'http', command: process.execPath },
    noCommand: { type: 'stdio', url: 'https://example.test/mcp' },
  };
  const text = JSON.stringify({ mcpServers: servers }, null, 2);
  const w = await workspace({ '.mcp.json': text });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['claude'], trust: 'trusted' });
  const statuses = Object.fromEntries(report.clients[0].extensions.map(extension => [extension.name, extension.status]));
  for (const name of ['implicit', 'stdio', 'http', 'alias', 'sse', 'ws']) assert.equal(statuses[name], 'active', name);
  assert.equal(statuses.placeholder, 'ignored');
  for (const name of ['noType', 'sdk', 'unknown', 'malformed', 'nullType', 'noUrl', 'noCommand']) assert.equal(statuses[name], 'invalid', name);
  for (const [name, field] of [['noType', 'url'], ['sdk', 'type'], ['unknown', 'type'], ['malformed', 'type'], ['noUrl', 'type'], ['noCommand', 'type']]) {
    const finding = report.findings.find(finding => finding.severity === 'error' && finding.location.key === `mcpServers.${name}.${field}`);
    assert.ok(finding, name);
    assert.ok(text.split('\n')[finding.location.line - 1].includes(`"${field}"`));
  }
});

test('Claude ignores fields belonging to other transports and clients while retaining their source warnings', async t => {
  const text = JSON.stringify({ mcpServers: {
    stdio: { command: process.execPath, url: 42, cwd: 'missing-directory', headers: [], enabled: false, env_vars: ['SIGHTLINE_IGNORED_MISSING'] },
    remote: { type: 'http', url: 'https://example.test/mcp', command: false, args: false, env: { UNUSED: '${SIGHTLINE_IGNORED_MISSING}' }, cwd: false },
  } }, null, 2);
  const w = await workspace({ '.mcp.json': text });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['claude'], trust: 'trusted' });
  assert.ok(report.clients[0].extensions.every(extension => extension.status === 'active'));
  assert.ok(!report.findings.some(finding => finding.severity === 'error'));
  for (const key of ['stdio.url', 'stdio.cwd', 'stdio.headers', 'stdio.enabled', 'stdio.env_vars', 'remote.command', 'remote.args', 'remote.env', 'remote.cwd']) {
    const finding = report.findings.find(finding => finding.ruleId === 'mcp.unsupported-field' && finding.location.key === 'mcpServers.' + key);
    assert.ok(finding, key);
    assert.ok(text.split('\n')[finding.location.line - 1].includes(`"${key.split('.').at(-1)}"`));
  }
  assert.ok(!report.findings.some(finding => finding.ruleId === 'mcp.env-missing' || finding.ruleId === 'extension.cwd-missing'));
});

test('Claude MCP drift compares the selected transport fields', async t => {
  const w = await workspace({
    '.codex/config.toml': `[mcp_servers.local]\ncommand=${JSON.stringify(process.execPath)}\n[mcp_servers.remote]\nurl="https://example.test/mcp"\n`,
    '.mcp.json': JSON.stringify({ mcpServers: {
      local: { command: process.execPath, url: 'https://example.test/ignored' },
      remote: { type: 'http', url: 'https://example.test/mcp', command: 'ignored-command', args: ['ignored-argument'] },
    } }),
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['codex', 'claude'], trust: 'trusted' });
  assert.ok(!report.findings.some(finding => finding.ruleId === 'mcp.cross-client-drift'));
});

test('unknown Claude workspace trust keeps project and local MCP self-approvals conditional', async t => {
  const w = await workspace({ '.mcp.json': JSON.stringify({ mcpServers: { fixture: { command: process.execPath } } }), '.claude/settings.json': '{}', '.claude/settings.local.json': '{}' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  for (const file of ['settings.json', 'settings.local.json']) for (const approval of [{ enableAllProjectMcpServers: true }, { enabledMcpjsonServers: ['fixture'] }]) {
    await writeFile(path.join(w.repo, '.claude', file), JSON.stringify(approval));
    const report = await scan({ ...w, user: false, clients: ['claude'] });
    assert.equal(report.clients[0].extensions[0].status, 'conditional', file + JSON.stringify(approval));
    await writeFile(path.join(w.repo, '.claude', file), '{}');
  }
  const trusted = await scan({ ...w, user: false, clients: ['claude'], trust: 'trusted' });
  assert.equal(trusted.clients[0].extensions[0].status, 'active');
});

test('Claude user approvals survive untrusted project overrides and any explicit rejection wins', async t => {
  const w = await workspace({
    '.mcp.json': JSON.stringify({ mcpServers: { fixture: { command: process.execPath } } }),
    '.claude/settings.json': JSON.stringify({ enableAllProjectMcpServers: false, enabledMcpjsonServers: [] }),
  }, { '.claude/settings.json': '{}' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  for (const approval of [{ enableAllProjectMcpServers: true }, { enabledMcpjsonServers: ['fixture'] }]) {
    await writeFile(path.join(w.home, '.claude/settings.json'), JSON.stringify(approval));
    for (const trust of ['auto', 'untrusted'] as const) {
      const report = await scan({ ...w, clients: ['claude'], trust });
      assert.equal(report.clients[0].extensions[0].status, 'active');
    }
  }
  await writeFile(path.join(w.repo, '.claude/settings.json'), JSON.stringify({ disabledMcpjsonServers: ['fixture'] }));
  const rejected = await scan({ ...w, clients: ['claude'], trust: 'trusted' });
  assert.equal(rejected.clients[0].extensions[0].status, 'ignored');
});

test('malformed Claude approval settings produce typed findings and retain conditional servers', async t => {
  const text = JSON.stringify({ enableAllProjectMcpServers: 'false', enabledMcpjsonServers: 'fixture', disabledMcpjsonServers: [42] }, null, 2);
  const w = await workspace({ '.mcp.json': JSON.stringify({ mcpServers: { fixture: { command: process.execPath } } }) }, { '.claude/settings.json': text });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, clients: ['claude'] });
  assert.equal(report.clients[0].extensions[0].status, 'conditional');
  const findings = report.findings.filter(finding => finding.ruleId === 'claude.mcp-approval-type');
  assert.equal(findings.length, 3);
  for (const finding of findings) assert.ok(text.split('\n')[finding.location.line - 1].includes(`"${finding.location.key}"`));
});

test('explicit Claude stdio probes use the session directory and ignore URL and cwd fields', async t => {
  const code = `import {writeFileSync} from 'node:fs';
import readline from 'node:readline';
writeFileSync('observed.json',JSON.stringify({cwd:process.cwd()}));
readline.createInterface({input:process.stdin}).on('line',line=>{
  const request=JSON.parse(line);
  if(request.id===undefined)return;
  const result=request.method==='initialize'?{protocolVersion:request.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:{tools:[]};
  console.log(JSON.stringify({jsonrpc:'2.0',id:request.id,result}));
});`;
  const w = await workspace({ 'server.mjs': code, '.mcp.json': JSON.stringify({ mcpServers: { fixture: {
    command: process.execPath, args: ['server.mjs'], cwd: 'missing-directory', url: 'https://example.test/ignored',
  } } }) });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['claude'], trust: 'trusted', probe: true });
  assert.ok(report.findings.some(finding => finding.ruleId === 'probe.mcp-ready'));
  assert.ok(!report.findings.some(finding => finding.ruleId === 'extension.cwd-missing'));
  const observed = JSON.parse(await readFile(path.join(w.repo, 'observed.json'), 'utf8'));
  assert.equal(await realpath(observed.cwd), await realpath(w.repo));
});
