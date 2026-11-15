import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { scan } from '../packages/core/index.js';
import { html, json, portable, terminal } from '../packages/reporter/index.js';
import { workspace } from './helpers.js';

const require = createRequire(import.meta.url);
const runtime = path.dirname(require.resolve('@google/gemini-cli/package.json'));
const cliModule = pathToFileURL(path.join(runtime, 'bundle/chunk-AAYJUGGU.js')).href;
const coreModule = pathToFileURL(path.join(runtime, 'bundle/chunk-2OHBIZ5H.js')).href;

function nativeStartup(repo: string, home: string, env: NodeJS.ProcessEnv = {}) {
  const script = `
    const cli = await import(${JSON.stringify(cliModule)});
    const core = await import(${JSON.stringify(coreModule)});
    const repo = process.argv[1];
    const settings = cli.loadSettings(repo);
    if (settings.merged.context.fileName) core.setGeminiMdFilename(settings.merged.context.fileName);
    else core.resetGeminiMdFilename();
    const memory = new core.MemoryContextManager({
      storage: { getProjectMemoryDir: () => process.env.GEMINI_CLI_HOME + '/absent-project-memory' },
      isTrustedFolder: () => settings.isTrusted,
      getExtensionLoader: () => ({ getExtensions: () => [] }),
      getWorkspaceContext: () => ({ getDirectories: () => new Set([repo]) }),
      getMemoryBoundaryMarkers: () => settings.merged.context.memoryBoundaryMarkers,
      getImportFormat: () => settings.merged.context.importFormat,
      getMcpClientManager: () => undefined,
    });
    await memory.refresh();
    console.log('NATIVE_RESULT ' + JSON.stringify({
      trusted: settings.isTrusted,
      trustDecision: cli.isWorkspaceTrusted(settings.merged, repo),
      trustFeature: settings.merged.security.folderTrust.enabled,
      workspace: settings.workspace.settings,
      servers: settings.merged.mcpServers,
      instructions: [memory.getGlobalMemory(), memory.getEnvironmentMemory()].filter(Boolean).join('\\n\\n'),
      loadedPaths: [...memory.getLoadedPaths()],
    }));
  `;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script, repo], {
    cwd: repo, timeout: 20000, encoding: 'utf8',
    env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TMP: process.env.TMP, TEMP: process.env.TEMP, TMPDIR: process.env.TMPDIR,
      GEMINI_CLI_HOME: home,
      GEMINI_CLI_SYSTEM_SETTINGS_PATH: path.join(home, 'absent-system.json'),
      GEMINI_CLI_SYSTEM_DEFAULTS_PATH: path.join(home, 'absent-defaults.json'),
      OTEL_SDK_DISABLED: 'true', NO_COLOR: '1', ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const captured = output.split('\n').find(line => line.startsWith('NATIVE_RESULT '));
  assert.ok(captured, 'Published Gemini startup result is missing.');
  return JSON.parse(captured.slice('NATIVE_RESULT '.length));
}

test('Gemini startup comparisons execute the pinned published 0.68.0 modules', async () => {
  const pkg = JSON.parse(await readFile(path.join(runtime, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '0.68.0');
  for (const [filename, digest] of Object.entries({
    'chunk-AAYJUGGU.js': '10548c40375eca51cd9df97d8f6f68a64972923b8ec53ef1b412cf403b8694f3',
    'chunk-2OHBIZ5H.js': '54f95e4238551b3fc47c2f1f9e382a56b7b9b5dfc5d83006e0b6abb655c7173f',
  })) assert.equal(createHash('sha256').update(await readFile(path.join(runtime, 'bundle', filename))).digest('hex'), digest, filename);
});

const cases: { name: string; level?: string; disabled?: boolean; env?: NodeJS.ProcessEnv; state: 'active' | 'ignored' | 'conditional' }[] = [
  { name: 'pending first approval', state: 'conditional' },
  { name: 'saved folder approval', level: 'TRUST_FOLDER', state: 'active' },
  { name: 'saved folder rejection', level: 'DO_NOT_TRUST', state: 'ignored' },
  { name: 'saved parent approval', level: 'TRUST_PARENT', state: 'active' },
  { name: 'folder trust disabled by user settings', disabled: true, state: 'active' },
  { name: 'environment approval', env: { GEMINI_CLI_TRUST_WORKSPACE: 'true' }, state: 'active' },
  { name: 'environment rejection before a saved approval', level: 'TRUST_FOLDER', env: { GEMINI_CLI_TRUST_WORKSPACE: 'false' }, state: 'ignored' },
  { name: 'restricted mode before environment approval', env: { GEMINI_CLI_TRUST_WORKSPACE: 'true', GEMINI_RESTRICTED_MODE: 'true' }, state: 'ignored' },
  { name: 'case-sensitive environment toggle values', env: { GEMINI_CLI_TRUST_WORKSPACE: 'TRUE' }, state: 'conditional' },
];

for (const fixture of cases) test(`Gemini startup matches 0.68.0 for ${fixture.name}`, async t => {
  const w = await workspace({
    'GEMINI.md': 'PROJECT_INSTRUCTION', 'TEAM.md': 'CUSTOM_PROJECT_INSTRUCTION',
    '.gemini/settings.json': JSON.stringify({ context: { fileName: 'TEAM.md' }, mcpServers: { fixture: { command: process.execPath, args: ['-p', 'process.version'] } } }),
  }, {
    '.gemini/GEMINI.md': 'GLOBAL_INSTRUCTION', '.gemini/PERSONAL.md': 'PERSONAL_INSTRUCTION', '.gemini/TEAM.md': 'GLOBAL_TEAM_INSTRUCTION',
    '.gemini/settings.json': JSON.stringify({
      context: { fileName: 'PERSONAL.md' }, mcpServers: { fixture: { command: process.execPath, args: ['--version'] } },
      ...(fixture.disabled ? { security: { folderTrust: { enabled: false } } } : {}),
    }),
  });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  await writeFile(path.join(w.home, '.gemini/trustedFolders.json'), JSON.stringify(fixture.level ? { [w.repo]: fixture.level } : {}));
  const native = nativeStartup(w.repo, w.home, fixture.env);
  assert.equal(native.trusted, fixture.state === 'active');
  const report = await scan({ ...w, clients: ['gemini'], env: { PATH: process.env.PATH, ...fixture.env } });
  const client = report.clients[0];
  assert.equal(client.instructions, native.instructions);
  const projectSettings = client.decisions.find(source => source.path === path.join(w.repo, '.gemini/settings.json'));
  assert.equal(projectSettings?.status, fixture.state);
  for (const server of client.extensions.filter(extension => extension.kind === 'mcp' && extension.status !== 'shadowed')) assert.equal(server.status, fixture.state);
  if (native.trusted) assert.deepEqual(client.extensions.find(extension => extension.kind === 'mcp' && extension.status === 'active')?.config, native.servers.fixture);
  if (fixture.state === 'conditional') assert.ok(client.decisions.some(source => source.path === path.join(w.repo, 'TEAM.md') && source.status === 'conditional'));
});

test('Gemini saved trust follows native parent inheritance and longest normalized rule paths', async t => {
  const w = await workspace({ 'GEMINI.md': 'PROJECT' }, { '.gemini/GEMINI.md': 'GLOBAL' });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  for (const rules of [
    { [w.root]: 'TRUST_FOLDER' },
    { [w.root]: 'TRUST_FOLDER', [w.repo]: 'DO_NOT_TRUST' },
    { [path.dirname(w.root)]: 'DO_NOT_TRUST', [path.join(w.root, 'approved-sibling')]: 'TRUST_PARENT' },
  ]) {
    const filename = path.join(w.home, '.gemini/trustedFolders.json');
    await writeFile(filename, JSON.stringify(rules));
    const native = nativeStartup(w.repo, w.home);
    const report = await scan({ ...w, clients: ['gemini'] });
    assert.equal(report.clients[0].instructions, native.instructions);
    assert.ok(report.clients[0].settings.some(setting => setting.location.path === filename));
    assert.ok(!JSON.stringify(portable(report)).includes(w.root));
  }
});

test('Gemini canonical trust matches the first native rule when equally long aliases compete', async t => {
  const w = await workspace({ 'GEMINI.md': 'PROJECT' }, { '.gemini/GEMINI.md': 'GLOBAL' });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  const first = path.join(w.root, 'alias-A');
  const second = path.join(w.root, 'alias-B');
  try {
    await symlink(w.repo, first, process.platform === 'win32' ? 'junction' : 'dir');
    await symlink(w.repo, second, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('Creating directory aliases requires Windows developer mode.'); return; }
    throw error;
  }
  for (const rules of [{ [first]: 'TRUST_FOLDER', [second]: 'DO_NOT_TRUST' }, { [second]: 'DO_NOT_TRUST', [first]: 'TRUST_FOLDER' }]) {
    await writeFile(path.join(w.home, '.gemini/trustedFolders.json'), JSON.stringify(rules));
    const native = nativeStartup(w.repo, w.home);
    const report = await scan({ ...w, clients: ['gemini'] });
    assert.equal(report.clients[0].instructions, native.instructions);
    assert.ok(!JSON.stringify(portable(report)).includes(w.root));
  }
});

test('Gemini trust JSON comments and custom filenames retain native provenance and conceal unrelated state', async t => {
  const w = await workspace({ 'GEMINI.md': 'PROJECT' }, { '.gemini/GEMINI.md': 'GLOBAL' });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  const filename = path.join(w.home, 'state/folder-trust.state');
  await mkdir(path.dirname(filename), { recursive: true });
  const unrelated = path.join(w.root, 'UNRELATED_GEMINI_PRIVATE_PROJECT');
  await writeFile(filename, '// Persisted decisions\n{\n' + JSON.stringify(unrelated) + ': "DO_NOT_TRUST",\n' + JSON.stringify(unrelated) + ': "TRUST_FOLDER",\n' + JSON.stringify(w.repo) + ': "TRUST_FOLDER"\n}');
  const env = { PATH: process.env.PATH, GEMINI_CLI_TRUSTED_FOLDERS_PATH: filename };
  const native = nativeStartup(w.repo, w.home, env);
  const report = await scan({ ...w, clients: ['gemini'], env });
  assert.equal(report.clients[0].instructions, native.instructions);
  const origin = report.clients[0].settings.find(setting => setting.location.path === filename)!.location;
  assert.equal(origin.line, 5);
  assert.equal(origin.key, w.repo);
  assert.equal(report.sources.find(source => source.path === filename)?.preview, undefined);
  for (const output of [JSON.stringify(report), json(report), terminal(report, 'explain'), html(report)]) assert.ok(!output.includes('UNRELATED_GEMINI_PRIVATE_PROJECT'));
  assert.ok(!JSON.stringify(portable(report)).includes(w.root));
});

test('Gemini comments load while trailing commas stop startup even before workspace approval', async t => {
  const w = await workspace({ 'GEMINI.md': 'PROJECT', '.gemini/settings.json': '// Project settings\n{"model":{"name":"fixture-model"}}' }, { '.gemini/GEMINI.md': 'GLOBAL' });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  const native = nativeStartup(w.repo, w.home);
  const report = await scan({ ...w, clients: ['gemini'] });
  assert.equal(report.clients[0].instructions, native.instructions);
  assert.ok(!report.findings.some(item => item.ruleId === 'parse.json'));
  await writeFile(path.join(w.repo, '.gemini/settings.json'), '{"model":{"name":"fixture-model"},}');
  assert.throws(() => nativeStartup(w.repo, w.home));
  const invalid = await scan({ ...w, clients: ['gemini'] });
  assert.equal(invalid.clients[0].instructions, '');
  assert.ok(invalid.findings.some(item => item.ruleId === 'parse.json'));
});

test('Gemini invalid saved trust blocks startup and an environment grant bypasses the unused file', async t => {
  const w = await workspace({ 'GEMINI.md': 'PROJECT' }, { '.gemini/GEMINI.md': 'GLOBAL', '.gemini/trustedFolders.json': '{"UNRELATED_GEMINI_STATE":"INVALID_PRIVATE_TRUST_VALUE"}' });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  assert.throws(() => nativeStartup(w.repo, w.home));
  const invalid = await scan({ ...w, clients: ['gemini'] });
  assert.equal(invalid.clients[0].instructions, '');
  assert.ok(invalid.findings.some(item => item.ruleId === 'gemini.trust-level'));
  for (const output of [JSON.stringify(invalid), html(invalid)]) {
    assert.ok(!output.includes('UNRELATED_GEMINI_STATE'));
    assert.ok(!output.includes('INVALID_PRIVATE_TRUST_VALUE'));
  }
  const env = { PATH: process.env.PATH, GEMINI_CLI_TRUST_WORKSPACE: 'true' };
  const native = nativeStartup(w.repo, w.home, env);
  const approved = await scan({ ...w, clients: ['gemini'], env });
  assert.equal(approved.clients[0].instructions, native.instructions);
  assert.ok(!approved.sources.some(source => source.path.endsWith('trustedFolders.json')));
});

test('Gemini project settings cannot grant themselves folder trust', async t => {
  const w = await workspace({ 'GEMINI.md': 'PROJECT', '.gemini/settings.json': '{"security":{"folderTrust":{"enabled":false}}}' }, { '.gemini/GEMINI.md': 'GLOBAL' });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  const native = nativeStartup(w.repo, w.home);
  assert.equal(native.trusted, false);
  const report = await scan({ ...w, clients: ['gemini'] });
  assert.equal(report.clients[0].instructions, native.instructions);
  assert.equal(report.clients[0].settings.find(setting => setting.key === 'security.folderTrust.enabled')?.status, 'conditional');
});

test('Gemini project MCP entries replace a complete user entry without inheriting its command', async t => {
  const w = await workspace({ '.gemini/settings.json': '{"mcpServers":{"fixture":{"args":["--version"]}}}' }, { '.gemini/settings.json': JSON.stringify({ mcpServers: { fixture: { command: process.execPath } }, security: { folderTrust: { enabled: false } } }) });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  const native = nativeStartup(w.repo, w.home);
  const report = await scan({ ...w, clients: ['gemini'] });
  const server = report.clients[0].extensions.find(extension => extension.kind === 'mcp' && extension.status !== 'shadowed')!;
  assert.deepEqual(server.config, native.servers.fixture);
  assert.equal(server.status, 'invalid');
});

test('Gemini uses GEMINI_CLI_HOME and the explicit inspection home selects its own configuration', async t => {
  const w = await workspace({ 'GEMINI.md': 'PROJECT' }, { '.gemini/GEMINI.md': 'DEFAULT_HOME', '.gemini/settings.json': '{"security":{"folderTrust":{"enabled":false}}}' });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  t.mock.method(os, 'homedir', () => w.home);
  const custom = path.join(w.root, 'custom-home');
  await mkdir(path.join(custom, '.gemini'), { recursive: true });
  await writeFile(path.join(custom, '.gemini/GEMINI.md'), 'CUSTOM_HOME');
  await writeFile(path.join(custom, '.gemini/settings.json'), '{"security":{"folderTrust":{"enabled":false}}}');
  const env = { PATH: process.env.PATH, GEMINI_CLI_HOME: custom };
  const native = nativeStartup(w.repo, custom, env);
  const report = await scan({ repo: w.repo, clients: ['gemini'], env });
  assert.equal(report.clients[0].instructions, native.instructions);
  assert.ok(!report.sources.some(source => source.path.startsWith(w.home)));
  assert.ok(!JSON.stringify(portable(report)).includes(w.root));
  const selected = await scan({ ...w, clients: ['gemini'], env });
  assert.equal(selected.clients[0].instructions, nativeStartup(w.repo, w.home).instructions);
});

test('Gemini repository-only inspections exclude saved trust and explicit trust resolves the isolated project', async t => {
  const w = await workspace({ 'GEMINI.md': 'PROJECT' }, { '.gemini/GEMINI.md': 'GLOBAL' });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  await writeFile(path.join(w.home, '.gemini/trustedFolders.json'), JSON.stringify({ [w.repo]: 'TRUST_FOLDER' }));
  const pending = await scan({ ...w, clients: ['gemini'], user: false });
  assert.equal(pending.clients[0].instructions, '');
  assert.ok(!pending.sources.some(source => source.path.startsWith(w.home)));
  assert.ok(pending.clients[0].decisions.some(source => source.kind === 'instructions' && source.status === 'conditional'));
  const emptyHome = path.join(w.root, 'empty-home');
  await mkdir(emptyHome);
  const native = nativeStartup(w.repo, emptyHome, { GEMINI_CLI_TRUST_WORKSPACE: 'true' });
  const approved = await scan({ ...w, clients: ['gemini'], user: false, trust: 'trusted' });
  assert.equal(approved.clients[0].instructions, native.instructions);
});

test('Gemini sandbox-exec reads folder trust from its native cache runtime directory', async t => {
  const w = await workspace({ 'GEMINI.md': 'PROJECT' }, { '.gemini/GEMINI.md': 'GLOBAL' });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  const cached = path.join(w.home, '.cache/.gemini/trustedFolders.json');
  await mkdir(path.dirname(cached), { recursive: true });
  await writeFile(cached, JSON.stringify({ [w.repo]: 'TRUST_FOLDER' }));
  await writeFile(path.join(w.home, '.gemini/trustedFolders.json'), JSON.stringify({ [w.repo]: 'DO_NOT_TRUST' }));
  const env = { PATH: process.env.PATH, SANDBOX: 'sandbox-exec' };
  const native = nativeStartup(w.repo, w.home, env);
  const report = await scan({ ...w, clients: ['gemini'], env });
  assert.equal(report.clients[0].instructions, native.instructions);
  assert.ok(report.sources.some(source => source.path === cached));
  assert.ok(!report.sources.some(source => source.path === path.join(w.home, '.gemini/trustedFolders.json')));
});

test('Gemini pending format changes retain the native current bytes and private conditional imports', async t => {
  const secret = 'gemini-trust-private-import-value';
  const w = await workspace({
    'GEMINI.md': 'PROJECT', '.gemini/settings.json': '{"context":{"importFormat":"flat"}}',
  }, {
    '.gemini/GEMINI.md': 'GLOBAL\n@./shared.md',
    '.gemini/shared.md': '---\nenv:\n  NORMAL: ' + secret + '\n---\nSHARED_BODY',
  });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  const native = nativeStartup(w.repo, w.home);
  const pending = await scan({ ...w, clients: ['gemini'] });
  assert.equal(pending.clients[0].instructionBytes, Buffer.byteLength(native.instructions));
  assert.ok(pending.clients[0].instructions.includes('Imported from: ./shared.md'));
  assert.ok(pending.clients[0].decisions.some(source => source.status === 'conditional' && source.content.includes('@./shared.md')));
  const approvedNative = nativeStartup(w.repo, w.home, { GEMINI_CLI_TRUST_WORKSPACE: 'true' });
  const approved = await scan({ ...w, clients: ['gemini'], trust: 'trusted' });
  assert.equal(approved.clients[0].instructionBytes, Buffer.byteLength(approvedNative.instructions));
  for (const report of [pending, approved]) for (const output of [JSON.stringify(report), json(report), terminal(report, 'explain'), html(report)]) assert.ok(!output.includes(secret));
});

test('Gemini duplicate JSON settings retain the native last value and a diagnostic', async t => {
  const w = await workspace({ 'GEMINI.md': 'PROJECT' }, {
    '.gemini/GEMINI.md': 'GLOBAL',
    '.gemini/settings.json': '// User settings\n{"security":{"folderTrust":{"enabled":true,"enabled":false}}}',
  });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  const native = nativeStartup(w.repo, w.home);
  assert.equal(native.trusted, true);
  const report = await scan({ ...w, clients: ['gemini'] });
  assert.equal(report.clients[0].instructions, native.instructions);
  assert.ok(report.findings.some(item => item.ruleId === 'parse.duplicate-key' && item.severity === 'warn'));
  assert.equal(report.sources.find(source => source.path === path.join(w.home, '.gemini/settings.json'))?.invalid, false);
});
