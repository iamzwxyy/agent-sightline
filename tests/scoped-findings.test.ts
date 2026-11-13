import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { scan } from '../packages/core/index.js';
import { html, json, terminal } from '../packages/reporter/index.js';
import { workspace } from './helpers.js';

test('target discovery scope excludes sibling-project syntax and configuration diagnostics', async t => {
  const w = await workspace({
    'AGENTS.md': 'Safe instructions.\n\nscoped-findings-private-value',
    '.codex/config.toml': 'model="root-model"\n',
    'app/src/index.ts': '',
    'sibling/src/index.ts': '',
    'sibling/.codex/config.toml': 'model=[\n',
    'sibling/.claude/settings.local.json': '{ broken JSON',
    'sibling/.claude/settings.json': JSON.stringify({ Permissions: {}, permissions: { allowed: [] }, mcpServers: {}, env: { NORMAL: 'scoped-findings-private-value' } }),
    'sibling/.claude/config.json': '{"model":"wrong-filename"}',
    'sibling/.claude/rules/bad.md': '---\npaths: [unclosed\n---\nRule body.',
    'sibling/.claude/rules/glob.md': '---\npaths: ["../outside/**"]\n---\nRule body.',
    'sibling/.github/copilot/settings.json': '{ broken JSON',
    'sibling/.mcp.json': '{ broken MCP JSON',
    'sibling/.cursor/rules/bad.mdc': '---\nglobs: [unclosed\n---\nRule body.',
    'sibling/.gemini/settings.json': '{ broken JSON',
    'sibling/opencode.jsonc': '{ broken JSONC',
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, target: 'app/src/index.ts', trust: 'trusted' });
  assert.ok(report.sources.some(source => source.relativePath === 'sibling/.codex/config.toml' && source.invalid));
  assert.ok(report.sources.some(source => source.relativePath === 'sibling/.claude/settings.local.json' && source.invalid));
  assert.ok(report.findings.every(finding => finding.severity === 'info'));
  assert.ok(report.findings.some(finding => finding.ruleId === 'source.outside-target' && finding.location.path.includes('sibling')));
  for (const output of [json(report), html(report), terminal(report)]) assert.ok(!output.includes('scoped-findings-private-value'));
  const codex = await scan({ ...w, user: false, clients: ['codex'], target: 'sibling/src/index.ts', trust: 'trusted' });
  assert.ok(codex.findings.some(finding => finding.ruleId === 'parse.toml' && finding.location.path === path.join(w.repo, 'sibling/.codex/config.toml')));
  const sibling = await scan({ ...w, repo: path.join(w.repo, 'sibling'), user: false, clients: ['claude', 'copilot'], trust: 'trusted' });
  for (const rule of ['parse.json', 'parse.frontmatter', 'config.field-case', 'config.unknown-field', 'config.unsupported-capability', 'source.wrong-location', 'glob.impossible']) assert.ok(sibling.findings.some(finding => finding.ruleId === rule), rule);
});

test('in-scope syntax errors remain actionable for ignored trust and personal-state decisions', async t => {
  const w = await workspace({ '.codex/config.toml': 'model=[\n', '.mcp.json': '{ broken MCP JSON' }, { '.copilot/config.json': '{ broken state JSON' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const codex = await scan({ ...w, clients: ['codex'], user: false, trust: 'untrusted' });
  assert.ok(codex.findings.some(finding => finding.ruleId === 'parse.toml'));
  const copilot = await scan({ ...w, clients: ['copilot'], trust: 'untrusted' });
  assert.ok(copilot.findings.some(finding => finding.ruleId === 'parse.json' && finding.location.path === path.join(w.home, '.copilot/config.json')));
  assert.ok(copilot.findings.some(finding => finding.ruleId === 'parse.json' && finding.location.path === path.join(w.repo, '.mcp.json')));
});

test('placement warnings and active glob diagnostics follow their target namespace', async t => {
  const w = await workspace({
    '.codex/settings.json': '{"model":"wrong-root-filename"}',
    'app/src/index.ts': '',
    'sibling/.codex/settings.json': '{"model":"wrong-sibling-filename"}',
    '.claude/rules/check.md': '---\npaths: ["../outside/**"]\n---\nRoot rule.',
    'sibling/.claude/rules/check.md': '---\npaths: ["../outside/**"]\n---\nSibling rule.',
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, target: 'app/src/index.ts', clients: ['codex', 'claude'], trust: 'trusted' });
  assert.deepEqual(report.findings.filter(finding => finding.ruleId === 'source.wrong-location').map(finding => finding.location.path), [path.join(w.repo, '.codex/settings.json')]);
  assert.deepEqual(report.findings.filter(finding => finding.ruleId === 'glob.impossible').map(finding => finding.location.path), [path.join(w.repo, '.claude/rules/check.md')]);
});
