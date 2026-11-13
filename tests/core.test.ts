import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { chmod, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { scan } from '../packages/core/index.js';
import { parseSource } from '../packages/core/parse.js';
import { createRedactor, redact, redactText } from '../packages/core/redact.js';
import { bytes, matches, prefix, slash, splitGlobs } from '../packages/core/utils.js';
import type { Source } from '../packages/core/types.js';
import { workspace } from './helpers.js';
import { rootOf } from '../packages/adapters/common.js';

function source(text: string, ext: string, kind: Source['kind'] = 'settings'): Source { return { id: 'test', path: '/fixture/test.' + ext, relativePath: 'test.' + ext, owners: ['codex'], scope: 'repository', kind, baseDir: '/fixture', text, body: text, bytes: bytes(text), bodyLine: 1, data: {}, lines: {}, invalid: false }; }
test('JSON/JSONC duplicate keys and accurate parser locations', () => {
  const s = source('{\n "model": "one",\n "model": "two"\n}', 'json');
  const findings = parseSource(s); assert.equal(findings[0].ruleId, 'parse.duplicate-key'); assert.equal(findings[0].location.line, 3); assert.equal(findings[0].location.column, 2); assert.equal(s.invalid, true);
  const c = source('{ // comment\n"model":"one",}', 'jsonc'); assert.deepEqual(parseSource(c), []); assert.equal(c.data.model, 'one');
  const strict = source('{ // comment\n"model":"one"}', 'json'); assert.ok(parseSource(strict).length);
});
test('incomplete JSON values keep their parser identity and point to the actual column', () => {
  for (const extension of ['json', 'jsonc']) {
    for (const newline of ['\n', '\r\n']) {
      const input = source(`{${newline}  "model": }`, extension);
      const findings = parseSource(input);
      assert.equal(input.invalid, true);
      assert.deepEqual(findings.map(finding => finding.ruleId), ['parse.json']);
      assert.equal(findings[0].message, 'Expected a JSON value.');
      assert.equal(findings[0].location.line, 2);
      assert.equal(findings[0].location.column, 12);
    }
  }
  const unclosed = parseSource(source('{ "model": "private-sentinel"', 'json'));
  assert.ok(unclosed.some(finding => finding.message === "Expected '}' to close the object."));
  assert.ok(!JSON.stringify(unclosed).includes('private-sentinel'));
  const repeated = parseSource(source('{ "model": ?, "model": ? }', 'json'));
  assert.equal(repeated.length, 5);
  assert.equal(new Set(repeated.map(finding => finding.id)).size, 5);
});
test('TOML/YAML/frontmatter reject syntax and duplicate keys', () => {
  for (const [text, ext, kind] of [['model="x"\nmodel="y"', 'toml', 'settings'], ['x: 1\nx: 2', 'yaml', 'settings'], ['---\npaths: [unterminated\n---\nbody', 'md', 'rules']] as const) { const s = source(text, ext, kind); assert.ok(parseSource(s).length); assert.ok(s.invalid); }
  const s = source('[mcp_servers.db]\ncommand="node"\nargs=["x"]', 'toml'); assert.deepEqual(parseSource(s), []); assert.equal(s.lines['mcp_servers.db.command'], 2);
  const md = source('---\nnot: [yaml\n', 'md', 'instructions'); assert.deepEqual(parseSource(md), []); assert.equal(md.body, md.text, 'AGENTS.md is raw Markdown, not YAML configuration');
});

test('TOML quoted hook-state and project keys retain decoded paths and exact source lines', () => {
  for (const key of ['C:\\Users\\Fixture\\.codex\\hooks.json:pre_tool_use:0:0', '/tmp/quoted"project/hooks.json:stop:0:0']) {
    for (const quoted of [JSON.stringify(key), "'" + key + "'"]) {
      const input = source(`[hooks . state . ${quoted}]\nenabled=false\ntrusted_hash="fixture-hash"\n`, 'toml');
      assert.deepEqual(parseSource(input), []);
      assert.equal(input.lines[`hooks.state.${key}.enabled`], 2);
      assert.equal(input.lines[`hooks.state.${key}.trusted_hash`], 3);
    }
    const project = source(`[projects.${JSON.stringify(key)}]\ntrust_level="trusted"\n`, 'toml');
    assert.deepEqual(parseSource(project), []);
    assert.equal(project.lines[`projects.${key}.trust_level`], 2);
  }
});

test('TOML array tables retain per-handler source lines across multiline values and repeated parent groups', () => {
  const text = [
    'description = """', '[hooks.Stop]', 'command="string content"', '"""',
    'literal = \'\'\'', '[[hooks.Stop.hooks]]', 'command="literal content"', '\'\'\'',
    'values = [', '  "[fake.table]",', '  "command=value",', ']',
    '[[hooks.Stop]]', 'matcher="first"', '[[hooks.Stop.hooks]]', 'type="command"', 'command="first-command"',
    'command_windows="first-windows"', '[[hooks.Stop.hooks]]', 'type="command"', 'command="second-command"',
    '[[hooks.Stop]]', 'matcher="second"', '[[hooks.Stop.hooks]]', 'type="command"', 'command="third-command"',
    '[hooks.state."quoted.key"]', 'enabled=false',
  ].join('\n');
  for (const newline of ['\n', '\r\n']) {
    const input = source(text.replaceAll('\n', newline), 'toml');
    assert.deepEqual(parseSource(input), []);
    assert.equal(input.lines['hooks.Stop.0.matcher'], 14);
    assert.equal(input.lines['hooks.Stop.0.hooks.0.command'], 17);
    assert.equal(input.lines['hooks.Stop.0.hooks.0.command_windows'], 18);
    assert.equal(input.lines['hooks.Stop.0.hooks.1.command'], 21);
    assert.equal(input.lines['hooks.Stop.1.matcher'], 23);
    assert.equal(input.lines['hooks.Stop.1.hooks.0.command'], 26);
    assert.equal(input.lines['hooks.state.quoted.key.enabled'], 28);
    assert.equal(input.lines['fake.table'], undefined);
    assert.equal(input.lines['command'], undefined);
  }
});
test('glob semantics preserve platform separators, braces and client matchBase differences', () => {
  assert.deepEqual(splitGlobs('src/**/*.{ts,tsx}, docs/**/*.md'), ['src/**/*.{ts,tsx}', 'docs/**/*.md']);
  assert.ok(matches('src\\a.ts', ['src/**/*.ts'])); assert.ok(matches('src/nested/a.md', ['*.md'], true)); assert.ok(!matches('src/a.md', ['*.md'])); assert.ok(!matches('src/a.md', ['/*.md'], true));
  assert.equal(slash('C:\\repo\\a.ts'), 'C:/repo/a.ts'); assert.equal(prefix('a😀b', 3), 'a');
  assert.equal(slash(rootOf({ ...source('', 'md'), path: 'C:\\repo\\.claude\\rules\\payments.md' }, '.claude')), 'C:/repo');
});
test('Codex project empty override shadows, global empty override falls back, global is not capped', async t => {
  const w = await workspace({ 'AGENTS.md': 'should be hidden', 'AGENTS.override.md': '', 'src/a.ts': '' }, { '.codex/AGENTS.md': 'Global content beyond budget', '.codex/AGENTS.override.md': ' \n', '.codex/config.toml': 'project_doc_max_bytes=1' }); t.after(() => rm(w.root, { recursive: true, force: true }));
  const r = await scan({ ...w, target: 'src/a.ts', clients: ['codex'], trust: 'trusted' }); assert.equal(r.clients[0].instructions, 'Global content beyond budget'); assert.ok(r.clients[0].decisions.some(d => d.path.endsWith(path.sep + 'AGENTS.md') && d.scope !== 'user' && d.status === 'shadowed'));
});
test('Codex no-root marker and UTF-8 raw-byte truncation match version-pinned source', async t => {
  const w = await workspace({ 'AGENTS.md': 'ROOT', 'src/AGENTS.md': 'a😀b', 'src/a.ts': '' }, { '.codex/config.toml': 'project_doc_max_bytes=3\nproject_root_markers=[]' }); t.after(() => rm(w.root, { recursive: true, force: true }));
  const r = await scan({ ...w, target: 'src/a.ts', clients: ['codex'], trust: 'trusted' }); assert.equal(r.clients[0].instructions, 'a�'); assert.equal(r.clients[0].decisions.find(d => d.path.endsWith('src' + path.sep + 'AGENTS.md'))!.loadedBytes, 3); assert.ok(!r.clients[0].instructions.includes('ROOT'));
});
test('unknown/untrusted project does not claim proven effective settings', async t => {
  const w = await workspace({ '.codex/config.toml': 'model="project"', 'AGENTS.md': 'root' }); t.after(() => rm(w.root, { recursive: true, force: true }));
  const r = await scan({ ...w, clients: ['codex'] }); assert.equal(r.clients[0].instructions, ''); assert.ok(r.clients[0].settings.some(s => s.status === 'conditional'));
  const u = await scan({ ...w, clients: ['codex'], trust: 'untrusted' }); assert.ok(u.clients[0].decisions.filter(d => d.scope !== 'user').every(d => d.status === 'ignored'));
});
test('MCP command/env/cwd errors and same-name drift have stable findings', async t => {
  const w = await workspace({ '.mcp.json': '{"mcpServers":{"db":{"command":"missing-sightline-command","env":{"AUTH":"${SIGHTLINE_MISSING}"},"cwd":"missing-directory"}}}' }, { '.codex/config.toml': '[mcp_servers.db]\ncommand="different-missing-command"\nenv_vars=["SIGHTLINE_MISSING"]' }); t.after(() => rm(w.root, { recursive: true, force: true }));
  const r = await scan({ ...w, clients: ['codex', 'claude'], trust: 'trusted' });
  for (const rule of ['mcp.command-missing', 'mcp.env-missing', 'extension.cwd-missing', 'mcp.cross-client-drift']) assert.ok(r.findings.some(f => f.ruleId === rule), rule);
  assert.ok(r.findings.every(f => f.id && f.location.line > 0 && f.why && f.suggestion && Array.isArray(f.related)));
});
test('redaction removes arbitrary env/header values and secrets from every public surface', async t => {
  const secret = 'sentinel-super-private-value';
  const w = await workspace({ '.mcp.json': JSON.stringify({ mcpServers: { db: { command: 'node', args: [secret], env: { NORMAL: secret }, headers: { Custom: 'private-header' } } } }), 'CLAUDE.md': `API_KEY=${secret}\nBearer ${secret}\nhttps://user:pass@localhost/?token=${secret}` }); t.after(() => rm(w.root, { recursive: true, force: true }));
  const r = await scan({ ...w, clients: ['claude'], trust: 'trusted' }); const text = JSON.stringify(r); assert.ok(!text.includes(secret)); assert.ok(!text.includes('private-header')); assert.ok(text.includes('REDACTED'));
  assert.ok(!redactText('token=abc123\nAuthorization: Bearer xyz\nsk-proj-abcdefghijklmnop').includes('abc123'));
  assert.equal(redact({ config: { env: { FOO: 'bar' } } }).config.env.FOO, '[REDACTED]');
});
test('text redaction preserves line endings and matches overlapping private values literally', () => {
  for (const newline of ['\n', '\r\n']) {
    const privateValue = 'literal.*[private]' + newline + 'second-private-line';
    const scrub = createRedactor(['literal.*[private]', privateValue]);
    const text = 'Before' + newline + privateValue + newline + 'After';
    const output = scrub(text);
    assert.equal(output, 'Before' + newline + '[REDACTED]' + newline + newline + 'After');
    assert.equal(scrub(text), output);
    const key = 'Before' + newline + '-----BEGIN PRIVATE KEY-----' + newline + 'private-key-material' + newline + '-----END PRIVATE KEY-----' + newline + 'After';
    const redacted = redactText(key);
    assert.equal(redacted.split('\n').length, key.split('\n').length);
    assert.ok(!redacted.includes('private-key-material'));
    for (const label of ['password', 'private_key']) {
      const assignment = label + '="first-private' + newline + 'last-private"' + newline + 'next=value';
      assert.equal(redactText(assignment).split('\n').length, assignment.split('\n').length);
      assert.ok(!redactText(assignment).includes('last-private'));
    }
  }
});
test('Claude default AGENTS fallback and explicit instruction mode', async t => {
  const w = await workspace({ 'AGENTS.md': 'shared', '.claude/rules/a.md': 'rule' }); t.after(() => rm(w.root, { recursive: true, force: true }));
  let r = await scan({ ...w, clients: ['claude'] }); assert.ok(r.clients[0].instructions.includes('shared'));
  await writeFile(path.join(w.repo, 'CLAUDE.local.md'), 'personal'); r = await scan({ ...w, clients: ['claude'] }); assert.ok(!r.clients[0].instructions.includes('shared'));
  await mkdir(path.join(w.home, '.claude')); await writeFile(path.join(w.home, '.claude/settings.json'), '{"pluginConfigs":{"cc-plugin-agents-md@builtin":{"options":{"instructionFiles":"claude-md-and-agents-md"}}}}');
  r = await scan({ ...w, clients: ['claude'] }); assert.ok(r.clients[0].instructions.includes('shared')); assert.ok(r.clients[0].instructions.includes('personal'));
});
test('imports skip code examples, respect escaped spaces and four-hop depth', async t => {
  const w = await workspace({ 'CLAUDE.md': 'Inline `@missing.md`\n```\n@also-missing.md\n```\n@Design\\ Docs/policy.md\n@a.md\n', 'Design Docs/policy.md': 'policy', 'a.md': '@b.md', 'b.md': '@c.md', 'c.md': '@d.md', 'd.md': '@e.md', 'e.md': 'too deep' }); t.after(() => rm(w.root, { recursive: true, force: true }));
  const r = await scan({ ...w, clients: ['claude'] }); assert.ok(r.clients[0].instructions.includes('policy')); assert.ok(!r.clients[0].instructions.includes('too deep')); assert.ok(r.findings.some(f => f.ruleId === 'include.depth')); assert.ok(!r.findings.some(f => f.ruleId === 'include.missing'));
});
test('repository symlink loop/external source degrade without reading private content', { skip: process.platform === 'win32' }, async t => {
  const w = await workspace({ 'CLAUDE.md': '@private.md\n', 'src/a.ts': '' }); t.after(() => rm(w.root, { recursive: true, force: true }));
  await writeFile(path.join(w.root, 'private.md'), 'DO_NOT_READ_PRIVATE'); await symlink(path.join(w.root, 'private.md'), path.join(w.repo, 'private.md')); await symlink(w.repo, path.join(w.repo, 'loop')); await symlink('/missing/sightline', path.join(w.repo, 'AGENTS.md'));
  const r = await scan({ ...w, clients: ['claude', 'codex'], trust: 'trusted' }); assert.ok(!JSON.stringify(r).includes('DO_NOT_READ_PRIVATE')); assert.ok(r.findings.some(f => f.ruleId === 'source.symlink-cycle')); assert.ok(r.findings.some(f => f.ruleId === 'source.broken-symlink')); assert.ok(r.findings.some(f => f.ruleId === 'include.outside-scope'));
});
test('unreadable configuration does not crash scan', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async t => {
  const w = await workspace({ 'AGENTS.md': 'private' }); t.after(async () => { await chmod(path.join(w.repo, 'AGENTS.md'), 0o600); await rm(w.root, { recursive: true, force: true }); });
  await chmod(path.join(w.repo, 'AGENTS.md'), 0); const r = await scan({ ...w, clients: ['codex'] }); assert.ok(r.findings.some(f => f.ruleId === 'source.unreadable'));
});
test('cross-client content recipients and deterministic output', async t => {
  const w = await workspace({ 'AGENTS.md': 'shared', 'CLAUDE.md': 'claude-only' }); t.after(() => rm(w.root, { recursive: true, force: true }));
  const o = { ...w, clients: ['codex', 'claude', 'copilot'] as const, trust: 'trusted' as const };
  const r = await scan({ ...o, clients: [...o.clients] }); assert.deepEqual(r.diff.find(d => d.content === 'shared')!.clients, ['codex', 'copilot']);
  assert.deepEqual(r, await scan({ ...o, clients: [...o.clients] }));
});
test('default scan does not execute declared hook/MCP commands', async t => {
  const w = await workspace({ '.mcp.json': '{"mcpServers":{"danger":{"command":"node","args":["evil.js"]}}}', 'evil.js': 'require("node:fs").writeFileSync("EXECUTED", "bad")' }); t.after(() => rm(w.root, { recursive: true, force: true }));
  await scan({ ...w, clients: ['claude'], trust: 'trusted' }); await assert.rejects(readFile(path.join(w.repo, 'EXECUTED')));
});

test('ordinary application settings and Cargo configuration are excluded from agent discovery', async t => {
  const w = await workspace({ '.vscode/settings.json': '{ // VS Code settings\n"editor.fontSize": 14\n}', '.cargo/config.toml': 'not a valid TOML file [', 'src/config.toml': 'application configuration [', 'src/settings.json': '{application data', '.claude/settings.json': '{"model":"sonnet"}' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const r = await scan({ ...w, user: false, clients: ['claude'] });
  assert.deepEqual(r.sources.map(source => source.relativePath), ['.claude/settings.json']);
  assert.ok(!r.findings.some(finding => finding.severity !== 'info'));
  assert.equal(r.clients[0].settings.find(setting => setting.key === 'model')?.value, 'sonnet');
});

test('subproject configurations remain discoverable without wrong-location warnings', async t => {
  const w = await workspace({ 'app/.claude/settings.json': '{"model":"sonnet"}', 'app/.codex/config.toml': 'model="project"', 'app/.claude/skills/check/SKILL.md': '---\nname: check\ndescription: Check the app.\n---\nApp skill.' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const r = await scan({ ...w, user: false, clients: ['codex', 'claude'], trust: 'trusted' });
  assert.equal(r.sources.length, 3);
  assert.ok(!r.findings.some(finding => finding.severity !== 'info'));
  assert.ok(r.findings.some(finding => finding.ruleId === 'source.outside-target'));
  assert.ok(r.clients.every(client => client.settings.length === 0 && client.extensions.length === 0));
  const app = await scan({ ...w, repo: path.join(w.repo, 'app'), user: false, clients: ['codex', 'claude'], trust: 'trusted' });
  assert.ok(app.clients.every(client => client.settings.some(setting => setting.key === 'model')));
});

test('malformed sources do not turn an unrelated client into an invalid or detected client', async t => {
  const w = await workspace({ '.claude/settings.json': '{ broken JSON' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const r = await scan({ ...w, env: { PATH: '' }, user: false, clients: ['claude', 'codex'] });
  assert.ok(r.findings.some(finding => finding.ruleId === 'parse.json'));
  const codex = r.clients.find(client => client.client === 'codex')!;
  assert.equal(codex.detected, false);
  assert.equal(codex.decisions[0].status, 'ignored');
  assert.equal(r.clients.find(client => client.client === 'claude')!.decisions[0].status, 'invalid');
});

test('selected clients scope syntax, glob and configuration diagnostics to their source owners', async t => {
  const w = await workspace({
    'AGENTS.md': 'Repository instructions.',
    '.claude/settings.local.json': '{ broken JSON',
    '.claude/settings.json': '{"Permissions":{"allow":[]},"permissions":{"allowed":[]}}',
    '.claude/rules/check.md': '---\npaths: ["../outside/**"]\n---\nCheck the target.',
    '.github/mcp.json': '{"servers":{}}',
    '.vscode/mcp.json': '{"servers":{"editor":{"command":"node"}}}',
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const codex = await scan({ ...w, user: false, clients: ['codex'], trust: 'trusted' });
  assert.ok(!codex.findings.some(finding => finding.severity !== 'info'));
  assert.ok(codex.sources.some(source => source.relativePath === '.claude/settings.local.json' && source.invalid));
  assert.ok(codex.clients[0].decisions.some(decision => decision.path.endsWith('settings.local.json') && decision.status === 'ignored'));
  const claude = await scan({ ...w, user: false, clients: ['claude'] });
  for (const rule of ['parse.json', 'config.field-case', 'config.unknown-field', 'glob.impossible']) assert.ok(claude.findings.some(finding => finding.ruleId === rule), rule);
  assert.ok(!claude.findings.some(finding => finding.ruleId === 'mcp.root-key'));
  const copilot = await scan({ ...w, user: false, clients: ['copilot'] });
  assert.ok(copilot.findings.some(finding => finding.ruleId === 'mcp.root-key'));
  assert.equal(copilot.findings.filter(finding => finding.ruleId === 'mcp.root-key').length, 1);
  assert.ok(!copilot.findings.some(finding => finding.ruleId.startsWith('parse.')));
});

test('unsupported filenames inside agent configuration directories still report actionable placement errors', async t => {
  const w = await workspace({ '.codex/settings.json': '{"model":"project"}', '.claude/config.json': '{"model":"sonnet"}' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const r = await scan({ ...w, user: false, clients: ['codex', 'claude'], trust: 'trusted' });
  const warnings = r.findings.filter(finding => finding.ruleId === 'source.wrong-location');
  assert.equal(warnings.length, 2);
  assert.ok(warnings.find(finding => finding.client === 'codex')!.suggestion.includes('.codex/config.toml'));
  assert.ok(warnings.find(finding => finding.client === 'claude')!.suggestion.includes('.claude/settings.json'));
});
