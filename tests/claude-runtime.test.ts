import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { scan } from '../packages/core/index.js';
import { claudeMetadata } from '../packages/adapters/claude.js';
import { workspace } from './helpers.js';

const require = createRequire(import.meta.url);
const platformPackage = `@anthropic-ai/claude-code-${process.platform}-${process.arch}`;
const runtimePackage = require(platformPackage + '/package.json');
const runtime = path.join(path.dirname(require.resolve(platformPackage + '/package.json')), process.platform === 'win32' ? 'claude.exe' : 'claude');

function isolatedEnvironment(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH, PATHEXT: process.env.PATHEXT, SystemRoot: process.env.SystemRoot,
    COMSPEC: process.env.COMSPEC, TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR,
    HOME: home, USERPROFILE: home,
    APPDATA: path.join(home, 'AppData/Roaming'), LOCALAPPDATA: path.join(home, 'AppData/Local'),
    XDG_CONFIG_HOME: path.join(home, '.config'), GIT_CONFIG_NOSYSTEM: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
    NO_COLOR: '1', MCP_TIMEOUT: '2000',
  };
}

function readServer(repo: string, env: NodeJS.ProcessEnv) {
  const result = spawnSync(runtime, ['mcp', 'get', 'fixture'], { cwd: repo, env, encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.ifError(result.error);
  return { ...result, text: result.stdout + result.stderr };
}

test('the MCP conformance checks use the pinned Claude binary', async t => {
  const w = await workspace();
  t.after(() => rm(w.root, { recursive: true, force: true }));
  assert.equal(runtimePackage.version, claudeMetadata.ruleVersion);
  assert.equal(execFileSync(runtime, ['--version'], { env: isolatedEnvironment(w.home), encoding: 'utf8' }).trim(), claudeMetadata.ruleVersion + ' (Claude Code)');
});

test('Claude native MCP transport parsing agrees with Sightline in isolated project configurations', { timeout: 30000 }, async t => {
  const w = await workspace({ '.mcp.json': '{}' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const env = isolatedEnvironment(w.home);
  const cases = [
    { name: 'implicit stdio', config: { command: process.execPath }, type: 'stdio' },
    { name: 'explicit stdio', config: { type: 'stdio', command: process.execPath }, type: 'stdio' },
    { name: 'HTTP', config: { type: 'http', url: 'https://example.invalid/mcp' }, type: 'http' },
    { name: 'HTTP alias', config: { type: 'streamable-http', url: 'https://example.invalid/mcp' }, type: 'http' },
    { name: 'SSE', config: { type: 'sse', url: 'https://example.invalid/mcp' }, type: 'sse' },
    { name: 'WebSocket', config: { type: 'ws', url: 'wss://example.invalid/mcp' }, type: 'ws' },
    { name: 'stdio ignores remote fields', config: { command: process.execPath, url: 42, headers: [], cwd: false, enabled: false }, type: 'stdio' },
    { name: 'HTTP ignores stdio fields', config: { type: 'http', url: 'https://example.invalid/mcp', command: 42, args: false, env: false, cwd: false }, type: 'http' },
    { name: 'URL without type', config: { url: 'https://example.invalid/mcp' } },
    { name: 'SDK registration', config: { type: 'sdk', name: 'fixture' } },
    { name: 'unknown type', config: { type: 'unsupported', command: process.execPath } },
    { name: 'non-string type', config: { type: false, command: process.execPath } },
    { name: 'null type', config: { type: null, command: process.execPath } },
    { name: 'HTTP without URL', config: { type: 'http', command: process.execPath } },
    { name: 'stdio without command', config: { type: 'stdio', url: 'https://example.invalid/mcp' } },
  ];
  for (const fixture of cases) {
    await writeFile(path.join(w.repo, '.mcp.json'), JSON.stringify({ mcpServers: { fixture: fixture.config } }));
    const actual = readServer(w.repo, env);
    const report = await scan({ ...w, env, user: false, clients: ['claude'] });
    const extension = report.clients[0].extensions[0];
    if (fixture.type) {
      assert.equal(actual.status, 0, fixture.name + actual.text);
      assert.match(actual.text, new RegExp('Type: ' + fixture.type), fixture.name);
      assert.match(actual.text, /Pending approval/, fixture.name);
      assert.equal(extension.status, 'conditional', fixture.name);
      assert.ok(!report.findings.some(finding => finding.severity === 'error'), fixture.name);
    } else {
      assert.equal(actual.status, 1, fixture.name + actual.text);
      assert.match(actual.text, /No MCP server named/, fixture.name);
      assert.equal(extension.status, 'invalid', fixture.name);
    }
  }
});

const fixtureServer = `import {writeFileSync} from 'node:fs';
import readline from 'node:readline';
writeFileSync('native-observed.json',JSON.stringify({cwd:process.cwd()}));
setTimeout(()=>process.exit(0),8000).unref();
readline.createInterface({input:process.stdin}).on('line',line=>{
  const request=JSON.parse(line);
  if(request.id===undefined)return;
  const result=request.method==='initialize'?{protocolVersion:request.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:{tools:[]};
  console.log(JSON.stringify({jsonrpc:'2.0',id:request.id,result}));
});`;

test('Claude native project approval boundaries agree with Sightline', { timeout: 30000 }, async t => {
  const w = await workspace({ '.mcp.json': '{}', '.claude/settings.json': '{}', '.claude/settings.local.json': '{}', 'server.mjs': fixtureServer }, { '.claude/settings.json': '{}' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const env = isolatedEnvironment(w.home);
  await rm(path.join(w.repo, '.git'), { recursive: true });
  execFileSync('git', ['-c', 'init.templateDir=', 'init', '--quiet', w.repo], { env, stdio: 'pipe' });
  await writeFile(path.join(w.repo, '.mcp.json'), JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: [path.join(w.repo, 'server.mjs')] } } }));
  const cases = [
    { name: 'shared approval flag', project: { enableAllProjectMcpServers: true }, expected: 'conditional', native: /Pending approval/ },
    { name: 'shared approval list', project: { enabledMcpjsonServers: ['fixture'] }, expected: 'conditional', native: /Pending approval/ },
    { name: 'local approval flag', local: { enableAllProjectMcpServers: true }, expected: 'conditional', native: /Pending approval/ },
    { name: 'user approval flag', user: { enableAllProjectMcpServers: true }, expected: 'active', native: /Connected/ },
    { name: 'user approval list', user: { enabledMcpjsonServers: ['fixture'] }, expected: 'active', native: /Connected/ },
    { name: 'untrusted scalar override', user: { enableAllProjectMcpServers: true }, project: { enableAllProjectMcpServers: false }, expected: 'active', native: /Connected/ },
    { name: 'explicit rejection', user: { enableAllProjectMcpServers: true }, project: { disabledMcpjsonServers: ['fixture'] }, expected: 'ignored', native: /Rejected/ },
  ];
  for (const fixture of cases) {
    await writeFile(path.join(w.home, '.claude/settings.json'), JSON.stringify(fixture.user ?? {}));
    await writeFile(path.join(w.repo, '.claude/settings.json'), JSON.stringify(fixture.project ?? {}));
    await writeFile(path.join(w.repo, '.claude/settings.local.json'), JSON.stringify(fixture.local ?? {}));
    const actual = readServer(w.repo, env);
    assert.equal(actual.status, 0, fixture.name + actual.text);
    assert.match(actual.text, fixture.native, fixture.name);
    const report = await scan({ ...w, env, clients: ['claude'] });
    assert.equal(report.clients[0].extensions[0].status, fixture.expected, fixture.name);
    assert.equal(report.clients[0].decisions.find(decision => decision.path === path.join(w.repo, '.mcp.json'))?.status, fixture.expected === 'conditional' ? 'conditional' : 'active', fixture.name);
    if (fixture.name === 'untrusted scalar override') {
      assert.equal(report.clients[0].settings.find(setting => setting.key === 'enableAllProjectMcpServers' && setting.status === 'active')?.value, true);
      assert.equal(report.clients[0].settings.find(setting => setting.key === 'enableAllProjectMcpServers' && setting.status === 'ignored')?.value, false);
      assert.ok(!report.findings.some(finding => finding.ruleId === 'config.overridden' && finding.location.key === 'enableAllProjectMcpServers'));
    }
  }
});

test('Claude native stdio directory behavior and empty remote endpoints agree with Sightline', { timeout: 15000 }, async t => {
  const w = await workspace({ '.mcp.json': '{}', 'server.mjs': fixtureServer }, { '.claude/settings.json': '{"enableAllProjectMcpServers":true}' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const env = isolatedEnvironment(w.home);
  await mkdir(path.join(w.repo, 'other'));
  await writeFile(path.join(w.repo, '.mcp.json'), JSON.stringify({ mcpServers: { fixture: {
    command: process.execPath, args: [path.join(w.repo, 'server.mjs')], cwd: path.join(w.repo, 'other'), url: 'https://example.invalid/ignored',
  } } }));
  const actual = readServer(w.repo, env);
  assert.equal(actual.status, 0, actual.text);
  assert.match(actual.text, /Connected/);
  const observed = JSON.parse(await readFile(path.join(w.repo, 'native-observed.json'), 'utf8'));
  assert.equal(await realpath(observed.cwd), await realpath(w.repo));
  const report = await scan({ ...w, env, clients: ['claude'], probe: true });
  assert.ok(report.findings.some(finding => finding.ruleId === 'probe.mcp-ready'));
  assert.ok(report.findings.some(finding => finding.ruleId === 'mcp.unsupported-field' && finding.location.key === 'mcpServers.fixture.cwd'));
  await writeFile(path.join(w.repo, '.mcp.json'), JSON.stringify({ mcpServers: { fixture: { type: 'http', url: '' } } }));
  const empty = readServer(w.repo, env);
  assert.equal(empty.status, 0, empty.text);
  assert.match(empty.text, /not configured/i);
  const snapshot = await scan({ ...w, env, clients: ['claude'] });
  assert.equal(snapshot.clients[0].extensions[0].status, 'ignored');
  assert.ok(!snapshot.findings.some(finding => finding.severity === 'error'));
});

test('Claude native scope precedence keeps the user server when an approved project definition is invalid', { timeout: 15000 }, async t => {
  const w = await workspace({ '.mcp.json': '{}', 'server.mjs': fixtureServer }, { '.claude/settings.json': '{"enableAllProjectMcpServers":true}', '.claude.json': '{}' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const env = isolatedEnvironment(w.home);
  await writeFile(path.join(w.home, '.claude.json'), JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: [path.join(w.repo, 'server.mjs')] } } }));
  for (const config of [{ type: 'sdk', name: 'fixture' }, { url: 'https://example.invalid/mcp' }, { command: process.execPath, args: false }, { command: process.execPath, env: false }]) {
    await writeFile(path.join(w.repo, '.mcp.json'), JSON.stringify({ mcpServers: { fixture: config } }));
    const actual = readServer(w.repo, env);
    assert.equal(actual.status, 0, actual.text);
    assert.match(actual.text, /Scope: User config/);
    assert.match(actual.text, /Connected/);
    const report = await scan({ ...w, env, clients: ['claude'] });
    const extensions = report.clients[0].extensions;
    assert.equal(extensions.find(extension => extension.location.path === path.join(w.home, '.claude.json'))?.status, 'active');
    assert.match(extensions.find(extension => extension.status === 'active')!.reason, /structural validation/);
    assert.equal(extensions.find(extension => extension.location.path === path.join(w.repo, '.mcp.json'))?.status, 'invalid');
    assert.ok(report.findings.some(finding => finding.severity === 'error' && finding.related.some(location => location.path === path.join(w.home, '.claude.json'))));
  }
});
