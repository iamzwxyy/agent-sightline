import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { skills: { type: 'string' } } });
const configured = values.skills !== undefined;
const skillCount = Number(values.skills ?? 0);
if (!Number.isSafeInteger(skillCount) || skillCount < 0) throw new Error('--skills must be a non-negative safe integer.');
const repo = mkdtempSync(path.join(os.tmpdir(), 'sightline-bench-'));
try {
  mkdirSync(path.join(repo, '.git'));
  writeFileSync(path.join(repo, 'AGENTS.md'), 'Benchmark repository instruction.');
  for (let directory = 0; directory < 100; directory++) {
    const folder = path.join(repo, `module-${directory}`);
    mkdirSync(folder);
    for (let file = 0; file < 100; file++) writeFileSync(path.join(folder, `file-${file}.ts`), '');
    if (configured) writeFileSync(path.join(folder, 'AGENTS.md'), `Instructions for module ${directory}.`);
  }
  if (configured) {
    const rules = path.join(repo, '.claude/rules');
    mkdirSync(rules, { recursive: true });
    for (let index = 0; index < 100; index++) {
      writeFileSync(path.join(rules, `policy-${index}.md`), `---\npaths:\n  - module-99/**\n---\nPolicy ${index} applies to the selected module.\n`);
    }
    for (let index = 0; index < skillCount; index++) {
      const folder = path.join(repo, '.agents/skills', `skill-${index}`);
      mkdirSync(folder, { recursive: true });
      writeFileSync(path.join(folder, 'SKILL.md'), `---\nname: skill-${index}\ndescription: A reproducible benchmark skill.\n---\nPerform the documented workflow.\n`);
    }
  }
  const args = [path.resolve('dist/cli/index.js')];
  if (configured) args.push('explain', 'module-99/file-99.ts', '--trust', 'trusted');
  args.push('--repo', repo, '--no-user', '--json');
  const start = performance.now();
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const elapsed = performance.now() - start;
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `CLI exited with status ${result.status}.`);
  const report = JSON.parse(result.stdout);
  if (!report.discovery.complete) throw new Error('Benchmark discovery is incomplete. Reduce --skills to fit the default discovery budget.');
  if (configured) {
    const codex = report.clients.find(client => client.client === 'codex');
    const skills = codex.extensions.filter(extension => extension.kind === 'skill');
    if (report.sources.length !== 201 + skillCount || skills.length !== skillCount || !codex.instructions.includes('Instructions for module 99.')) {
      throw new Error('The configured benchmark did not discover and resolve its complete fixture.');
    }
  }
  console.log(JSON.stringify({
    files: 10000,
    coldProcessMs: Math.round(elapsed),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    sources: report.sources.length,
    ...(configured ? { skills: skillCount, repositoryEntries: report.discovery.repositoryEntries, reportBytes: Buffer.byteLength(result.stdout) } : {}),
    note: 'Synthetic tree, fresh process, filesystem cache warmed by fixture creation.',
  }, null, 2));
} finally { rmSync(repo, { recursive: true, force: true }); }
