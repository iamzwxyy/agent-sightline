import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readFile, readdir, rm } from 'node:fs/promises';
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
