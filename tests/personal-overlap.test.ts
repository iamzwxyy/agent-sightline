import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { scan } from '../packages/core/index.js';
import { makeContext } from '../packages/core/discovery.js';
import { html, json, terminal } from '../packages/reporter/index.js';
import { workspace } from './helpers.js';

test('personal Copilot files retain JSONC, aliases and privacy inside the inspection root', async t => {
  const w = await workspace({}, {
    'app/index.ts': '',
    '.copilot/config.json': '{}',
    '.copilot/settings.json': '{"disabled_mcp_servers":["blocked"]}',
    '.copilot/mcp-config.json': '// Personal MCP\n{"mcpServers":{"personal":{"command":"node"},"blocked":{"command":"node"},},}',
    '.copilot/copilot-instructions.md': 'Personal instructions.',
    '.mcp.json': '{"mcpServers":{"workspace":{"command":"node"}}}',
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  await writeFile(path.join(w.home, '.copilot/config.json'), '// Personal state\n' + JSON.stringify({ trustedFolders: [w.home], internalValue: 'overlap-private-state-sentinel' }));
  for (const repo of [w.home, w.root]) {
    const report = await scan({ ...w, repo, target: path.relative(repo, path.join(w.home, 'app/index.ts')), clients: ['copilot'] });
    assert.ok(!report.findings.some(finding => finding.ruleId === 'parse.json'));
    const state = report.sources.find(source => source.path === path.join(w.home, '.copilot/config.json'))!;
    assert.equal(state.scope, 'user');
    assert.equal(state.invalid, false);
    assert.equal(state.preview, undefined);
    assert.equal(report.clients[0].extensions.find(extension => extension.name === 'personal')?.status, 'active');
    assert.equal(report.clients[0].extensions.find(extension => extension.name === 'blocked')?.status, 'ignored');
    assert.equal(report.clients[0].extensions.find(extension => extension.name === 'workspace')?.status, 'active');
    assert.ok(report.clients[0].instructions.includes('Personal instructions.'));
    assert.equal(report.sources.find(source => source.path.endsWith('copilot-instructions.md'))?.kind, 'instructions');
    for (const output of [JSON.stringify(report), json(report), html(report), terminal(report, 'explain')]) assert.ok(!output.includes('overlap-private-state-sentinel'));
  }
});

test('repository-only scans exclude overlapping personal Copilot inputs and withhold state previews', async t => {
  const w = await workspace({}, {
    '.copilot/config.json': '{}',
    '.copilot/settings.json': '{"disabledMcpServers":["workspace"]}',
    '.copilot/mcp-config.json': '{"mcpServers":{"personal":{"command":"node"}}}',
    '.copilot/copilot-instructions.md': 'Excluded personal instructions.',
    'AGENTS.md': 'Repository instructions.',
    '.mcp.json': '{"mcpServers":{"workspace":{"command":"node"}}}',
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  await writeFile(path.join(w.home, '.copilot/config.json'), JSON.stringify({ trustedFolders: [w.home], internalValue: 'repository-only-state-sentinel' }));
  const report = await scan({ ...w, repo: w.home, user: false, clients: ['copilot'] });
  assert.ok(!report.clients[0].instructions.includes('Excluded personal instructions.'));
  assert.ok(report.clients[0].instructions.includes('Repository instructions.'));
  assert.ok(!report.clients[0].extensions.some(extension => extension.name === 'personal'));
  assert.equal(report.clients[0].extensions.find(extension => extension.name === 'workspace')?.status, 'conditional');
  assert.equal(report.sources.find(source => source.path.endsWith('.copilot/config.json'))?.preview, undefined);
  for (const output of [JSON.stringify(report), json(report), html(report)]) assert.ok(!output.includes('repository-only-state-sentinel'));
});

test('an explicit personal read updates cached source metadata and replaces obsolete parse findings', async t => {
  const w = await workspace({}, { '.copilot/mcp-config.json': '// JSONC\n{"mcpServers":{},}' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const ctx = await makeContext({ ...w, repo: w.home });
  const file = path.join(w.home, '.copilot/mcp-config.json');
  const initial = await ctx.read(file, 'copilot', 'mcp');
  assert.equal(initial?.invalid, true);
  assert.ok(ctx.findings.some(finding => finding.ruleId === 'parse.json'));
  const personal = await ctx.read(file, 'copilot', 'mcp', 'user');
  assert.equal(personal, initial);
  assert.equal(personal?.scope, 'user');
  assert.equal(personal?.invalid, false);
  assert.ok(!ctx.findings.some(finding => finding.ruleId === 'parse.json'));
  assert.equal(ctx.sources.length, 1);
});

test('shared Claude project settings keep Copilot project trust beside an overlapping personal source', async t => {
  const w = await workspace({}, { '.claude/settings.json': '{"model":"shared-model"}', '.copilot/settings.json': '{}' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, repo: w.home, clients: ['claude', 'copilot'], trust: 'untrusted' });
  assert.equal(report.clients.find(client => client.client === 'claude')?.settings.find(setting => setting.key === 'model' && setting.status === 'active')?.value, 'shared-model');
  assert.equal(report.clients.find(client => client.client === 'copilot')?.settings.find(setting => setting.key === 'model')?.status, 'ignored');
});

test('personal settings inside a wider repository respect user inclusion for every adapter', async t => {
  const w = await workspace({ 'AGENTS.md': 'Repository instructions.' }, {
    '.codex/config.toml': 'model="personal-codex-model"\n',
    '.claude/settings.json': '{"model":"personal-claude-model"}',
    '.gemini/settings.json': '{"model":{"name":"personal-gemini-model"}}',
    '.cursor/mcp.json': '{"mcpServers":{"personal-cursor":{"command":"node"}}}',
    '.copilot/settings.json': '{"disabledMcpServers":["personal-copilot"]}',
    '.config/opencode/opencode.json': '{"model":"personal-opencode-model"}',
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  for (const user of [true, false]) {
    const report = await scan({ ...w, repo: w.root, target: 'repo', user });
    for (const client of report.clients) {
      const contributions = client.settings.filter(setting => setting.location.path.startsWith(w.home));
      if (client.client !== 'cursor') assert.equal(contributions.some(setting => setting.status === 'active'), user, client.client);
      else assert.equal(client.extensions.some(extension => extension.name === 'personal-cursor' && extension.status === 'active'), user);
    }
    if (user) assert.ok(report.sources.filter(source => source.path.startsWith(w.home)).every(source => source.scope === 'user'));
  }
});

test('an overlapping custom Copilot root retains personal settings and private state', async t => {
  const w = await workspace();
  t.after(() => rm(w.root, { recursive: true, force: true }));
  t.mock.method(os, 'homedir', () => w.home);
  const customRoot = path.join(w.repo, 'machine/.copilot');
  await mkdir(customRoot, { recursive: true });
  await writeFile(path.join(customRoot, 'config.json'), JSON.stringify({ internalValue: 'custom-overlap-private-state' }));
  await writeFile(path.join(customRoot, 'settings.json'), '{"disabled_mcp_servers":["fixture"]}');
  await writeFile(path.join(customRoot, 'mcp-config.json'), '// Personal MCP\n{"mcpServers":{"fixture":{"command":"node"}},}');
  for (const user of [true, false]) {
    const report = await scan({ repo: w.repo, env: { ...w.env, COPILOT_HOME: customRoot }, clients: ['copilot'], user });
    assert.equal(report.clients[0].extensions.find(extension => extension.name === 'fixture')?.status, user ? 'ignored' : undefined);
    assert.equal(report.sources.find(source => source.path === path.join(customRoot, 'config.json'))?.preview, undefined);
    for (const output of [JSON.stringify(report), json(report), html(report)]) assert.ok(!output.includes('custom-overlap-private-state'));
  }
});

test('a directory alias to the personal root withholds every state preview', async t => {
  const w = await workspace({}, { '.copilot/config.json': '{"internalValue":"aliased-overlap-private-state"}' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const alias = path.join(w.root, 'home-alias');
  await symlink(w.home, alias, process.platform === 'win32' ? 'junction' : 'dir');
  for (const user of [true, false]) {
    const report = await scan({ ...w, repo: alias, clients: ['copilot'], user });
    assert.equal(report.sources.find(source => source.path === path.join(alias, '.copilot/config.json'))?.preview, undefined);
    for (const output of [JSON.stringify(report), json(report), html(report)]) assert.ok(!output.includes('aliased-overlap-private-state'));
  }
});
