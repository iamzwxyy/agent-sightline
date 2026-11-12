import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const temp = mkdtempSync(path.join(os.tmpdir(), 'sightline-install-'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this script using npm run smoke.');
const runNpm = args => execFileSync(process.execPath, [npm, ...args], { encoding: 'utf8' });
try {
  const result = JSON.parse(runNpm(['pack', '--ignore-scripts', '--json', '--pack-destination', temp]));
  const tarball = path.join(temp, result[0].filename);
  runNpm(['install', '--offline', '--cache', path.join(temp, 'empty-cache'), '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', path.join(temp, 'install'), tarball]);
  const cli = path.join(temp, 'install/node_modules/agent-sightline/dist/cli/index.js');
  const repo = path.join(temp, 'repository'); mkdirSync(path.join(repo, '.git'), { recursive: true }); writeFileSync(path.join(repo, 'AGENTS.md'), 'Installed package works.');
  const output = execFileSync(process.execPath, [cli, '--repo', repo, '--no-user', '--trust', 'trusted', '--client', 'codex', '--json'], { encoding: 'utf8' });
  const report = JSON.parse(output); if (report.clients[0].instructions !== 'Installed package works.') throw new Error('Installed resolver failed.');
  const nested = path.join(repo, 'src'); mkdirSync(nested);
  const inferred = JSON.parse(execFileSync(process.execPath, [cli, 'explain', 'new.ts', '--no-user', '--trust', 'trusted', '--client', 'codex', '--json'], { cwd: nested, encoding: 'utf8' }));
  if (inferred.clients[0].instructions !== 'Installed package works.' || path.dirname(path.dirname(inferred.target)) !== inferred.repository) throw new Error('Installed nested-directory discovery failed.');
  const htmlFile = path.join(temp, 'report.html'); execFileSync(process.execPath, [cli, 'report', '--repo', repo, '--no-user', '--format', 'html', '--output', htmlFile]);
  if (!readFileSync(htmlFile, 'utf8').includes('Sightline — Agent configuration')) throw new Error('Installed HTML reporter failed.');
  const version = execFileSync(process.execPath, [cli, 'version'], { encoding: 'utf8' }).trim(); if (version !== pkg.version || report.tool.version !== pkg.version) throw new Error('Wrong package version.');
  const profileHome = path.join(temp, 'profile-home');
  mkdirSync(path.join(profileHome, '.codex'), { recursive: true });
  writeFileSync(path.join(profileHome, '.codex/config.toml'), 'model = "base-model"\n');
  writeFileSync(path.join(profileHome, '.codex/review.config.toml'), 'model = "review-model"\n');
  const profiled = JSON.parse(execFileSync(process.execPath, [cli, '--repo', repo, '--home', profileHome, '--client', 'codex', '--profile', 'review', '--json'], { encoding: 'utf8' }));
  if (profiled.inputs?.codexProfile !== 'review' || profiled.clients[0].settings.find(setting => setting.key === 'model' && setting.status === 'active')?.value !== 'review-model') throw new Error('Installed profile resolution failed.');
  const demo = JSON.parse(execFileSync(process.execPath, [cli, 'demo', '--clients', 'codex,claude,copilot', '--json'], { encoding: 'utf8' }));
  if (new Set(demo.findings.map(f => f.ruleId)).size < 5) throw new Error('Bundled demo failed to demonstrate real findings.');
  const inspector = spawn(process.execPath, [cli, 'demo', '--ui', '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let startupTimer;
  try {
    const url = await new Promise((resolve, reject) => {
      let output = '';
      startupTimer = setTimeout(() => reject(new Error('Installed demo inspector did not start.')), 15000);
      inspector.once('error', reject);
      inspector.once('exit', () => reject(new Error('Installed demo inspector exited before startup.')));
      inspector.stdout.on('data', chunk => { output += chunk.toString(); const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) resolve(match[0]); });
    });
    const page = await (await globalThis.fetch(url)).text();
    if (!page.includes('Read effective text') || !page.includes('instructions.truncated')) throw new Error('Installed demo inspector assets are incomplete.');
    const sample = await (await globalThis.fetch(url + '/api/scan?target=src/payments/refund.ts')).json();
    if (!sample.assumptions.includes('User configuration: excluded.')) throw new Error('Demo inspector must exclude personal configuration.');
    const snapshot = await (await globalThis.fetch(url + '/api/scan?target=src/payments/refund.ts&include=html')).json();
    if (snapshot.report.target !== sample.target || !snapshot.html.includes('data-live="false"') || !snapshot.html.includes('instructions.truncated')) throw new Error('Installed inspector snapshot export failed.');
  } finally {
    clearTimeout(startupTimer);
    if (inspector.exitCode === null) { const stopped = once(inspector, 'exit'); inspector.kill(); await stopped; }
  }
  console.log(`Installed ${result[0].filename} offline with an empty cache: CLI, Codex resolution, HTML assets, version and browser demo startup passed (${result[0].size} compressed bytes).`);
} finally { rmSync(temp, { recursive: true, force: true }); }
