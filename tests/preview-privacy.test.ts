import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { scan } from '../packages/core/index.js';
import { workspace } from './helpers.js';
import { html, json, portable, terminal } from '../packages/reporter/index.js';
import { adapters } from '../packages/adapters/index.js';
import { VERSION } from '../packages/core/version.js';

test('parsed source values redact escaped and multiline secrets while preserving source lines', async t => {
  const cases = [
    { file: '.mcp.json', text: String.raw`{
  "mcpServers": {"fixture": {
    "env": {"NORMAL": "json-quote-private-\"value"},
    "args": ["json-quote-private-\"value"],
    "command": "missing-preview-fixture"
  }}
}`, fragments: ['json-quote-private-'], command: '"command"' },
    { file: '.mcp.json', text: String.raw`{
  "mcpServers": {"fixture": {
    "\u0065nv": {"NORMAL": "json-unicode-private-\u0076alue"},
    "args": ["json-unicode-private-value"],
    "command": "missing-preview-fixture"
  }}
}`, fragments: ['json-unicode-private-'], command: '"command"' },
    { file: '.mcp.json', text: JSON.stringify({ mcpServers: { fixture: {
      env: { NORMAL: '${SIGHTLINE_SOURCE_SECRET:-fallback-confidential-value}' },
      args: ['${SIGHTLINE_SOURCE_SECRET:-fallback-confidential-value}'], command: 'missing-preview-fixture',
    } } }, null, 2), fragments: ['fallback-confidential-value'], command: '"command"' },
    { file: 'opencode.jsonc', text: String.raw`{
  // Source comments remain readable.
  "env": {"NORMAL": "jsonc-escaped-private-\u0076alue",},
  "headers": {"Custom": "header-escaped-private-\"value"},
}`, fragments: ['jsonc-escaped-private-', 'header-escaped-private-'] },
    { file: '.codex/config.toml', text: '[mcp_servers.fixture]\ncommand="missing-preview-fixture"\nargs=["toml-unicode-private-value"]\n[mcp_servers.fixture.env]\nNORMAL="toml-unicode-private-\\u0076alue"\n', fragments: ['toml-unicode-private-'], command: 'command=' },
    { file: '.codex/config.toml', text: '[mcp_servers.fixture.env]\nNORMAL="""\ntoml-multiline-private-first\ntoml-multiline-private-last"""\n[mcp_servers.fixture]\ncommand="missing-preview-fixture"\n', fragments: ['toml-multiline-private-first', 'toml-multiline-private-last'], command: 'command=' },
    { file: '.codex/config.toml', text: '[mcp_servers.fixture.env]\nNORMAL="""toml-continued-private-\\\n  value"""\n[mcp_servers.fixture]\ncommand="missing-preview-fixture"\n', fragments: ['toml-continued-private-'], command: 'command=' },
    { file: '.claude/skills/check/SKILL.md', text: '---\nname: check\ndescription: Safe skill.\nenv:\n  NORMAL: >-\n    yaml-folded-private-first\n    yaml-folded-private-last\n---\nSafe skill body.', fragments: ['yaml-folded-private-first', 'yaml-folded-private-last'] },
    { file: '.claude/skills/check/SKILL.md', text: '---\nname: check\ndescription: Safe skill.\nordinary: &value "yaml-alias-private-\\u0076alue"\nenv:\n  NORMAL: *value\n---\nSafe skill body.', fragments: ['yaml-alias-private-'] },
  ];
  for (const fixture of cases) for (const newline of ['\n', '\r\n']) {
    const text = fixture.text.replaceAll('\n', newline);
    const w = await workspace({ [fixture.file]: text });
    t.after(() => rm(w.root, { recursive: true, force: true }));
    const report = await scan({ ...w, user: false, clients: ['codex', 'claude'], trust: 'trusted' });
    const source = report.sources.find(source => source.relativePath === fixture.file)!;
    assert.equal(source.invalid, false, fixture.file);
    assert.ok(source.preview?.includes('[REDACTED]'), fixture.file);
    assert.equal(source.preview?.split('\n').length, text.split('\n').length, fixture.file);
    if (fixture.file.endsWith('.toml')) assert.ok(source.preview?.includes('NORMAL="[REDACTED]"'));
    assert.ok(!('valueRanges' in source));
    for (const output of [JSON.stringify(report), json(report), html(report), terminal(report, 'explain')]) {
      for (const fragment of fixture.fragments) assert.ok(!output.includes(fragment), fixture.file + ' ' + fragment);
    }
    if (fixture.command) {
      assert.ok(report.findings.some(finding => finding.ruleId === 'mcp.command-missing'));
      const commandLine = text.split('\n').findIndex(line => line.includes(fixture.command));
      assert.ok(source.preview?.split('\n')[commandLine].includes(fixture.command));
    }
  }
});

test('earlier duplicate private values remain redacted when copied into other instruction sources', async t => {
  const secret = 'discarded-value-copied-private-sentinel';
  const w = await workspace({
    '.mcp.json': '{"mcpServers":{"fixture":{"env":{"NORMAL":"' + secret + '","NORMAL":"later-value"}}}}',
    'CLAUDE.md': 'Copied value ' + secret,
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['claude'] });
  assert.ok(report.sources.find(source => source.relativePath === '.mcp.json')?.invalid);
  for (const text of [JSON.stringify(report), json(report), html(report), terminal(report, 'explain')]) assert.ok(!text.includes(secret));
});

test('private settings follow parsed key paths while quoted keys retain their public values', async t => {
  const w = await workspace({
    '.claude/settings.json': '{"env":{"NORMAL":987654321},"literal.env.field":"public-literal-value","child.env.OTHER":"public-opaque-value","private_key":{"child":{"env":{"OTHER":"range-object-private"}}}}',
    '.codex/config.toml': '[hooks.state."fixture.env.value"]\nenabled=false\n',
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['codex', 'claude'], trust: 'trusted' });
  assert.equal(report.clients[0].settings.find(setting => setting.key === 'hooks.state.fixture.env.value.enabled')?.value, false);
  assert.equal(report.clients[1].settings.find(setting => setting.key === 'literal.env.field')?.value, 'public-literal-value');
  assert.equal(report.clients[1].settings.find(setting => setting.key === 'child.env.OTHER')?.value, 'public-opaque-value');
  assert.equal(report.clients[1].settings.find(setting => setting.key === 'env.NORMAL')?.value, '[REDACTED]');
  for (const output of [json(report), html(report), terminal(report, 'explain')]) assert.ok(!output.includes('987654321'));
});

test('private scalar types and sensitive-key aliases stay hidden in source previews and copied values', async t => {
  const w = await workspace({ '.claude/settings.json': '{"env":{"NUMERIC":987654321,"FLAG":true}}', '.mcp.json': JSON.stringify({ mcpServers: { fixture: {
    command: 'node', env: { PIN: 123456789, FLAG: true, EMPTY: null },
    passwd: 'passwd-copied-private-sentinel', private_key: 'key-copied-private-sentinel',
    args: ['passwd-copied-private-sentinel', 'key-copied-private-sentinel'],
  } } }, null, 2) });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['claude'], trust: 'trusted' });
  const preview = report.sources.find(source => source.relativePath === '.mcp.json')!.preview!;
  assert.ok(preview.includes('"PIN"'));
  assert.ok(preview.includes('"FLAG"'));
  assert.ok(preview.includes('"EMPTY"'));
  assert.ok(!preview.includes('123456789'));
  assert.ok(!preview.includes('true'));
  assert.ok(report.clients[0].settings.filter(setting => setting.key.startsWith('env.')).every(setting => setting.value === '[REDACTED]'));
  for (const output of [JSON.stringify(report), json(report), html(report)]) {
    assert.ok(!output.includes('987654321'));
    assert.ok(!output.includes('passwd-copied-private-sentinel'));
    assert.ok(!output.includes('key-copied-private-sentinel'));
  }
});

test('private values matching report identifiers preserve scan structure and redact configuration payloads', async t => {
  const values = ['codex', 'active', '1', 'parse.json', 'client', 'kind', 'schemaVersion', 'instructions', 'path', 'env', 'error', 'severity', 'ruleId', 'findings'];
  const env = Object.fromEntries(values.map((value, index) => [`VALUE_${index}`, value]));
  const w = await workspace({
    'AGENTS.md': 'codex active 1 parse.json',
    '.mcp.json': JSON.stringify({ mcpServers: { fixture: { command: 'node', args: values, env } } }),
    '.claude/settings.json': '{ "model": }',
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, clients: ['codex', 'claude'], trust: 'trusted' });
  assert.equal(report.schemaVersion, '1.0');
  assert.equal(report.tool.version, VERSION);
  assert.deepEqual(report.clients.map(client => client.client), ['codex', 'claude']);
  for (const client of report.clients) {
    assert.deepEqual(client.metadata, adapters.find(adapter => adapter.metadata.id === client.client)!.metadata);
    for (const decision of client.decisions) {
      assert.ok(report.sources.some(source => source.id === decision.sourceId));
      assert.match(decision.sourceId, /^[a-f0-9]{16}$/);
      assert.ok(['active', 'conditional', 'ignored', 'invalid'].includes(decision.status));
      assert.ok(['instructions', 'mcp', 'settings'].includes(decision.kind));
    }
  }
  assert.equal(report.clients[0].instructions, '[REDACTED] [REDACTED] [REDACTED] [REDACTED]');
  assert.ok(report.clients[0].decisions.some(decision => decision.kind === 'instructions' && decision.status === 'active'));
  assert.deepEqual(report.diff[0].clients, ['codex', 'claude']);
  const syntax = report.findings.find(finding => finding.ruleId === 'parse.json')!;
  assert.equal(syntax.severity, 'error');
  assert.equal(syntax.client, undefined);
  assert.match(syntax.id, /^[a-f0-9]{16}$/);
  const server = report.clients[1].extensions.find(extension => extension.kind === 'mcp')!;
  assert.equal(server.status, 'active');
  assert.ok(server.config.args.every((value: string) => value === '[REDACTED]'));
  assert.ok(report.sources.find(source => source.relativePath.endsWith('.mcp.json'))?.preview?.includes('[REDACTED]'));
  assert.ok(report.pathMappings?.every(mapping => typeof mapping.path === 'string' && typeof mapping.replacement === 'string'));
  for (const output of [JSON.parse(json(report)), portable(report)]) {
    assert.equal(output.schemaVersion, '1.0');
    assert.equal(output.clients[0].client, 'codex');
    assert.equal(output.findings.find((finding: { ruleId: string }) => finding.ruleId === 'parse.json').severity, 'error');
  }
  report.tool.name = 'password=mutated-tool-sentinel';
  report.clients[0].metadata.name = 'password=mutated-metadata-sentinel';
  for (const output of [json(report), html(report)]) {
    assert.ok(!output.includes('mutated-tool-sentinel'));
    assert.ok(!output.includes('mutated-metadata-sentinel'));
  }
});

test('invalid environment and header containers keep nested string values private', async t => {
  const secrets = ['invalid-env-nested-sentinel', 'invalid-header-array-sentinel', 'invalid-env-string-sentinel'];
  const w = await workspace({ '.mcp.json': JSON.stringify({ mcpServers: {
    nested: { command: 'node', env: { VALUE: { nested: secrets[0] } }, headers: [secrets[1]] },
    scalar: { command: 'node', env: secrets[2] },
  } }) });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['claude'], trust: 'trusted' });
  assert.ok(report.findings.some(finding => finding.ruleId === 'mcp.env-type'));
  for (const output of [json(report), html(report)]) for (const secret of secrets) assert.ok(!output.includes(secret), secret);
});

test('syntax-invalid sources retain diagnostics while withholding previews that cannot be reliably redacted', async t => {
  const cases = [
    ['.mcp.json', '{"mcpServers":{"fixture":{"env":{"NORMAL":"duplicate-private-sentinel","NORMAL":"later-value"}}}}', 'duplicate-private-sentinel'],
    ['.mcp.json', '{"mcpServers":{"fixture":{"env":{"NORMAL":"unclosed-private-sentinel', 'unclosed-private-sentinel'],
    ['.codex/config.toml', '[mcp_servers.fixture.env]\nNORMAL="toml-private-sentinel"\ninvalid=[\n', 'toml-private-sentinel'],
    ['.claude/skills/check/SKILL.md', '---\nname: check\nenv:\n  NORMAL: yaml-private-sentinel\ninvalid: [\n---\nSkill body.', 'yaml-private-sentinel'],
  ];
  for (const [file, text, secret] of cases) {
    const w = await workspace({ [file]: text, 'AGENTS.md': 'Visible repository instructions.' });
    t.after(() => rm(w.root, { recursive: true, force: true }));
    const report = await scan({ ...w, user: false, clients: ['codex', 'claude'], trust: 'trusted' });
    const invalid = report.sources.find(source => source.relativePath === file)!;
    assert.equal(invalid.invalid, true, file);
    assert.equal(invalid.preview, undefined, file);
    assert.ok(report.findings.some(finding => finding.ruleId.startsWith('parse.') && finding.location.path === invalid.path && finding.location.line > 0), file);
    assert.equal(report.sources.find(source => source.relativePath === 'AGENTS.md')?.preview, 'Visible repository instructions.');
    for (const output of [JSON.stringify(report), json(report), html(report), terminal(report, 'explain')]) assert.ok(!output.includes(secret), file);
  }
});

test('source previews redact credentials and omit private account/session state', async t => {
  const w = await workspace({
    '.mcp.json': JSON.stringify({ mcpServers: { test: { command: 'node', env: { NORMAL_NAME: 'preview-env-sentinel' }, headers: { Header: 'preview-header-sentinel' } } } }),
    'CLAUDE.md': 'API_KEY=preview-markdown-sentinel',
  }, {
    '.claude.json': JSON.stringify({ mcpServers: {}, projects: {}, account: { email: 'private-user-sentinel@example.test' } }),
    '.copilot/config.json': JSON.stringify({ trusted_folders: [], session_history: ['private-session-sentinel'] }),
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const privateAlias = path.join(w.root, 'private-history-alias');
  await symlink(w.repo, privateAlias, process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(path.join(w.home, '.claude.json'), JSON.stringify({ mcpServers: {}, projects: {}, account: { email: 'private-user-sentinel@example.test', lastDirectory: privateAlias } }));
  const report = await scan({ ...w, clients: ['claude', 'copilot'], trust: 'trusted' });
  const text = JSON.stringify(report);
  for (const secret of ['preview-env-sentinel', 'preview-header-sentinel', 'preview-markdown-sentinel', 'private-user-sentinel', 'private-session-sentinel']) assert.ok(!text.includes(secret), secret);
  assert.ok(!text.includes('private-history-alias'));
  assert.ok(report.sources.some(source => source.preview?.includes('REDACTED')));
  assert.ok(report.sources.filter(source => source.path.endsWith('.claude.json') || source.path.endsWith('config.json')).every(source => source.preview === undefined));
});

test('portable findings replace a custom home even when its only configuration source is broken', { skip: process.platform === 'win32' }, async t => {
  const w = await workspace();
  t.after(() => rm(w.root, { recursive: true, force: true }));
  await mkdir(path.join(w.home, '.claude'));
  await symlink(path.join(w.home, 'missing.md'), path.join(w.home, '.claude/CLAUDE.md'));
  const report = await scan({ ...w, clients: ['claude'] });
  const exported = portable(report);
  const broken = exported.findings.find(finding => finding.ruleId === 'source.broken-symlink');
  assert.equal(broken?.location.path, '~/.claude/CLAUDE.md');
  assert.ok(!JSON.stringify(exported).includes(w.home));
});
