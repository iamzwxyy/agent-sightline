import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { claude } from '../packages/adapters/claude.js';
import { discoverClaudeManagedSettings } from '../packages/adapters/claude-policy.js';
import { discoverRepository, makeContext } from '../packages/core/discovery.js';
import { scan } from '../packages/core/index.js';
import { workspace } from './helpers.js';

async function managedFixture(t: test.TestContext, files: Record<string, unknown>, user: Record<string, unknown> = {}, project: Record<string, unknown> = {}, servers: Record<string, unknown> = {}) {
  const managedFiles = Object.fromEntries(Object.entries(files).map(([name, data]) => ['managed/' + name, typeof data === 'string' ? data : JSON.stringify(data, null, 2)]));
  const w = await workspace({ '.claude/settings.json': JSON.stringify(project), '.mcp.json': JSON.stringify({ mcpServers: servers }) }, { '.claude/settings.json': JSON.stringify(user), ...managedFiles });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  const ctx = await makeContext({ ...w, trust: 'trusted', clients: ['claude'] });
  await discoverRepository(ctx);
  await claude.discover(ctx);
  await discoverClaudeManagedSettings(ctx, path.join(w.home, 'managed'));
  const effective = await claude.resolveForTarget(ctx);
  effective.findings.push(...await claude.validate(ctx, effective));
  return { ...w, ctx, effective };
}

test('Claude MCP lists merge across scopes and retain each blocking source', async t => {
  const { effective, home } = await managedFixture(t, {}, { allowedMcpServers: [{ serverName: 'allowed' }] }, { allowedMcpServers: [{ serverName: 'other' }], deniedMcpServers: [{ serverName: 'other' }] }, {
    allowed: { command: process.execPath }, other: { command: 'missing-blocked-claude-command' }, blocked: { command: 'missing-blocked-claude-command' },
  });
  assert.deepEqual(Object.fromEntries(effective.extensions.map(extension => [extension.name, extension.status])), { allowed: 'active', other: 'ignored', blocked: 'ignored' });
  assert.ok(!effective.findings.some(finding => finding.ruleId === 'mcp.command-missing'));
  assert.equal(effective.findings.filter(finding => finding.ruleId === 'claude.mcp-policy-blocked').length, 2);
  const blocked = effective.extensions.find(extension => extension.name === 'blocked')!;
  assert.ok(blocked.origins?.some(origin => origin.key === 'allowedMcpServers' && origin.location.path === path.join(home, '.claude/settings.json')));
  assert.ok(blocked.origins?.some(origin => origin.key === 'command'));
});

test('Claude managed MCP allowlist lock ignores ordinary grants and preserves ordinary denials', async t => {
  const { effective } = await managedFixture(t, { 'managed-settings.json': { allowManagedMcpServersOnly: true, allowedMcpServers: [{ serverName: 'approved' }] } }, {
    allowedMcpServers: [{ serverName: 'personal' }], deniedMcpServers: [{ serverName: 'approved' }],
  }, {}, { personal: { command: process.execPath }, approved: { command: process.execPath } });
  assert.ok(effective.extensions.every(extension => extension.status === 'ignored'));
  assert.equal((effective.settings.find(setting => setting.key === 'allowedMcpServers' && setting.status === 'active')?.value as { serverName: string }[])[0].serverName, 'approved');
  assert.ok(effective.settings.some(setting => setting.key === 'allowedMcpServers' && setting.status === 'ignored'));
  assert.ok(effective.findings.some(finding => finding.ruleId === 'claude.policy-ignored'));
});

test('Claude provided servers replace whole entries and ignore ordinary declarations', async t => {
  const { effective, home } = await managedFixture(t, {
    'managed-settings.json': { managedMcpServers: { fixture: { type: 'http', url: 'https://first.example.test/mcp', headers: { Authorization: 'fixture-key' } } }, allowedMcpServers: [] },
    'managed-settings.d/20-replace.json': { managedMcpServers: { fixture: { type: 'sse', url: 'https://second.example.test/mcp' } } },
  }, { managedMcpServers: { personal: { type: 'http', url: 'https://ignored.example.test/mcp' } } }, {}, { fixture: { command: process.execPath } });
  const winner = effective.extensions.find(extension => extension.kind === 'mcp' && extension.status === 'active')!;
  assert.deepEqual({ ...winner.config }, { type: 'sse', url: 'https://second.example.test/mcp' });
  assert.equal(winner.location.path, path.join(home, 'managed/managed-settings.d/20-replace.json'));
  assert.ok(!effective.extensions.some(extension => extension.name === 'personal'));
  assert.equal(effective.settings.find(setting => setting.key === 'managedMcpServers.fixture' && setting.status === 'active')?.location.path, winner.location.path);
  assert.deepEqual(effective.settings.find(setting => setting.key === 'managedMcpServers.fixture' && setting.status === 'active')?.value, winner.config);
  assert.equal(effective.extensions.find(extension => extension.location.path.endsWith('.mcp.json'))?.status, 'shadowed');
  assert.ok(effective.findings.some(finding => finding.ruleId === 'claude.managed-only'));
});

test('Claude provided server validation drops invalid siblings and retains their precise locations', async t => {
  const bad = {
    insecure: { type: 'http', url: 'http://localhost/mcp' },
    command: { type: 'http', url: 'https://example.test', command: 'node' },
    args: { type: 'http', url: 'https://example.test', args: [] },
    environment: { type: 'http', url: 'https://example.test', env: {} },
    helper: { type: 'http', url: 'https://example.test', headersHelper: 'echo key' },
    variable: { type: 'http', url: 'https://example.test/${FIXTURE_VALUE}' },
    invisible: { type: 'http', url: 'https://example.test', headers: { 'X-Test': 'hidden\u200bvalue' } },
    'bad.name': { type: 'http', url: 'https://example.test' },
    stdio: { command: process.execPath },
  };
  const { effective, ctx } = await managedFixture(t, { 'managed-settings.json': { managedMcpServers: { ...bad, valid: { type: 'streamable-http', url: 'https://example.test/mcp' } } } });
  assert.equal(effective.extensions.filter(extension => extension.status === 'active').length, 1);
  assert.equal(effective.extensions.find(extension => extension.name === 'valid')?.status, 'active');
  assert.equal(effective.extensions.filter(extension => extension.status === 'invalid').length, Object.keys(bad).length);
  const source = ctx.sources.find(source => source.path.endsWith('managed-settings.json'))!;
  for (const finding of effective.findings.filter(finding => finding.ruleId === 'claude.managed-mcp-invalid')) assert.ok(source.lines[finding.location.key!] === finding.location.line);
});

test('Claude exclusive managed MCP suppresses ordinary servers, retains provided servers and applies denials', async t => {
  const { effective, ctx } = await managedFixture(t, {
    'managed-mcp.json': { mcpServers: { fixture: { command: process.execPath }, denied: { command: 'missing-denied-managed-command' } } },
    'managed-settings.json': { managedMcpServers: { fixture: { type: 'http', url: 'https://example.test' }, provided: { type: 'http', url: 'https://example.test' } }, allowedMcpServers: [] },
  }, { deniedMcpServers: [{ serverName: 'denied' }] }, {}, { personal: { command: 'missing-excluded-managed-command' } });
  const active = effective.extensions.filter(extension => extension.status === 'active');
  assert.deepEqual(active.map(extension => extension.name).sort(), ['fixture', 'provided']);
  assert.equal(active.find(extension => extension.name === 'fixture')?.config.command, process.execPath);
  assert.equal(effective.extensions.find(extension => extension.name === 'personal')?.status, 'ignored');
  assert.equal(effective.extensions.find(extension => extension.name === 'denied')?.status, 'ignored');
  assert.ok(!effective.findings.some(finding => finding.ruleId === 'mcp.command-missing'));
  assert.ok(ctx.sources.some(source => source.scope === 'system' && source.kind === 'mcp' && source.path.endsWith('managed-mcp.json')));
});

test('Claude empty exclusive MCP disables ordinary servers while env-only references remain allowlist-exempt', async t => {
  for (const servers of [{}, { fixture: { command: process.execPath, env: { KEY: '${MISSING_MANAGED_FIXTURE:-default}' } } }]) {
    const { effective } = await managedFixture(t, { 'managed-mcp.json': { mcpServers: servers }, 'managed-settings.json': { allowedMcpServers: [] } }, {}, {}, { personal: { command: process.execPath } });
    assert.equal(effective.extensions.find(extension => extension.name === 'personal')?.status, 'ignored');
    if ('fixture' in servers) assert.equal(effective.extensions.find(extension => extension.name === 'fixture')?.status, 'active');
  }
  const { effective } = await managedFixture(t, { 'managed-mcp.json': { mcpServers: { fixture: { command: '${MISSING_MANAGED_FIXTURE:-node}' } } }, 'managed-settings.json': { allowedMcpServers: [] } });
  assert.equal(effective.extensions[0].status, 'ignored');
});

test('Claude managed MCP list repairs retain original entry keys and valid lower denials', async t => {
  const { effective } = await managedFixture(t, { 'managed-settings.json': { allowedMcpServers: [42, { serverName: 'fixture' }], deniedMcpServers: [42, { serverName: 'fixture' }] } }, {}, {}, { fixture: { command: process.execPath } });
  const denied = effective.extensions[0];
  assert.equal(denied.status, 'ignored');
  assert.ok(denied.origins?.some(origin => origin.location.key === 'deniedMcpServers.1'));
  for (const [allowed, status] of [[42, 'ignored'], [null, 'ignored']] as const) {
    const { effective: repaired } = await managedFixture(t, { 'managed-settings.json': { allowedMcpServers: allowed, deniedMcpServers: 42 } }, {}, {}, { fixture: { command: process.execPath } });
    assert.equal(repaired.extensions[0].status, status);
  }
});

test('Claude malformed exclusive files keep ordinary MCP suppressed', async t => {
  for (const content of ['{ broken JSON', '{}', '{"mcpServers":42}', '', '[]']) {
    const { effective } = await managedFixture(t, { 'managed-mcp.json': content }, {}, {}, { fixture: { command: 'missing-malformed-managed-command' } });
    assert.equal(effective.extensions.find(extension => extension.name === 'fixture')?.status, 'ignored', content);
    assert.ok(!effective.findings.some(finding => finding.ruleId === 'mcp.command-missing'));
    assert.equal(effective.decisions.find(decision => decision.path.endsWith('managed-mcp.json'))?.status, 'invalid');
  }
});

test('blocked Claude MCP servers remain inactive through the public scan and explicit probe entry points', async t => {
  const w = await workspace({ '.mcp.json': JSON.stringify({ mcpServers: { fixture: { command: 'missing-policy-blocked-command' } } }) }, { '.claude/settings.json': JSON.stringify({ enableAllProjectMcpServers: true, allowedMcpServers: [] }) });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  const report = await scan({ ...w, clients: ['claude'], probe: true });
  assert.equal(report.clients[0].extensions[0].status, 'ignored');
  assert.ok(!report.findings.some(finding => finding.ruleId === 'mcp.command-missing' || finding.ruleId.startsWith('probe.')));
});
