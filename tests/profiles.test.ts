import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { rm, writeFile } from 'node:fs/promises';
import { scan } from '../packages/core/index.js';
import { html, json, terminal } from '../packages/reporter/index.js';
import { workspace } from './helpers.js';

test('selected Codex profile overlays user defaults with project precedence and exact provenance', async t => {
  const w = await workspace({
    'AGENTS.md': 'Repository instructions',
    'src/a.ts': '',
    '.codex/config.toml': 'model = "project-model"\nmodel_provider = "blocked-provider"\n',
  }, {
    '.codex/config.toml': 'model = "base-model"\nsandbox_mode = "read-only"\nmodel_provider = "openai"\n',
    '.codex/review.config.toml': 'model = "review-model"\nsandbox_mode = "workspace-write"\nmodel_reasoning_effort = "high"\n[mcp_servers.fixture]\ncommand = "node"\n[mcp_servers.fixture.env]\nVALUE = "profile-private-sentinel"\n',
    '.codex/unselected.config.toml': 'this is deliberately invalid TOML',
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const selected = await scan({ ...w, target: 'src/a.ts', clients: ['codex'], trust: 'trusted', codexProfile: 'review' });
  const effective = selected.clients[0];
  const winner = effective.settings.find(setting => setting.key === 'model' && setting.status === 'active')!;
  assert.equal(winner.value, 'project-model');
  assert.equal(winner.location.line, 1);
  assert.deepEqual(winner.overrides.map(location => path.basename(location.path)), ['config.toml', 'review.config.toml']);
  const sandbox = effective.settings.find(setting => setting.key === 'sandbox_mode' && setting.status === 'active')!;
  assert.equal(sandbox.value, 'workspace-write');
  assert.equal(sandbox.location.path, path.join(w.home, '.codex/review.config.toml'));
  assert.equal(sandbox.location.line, 2);
  assert.equal(effective.settings.find(setting => setting.key === 'model_provider' && setting.status === 'active')?.value, 'openai');
  assert.ok(effective.settings.some(setting => setting.key === 'model_provider' && setting.status === 'ignored'));
  assert.equal(effective.extensions.find(extension => extension.name === 'fixture')?.status, 'active');
  assert.equal(selected.inputs?.codexProfile, 'review');
  assert.ok(!selected.sources.some(source => source.path.endsWith('unselected.config.toml')));
  assert.ok(!selected.findings.some(finding => finding.ruleId.startsWith('parse.')));
  for (const output of [json(selected), html(selected), terminal(selected, 'explain')]) assert.ok(!output.includes('profile-private-sentinel'));
  const base = await scan({ ...w, target: 'src/a.ts', clients: ['codex'], trust: 'trusted' });
  assert.equal(base.clients[0].settings.find(setting => setting.key === 'sandbox_mode' && setting.status === 'active')?.value, 'read-only');
  assert.ok(!base.sources.some(source => source.path.endsWith('review.config.toml')));
  const untrusted = await scan({ ...w, target: 'src/a.ts', clients: ['codex'], trust: 'untrusted', codexProfile: 'review' });
  assert.equal(untrusted.clients[0].settings.find(setting => setting.key === 'model' && setting.status === 'active')?.value, 'review-model');
});

test('profile file controls instruction budget, root markers and automatic trust', async t => {
  const w = await workspace({ 'AGENTS.md': 'Outer instructions', 'src/AGENTS.md': 'Nested instructions', 'src/a.ts': '' }, {
    '.codex/review.config.toml': 'project_doc_max_bytes = 6\nproject_root_markers = []\n',
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  await writeFile(path.join(w.home, '.codex/review.config.toml'), `project_doc_max_bytes = 6\nproject_root_markers = []\n[projects.${JSON.stringify(w.repo)}]\ntrust_level = "trusted"\n`);
  const report = await scan({ ...w, clients: ['codex'], codexProfile: 'review', target: 'src/a.ts' });
  assert.equal(report.clients[0].instructions, 'Nested');
  assert.ok(report.findings.some(finding => finding.ruleId === 'instructions.truncated'));
  assert.ok(report.clients[0].notes.some(note => note.includes('Project trust: trusted')));
});

test('unused legacy tables are excluded and selected legacy profiles produce migration errors', async t => {
  const w = await workspace({}, {
    '.codex/config.toml': 'model = "base"\n[profiles.review]\nmodel = "legacy"\n',
    '.codex/review.config.toml': 'model = "new"\n',
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const base = await scan({ ...w, clients: ['codex'] });
  assert.ok(base.findings.some(finding => finding.ruleId === 'codex.legacy-profiles' && finding.severity === 'warn'));
  assert.ok(!base.clients[0].settings.some(setting => setting.key.startsWith('profiles.')));
  assert.equal(base.clients[0].settings.find(setting => setting.key === 'model')?.value, 'base');
  const conflict = await scan({ ...w, clients: ['codex'], codexProfile: 'review' });
  assert.ok(conflict.findings.some(finding => finding.ruleId === 'codex.legacy-profiles' && finding.severity === 'error' && finding.location.line === 2));
  assert.ok(!conflict.clients[0].settings.some(setting => setting.status === 'active'));
  await writeFile(path.join(w.home, '.codex/config.toml'), 'profile = "review"\nmodel = "base"\n');
  const selector = await scan({ ...w, clients: ['codex'] });
  assert.ok(selector.findings.some(finding => finding.ruleId === 'codex.legacy-profile' && finding.location.line === 1));
});

test('absent or malformed profile files retain explicit diagnostics and base provenance', async t => {
  const w = await workspace({}, { '.codex/config.toml': 'model = "base"\n', '.codex/broken.config.toml': 'model = [\n' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const absent = await scan({ ...w, clients: ['codex'], codexProfile: 'absent' });
  assert.ok(absent.findings.some(finding => finding.ruleId === 'codex.profile-missing'));
  assert.equal(absent.clients[0].settings.find(setting => setting.key === 'model')?.value, 'base');
  const broken = await scan({ ...w, clients: ['codex'], codexProfile: 'broken' });
  assert.ok(broken.findings.some(finding => finding.ruleId === 'parse.toml'));
  assert.ok(broken.clients[0].decisions.some(decision => decision.path.endsWith('broken.config.toml') && decision.status === 'invalid'));
});

test('project-only machine settings are removed before Codex schema validation', async t => {
  const w = await workspace({ '.codex/config.toml': 'model = "project"\nmodel_provider = 42\nprofile = "unsupported"\n[profiles.ignored]\nmodel = "unused"\n' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, clients: ['codex'], trust: 'trusted' });
  assert.ok(!report.findings.some(finding => ['config.schema', 'codex.legacy-profile', 'codex.legacy-profiles'].includes(finding.ruleId)));
  assert.equal(report.clients[0].settings.find(setting => setting.key === 'model' && setting.status === 'active')?.value, 'project');
  assert.equal(report.findings.filter(finding => finding.ruleId === 'codex.project-setting-ignored').length, 3);
});

test('invalid profile selection is rejected before reading profile files', async t => {
  const w = await workspace();
  t.after(() => rm(w.root, { recursive: true, force: true }));
  for (const codexProfile of ['', '../private', 'a/b', 'a\\b', 'review.config.toml', 'with space']) await assert.rejects(scan({ ...w, codexProfile }), /profile names/);
  await assert.rejects(scan({ ...w, codexProfile: 'review', user: false }), /user configuration/);
  await assert.rejects(scan({ ...w, codexProfile: 'review', clients: ['claude'] }), /selected clients/);
});
