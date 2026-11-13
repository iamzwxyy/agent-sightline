import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
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

test('Claude permission precedence and trust boundaries use the pinned CLI with a local scripted API', { timeout: 120000 }, async t => {
  const marker = 'permission-marker.txt';
  const command = `node -e "require('node:fs').writeFileSync('${marker}','permission-fixture')"`;
  const exact = `Bash(${command})`;
  const cases = [
    { name: 'exact allow', user: { allow: [exact] }, allowed: true },
    { name: 'exact ask before allow', user: { allow: [exact], ask: [exact] }, allowed: false, rule: 'permission.ask-overrides-allow' },
    { name: 'tool-wide ask before allow', user: { allow: [exact], ask: ['Bash'] }, allowed: false, rule: 'permission.ask-overrides-allow' },
    { name: 'Bash wildcard ask before allow', user: { allow: [exact], ask: ['Bash(*)'] }, allowed: false, rule: 'permission.ask-overrides-allow' },
    { name: 'exact deny before allow', user: { allow: [exact], deny: [exact] }, allowed: false, rule: 'permission.deny-overrides-allow' },
    { name: 'deny before ask and allow', user: { allow: [exact], ask: [exact], deny: ['Bash'] }, allowed: false, rule: 'permission.deny-overrides-allow', removed: true },
    { name: 'user ask before project allow', user: { ask: ['Bash'] }, project: { allow: [exact] }, allowed: false, rule: 'permission.ask-overrides-allow' },
    { name: 'project ask before user allow', user: { allow: [exact] }, project: { ask: ['Bash'] }, allowed: false, rule: 'permission.ask-overrides-allow' },
    { name: 'user deny before local allow', user: { deny: ['Bash'] }, local: { allow: [exact] }, allowed: false, rule: 'permission.deny-overrides-allow', removed: true },
    { name: 'project wildcard deny before local allow', user: { ask: ['Bash'] }, project: { deny: ['Bash(*)'] }, local: { allow: [exact] }, allowed: false, rule: 'permission.deny-overrides-allow', removed: true },
    { name: 'different ask keeps allow', user: { allow: [exact], ask: ['Bash(unrelated-fixture)'] }, allowed: true },
    { name: 'narrow ask keeps broader allow', user: { allow: ['Bash'], ask: ['Bash(unrelated-fixture)'] }, allowed: true },
    { name: 'trusted project grant', user: {}, project: { allow: [exact] }, allowed: true },
    { name: 'untrusted project grant', user: {}, project: { allow: [exact] }, trusted: false, allowed: false, status: 'ignored' },
    { name: 'user grant independent of workspace trust', user: { allow: [exact] }, trusted: false, allowed: true },
    { name: 'untrusted project ask still restricts user grant', user: { allow: [exact] }, project: { ask: ['Bash'] }, trusted: false, allowed: false, rule: 'permission.ask-overrides-allow' },
    { name: 'trusted local grant', user: {}, local: { allow: [exact] }, allowed: true },
    { name: 'untracked local grant retains a session check', user: {}, local: { allow: [exact] }, trusted: false, allowed: true, status: 'conditional' },
    { name: 'tracked local grant retains a session check', user: {}, local: { allow: [exact] }, trusted: false, tracked: true, allowed: false, status: 'conditional' },
  ];
  let messages: any[] = [];
  const server = createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    const data = JSON.parse(text);
    if (request.url?.includes('count_tokens')) { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ input_tokens: 1 })); return; }
    messages.push(data);
    const useTool = messages.length === 1;
    const block = useTool ? { type: 'tool_use', id: 'fixture-tool', name: 'Bash', input: { command, description: 'Write the isolated fixture marker.' } } : { type: 'text', text: 'Fixture complete.' };
    const reply = { id: 'fixture-' + messages.length, type: 'message', role: 'assistant', model: data.model, content: [block], stop_reason: useTool ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
    if (!data.stream) { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(reply)); return; }
    response.setHeader('Content-Type', 'text/event-stream');
    const event = (value: Record<string, unknown>) => response.write('event: ' + value.type + '\ndata: ' + JSON.stringify(value) + '\n\n');
    event({ type: 'message_start', message: { ...reply, content: [], stop_reason: null } });
    event({ type: 'content_block_start', index: 0, content_block: useTool ? { ...block, input: {} } : { type: 'text', text: '' } });
    event({ type: 'content_block_delta', index: 0, delta: useTool ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } });
    event({ type: 'content_block_stop', index: 0 });
    event({ type: 'message_delta', delta: { stop_reason: reply.stop_reason, stop_sequence: null }, usage: { output_tokens: 1 } });
    event({ type: 'message_stop' });
    response.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    const closed = new Promise<void>(resolve => server.close(() => resolve()));
    server.closeAllConnections();
    await closed;
  });
  for (const scenario of cases) await t.test(scenario.name, async scenarioTest => {
    const w = await workspace({ '.claude/settings.json': JSON.stringify({ permissions: scenario.project ?? {} }), '.claude/settings.local.json': JSON.stringify({ permissions: scenario.local ?? {} }) }, { '.claude/settings.json': JSON.stringify({ permissions: scenario.user }) });
    scenarioTest.after(() => rm(w.root, { recursive: true, force: true }));
    const env = { ...isolatedEnvironment(w.home), ANTHROPIC_API_KEY: 'synthetic-fixture-key', ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + (server.address() as AddressInfo).port };
    execFileSync('git', ['-c', 'init.templateDir=', 'init', '--quiet', w.repo], { env });
    if (scenario.tracked) execFileSync('git', ['add', '.claude/settings.local.json'], { env, cwd: w.repo });
    const trust = { hasTrustDialogAccepted: scenario.trusted !== false };
    await writeFile(path.join(w.home, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, projects: { [w.repo]: trust, [await realpath(w.repo)]: trust } }));
    messages = [];
    const child = spawn(runtime, ['-p', 'Run the isolated fixture.', '--output-format', 'json', '--permission-mode', 'manual', '--permission-prompts', 'none', '--no-session-persistence', '--tools', 'Bash', '--strict-mcp-config', '--system-prompt', 'Use the fixture tool.'], { cwd: w.repo, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '', errors = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    try {
      const [status] = await once(child, 'close');
      assert.equal(status, 0, errors);
      assert.equal(messages.length, 2);
      assert.equal(JSON.parse(output).is_error, false);
      assert.equal(await readFile(path.join(w.repo, marker), 'utf8').catch(() => null), scenario.allowed ? 'permission-fixture' : null);
      if (scenario.removed) assert.ok(!messages[0].tools.some((tool: any) => tool.name === 'Bash'));
      if (scenario.rule === 'permission.ask-overrides-allow') assert.equal(JSON.parse(output).permission_denials.length, 1);
      const report = await scan({ ...w, clients: ['claude'], trust: scenario.trusted === false ? 'untrusted' : 'trusted' });
      const allow = report.clients[0].extensions.find(extension => extension.kind === 'permission' && extension.config.action === 'allow')!;
      assert.equal(allow.status, scenario.status ?? (scenario.allowed ? 'active' : 'shadowed'));
      if (scenario.rule) assert.ok(report.findings.some(finding => finding.ruleId === scenario.rule));
      else assert.ok(!report.findings.some(finding => finding.ruleId.startsWith('permission.')));
    } finally { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
  });
});

test('Claude native settings keep strict JSON when Copilot accepts a shared JSONC source', async t => {
  const w = await workspace({ '.mcp.json': '{"mcpServers":{"fixture":{"type":"http","url":"https://example.invalid/mcp"}}}', '.claude/settings.json': '{}' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  for (const content of ['{"disabledMcpjsonServers":["fixture"]}', '{// comment\n"disabledMcpjsonServers":["fixture"],}']) {
    await writeFile(path.join(w.repo, '.claude/settings.json'), content);
    const native = readServer(w.repo, isolatedEnvironment(w.home));
    const report = await scan({ ...w, user: false, clients: ['claude'] });
    assert.equal(native.status, 0);
    if (content.includes('//')) {
      assert.match(native.text, /Pending approval/);
      assert.ok(report.findings.some(finding => finding.ruleId === 'parse.json' && finding.client === 'claude'));
      assert.equal(report.clients[0].extensions.find(extension => extension.name === 'fixture')?.status, 'conditional');
    } else {
      assert.match(native.text, /Rejected/);
      assert.equal(report.clients[0].extensions.find(extension => extension.name === 'fixture')?.status, 'ignored');
    }
  }
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
