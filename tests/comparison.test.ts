import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { scan } from '../packages/core/index.js';
import { html, json, portable, terminal } from '../packages/reporter/index.js';
import { workspace } from './helpers.js';

test('the shipped demo shares a payment paragraph across all three clients and different source files', async () => {
  const report = await scan({ repo: path.resolve('examples/broken-agent-config'), target: 'src/payments/refund.ts', user: false, trust: 'trusted', clients: ['codex', 'claude', 'copilot'] });
  const shared = report.instructionDiff?.find(block => block.content === 'Keep payment operations idempotent.');
  assert.deepEqual(shared?.clients, ['codex', 'claude', 'copilot']);
  assert.equal(new Set(shared?.origins.map(origin => path.basename(origin.location.path))).size, 3);
  assert.equal(shared?.origins.filter(origin => origin.client === 'copilot').length, 2);
  assert.ok(shared?.origins.every(origin => origin.endLine === origin.location.line));
});

test('instruction comparison finds shared paragraphs inside different files with exact source ranges', async t => {
  const w = await workspace({
    'AGENTS.md': 'Codex introduction.\r\n\r\nRun the checks.\r\nKeep changes focused.\r\n\r\nCodex ending.',
    'CLAUDE.md': 'Run the checks.\nKeep changes focused.\n\nClaude ending.',
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['codex', 'claude'], trust: 'trusted' });
  const shared = report.instructionDiff?.find(block => block.content === 'Run the checks.\nKeep changes focused.');
  assert.ok(shared, 'The common paragraph must be found independently of the rest of each file.');
  assert.deepEqual(shared.clients, ['codex', 'claude']);
  assert.deepEqual(shared.origins.map(origin => [origin.client, path.basename(origin.location.path), origin.location.line, origin.endLine, origin.order]), [
    ['codex', 'AGENTS.md', 3, 4, 2],
    ['claude', 'CLAUDE.md', 1, 2, 1],
  ]);
  assert.equal(report.diff.length, 2);
  assert.ok(report.diff.every(block => block.clients.length === 1));
  const output = terminal(report, 'diff');
  assert.ok(output.includes('codex, claude · shared by all'));
  assert.ok(output.includes(path.join(w.repo, 'AGENTS.md') + ':3'));
  assert.deepEqual(JSON.parse(json(report)).instructionDiff, report.instructionDiff);
  const exported = portable(report);
  assert.ok(exported.instructionDiff?.every(block => block.origins.every(origin => origin.location.path.startsWith('<repo>/'))));
  assert.ok(!html(report).includes(JSON.stringify(w.repo).slice(1, -1)));
  assert.deepEqual(report, await scan({ ...w, user: false, clients: ['codex', 'claude'], trust: 'trusted' }));
});

test('instruction comparison retains repeated paragraphs, fences, whitespace and occurrence order', async t => {
  const fence = '````sh\nfirst\n\n```\nsecond\n````';
  const w = await workspace({
    'AGENTS.md': 'Repeat.\n\n' + fence + '\n\nRepeat.\n\nIndented.\n\n  Indented.',
    'CLAUDE.md': fence + '\n\nRepeat.',
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['codex', 'claude'], trust: 'trusted' });
  const repeated = report.instructionDiff?.find(block => block.content === 'Repeat.');
  assert.equal(repeated?.origins.filter(origin => origin.client === 'codex').length, 2);
  assert.deepEqual(repeated?.origins.map(origin => origin.order), [1, 3, 2]);
  const code = report.instructionDiff?.find(block => block.content === fence);
  assert.deepEqual(code?.clients, ['codex', 'claude']);
  assert.equal(code?.origins[0].endLine, 8);
  assert.ok(report.instructionDiff?.some(block => block.content === '  Indented.'));
  assert.ok(report.instructionDiff?.some(block => block.content === 'Indented.'));
});

test('instruction origins skip removed comments and frontmatter and disclose transformed source ranges', async t => {
  const w = await workspace({
    'CLAUDE.md': '<!-- Run the checks.\nHidden duplicate. -->\n\nRun the checks.\n\nBefore<!-- removed\ncomment -->after.\n\nLast paragraph.',
    '.claude/rules/general.md': '---\ndescription: Frontmatter text.\n---\n\nFrontmatter text.',
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['claude'] });
  const common = report.instructionDiff?.find(block => block.content === 'Run the checks.');
  assert.equal(common?.origins[0].location.line, 4);
  assert.equal(common?.origins[0].endLine, 4);
  const transformed = report.instructionDiff?.find(block => block.content === 'Beforeafter.');
  assert.equal(transformed?.origins[0].endLine, undefined);
  assert.equal(transformed?.origins[0].location.line, 1);
  const frontmatter = report.instructionDiff?.find(block => block.content === 'Frontmatter text.');
  assert.equal(frontmatter?.origins[0].location.line, 5);
  assert.equal(frontmatter?.origins[0].endLine, 5);
  assert.ok(terminal(report, 'diff').includes('(source starts here)'));
});

test('instruction comparison excludes conditional and ignored content while retaining only the loaded byte prefix', async t => {
  const w = await workspace({
    'AGENTS.md': 'Shared.\n\nPartially loaded paragraph.',
    'AGENTS.override.md': 'Shared.\n\nPrefix-only paragraph.',
    'CLAUDE.md': 'Shared.\n\nComplete Claude paragraph.',
    '.claude/rules/conditional.md': '---\npaths: [other.ts]\n---\nIgnored rule.',
  }, { '.codex/config.toml': 'project_doc_max_bytes=13\n' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, clients: ['codex', 'claude'], trust: 'trusted' });
  assert.deepEqual(report.instructionDiff?.find(block => block.content === 'Shared.')?.clients, ['codex', 'claude']);
  assert.ok(report.instructionDiff?.some(block => block.content === 'Pref'));
  assert.ok(!report.instructionDiff?.some(block => /Partially|Ignored rule|Prefix-only/.test(block.content)));
  const untrusted = await scan({ ...w, clients: ['codex'], trust: 'untrusted' });
  assert.deepEqual(untrusted.instructionDiff, []);
  const conditional = await scan({ ...w, clients: ['codex'] });
  assert.deepEqual(conditional.instructionDiff, []);
});

test('paragraph membership is computed before privacy redaction and generated client IDs remain stable', async t => {
  const w = await workspace({
    'AGENTS.md': 'private-first\n\ncodex',
    'CLAUDE.md': 'private-second\n\ncodex',
    '.mcp.json': '{"mcpServers":{"fixture":{"command":"node","env":{"FIRST":"private-first","SECOND":"private-second","CLIENT":"codex"}}}}',
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['codex', 'claude'], trust: 'trusted' });
  const masked = report.instructionDiff?.filter(block => block.content === '[REDACTED]');
  assert.equal(masked?.length, 3);
  assert.ok(masked?.some(block => block.clients.length === 2));
  assert.ok(masked?.filter(block => block.clients.length === 1).every(block => block.origins.length === 1));
  assert.deepEqual(masked?.find(block => block.clients.length === 2)?.origins.map(origin => origin.client), ['codex', 'claude']);
  const text = JSON.stringify(report);
  assert.ok(!text.includes('private-first'));
  assert.ok(!text.includes('private-second'));
  const legacy = structuredClone(report);
  delete legacy.instructionDiff;
  assert.ok(terminal(legacy, 'diff').includes('Instruction content by receiving client'));
  assert.ok(!terminal(legacy, 'diff').includes('Instruction paragraphs by receiving client'));
});
