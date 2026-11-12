import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { scan } from '../packages/core/index.js';
import type { ClientId } from '../packages/core/types.js';
import { slash } from '../packages/core/utils.js';
import { fixture, workspace } from './helpers.js';

for (const client of ['codex', 'claude', 'copilot'] as const) test(`${client} adapter golden: filesystem → effective → provenance → findings`, async t => {
  const f = await fixture(`${client}/chain.json`); const w = await workspace(f.repo, f.home); t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, target: f.target, clients: [client], trust: 'trusted' }); const e = report.clients[0];
  const rel = (p: string) => p.startsWith(w.home) ? '$home/' + slash(path.relative(w.home, p)) : slash(path.relative(w.repo, p));
  for (const status of ['active', 'ignored', 'shadowed', 'conditional', 'truncated']) for (const p of f.expected[status] ?? []) assert.ok(e.decisions.some(d => rel(d.path) === p && d.status === status), `${p} should be ${status}`);
  for (const value of f.expected.contains) assert.ok(e.instructions.includes(value), value);
  for (const value of f.expected.absent) assert.ok(!e.instructions.includes(value), value);
  for (const rule of f.expected.findings) assert.ok(report.findings.some(f => f.ruleId === rule), rule);
  assert.ok(e.decisions.every(d => path.isAbsolute(d.path) && d.line > 0 && d.reason));
  assert.ok(!report.findings.some(f => f.ruleId.startsWith('parse.')), JSON.stringify(report.findings));
  if (client === 'codex') { assert.equal(e.decisions.find(d => slash(d.path).endsWith('src/payments/AGENTS.override.md'))!.loadedBytes, 20); assert.equal(e.metadata.ruleVersion, '0.167.2'); }
  if (client === 'claude') { assert.equal(e.settings.find(s => s.key === 'model' && s.status === 'active')!.value, 'project-model'); assert.ok(e.extensions.some(x => x.kind === 'permission' && x.config.action === 'allow' && x.status === 'shadowed')); }
});
for (const client of ['gemini', 'cursor', 'opencode'] as ClientId[]) test(`${client} experimental golden has explicit boundaries`, async t => {
  const f = await fixture('mixed/experimental.json'); const w = await workspace(f.repo, f.home); t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, target: f.target, clients: [client], trust: 'trusted' }); const e = report.clients[0];
  assert.equal(e.metadata.maturity, 'experimental'); assert.ok(e.metadata.limitations.length);
  for (const status of ['active', 'ignored', 'conditional']) for (const p of f.expected[client][status] ?? []) assert.ok(e.decisions.some(d => slash(path.relative(w.repo, d.path)) === p && d.status === status), `${p} ${status}`);
  for (const s of f.expected[client].contains) assert.ok(e.instructions.includes(s));
  for (const s of f.expected[client].absent) assert.ok(!e.instructions.includes(s));
  if (client === 'opencode') assert.ok(e.instructions.indexOf('Nested shared') < e.instructions.indexOf('Shared root'));
});
