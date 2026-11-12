import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const temp = mkdtempSync(path.join(os.tmpdir(), 'sightline-install-'));
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this script using npm run smoke.');
const runNpm = args => execFileSync(process.execPath, [npm, ...args], { encoding: 'utf8' });
try {
  const result = JSON.parse(runNpm(['pack', '--ignore-scripts', '--json', '--pack-destination', temp]));
  const tarball = path.join(temp, result[0].filename);
  runNpm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', path.join(temp, 'install'), tarball]);
  const cli = path.join(temp, 'install/node_modules/agent-sightline/dist/cli/index.js');
  const repo = path.join(temp, 'repository'); mkdirSync(path.join(repo, '.git'), { recursive: true }); writeFileSync(path.join(repo, 'AGENTS.md'), 'Installed package works.');
  const output = execFileSync(process.execPath, [cli, '--repo', repo, '--no-user', '--trust', 'trusted', '--client', 'codex', '--json'], { encoding: 'utf8' });
  const report = JSON.parse(output); if (report.clients[0].instructions !== 'Installed package works.') throw new Error('Installed resolver failed.');
  const htmlFile = path.join(temp, 'report.html'); execFileSync(process.execPath, [cli, 'report', '--repo', repo, '--no-user', '--format', 'html', '--output', htmlFile]);
  if (!readFileSync(htmlFile, 'utf8').includes('Sightline — Agent configuration')) throw new Error('Installed HTML reporter failed.');
  const version = execFileSync(process.execPath, [cli, 'version'], { encoding: 'utf8' }).trim(); if (version !== '0.1.0') throw new Error('Wrong package version.');
  const demo = JSON.parse(execFileSync(process.execPath, [cli, 'demo', '--clients', 'codex,claude,copilot', '--json'], { encoding: 'utf8' }));
  if (new Set(demo.findings.map(f => f.ruleId)).size < 5) throw new Error('Bundled demo failed to demonstrate real findings.');
  console.log(`Installed ${result[0].filename}: CLI, Codex resolution, HTML assets and version passed (${result[0].size} compressed bytes).`);
} finally { rmSync(temp, { recursive: true, force: true }); }
