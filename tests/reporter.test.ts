import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { scan } from '../packages/core/index.js';
import type { Finding, Report } from '../packages/core/types.js';
import { failed, html, json, portable, terminal } from '../packages/reporter/index.js';
import { workspace } from './helpers.js';
import { CLIENTS } from '../packages/core/types.js';

test('HTML embeds the shared client marks inside its hashed stylesheet', async () => {
  const output = html(reportWithFindings());
  for (const client of CLIENTS) {
    const asset = await readFile(new URL(`../packages/web/assets/clients/${client}.svg`, import.meta.url));
    assert.ok(output.includes(`.client-avatar.${client}{background-image:url("data:image/svg+xml;base64,${asset.toString('base64')}")}`));
  }
  const liveOutput = html(reportWithFindings(), { live: true });
  for (const name of ['fonts/OFL.txt', 'clients/lobe-icons-LICENSE.txt', 'clients/octicons-LICENSE.txt']) {
    const notice = (await readFile(new URL(`../packages/web/assets/${name}`, import.meta.url), 'utf8')).replace(/\r\n?/g, '\n');
    assert.ok(output.includes(notice));
    assert.ok(liveOutput.includes(notice));
  }
  assert.ok(output.includes('img-src data:'));
});

const missingCommand: Finding = {
  id: 'codex-missing-command', ruleId: 'mcp.command-missing', severity: 'error', client: 'codex',
  message: 'MCP command for "db" was not found or is not executable.',
  location: { path: '/repo/.codex/config.toml', line: 3, column: 1, key: 'mcp_servers.db.command' },
  related: [], why: 'The configured executable is unavailable.', suggestion: 'Install the runtime or correct the command.',
};
function reportWithFindings(findings: Finding[] = []): Report {
  return {
    schemaVersion: '1.0', tool: { name: 'Agent Sightline', version: '0.1.2' },
    repository: '/repo', target: '/repo/src/index.ts', sessionDirectory: '/repo/src',
    assumptions: [], sources: [], clients: [], findings, diff: [],
  };
}

test('terminal groups identical client findings at the same source while preserving other source locations', () => {
  const report = reportWithFindings([
    missingCommand,
    { ...missingCommand, id: 'claude-missing-command', client: 'claude' },
    { ...missingCommand, id: 'other-source', client: 'claude', location: { path: '/repo/.mcp.json', line: 4, column: 7, key: 'mcpServers.db.command' } },
  ]);
  const original = structuredClone(report);
  const output = terminal(report);
  assert.match(output, /2 findings\nErrors 2 · Warnings 0 · Info 0/);
  assert.equal(output.match(/^ERROR /gm)?.length, 2);
  assert.ok(output.includes('[codex, claude]'));
  assert.ok(output.includes('/repo/.codex/config.toml:3:1'));
  assert.ok(output.includes('/repo/.mcp.json:4:7'));
  assert.ok(output.includes('Identical findings at the same source are grouped across clients.'));
  assert.ok(!output.includes('Showing '));
  assert.deepEqual(report, original);
  assert.equal(JSON.parse(json(report)).findings.length, 3);
  assert.ok(failed(report, 'error'));
  const explained = terminal(report, 'explain');
  assert.equal(explained.match(/^ERROR /gm)?.length, 3);
});

test('terminal preserves distinct diagnostic details at the same source', () => {
  const variants: Partial<Finding>[] = [
    { location: { ...missingCommand.location, line: 4 } },
    { location: { ...missingCommand.location, column: 12 } },
    { location: { ...missingCommand.location, key: 'mcp_servers.db.args' } },
    { severity: 'warn' },
    { why: 'A different runtime resolution failed.' },
    { suggestion: 'Correct the working directory first.' },
    { related: [{ path: '/repo/other.json', line: 8, column: 2 }] },
  ];
  for (const variant of variants) {
    const output = terminal(reportWithFindings([missingCommand, { ...missingCommand, ...variant, id: 'different-diagnostic' }]));
    assert.ok(output.includes('2 findings'), JSON.stringify(variant));
  }
});

test('terminal distinguishes its summary limit from grouping and reports severity totals for the full list', () => {
  const findings = Array.from({ length: 13 }, (_, index) => ({
    ...missingCommand, id: `finding-${index}`, location: { ...missingCommand.location, line: index + 1 },
  }));
  const output = terminal(reportWithFindings(findings));
  assert.match(output, /13 findings\nErrors 13 · Warnings 0 · Info 0/);
  assert.equal(output.match(/^ERROR /gm)?.length, 12);
  assert.ok(output.includes('Showing 12 of 13 distinct findings. Use --json or explain to inspect the rest.'));
  assert.ok(!output.includes('grouped across clients'));
});

test('terminal renders unique related source locations and gives an empty workspace a usable next step', () => {
  const location = { path: '/repo/.mcp.json', line: 4, column: 7 };
  const output = terminal(reportWithFindings([{ ...missingCommand, related: [missingCommand.location, location, location] }]));
  assert.equal(output.match(/Related \/repo\/\.mcp.json:4:7/g)?.length, 1);
  assert.ok(!output.includes('Related /repo/.codex/config.toml'));
  const empty = terminal(reportWithFindings());
  assert.ok(empty.includes('No agent configuration was discovered in this scan.'));
  assert.ok(empty.includes('agent-sightline demo'));
});

test('portable reports replace JSON-escaped Windows and POSIX repository paths', () => {
  for (const repository of ['D:\\projects\\checkout', 'C:\\Users\\example\\checkout', '/tmp/quoted"project', '/tmp/back\\slash-project', '/tmp/ending\\']) {
    const filename = repository + '/instructions.md';
    const report = reportWithFindings([{ ...missingCommand, location: { ...missingCommand.location, path: filename } }]);
    report.repository = repository;
    report.target = filename;
    report.sessionDirectory = repository;
    report.assumptions = [`Working tree at ${repository}`, JSON.stringify({ file: filename })];
    const exported = portable(report);
    assert.equal(exported.repository, '<repo>');
    assert.equal(exported.target, '<repo>/instructions.md');
    assert.equal(exported.sessionDirectory, '<repo>');
    assert.equal(exported.findings[0].location.path, '<repo>/instructions.md');
    assert.deepEqual(exported.assumptions, ['Working tree at <repo>', JSON.stringify({ file: '<repo>/instructions.md' })]);
  }
});

test('portable reports replace verified repository aliases and custom home paths after JSON serialization', async t => {
  const w = await workspace({ 'CLAUDE.md': 'Read the local source.' }, { '.claude/CLAUDE.md': 'Personal instructions.' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const repo = await realpath(w.repo);
  const home = await realpath(w.home);
  const alias = path.join(await realpath(w.root), 'repository-alias');
  const flagAlias = path.join(home, 'flag-alias');
  await symlink(repo, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await symlink(repo, flagAlias, process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(path.join(repo, '.mcp.json'), JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: [path.join(alias, 'missing-server.mjs'), '--root=' + flagAlias], cwd: alias } } }, null, 2));
  const report = await scan({ ...w, repo, home, clients: ['claude'], trust: 'trusted' });
  const original = JSON.stringify(report);
  assert.ok(original.includes(JSON.stringify(alias).slice(1, -1)));
  await rm(w.root, { recursive: true, force: true });
  const exported = portable(JSON.parse(original));
  const text = JSON.stringify(exported);
  for (const root of [repo, w.repo, home, w.home, alias, flagAlias]) assert.ok(!text.includes(JSON.stringify(root).slice(1, -1)), root);
  assert.equal(exported.repository, '<repo>');
  assert.equal(exported.clients[0].extensions.find(extension => extension.name === 'fixture')?.config.cwd, '<repo>');
  assert.ok(exported.clients[0].extensions.find(extension => extension.name === 'fixture')?.config.args.includes('--root=<repo>'));
  assert.ok(exported.clients[0].decisions.some(decision => decision.path === '~/.claude/CLAUDE.md' || decision.path === '~\\.claude\\CLAUDE.md'));
  assert.equal(exported.pathMappings, undefined);
  assert.equal(JSON.stringify(report), original);
  assert.deepEqual(portable(exported), exported);
});

test('portable paths cover escaped configuration text, Windows spellings and flattened project keys', () => {
  const report = reportWithFindings();
  report.repository = 'C:\\Users\\Private Person\\Checkout';
  report.pathMappings = [
    { path: report.repository, replacement: '<repo>' },
    { path: 'D:\\Repository Alias', replacement: '<repo>' },
    { path: 'Z:\\Custom Profile', replacement: '~' },
  ];
  report.assumptions = [
    'command D:\\Repository Alias\\server.mjs',
    JSON.stringify({ cwd: 'd:/repository alias/src', config: 'D:\\Repository Alias\\config.json' }),
    'projects.C:\\Users\\Private Person\\Checkout.trust_level',
    'Z:\\Custom Profile\\.codex\\config.toml',
    'hooks.state.Z:\\Custom Profile\\.codex\\hooks.json:pre_tool_use:0:0.trusted_hash',
  ];
  const exported = portable(report);
  assert.deepEqual(exported.assumptions, [
    'command <repo>\\server.mjs',
    JSON.stringify({ cwd: '<repo>/src', config: '<repo>\\config.json' }),
    'projects.<repo>.trust_level',
    '~\\.codex\\config.toml',
    'hooks.state.~\\.codex\\hooks.json:pre_tool_use:0:0.trusted_hash',
  ]);
});

test('portable paths preserve neighboring repositories and URLs while retaining legacy report support', () => {
  const report = reportWithFindings();
  report.repository = '/workspace/project';
  report.assumptions = ['/workspace/project/config.json', '/workspace/project-backup/config.json', '/workspace/project.backup/config.json', 'https://example.test/workspace/project/config.json', 'file:///workspace/project/config.json', '/home/Example Person/.claude/CLAUDE.md', 'projects./workspace/project.backup.trust_level', 'projects./home/Example Person/project.backup.trust_level'];
  assert.deepEqual(portable(report).assumptions, ['<repo>/config.json', '/workspace/project-backup/config.json', '/workspace/project.backup/config.json', 'https://example.test/workspace/project/config.json', 'file://<repo>/config.json', '~/.claude/CLAUDE.md', 'projects./workspace/project.backup.trust_level', 'projects.~/project.backup.trust_level']);
});

test('portable Claude project MCP origins conceal repository paths and preserve neighboring Codex trust keys', async t => {
  const w = await workspace({}, { '.claude.json': '{}', '.codex/config.toml': '' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const repo = await realpath(w.repo);
  const neighbor = repo + '.mcpServers.neighbor';
  await writeFile(path.join(w.home, '.claude.json'), JSON.stringify({ projects: { [repo]: { mcpServers: {
    fixture: { command: 'missing-source-fixture', env: { API_TOKEN: 'private-origin-sentinel' } },
  } } } }, null, 2));
  await writeFile(path.join(w.home, '.codex/config.toml'), `[projects.${JSON.stringify(neighbor)}]\ntrust_level="trusted"\n`);
  const report = await scan({ ...w, repo, clients: ['claude', 'codex'] });
  const neighborReport = reportWithFindings();
  neighborReport.repository = repo;
  neighborReport.assumptions = [`projects.${neighbor}.trust_level`];
  const expectedNeighbor = portable(neighborReport).assumptions[0];
  assert.ok(!expectedNeighbor.includes('<repo>'));
  for (const legacy of [false, true]) {
    const input = JSON.parse(json(report)) as Report;
    if (legacy) for (const client of input.clients) for (const extension of client.extensions) delete extension.origins;
    const exported = portable(input);
    const claude = exported.clients.find(client => client.client === 'claude')!;
    const server = claude.extensions.find(extension => extension.name === 'fixture')!;
    assert.equal(server.location.key, 'projects.<repo>.mcpServers.fixture');
    if (!legacy) {
      const origin = server.origins!.find(origin => origin.key === 'env.API_TOKEN')!;
      assert.equal(origin.location.key, 'projects.<repo>.mcpServers.fixture.env.API_TOKEN');
      assert.equal(typeof origin.location.line, 'number');
    }
    assert.equal(claude.findings.find(finding => finding.ruleId === 'mcp.command-missing')?.location.key, 'projects.<repo>.mcpServers.fixture.command');
    const codex = exported.clients.find(client => client.client === 'codex')!;
    assert.equal(codex.settings.find(setting => setting.key.endsWith('.trust_level'))?.key, expectedNeighbor);
    assert.ok(!JSON.stringify(claude).includes(JSON.stringify(repo).slice(1, -1)));
    for (const text of [json(exported), html(input)]) assert.ok(!text.includes('private-origin-sentinel'));
    assert.deepEqual(portable(exported), exported);
  }
});

test('portable paths retain correct separators when the repository is a filesystem root', () => {
  for (const repository of ['/', 'C:\\', '\\\\server\\share\\']) {
    const report = reportWithFindings();
    report.repository = repository;
    report.target = repository + 'src/file.ts';
    report.sessionDirectory = repository;
    const exported = portable(report);
    assert.equal(exported.repository, '<repo>');
    assert.equal(exported.sessionDirectory, '<repo>');
    assert.equal(exported.target, '<repo>/src/file.ts');
  }
});

test('path metadata preserves environment redaction and keeps private placeholders distinct from repository paths', async t => {
  const w = await workspace({ 'CLAUDE.md': 'token=hidden-value' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  await writeFile(path.join(w.repo, '.mcp.json'), JSON.stringify({ mcpServers: { fixture: { command: 'node', env: { ROOT: w.repo, PERSONAL: w.home } } } }));
  const report = await scan({ ...w, clients: ['claude'], trust: 'trusted' });
  const text = json(report);
  for (const root of [w.repo, w.home]) assert.ok(!text.includes(JSON.stringify(root).slice(1, -1)));
  const exported = portable(report);
  assert.equal(exported.repository, '<repo>');
  assert.ok(exported.clients[0].instructions.includes('[REDACTED]'));
  assert.ok(!exported.clients[0].instructions.includes('token=<repo>'));
});

test('HTML is self-contained, inert against script injection, and redacted again at export', async t => {
  const w = await workspace({ 'CLAUDE.md': '</script><img src=x onerror=alert(1)>\nAPI_KEY=private-sentinel' }); t.after(() => rm(w.root, { recursive: true, force: true }));
  const r = await scan({ ...w, clients: ['claude'] });
  // Second redaction boundary also protects caller-provided report mutations.
  r.clients[0].instructions += '\npassword=second-secret';
  for (const output of [html(r), json(r), terminal(r, 'explain')]) { assert.ok(!output.includes('private-sentinel')); assert.ok(!output.includes('second-secret')); }
  const h = html(r); assert.ok(!h.includes('</script><img')); assert.ok(h.includes('\\u003c/script')); assert.ok(h.includes("default-src 'none'")); assert.ok(!h.includes('<script src=')); assert.ok(!h.includes(w.repo));
  const live = html(r, { live: true, portable: false });
  const snapshot = JSON.parse(live.match(/<script type="application\/json" id="export-data">([\s\S]*?)<\/script>/)![1]);
  assert.equal(snapshot, h);
  assert.ok(!snapshot.includes(w.repo));
  assert.ok(!snapshot.includes('private-sentinel'));
  assert.ok(!snapshot.includes('second-secret'));
});

test('HTML starts with disabled controls and loading feedback while preserving source markup', async t => {
  const content = '<button>Instruction example</button>\n<input value="example">';
  const w = await workspace({ 'AGENTS.md': content });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['codex'], trust: 'trusted' });
  for (const live of [false, true]) {
    const output = html(report, { live });
    const initial = output.slice(0, output.lastIndexOf('<script>'));
    const controls = [...initial.matchAll(/<(?:button|input|select|textarea)\b[^>]*>/g)];
    assert.ok(controls.length > 0);
    for (const [control] of controls) assert.match(control, /\sdisabled\sdata-startup-disabled\b/);
    assert.ok(initial.includes('Loading report…'));
    const data = JSON.parse(output.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/)![1]);
    assert.equal(data.sources.find((source: any) => source.relativePath === 'AGENTS.md').preview, content);
  }
});
