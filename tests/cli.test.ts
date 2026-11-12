import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readFile, readdir, rm, watch } from 'node:fs/promises';
import { workspace } from './helpers.js';
const cli = path.resolve('packages/cli/index.ts');
function run(args: string[], cwd: string) { return spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), cli, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } }); }
test('no-argument CLI diagnoses repository and JSON is machine-readable without ANSI', async t => {
  const w = await workspace({ 'AGENTS.md': 'shared' }); t.after(() => rm(w.root, { recursive: true, force: true }));
  const r = run(['--no-user'], w.repo); assert.equal(r.status, 0); assert.ok(r.stdout.includes('Agent Sightline')); assert.ok(r.stdout.includes('sources')); assert.ok(!r.stdout.includes('\x1b'));
  const j = run(['--client', 'codex', '--no-user', '--trust', 'trusted', '--json'], w.repo); assert.equal(j.status, 0); assert.equal(JSON.parse(j.stdout).clients[0].instructions, 'shared');
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
  assert.ok(result.stdout.includes(path.join(w.repo, '.codex/config.toml') + ':1:1'));
  assert.ok(result.stdout.includes(path.join(w.repo, '.mcp.json') + ':1:1'));
  assert.ok(result.stdout.includes('[claude, copilot]'));
});
test('CI threshold uses unfiltered findings; errors return 2 and write no partial output', async t => {
  const w = await workspace({ '.mcp.json': '{"mcpServers":{"db":{"command":"missing-sightline-executable"}}}' }); t.after(() => rm(w.root, { recursive: true, force: true }));
  const r = run(['ci', '--client', 'claude', '--no-user', '--fail-on', 'error'], w.repo); assert.equal(r.status, 1); assert.ok(JSON.parse(r.stdout).findings.some((f: any) => f.ruleId === 'mcp.command-missing'));
  const none = run(['ci', '--client', 'claude', '--no-user', '--fail-on', 'none'], w.repo); assert.equal(none.status, 0);
  for (const args of [['--client', 'wrong'], ['--unknown'], ['explain'], ['explain', '../outside'], ['report', '--format', 'wrong', '--output', 'bad.html'], ['scan', '--probe']]) assert.equal(run(args, w.repo).status, 2, args.join(' '));
  assert.ok(!(await readdir(w.repo)).some(x => x === 'bad.html' || x.endsWith('.tmp')));
});
test('HTML/JSON report writes only explicit output and redacts exported paths', async t => {
  const w = await workspace({ 'CLAUDE.md': 'API_KEY=secret-sentinel-value' }); t.after(() => rm(w.root, { recursive: true, force: true }));
  const r = run(['report', '--client', 'claude', '--no-user', '--format', 'html', '--output', 'report.html'], w.repo); assert.equal(r.status, 0); const html = await readFile(path.join(w.repo, 'report.html'), 'utf8'); assert.ok(html.startsWith('<!doctype html>')); assert.ok(!html.includes('secret-sentinel-value')); assert.ok(!html.includes(w.repo));
  const broken = run(['report', '--output', 'missing-dir/report.json', '--json', '--no-user'], w.repo); assert.equal(broken.status, 2);
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
