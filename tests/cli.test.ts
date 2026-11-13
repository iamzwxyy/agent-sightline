import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, readdir, realpath, rm, watch, writeFile } from 'node:fs/promises';
import { workspace } from './helpers.js';
const cli = path.resolve('packages/cli/index.ts');
function run(args: string[], cwd: string) { return spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), cli, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } }); }
test('CLI follows Copilot personal alias failures through correction and portable export', async t => {
  const w = await workspace({ '.mcp.json': '{"mcpServers":{"fixture":{"command":"missing-personal-alias-cli-command"}}}' }, { '.copilot/settings.json': '{\n"disabled_mcp_servers":[42],\n"disable_all_hooks":true\n}' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const flags = ['--client', 'copilot', '--home', w.home, '--trust', 'trusted'];
  const failed = run(['ci', ...flags], w.repo);
  assert.equal(failed.status, 1, failed.stderr);
  const invalid = JSON.parse(failed.stdout);
  assert.equal(invalid.findings.find((finding: any) => finding.ruleId === 'copilot.setting-alias-type').location.key, 'disabled_mcp_servers');
  await writeFile(path.join(w.home, '.copilot/settings.json'), '{// personal legacy settings\n"disabled_mcp_servers":["fixture"],\n"disable_all_hooks":true,\n"colorMode":"dim",\n}');
  const checked = run(['ci', ...flags], w.repo);
  assert.equal(checked.status, 0, checked.stderr);
  const report = JSON.parse(checked.stdout);
  assert.equal(report.clients[0].extensions.find((extension: any) => extension.name === 'fixture').status, 'ignored');
  assert.equal(report.clients[0].settings.find((setting: any) => setting.key === 'disabledMcpServers').location.line, 2);
  assert.equal(report.clients[0].settings.find((setting: any) => setting.key === 'theme').value, 'dim');
  const file = path.join(w.root, 'copilot-aliases.html');
  const exported = run(['report', ...flags, '--format', 'html', '--output', file], w.repo);
  assert.equal(exported.status, 0, exported.stderr);
  const content = await readFile(file, 'utf8');
  assert.ok(content.includes('disabled_mcp_servers'));
  assert.ok(!content.includes(w.home));
  assert.ok(!content.includes(await realpath(w.repo)));
});
test('CLI follows a Claude transport error through correction and explicit trust', async t => {
  const servers = { remote: { url: 'https://example.test/mcp' }, local: { command: process.execPath } };
  const w = await workspace({ '.mcp.json': JSON.stringify({ mcpServers: servers }, null, 2), '.claude/settings.json': '{"enableAllProjectMcpServers":true}' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const flags = ['--no-user', '--client', 'claude'];
  const invalid = run(['ci', ...flags], w.repo);
  assert.equal(invalid.status, 1, invalid.stderr);
  const report = JSON.parse(invalid.stdout);
  assert.equal(report.clients[0].extensions.find((extension: any) => extension.name === 'remote').status, 'invalid');
  assert.equal(report.clients[0].extensions.find((extension: any) => extension.name === 'local').status, 'conditional');
  assert.ok(report.findings.some((finding: any) => finding.ruleId === 'mcp.transport-type' && finding.location.key === 'mcpServers.remote.url'));
  const corrected = { ...servers, remote: { type: 'http', ...servers.remote } };
  await writeFile(path.join(w.repo, '.mcp.json'), JSON.stringify({ mcpServers: corrected }, null, 2));
  const checked = run(['ci', ...flags], w.repo);
  assert.equal(checked.status, 0, checked.stderr);
  assert.ok(JSON.parse(checked.stdout).clients[0].extensions.every((extension: any) => extension.status === 'conditional'));
  const trusted = run(['ci', ...flags, '--trust', 'trusted'], w.repo);
  assert.equal(trusted.status, 0, trusted.stderr);
  assert.ok(JSON.parse(trusted.stdout).clients[0].extensions.every((extension: any) => extension.status === 'active'));
  const file = path.join(w.root, 'claude-transport.html');
  const exported = run(['report', ...flags, '--trust', 'trusted', '--format', 'html', '--output', file], w.repo);
  assert.equal(exported.status, 0, exported.stderr);
  assert.ok((await readFile(file, 'utf8')).includes('mcpServers.remote.url'));
});
test('CLI preserves merged MCP field locations through explain, CI and portable export', async t => {
  const w = await workspace({ '.codex/config.toml': '[mcp_servers.fixture]\nargs=["project-argument"]\n' }, {
    '.codex/config.toml': '[mcp_servers.fixture]\ncommand="missing-cli-source-fixture"\ncwd="missing-workdir"\nenv_vars=["SIGHTLINE_SOURCE_MISSING"]\n',
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const flags = ['--home', w.home, '--client', 'codex'];
  const checked = run(['ci', ...flags, '--trust', 'trusted'], w.repo);
  assert.equal(checked.status, 1, checked.stderr);
  const report = JSON.parse(checked.stdout);
  assert.equal(report.findings.find((finding: any) => finding.ruleId === 'mcp.command-missing').location.line, 2);
  const server = report.clients[0].extensions.find((extension: any) => extension.status === 'active');
  const argsLocation = server.origins.find((origin: any) => origin.key === 'args.0').location;
  assert.equal(await realpath(argsLocation.path), await realpath(path.join(w.repo, '.codex/config.toml')));
  const explained = run(['explain', '.', ...flags, '--trust', 'trusted'], w.repo);
  assert.equal(explained.status, 0, explained.stderr);
  assert.ok(explained.stdout.includes(path.join(w.home, '.codex/config.toml') + ':2:1'));
  assert.ok(explained.stdout.includes('command ← ' + path.join(w.home, '.codex/config.toml') + ':2'));
  assert.ok(explained.stdout.includes('args.0 ← ' + argsLocation.path + ':2'));
  const conditional = JSON.parse(run(['scan', ...flags, '--json'], w.repo).stdout);
  assert.ok(!conditional.findings.some((finding: any) => finding.ruleId === 'mcp.transport'));
  assert.ok(conditional.clients[0].extensions.some((extension: any) => extension.status === 'conditional' && extension.config.command === 'missing-cli-source-fixture'));
  const output = path.join(w.root, 'mcp-sources.html');
  const exported = run(['report', ...flags, '--trust', 'trusted', '--format', 'html', '--output', output], w.repo);
  assert.equal(exported.status, 0, exported.stderr);
  const content = await readFile(output, 'utf8');
  assert.ok(!content.includes(JSON.stringify(w.home).slice(1, -1)));
  assert.ok(content.includes('mcp_servers.fixture.command'));
});
test('CLI exports redact encoded source values and keep downstream hook diagnostics on the original line', async t => {
  const toml = '[mcp_servers.fixture]\ncommand="node"\n[mcp_servers.fixture.env]\nNORMAL="""\ncli-multiline-confidential-first\ncli-multiline-confidential-last"""\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype="command"\ncommand="missing-preview-hook-fixture"\n';
  const w = await workspace({ '.codex/config.toml': toml, '.mcp.json': JSON.stringify({ mcpServers: { fixture: { command: 'node', env: { NORMAL: 'cli-escaped-confidential-"value' } } } }) });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const flags = ['--no-user', '--trust', 'trusted', '--clients', 'codex,claude'];
  const result = run(['ci', ...flags], w.repo);
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  const finding = report.findings.find((finding: any) => finding.ruleId === 'hook.command-missing');
  assert.equal(finding.location.line, 10);
  const source = report.sources.find((source: any) => source.relativePath === '.codex/config.toml');
  assert.equal(source.preview.split('\n').length, toml.split('\n').length);
  assert.ok(source.preview.split('\n')[finding.location.line - 1].includes('missing-preview-hook-fixture'));
  const output = path.join(w.root, 'encoded-preview.html');
  const exported = run(['report', ...flags, '--format', 'html', '--output', output], w.repo);
  assert.equal(exported.status, 0, exported.stderr);
  for (const text of [result.stdout, await readFile(output, 'utf8')]) {
    assert.ok(!text.includes('cli-multiline-confidential-'));
    assert.ok(!text.includes('cli-escaped-confidential-'));
    assert.ok(!text.includes('valueRanges'));
  }
});
test('CLI explains platform-specific Codex hook commands with exact source lines and supported MCP handlers', async t => {
  const w = await workspace({ '.codex/config.toml': '[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype="command"\ncommand="missing-posix-hook-fixture"\ncommand_windows="missing-windows-hook-fixture"\n[[hooks.PreModelRequest]]\n[[hooks.PreModelRequest.hooks]]\ntype="mcp_tool"\nserver="fixture"\ntool="inspect"\n' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const result = run(['ci', '--no-user', '--trust', 'trusted', '--client', 'codex'], w.repo);
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  const missing = report.findings.filter((finding: any) => finding.ruleId === 'hook.command-missing');
  assert.equal(missing.length, 1);
  assert.equal(missing[0].location.line, process.platform === 'win32' ? 5 : 4);
  assert.ok(missing[0].location.key.endsWith(process.platform === 'win32' ? '.command_windows' : '.command'));
  assert.ok(!report.findings.some((finding: any) => finding.ruleId === 'hook.unknown-event' || finding.ruleId === 'hook.unsupported-type'));
  assert.equal(report.clients[0].extensions.find((hook: any) => hook.config.type === 'mcp_tool').status, 'conditional');
});
test('CI retains finding thresholds and stable JSON with private values matching machine fields', async t => {
  const w = await workspace({
    'AGENTS.md': 'codex active 1',
    '.mcp.json': JSON.stringify({ mcpServers: { fixture: { command: 'node', env: { CLIENT: 'codex', STATUS: 'active', NUMBER: '1', RULE: 'parse.json', SEVERITY: 'error', FIELD: 'findings' } } } }),
    '.claude/settings.json': '{ "model": }',
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const flags = ['--clients', 'codex,claude', '--no-user', '--trust', 'trusted'];
  const result = run(['ci', ...flags], w.repo);
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schemaVersion, '1.0');
  assert.equal(report.clients[0].client, 'codex');
  assert.ok(report.clients[0].decisions.some((decision: any) => decision.status === 'active'));
  assert.ok(report.findings.some((finding: any) => finding.ruleId === 'parse.json' && finding.severity === 'error'));
  assert.equal(report.clients[0].instructions, '[REDACTED] [REDACTED] [REDACTED]');
  const summary = run(flags, w.repo);
  assert.equal(summary.status, 0, summary.stderr);
  assert.ok(summary.stdout.includes('ERROR'));
  assert.ok(summary.stdout.includes('parse.json'));
  assert.ok(!summary.stdout.includes('NaN'));
});
test('no-argument CLI diagnoses repository and JSON is machine-readable without ANSI', async t => {
  const w = await workspace({ 'AGENTS.md': 'shared' }); t.after(() => rm(w.root, { recursive: true, force: true }));
  const r = run(['--no-user'], w.repo); assert.equal(r.status, 0); assert.ok(r.stdout.includes('Agent Sightline')); assert.ok(r.stdout.includes('sources')); assert.ok(!r.stdout.includes('\x1b'));
  const j = run(['--client', 'codex', '--no-user', '--trust', 'trusted', '--json'], w.repo); assert.equal(j.status, 0); assert.equal(JSON.parse(j.stdout).clients[0].instructions, 'shared');
});
test('implicit CLI scans inherit Git-root configuration while resolving targets from the working directory', async t => {
  const w = await workspace({
    'AGENTS.md': 'Root Codex instructions.',
    'CLAUDE.md': 'Root Claude instructions.',
    '.github/copilot-instructions.md': 'Root Copilot instructions.',
    '.codex/config.toml': 'model = "repository-model"',
    '.claude/settings.json': '{"model":"repository-model"}',
    'src/payments/CLAUDE.md': 'Nested Claude instructions.',
    'src/payments/refund.ts': '',
    'src/shared.ts': '',
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const repo = await realpath(w.repo);
  const cwd = path.join(repo, 'src/payments');
  const flags = ['--clients', 'codex,claude,copilot', '--no-user', '--trust', 'trusted', '--json'];
  const initial = run(flags, cwd);
  assert.equal(initial.status, 0, initial.stderr);
  const report = JSON.parse(initial.stdout);
  assert.equal(report.repository, repo);
  assert.equal(report.target, cwd);
  assert.equal(report.sessionDirectory, cwd);
  assert.ok(report.clients[0].instructions.includes('Root Codex instructions.'));
  assert.ok(report.clients[1].instructions.includes('Root Claude instructions.'));
  assert.ok(report.clients[1].instructions.includes('Nested Claude instructions.'));
  assert.ok(report.clients[2].instructions.includes('Root Copilot instructions.'));
  for (const client of report.clients.slice(0, 2)) assert.equal(client.settings.find((setting: any) => setting.key === 'model' && setting.status === 'active').value, 'repository-model');
  for (const target of ['refund.ts', '../shared.ts']) {
    const explained = run(['explain', target, ...flags], cwd);
    assert.equal(explained.status, 0, explained.stderr);
    assert.equal(JSON.parse(explained.stdout).target, path.resolve(cwd, target));
  }
  const outside = run(['explain', '../../../outside', ...flags], cwd);
  assert.equal(outside.status, 2);
});
test('explicit CLI repository boundaries retain their own relative target paths', async t => {
  const w = await workspace({ 'AGENTS.md': 'Outer instructions.', 'src/CLAUDE.md': 'Selected project instructions.', 'src/a.ts': '' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const directory = path.join(w.repo, 'src');
  const flags = ['--no-user', '--trust', 'trusted', '--client', 'claude', '--json'];
  for (const args of [[directory, ...flags], ['--repo', directory, ...flags], ['explain', 'a.ts', '--repo', directory, ...flags]]) {
    const result = run(args, w.repo);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.repository, directory);
    assert.ok(!report.sources.some((source: any) => source.path === path.join(w.repo, 'AGENTS.md')));
    assert.equal(report.clients[0].instructions, 'Selected project instructions.');
    assert.equal(report.target, args[0] === 'explain' ? path.join(directory, 'a.ts') : directory);
  }
});
test('CLI explain/diff/adapters/help/version and options after commands', async t => {
  const w = await workspace({ 'src/a.ts': '', 'AGENTS.md': 'shared' }); t.after(() => rm(w.root, { recursive: true, force: true }));
  const e = run(['explain', 'src/a.ts', '--client', 'codex', '--no-user', '--trust', 'trusted'], w.repo); assert.equal(e.status, 0); assert.ok(e.stdout.includes('Effective instructions')); assert.ok(e.stdout.includes('AGENTS.md:1'));
  const d = run(['diff', 'src/a.ts', '--clients', 'codex,copilot', '--no-user', '--trust', 'trusted', '--json'], w.repo); assert.equal(d.status, 0); assert.deepEqual(JSON.parse(d.stdout).diff[0].clients, ['codex', 'copilot']);
  for (const args of [['--help'], ['explain', '--help'], ['version'], ['--version'], ['adapters', '--json']]) assert.equal(run(args, w.repo).status, 0, args.join(' '));
});
test('CLI summary keeps same-name MCP failures at separate sources and labels experimental clients', async t => {
  const w = await workspace({
    '.codex/config.toml': '[mcp_servers.db]\ncommand="missing-sightline-runtime"',
    '.mcp.json': '{"mcpServers":{"db":{"command":"missing-sightline-runtime"}}}',
    '.cursor/rules/check.mdc': '---\nalwaysApply: true\n---\nCheck changes.',
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const result = run(['--clients', 'codex,claude,copilot,cursor', '--no-user', '--trust', 'trusted', '--severity', 'error'], w.repo);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('Cursor (experimental)'));
  assert.match(result.stdout, /2 findings\nErrors 2 · Warnings 0 · Info 0/);
  assert.equal(result.stdout.match(/^ERROR MCP command/gm)?.length, 2);
  assert.ok(result.stdout.includes(path.join(w.repo, '.codex/config.toml') + ':2:1'));
  assert.ok(result.stdout.includes(path.join(w.repo, '.mcp.json') + ':1:1'));
  assert.ok(result.stdout.includes('[claude, copilot]'));
});
test('CLI discovery budgets report partial results and reject invalid counts without output files', async t => {
  const w = await workspace({ 'AGENTS.md': 'Repository instructions.' }, { '.claude/rules/a.md': 'First personal rule.', '.claude/rules/b.md': 'Second personal rule.' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const partial = run(['--client', 'codex', '--no-user', '--max-entries', '0', '--severity', 'error'], w.repo);
  assert.equal(partial.status, 0, partial.stderr);
  assert.ok(partial.stdout.includes('Configuration discovery is incomplete.'));
  assert.ok(!partial.stdout.includes('No deterministic configuration problems found.'));
  const user = run(['--client', 'claude', '--home', w.home, '--max-user-files', '1', '--json'], w.repo);
  assert.equal(user.status, 0, user.stderr);
  const report = JSON.parse(user.stdout);
  assert.equal(report.discovery.complete, false);
  assert.equal(report.discovery.userFileLimit, 1);
  assert.ok(report.clients[0].instructions.includes('First personal rule.'));
  assert.ok(!report.clients[0].instructions.includes('Second personal rule.'));
  const strict = run(['ci', '--client', 'codex', '--no-user', '--max-entries', '0', '--fail-on', 'warn'], w.repo);
  assert.equal(strict.status, 1);
  for (const option of ['--max-entries', '--max-user-files']) {
    for (const count of ['-1', '1.5', 'NaN', 'Infinity']) {
      const invalid = run([option, count, '--no-user', '--output', 'invalid.json'], w.repo);
      assert.equal(invalid.status, 2, `${option} ${count}`);
    }
  }
  assert.ok(!(await readdir(w.repo)).includes('invalid.json'));
});
test('CI threshold uses unfiltered findings; errors return 2 and write no partial output', async t => {
  const w = await workspace({ '.mcp.json': '{"mcpServers":{"db":{"command":"missing-sightline-executable"}}}' }); t.after(() => rm(w.root, { recursive: true, force: true }));
  const r = run(['ci', '--client', 'claude', '--no-user', '--fail-on', 'error'], w.repo); assert.equal(r.status, 1); assert.ok(JSON.parse(r.stdout).findings.some((f: any) => f.ruleId === 'mcp.command-missing'));
  const none = run(['ci', '--client', 'claude', '--no-user', '--fail-on', 'none'], w.repo); assert.equal(none.status, 0);
  for (const args of [['--client', 'wrong'], ['--unknown'], ['explain'], ['explain', '../outside'], ['report', '--format', 'wrong', '--output', 'bad.html'], ['scan', '--probe']]) assert.equal(run(args, w.repo).status, 2, args.join(' '));
  assert.ok(!(await readdir(w.repo)).some(x => x === 'bad.html' || x.endsWith('.tmp')));
});

test('CI syntax failures follow the selected client while shared source errors keep their owners', async t => {
  const w = await workspace({ 'AGENTS.md': 'Repository instructions.', '.claude/settings.local.json': '{ broken JSON' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const codex = run(['ci', '--client', 'codex', '--no-user', '--trust', 'trusted'], w.repo);
  assert.equal(codex.status, 0, codex.stderr);
  assert.ok(!JSON.parse(codex.stdout).findings.some((finding: any) => finding.ruleId.startsWith('parse.')));
  const claude = run(['ci', '--client', 'claude', '--no-user'], w.repo);
  assert.equal(claude.status, 1, claude.stderr);
  assert.ok(JSON.parse(claude.stdout).findings.some((finding: any) => finding.ruleId === 'parse.json'));
  await writeFile(path.join(w.repo, '.mcp.json'), '{ broken MCP JSON');
  for (const client of ['claude', 'copilot']) {
    const result = run(['ci', '--client', client, '--no-user'], w.repo);
    assert.equal(result.status, 1, result.stderr);
    assert.ok(JSON.parse(result.stdout).findings.some((finding: any) => finding.ruleId === 'parse.json' && finding.location.path.endsWith('.mcp.json')));
  }
});
test('CI reports malformed extensions as findings and retains valid sibling definitions', async t => {
  const w = await workspace({
    '.mcp.json': JSON.stringify({ mcpServers: { invalid: { command: 'node', env: { PATH: 42 } }, valid: { command: process.execPath } } }),
    '.github/hooks/test.json': JSON.stringify({ version: 1, hooks: { sessionStart: [{ type: 'command', bash: 'echo safe', powershell: 'echo safe', cwd: 42 }] } }),
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const result = run(['ci', '--clients', 'claude,copilot', '--no-user', '--trust', 'trusted'], w.repo);
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  for (const rule of ['mcp.env-type', 'extension.cwd-type']) assert.ok(report.findings.some((finding: any) => finding.ruleId === rule));
  for (const client of report.clients) assert.equal(client.extensions.find((extension: any) => extension.name === 'valid').status, 'active');
});
test('HTML/JSON report writes only explicit output and redacts exported paths', async t => {
  const w = await workspace({ 'CLAUDE.md': 'API_KEY=secret-sentinel-value' }); t.after(() => rm(w.root, { recursive: true, force: true }));
  const r = run(['report', '--client', 'claude', '--no-user', '--format', 'html', '--output', 'report.html'], w.repo); assert.equal(r.status, 0); const html = await readFile(path.join(w.repo, 'report.html'), 'utf8'); assert.ok(html.startsWith('<!doctype html>')); assert.ok(!html.includes('secret-sentinel-value')); assert.ok(!html.includes(w.repo));
  const broken = run(['report', '--output', 'missing-dir/report.json', '--json', '--no-user'], w.repo); assert.equal(broken.status, 2);
});

test('CLI exports replace a configured agent home outside the user home while JSON keeps diagnostic paths', async t => {
  const w = await workspace();
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const codexHome = path.join(w.root, 'external-codex-home');
  await mkdir(codexHome);
  await writeFile(path.join(codexHome, 'config.toml'), 'model="external-model"\n');
  const env = { ...process.env, HOME: w.home, USERPROFILE: w.home, CODEX_HOME: codexHome };
  const args = ['--import', import.meta.resolve('tsx'), cli, '--repo', w.repo, '--client', 'codex'];
  const result = spawnSync(process.execPath, [...args, '--json'], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.clients[0].settings.find((setting: any) => setting.key === 'model' && setting.status === 'active').value, 'external-model');
  assert.ok(report.pathMappings.some((mapping: any) => mapping.path === codexHome && mapping.replacement === '<codex-home>'));
  const exported = spawnSync(process.execPath, [...args, '--format', 'html'], { env, encoding: 'utf8' });
  assert.equal(exported.status, 0, exported.stderr);
  assert.ok(!exported.stdout.includes(JSON.stringify(codexHome).slice(1, -1)));
  const snapshot = JSON.parse(exported.stdout.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/)![1]);
  const model = snapshot.clients[0].settings.find((setting: any) => setting.key === 'model' && setting.status === 'active');
  assert.equal(model.location.path.replace(/\\/g, '/'), '<codex-home>/config.toml');
  assert.equal(snapshot.pathMappings, undefined);
});

test('CLI retains oversized configured arguments while bounded alias discovery handles filesystem path errors', async t => {
  const argument = path.parse(process.cwd()).root + 'missing-sightline-directory/' + 'nested/'.repeat(10000);
  const w = await workspace({ '.mcp.json': JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: [argument] } } }) });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, ['--max-old-space-size=128', '--import', import.meta.resolve('tsx'), cli, '--repo', w.repo, '--client', 'claude', '--no-user', '--trust', 'trusted', '--json'], { encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.clients[0].extensions.find((extension: any) => extension.name === 'fixture').config.args[0], argument);
});

test('CLI profile selection resolves the named file and rejects incompatible inputs without output files', async t => {
  const w = await workspace({}, { '.codex/config.toml': 'model = "base"', '.codex/review.config.toml': 'model = "review"' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const result = run(['--client', 'codex', '--home', w.home, '--profile', 'review', '--json'], w.repo);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.inputs.codexProfile, 'review');
  assert.equal(report.clients[0].settings.find((setting: any) => setting.key === 'model' && setting.status === 'active').value, 'review');
  for (const args of [['--no-user', '--profile', 'review'], ['--client', 'claude', '--profile', 'review'], ['--profile', '../private']]) {
    const invalid = run([...args, '--home', w.home, '--output', 'invalid.json'], w.repo);
    assert.equal(invalid.status, 2);
    assert.ok(!(await readdir(w.repo)).includes('invalid.json'));
  }
});

test('interrupting a CLI probe terminates its server before exiting', { skip: process.platform === 'win32', timeout: 15000 }, async t => {
  const server = `import { writeFileSync, renameSync } from 'node:fs';
writeFileSync('probe.pid.tmp', String(process.pid));
renameSync('probe.pid.tmp', 'probe.pid');
setInterval(() => {}, 1000);
process.on('SIGTERM', () => {});`;
  const w = await workspace({ 'server.mjs': server, '.mcp.json': JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: ['server.mjs'] } } }) });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const changes = watch(w.repo, { signal: AbortSignal.timeout(10000) });
  const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), cli, 'doctor', '--probe', '--client', 'claude', '--trust', 'trusted', '--no-user'], { cwd: w.repo, stdio: 'ignore' });
  const closed = once(child, 'close');
  let pid: number | undefined;
  try {
    for await (const change of changes) if (change.filename === 'probe.pid') break;
    pid = Number(await readFile(path.join(w.repo, 'probe.pid'), 'utf8'));
    child.kill('SIGINT');
    const [code, signal] = await closed;
    assert.equal(code, 130);
    assert.equal(signal, null);
    assert.throws(() => process.kill(pid!, 0));
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
    if (pid) { try { process.kill(-pid, 'SIGKILL'); } catch { /* the owned probe already exited */ } }
  }
});
