import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
const repo = mkdtempSync(path.join(os.tmpdir(), 'sightline-bench-'));
try {
  mkdirSync(path.join(repo, '.git')); writeFileSync(path.join(repo, 'AGENTS.md'), 'Benchmark repository instruction.');
  for (let d = 0; d < 100; d++) { const dir = path.join(repo, `module-${d}`); mkdirSync(dir); for (let f = 0; f < 100; f++) writeFileSync(path.join(dir, `file-${f}.ts`), ''); }
  const start = performance.now(); const r = spawnSync(process.execPath, [path.resolve('dist/cli/index.js'), '--repo', repo, '--no-user', '--json'], { encoding: 'utf8' }); const elapsed = performance.now() - start;
  if (r.status !== 0) throw new Error(r.stderr);
  console.log(JSON.stringify({ files: 10000, coldProcessMs: Math.round(elapsed), platform: process.platform, arch: process.arch, node: process.version, sources: JSON.parse(r.stdout).sources.length, note: 'Synthetic tree; fresh process, filesystem recently populated. Not a universal cold-disk benchmark.' }, null, 2));
} finally { rmSync(repo, { recursive: true, force: true }); }
