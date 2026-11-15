import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { scan } from '../packages/core/index.js';
import { html, json, portable, terminal } from '../packages/reporter/index.js';
import { workspace } from './helpers.js';

const publishedLoader = new URL('../fixtures/upstream/gemini-0.68.0/memoryImportProcessor.js', import.meta.url);
function nativeContext(filename: string, format: 'tree' | 'flat', markers = ['.git']): string {
  const script = `
    import { readFile } from 'node:fs/promises';
    import path from 'node:path';
    import { processImports } from ${JSON.stringify(publishedLoader.href)};
    const [filename, format, markers] = JSON.parse(process.argv[1]);
    const result = await processImports(await readFile(filename, 'utf8'), path.dirname(filename), false, undefined, undefined, format, markers);
    const body = result.content.trim();
    const lines = ['--- Context from: ' + filename + ' ---', body, '--- End of Context from: ' + filename + ' ---'];
    console.log(JSON.stringify(body ? lines.join(String.fromCharCode(10)) : ''));
  `;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify([filename, format, markers])], {
    encoding: 'utf8', timeout: 15000, env: { ...process.env, GEMINI_DEBUG_LOG_FILE: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  }));
}

test('Gemini comparison executes the published 0.68.0 processor modules', async () => {
  const expected = {
    'memoryImportProcessor.js': 'e7d21469a24ac772aea3f2a1a411d06e63229b98aa6565863286309c302b6914',
    'paths.js': 'df424b49c88b7e426644d44be42726f8aea0d97c63d8dc8714af1a5d198edf48',
    'debugLogger.js': '1f2595430a558e98a5cd381352a9c2121bcb4574d7d8e95e8fad56a69c287497',
    LICENSE: '58d1e17ffe5109a7ae296caafcadfdbe6a7d176f0bc4ab01e12a689b0499d8bd',
  };
  for (const [name, digest] of Object.entries(expected)) {
    const bytes = await readFile(new URL(name, publishedLoader));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), digest, name);
  }
});

const cases = [
  { name: 'inline imports', files: { 'GEMINI.md': 'Before @./context.md After\n', 'context.md': 'Imported instruction.\n' } },
  { name: 'nested and repeated imports', files: { 'GEMINI.md': 'Root\n@./a.md\n@./b.md\n@./a.md', 'a.md': 'A\n@./common.md', 'b.md': 'B\n@./common.md', 'common.md': 'Common.' } },
  { name: 'cycles back to the root', files: { 'GEMINI.md': 'Root\n@./child.md', 'child.md': 'Child\n@./GEMINI.md' } },
  { name: 'code spans and fence formats', files: { 'GEMINI.md': '`@./inline.md`\n```\n@./backticks.md\n```\n~~~\n@./tildes.md\n~~~\n@./real.md', 'inline.md': 'Inline.', 'backticks.md': 'Backticks.', 'tildes.md': 'Tildes.', 'real.md': 'Real.' } },
  { name: 'missing files and rejected URLs', files: { 'GEMINI.md': 'Root\n@./missing.md\n@https://example.invalid/context.md\n@file:///missing.md' } },
  { name: 'frontmatter as literal context', files: { 'GEMINI.md': '---\ntitle: Context\n---\n@./child.md', 'child.md': '---\ndescription: Keep this text.\n---\nChild.' } },
  { name: 'ASCII boundaries and literal punctuation', files: { 'GEMINI.md': 'email@example.test\n\\@./escaped.md\n\u00a0@./nbsp.md\n@~/.gemini/home.md\n@./child.md,\n@./child.md\n@\n', 'child.md': 'Child.', 'escaped.md': 'Escaped.', 'nbsp.md': 'NBSP.' } },
  { name: 'directory reads and unresolved parent paths', files: { 'GEMINI.md': '@./directory\n@../outside.md\n@./missing/../child.md', 'directory/file.md': 'Inside a directory.', 'child.md': 'Child.' } },
  { name: 'Unicode and encoded path validation', files: { 'GEMINI.md': '@./中文.md\n@中文.md\n@./encoded%20name.md\n@./bad%ZZ.md\n@./%2e%2e/outside.md', '中文.md': 'Unicode context.', 'encoded%20name.md': 'Literal percent filename.', 'encoded name.md': 'Decoded validation target.', 'bad%ZZ.md': 'Malformed escape filename.', '%2e%2e/outside.md': 'Rejected encoded traversal.' } },
  { name: 'depth boundaries', files: { 'GEMINI.md': 'Root\n@./step-0.md', ...Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`step-${index}.md`, `Step ${index}\n${index < 39 ? `@./step-${index + 1}.md` : 'Last instruction.'}`])) } },
];
for (const fixture of cases) for (const format of ['tree', 'flat'] as const) {
  test(`Gemini ${format} context matches the published processor for ${fixture.name}`, async t => {
    const w = await workspace({ ...fixture.files, '.gemini/settings.json': JSON.stringify({ context: { importFormat: format } }) });
    t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
    const report = await scan({ ...w, user: false, clients: ['gemini'], trust: 'trusted' });
    assert.equal(report.clients[0].instructions, nativeContext(path.join(w.repo, 'GEMINI.md'), format));
    assert.equal(report.discovery?.complete, true);
    assert.ok(!report.findings.some(finding => finding.ruleId === 'experimental.imports'));
  });
}

for (const format of ['tree', 'flat'] as const) test(`Gemini ${format} imports preserve file aliases and reject external links`, async t => {
  const w = await workspace({ 'GEMINI.md': '@./alias.md\n@./child.md\n@./external.md\n@./broken.md', 'child.md': 'Shared body.' });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  await writeFile(path.join(w.root, 'outside.md'), 'Outside the native boundary.');
  try {
    await symlink(path.join(w.repo, 'child.md'), path.join(w.repo, 'alias.md'));
    await symlink(path.join(w.root, 'outside.md'), path.join(w.repo, 'external.md'));
    await symlink(path.join(w.repo, 'missing.md'), path.join(w.repo, 'broken.md'));
  } catch (error) {
    if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('Creating file symlinks requires Windows developer mode.'); return; }
    throw error;
  }
  await mkdir(path.join(w.repo, '.gemini'));
  await writeFile(path.join(w.repo, '.gemini/settings.json'), JSON.stringify({ context: { importFormat: format } }));
  const report = await scan({ ...w, user: false, clients: ['gemini'], trust: 'trusted' });
  assert.equal(report.clients[0].instructions, nativeContext(path.join(w.repo, 'GEMINI.md'), format));
  assert.ok(!JSON.stringify(report).includes('Outside the native boundary.'));
});

test('Gemini text imports retain raw configuration text and scope its structural diagnostics to the owning client', async t => {
  const secret = 'gemini-import-private-sentinel';
  const w = await workspace({ 'GEMINI.md': 'Instructions\n@./.mcp.json\nEnd.', '.mcp.json': '{"mcpServers":{"test":{"env":{"NORMAL":"' + secret + '"},"command":' });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  const report = await scan({ ...w, user: false, clients: ['gemini'], trust: 'trusted' });
  assert.ok(report.clients[0].instructions.includes('"mcpServers"'));
  assert.ok(report.clients[0].instructions.includes('[REDACTED]'));
  assert.ok(report.clients[0].decisions.some(source => source.path.endsWith('.mcp.json') && source.kind === 'instructions' && source.status === 'active'));
  assert.ok(!report.findings.some(finding => finding.ruleId.startsWith('parse.')));
  for (const output of [JSON.stringify(report), json(report), terminal(report, 'explain'), html(report)]) assert.ok(!output.includes(secret));
  const mixed = await scan({ ...w, user: false, clients: ['claude', 'gemini'], trust: 'trusted' });
  assert.ok(mixed.findings.some(finding => finding.ruleId.startsWith('parse.')));
  assert.ok(mixed.clients.find(client => client.client === 'gemini')!.instructions.includes('"mcpServers"'));
});

test('Gemini text imports keep inactive foreign MCP files outside their configuration consumer', async t => {
  const w = await workspace({ 'GEMINI.md': '@./nested/.mcp.json', 'nested/.mcp.json': '{"servers":{"example":{"command":"node"}}}' });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  const report = await scan({ ...w, user: false, clients: ['claude', 'gemini'], trust: 'trusted' });
  assert.ok(report.clients.find(client => client.client === 'gemini')!.instructions.includes('"servers"'));
  assert.ok(!report.findings.some(finding => finding.ruleId === 'mcp.root-key'));
  const own = await scan({ ...w, repo: path.join(w.repo, 'nested'), user: false, clients: ['claude', 'gemini'], trust: 'trusted' });
  assert.ok(own.findings.some(finding => finding.ruleId === 'mcp.root-key'));
});

for (const extension of ['json', 'jsonc', 'toml', 'yaml', 'yml', 'md']) test(`Gemini literal ${extension} imports redact structured private values and their copied text`, async t => {
  const secret = 'gemini-structured-import-private';
  const structured = extension === 'json' || extension === 'jsonc'
    ? JSON.stringify({ env: { NORMAL: secret, NUMERIC: 987654321, FLAG: true, EMPTY: null }, ordinaryFlag: true })
    : extension === 'toml'
      ? `[env]\nNORMAL="${secret}"\nNUMERIC=987654321\nFLAG=true\n`
      : `env:\n  NORMAL: ${secret}\n  NUMERIC: 987654321\n  FLAG: true\n  EMPTY: null\n`;
  const text = extension === 'md' ? `---\n${structured}---\nLiteral context body.` : structured;
  const w = await workspace({ 'GEMINI.md': `Root\n@./context.${extension}\nCopied ${secret}`, [`context.${extension}`]: text });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  const report = await scan({ ...w, user: false, clients: ['gemini'], trust: 'trusted' });
  for (const output of [JSON.stringify(report), json(report), terminal(report, 'explain'), html(report)]) {
    assert.ok(!output.includes(secret));
    assert.ok(!output.includes('987654321'));
  }
  assert.ok(!/FLAG"?\s*[:=]\s*true/.test(report.clients[0].instructions));
  assert.ok(report.clients[0].instructions.includes('NORMAL'));
  assert.equal(report.clients[0].metadata.maturity, 'experimental');
  assert.ok(report.clients[0].decisions.every(source => Number.isInteger(source.line) && source.line > 0));
  assert.ok(!report.findings.some(finding => finding.ruleId.startsWith('parse.')));
  if (extension === 'json' || extension === 'jsonc') {
    const preview = JSON.parse(report.sources.find(source => source.relativePath === `context.${extension}`)!.preview!);
    assert.equal(preview.ordinaryFlag, true);
    assert.equal(preview.env.FLAG, '[REDACTED]');
  }
});

test('Gemini private tree imports conceal earlier public segments and nested imported text', async t => {
  const w = await workspace({
    'GEMINI.md': '@./shared.md\n@./context.json',
    'shared.md': 'PRIVATE_BEFORE\n@./child.md\nPRIVATE_AFTER',
    'child.md': 'PRIVATE_LEAF',
    'context.json': '{"env":{"NORMAL":" @./shared.md "}}',
  });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  const report = await scan({ ...w, user: false, clients: ['gemini'], trust: 'trusted' });
  for (const output of [JSON.stringify(report), json(report), terminal(report, 'explain'), html(report)]) {
    for (const value of ['PRIVATE_BEFORE', 'PRIVATE_AFTER', 'PRIVATE_LEAF']) assert.ok(!output.includes(value), value);
  }
  assert.equal(report.discovery?.complete, true);
});

test('Gemini literal YAML imports conceal decoded aliases and escaped public spellings of private values', async t => {
  const secret = 'gemini-alias-private-value';
  const w = await workspace({
    'GEMINI.md': `@./context.yaml\nCopied ${secret}`,
    'context.yaml': 'ordinary: &shared "gemini-alias-private-\\u0076alue"\n\nenv:\n  NORMAL: *shared\n  FLAG: true\nordinaryFlag: true\n',
  });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  const report = await scan({ ...w, user: false, clients: ['gemini'], trust: 'trusted' });
  for (const output of [JSON.stringify(report), json(report), terminal(report, 'explain'), html(report)]) assert.ok(!output.includes('gemini-alias-private-'));
  assert.ok(report.clients[0].instructions.includes('ordinaryFlag: true'));
  assert.equal(report.discovery?.complete, true);
});

test('Gemini literal YAML imports retain cyclic aliases while protecting their private values', async t => {
  const w = await workspace({
    'GEMINI.md': '@./context.yaml',
    'context.yaml': 'ordinary: &shared\n  VALUE: gemini-cyclic-alias-private\n  self: *shared\nenv:\n  NORMAL: *shared\n',
  });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  const report = await scan({ ...w, user: false, clients: ['gemini'], trust: 'trusted' });
  for (const output of [JSON.stringify(report), json(report), terminal(report, 'explain'), html(report)]) assert.ok(!output.includes('gemini-cyclic-alias-private'));
  assert.ok(report.clients[0].instructions.includes('ordinary: &shared'));
  assert.equal(report.discovery?.complete, true);
});

test('Gemini tree segments keep their original lines and import columns in comparisons and portable reports', async t => {
  const w = await workspace({ 'GEMINI.md': 'Repeated\n\nBefore @./child.md After\n\nRepeated', 'child.md': 'Child.' });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  const report = await scan({ ...w, user: false, clients: ['gemini'], trust: 'trusted' });
  const repeated = report.instructionDiff!.find(block => block.content === 'Repeated')!;
  assert.deepEqual(repeated.origins.map(origin => origin.location.line), [1, 5]);
  const imported = report.clients[0].decisions.find(source => source.path.endsWith('child.md'))!;
  assert.deepEqual(imported.importedFrom, { path: path.join(w.repo, 'GEMINI.md'), line: 3, column: 8 });
  const after = report.clients[0].decisions.find(source => source.content.includes('After'))!;
  assert.equal(after.line, 3);
  assert.equal(after.column, 19);
  const exported = portable(report);
  assert.ok(!JSON.stringify(exported).includes(w.root));
  assert.equal(exported.clients[0].decisions.find(source => source.path.endsWith('child.md'))!.importedFrom?.column, 8);
});

for (const markers of [[], ['.memory-root'], ['.git']]) test(`Gemini context discovery and imports follow memory boundary markers ${JSON.stringify(markers)}`, async t => {
  const w = await workspace({
    'GEMINI.md': 'Outer context.', 'nested/.memory-root': '', 'nested/.git': 'gitdir: deliberately-unused-pointer',
    'nested/GEMINI.md': 'Nested\n@../outside.md\n@./child.md', 'outside.md': 'Outer import.', 'nested/child.md': 'Nested import.',
    'nested/.gemini/settings.json': JSON.stringify({ context: { memoryBoundaryMarkers: markers } }),
  });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  const report = await scan({ ...w, target: 'nested', user: false, clients: ['gemini'], trust: 'trusted' });
  assert.equal(report.clients[0].instructions, nativeContext(path.join(w.repo, 'nested/GEMINI.md'), 'tree', markers));
  assert.ok(!report.clients[0].instructions.includes('Outer context.'));
  assert.ok(!report.clients[0].instructions.includes('Outer import.'));
});

test('Gemini reports an import outside the inspection boundary as incomplete without reading its body', async t => {
  const w = await workspace({ 'GEMINI.md': 'Outer context.', 'shared.md': 'Uninspected private body.', 'nested/GEMINI.md': 'Nested\n@../shared.md\nEnd.' });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  const report = await scan({ ...w, repo: path.join(w.repo, 'nested'), user: false, clients: ['gemini'], trust: 'trusted' });
  assert.equal(report.discovery?.complete, false);
  assert.ok(report.findings.some(finding => finding.ruleId === 'include.inspection-scope'));
  assert.ok(!JSON.stringify(report).includes('Uninspected private body.'));
  assert.ok(report.clients[0].instructions.includes('Nested'));
  assert.ok(report.clients[0].instructions.includes('End.'));
});

for (const format of ['tree', 'flat'] as const) test(`Gemini ${format} global and ancestor contexts retain separate import state`, async t => {
  const w = await workspace({
    'GEMINI.md': 'Project\n@./shared.md', 'shared.md': 'Project shared.',
    'src/GEMINI.md': 'Nested\n@../shared.md', 'src/file.ts': '',
  }, {
    '.gemini/settings.json': JSON.stringify({ context: { importFormat: format } }),
    '.gemini/GEMINI.md': 'Global\n@./shared.md', '.gemini/shared.md': 'Global shared.',
  });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  const report = await scan({ ...w, target: 'src/file.ts', clients: ['gemini'], trust: 'trusted' });
  const files = [path.join(w.home, '.gemini/GEMINI.md'), path.join(w.repo, 'GEMINI.md'), path.join(w.repo, 'src/GEMINI.md')];
  assert.equal(report.clients[0].instructions, files.map(filename => nativeContext(filename, format)).join('\n\n'));
  const user = report.clients[0].decisions.find(source => source.path === path.join(w.home, '.gemini/shared.md'))!;
  assert.equal(user.scope, 'user');
  const exported = portable(report);
  assert.ok(exported.clients[0].decisions.some(source => source.path.replaceAll('\\', '/') === '~/.gemini/shared.md'));
  assert.ok(!JSON.stringify(exported).includes(w.root));
});

test('Gemini context import reading limits keep report discovery incomplete', async t => {
  const w = await workspace({ 'GEMINI.md': 'Before\n@./large.md\nAfter', 'large.md': 'x'.repeat(2 * 1024 * 1024 + 1) });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  const report = await scan({ ...w, user: false, clients: ['gemini'], trust: 'trusted' });
  assert.equal(report.discovery?.complete, false);
  assert.ok(report.findings.some(finding => finding.ruleId === 'source.read-limit'));
  assert.ok(report.findings.some(finding => finding.ruleId === 'include.inspection-scope'));
  assert.ok(report.clients[0].instructions.includes('Before'));
  assert.ok(report.clients[0].instructions.includes('After'));
});

test('Gemini diagnoses malformed boundary settings without applying context from an unproven scope', async t => {
  const w = await workspace({ 'GEMINI.md': 'Context.', '.gemini/settings.json': '{"context":{"memoryBoundaryMarkers":42}}' });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  const report = await scan({ ...w, user: false, clients: ['gemini'], trust: 'trusted' });
  assert.equal(report.clients[0].instructions, '');
  assert.ok(report.findings.some(finding => finding.ruleId === 'gemini.context-type' && finding.location.key === 'context.memoryBoundaryMarkers'));
});
