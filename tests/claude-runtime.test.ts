import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { chmod, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
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

interface PolicyScenario {
  name: string; user: Record<string, unknown>; project?: Record<string, unknown>; local?: Record<string, unknown>;
  allowed: boolean; trusted?: boolean; tracked?: boolean; status?: string; rule?: string; removed?: boolean;
  userSettings?: Record<string, unknown>; projectSettings?: Record<string, unknown>; localSettings?: Record<string, unknown>;
  managed?: Record<string, unknown>; managedFiles?: Record<string, unknown>;
  managedContent?: string; startupBlocked?: boolean; noAllow?: boolean;
  blockingRule?: { key: string; line: number };
  effectiveDeny?: string[];
  hookScopes?: string[]; hooksRun?: string[]; rejected?: boolean;
}

test('Claude permission precedence and hook policies use the pinned CLI with a local scripted API', { timeout: 240000 }, async t => {
  const marker = 'permission-marker.txt';
  const command = `node -e "require('node:fs').writeFileSync('${marker}','permission-fixture')"`;
  const exact = `Bash(${command})`;
  const managedEnabled = process.env.SIGHTLINE_TEST_MANAGED_POLICY === '1';
  const managedRoot = '/etc/claude-code';
  if (managedEnabled) {
    assert.equal(process.platform, 'linux');
    assert.equal(process.env.GITHUB_ACTIONS, 'true');
    assert.deepEqual(await readdir(managedRoot), [], 'The isolated CI system policy directory must start empty.');
  }
  const scopes = ['user', 'project', 'local', 'managed'];
  const cases: PolicyScenario[] = [
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
    { name: 'user hook runs', user: { allow: [exact] }, hookScopes: ['user'], hooksRun: ['user'], allowed: true },
    { name: 'user disableAllHooks suppresses configured hooks', user: { allow: [exact] }, userSettings: { disableAllHooks: true }, hookScopes: ['user', 'project', 'local'], hooksRun: [], allowed: true },
    { name: 'project false re-enables hooks after user true', user: { allow: [exact] }, userSettings: { disableAllHooks: true }, projectSettings: { disableAllHooks: false }, hookScopes: ['user', 'project', 'local'], hooksRun: ['user', 'project', 'local'], allowed: true },
    { name: 'local disableAllHooks wins over project false', user: { allow: [exact] }, projectSettings: { disableAllHooks: false }, localSettings: { disableAllHooks: true }, hookScopes: ['user', 'project', 'local'], hooksRun: [], allowed: true },
    { name: 'quoted ordinary disableAllHooks rejects the settings layer', user: { allow: [exact] }, userSettings: { disableAllHooks: 'true' }, hookScopes: ['user'], hooksRun: [], allowed: false, rejected: true },
    { name: 'unreadable ordinary MCP allowlist retains other settings', user: { allow: [exact] }, userSettings: { allowedMcpServers: 42 }, allowed: true, rule: 'claude.mcp-policy-type' },
    { name: 'invalid ordinary MCP policy entry retains other settings', user: { allow: [exact] }, userSettings: { deniedMcpServers: [42] }, allowed: true, rule: 'claude.mcp-policy-type' },
    { name: 'ordinary managed-only declarations do not restrict grants or hooks', user: { allow: [exact] }, userSettings: { allowManagedPermissionRulesOnly: true, allowManagedHooksOnly: true }, hookScopes: ['user'], hooksRun: ['user'], allowed: true },
    ...(managedEnabled ? [
      { name: 'managed-only policy ignores user grants', user: { allow: [exact] }, managed: { allowManagedPermissionRulesOnly: true }, allowed: false, status: 'ignored' },
      { name: 'managed-only policy ignores shared project grants', user: {}, project: { allow: [exact] }, managed: { allowManagedPermissionRulesOnly: true }, allowed: false, status: 'ignored' },
      { name: 'managed-only policy ignores local grants', user: {}, local: { allow: [exact] }, managed: { allowManagedPermissionRulesOnly: true }, allowed: false, status: 'ignored' },
      { name: 'managed-only grants ignore user ask rules', user: { ask: ['Bash'] }, managed: { allowManagedPermissionRulesOnly: true, permissions: { allow: [exact] } }, allowed: true },
      { name: 'managed-only grants ignore user deny rules', user: { deny: ['Bash'] }, managed: { allowManagedPermissionRulesOnly: true, permissions: { allow: [exact] } }, allowed: true },
      { name: 'managed-only false retains user grants', user: { allow: [exact] }, managed: { allowManagedPermissionRulesOnly: false }, allowed: true },
      { name: 'managed-only quoted true restricts user grants', user: { allow: [exact] }, managed: { allowManagedPermissionRulesOnly: 'true' }, allowed: false, status: 'ignored' },
      { name: 'managed-only quoted false retains user grants', user: { allow: [exact] }, managed: { allowManagedPermissionRulesOnly: 'false' }, allowed: true },
      { name: 'invalid managed-only policy fails closed', user: { allow: [exact] }, managed: { allowManagedPermissionRulesOnly: 42 }, allowed: false, status: 'ignored' },
      { name: 'null managed-only policy is absent', user: { allow: [exact] }, managed: { allowManagedPermissionRulesOnly: null }, allowed: true },
      { name: 'empty managed file contributes an empty policy', user: { allow: [exact] }, managedContent: '', allowed: true },
      { name: 'managed ask still overrides user allow without a lock', user: { allow: [exact] }, managed: { permissions: { ask: ['Bash'] } }, allowed: false, rule: 'permission.ask-overrides-allow' },
      { name: 'drop-in policy restricts personal grants', user: { allow: [exact] }, managedFiles: { '10-policy.json': { allowManagedPermissionRulesOnly: true } }, allowed: false, status: 'ignored' },
      { name: 'later drop-in can clear the file policy lock', user: { allow: [exact] }, managed: { allowManagedPermissionRulesOnly: true }, managedFiles: { '20-policy.json': { allowManagedPermissionRulesOnly: false } }, allowed: true },
      { name: 'managed rule arrays accumulate across drop-ins', user: {}, managed: { permissions: { allow: [exact] } }, managedFiles: { '10-deny.json': { permissions: { deny: ['Bash'] } } }, allowed: false, rule: 'permission.deny-overrides-allow', removed: true },
      { name: 'managed-only hooks retain only managed handlers', user: { allow: [exact] }, managed: { allowManagedHooksOnly: true }, hookScopes: scopes, hooksRun: ['managed'], allowed: true },
      { name: 'user disable keeps managed hooks running', user: { allow: [exact] }, userSettings: { disableAllHooks: true }, hookScopes: scopes, hooksRun: ['managed'], allowed: true },
      { name: 'managed disable stops every configured hook', user: { allow: [exact] }, managed: { disableAllHooks: true }, hookScopes: scopes, hooksRun: [], allowed: true },
      { name: 'managed false overrides ordinary disable', user: { allow: [exact] }, userSettings: { disableAllHooks: true }, managed: { disableAllHooks: false }, hookScopes: scopes, hooksRun: scopes, allowed: true },
      { name: 'invalid managed hook disable is dropped', user: { allow: [exact] }, managed: { disableAllHooks: 'true' }, hookScopes: scopes, hooksRun: scopes, allowed: true },
      { name: 'drop-in can enable managed hook lock', user: { allow: [exact] }, managedFiles: { '10-policy.json': { allowManagedHooksOnly: true } }, hookScopes: scopes, hooksRun: ['managed'], allowed: true },
      { name: 'unreadable managed restriction withholds adjacent grants', user: { deny: ['Bash'] }, managed: { permissions: { allow: [exact], deny: 42 } }, allowed: false, noAllow: true, removed: true, rule: 'permission.type', effectiveDeny: ['Bash'] },
      { name: 'null managed restriction is absent', user: {}, managed: { permissions: { allow: [exact], deny: null } }, allowed: true },
      { name: 'managed restriction arrays retain valid entries', user: { allow: [exact] }, managed: { permissions: { deny: [42, 'Bash'] } }, allowed: false, removed: true, rule: 'permission.deny-overrides-allow', blockingRule: { key: 'permissions.deny.1', line: 5 } },
      { name: 'malformed managed JSON prevents startup', user: { allow: [exact] }, managedContent: '{ broken JSON', startupBlocked: true, allowed: false },
      { name: 'non-object policy drop-in prevents startup', user: { allow: [exact] }, managedFiles: { '10-policy.json': [] }, startupBlocked: true, allowed: false },
    ] : []),
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
    const scopeSettings = (scope: string, data: Record<string, unknown> = {}) => ({ ...data, ...(scenario.hookScopes?.includes(scope) ? { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: `node -e "require('node:fs').writeFileSync('hook-${scope}.txt','hook-fixture')"` }] }] } } : {}) });
    const w = await workspace({ '.claude/settings.json': JSON.stringify(scopeSettings('project', { ...scenario.projectSettings, permissions: scenario.project ?? {} })), '.claude/settings.local.json': JSON.stringify(scopeSettings('local', { ...scenario.localSettings, permissions: scenario.local ?? {} })) }, { '.claude/settings.json': JSON.stringify(scopeSettings('user', { ...scenario.userSettings, permissions: scenario.user })) });
    scenarioTest.after(() => rm(w.root, { recursive: true, force: true }));
    if (managedEnabled) {
      const dropins = path.join(managedRoot, 'managed-settings.d');
      await mkdir(dropins);
      scenarioTest.after(async () => {
        await rm(path.join(managedRoot, 'managed-settings.json'), { force: true });
        await rm(dropins, { recursive: true, force: true });
      });
      await writeFile(path.join(managedRoot, 'managed-settings.json'), scenario.managedContent ?? JSON.stringify(scopeSettings('managed', scenario.managed), null, 2));
      for (const [name, data] of Object.entries(scenario.managedFiles ?? {})) await writeFile(path.join(dropins, name), JSON.stringify(data));
    }
    const env = { ...isolatedEnvironment(w.home), ANTHROPIC_API_KEY: 'synthetic-fixture-key', ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + (server.address() as AddressInfo).port };
    const inspect = async () => {
      const report = await scan({ ...w, system: managedEnabled, clients: ['claude'], trust: scenario.trusted === false ? 'untrusted' : 'trusted' });
      if (managedEnabled) {
        const flags = ['--repo', w.repo, '--home', w.home, '--system', '--client', 'claude', '--trust', scenario.trusted === false ? 'untrusted' : 'trusted'];
        const builtCli = path.resolve('dist/cli/index.js');
        const fromCli = JSON.parse(execFileSync(process.execPath, [builtCli, ...flags, '--json'], { env, encoding: 'utf8' }));
        assert.deepEqual(fromCli.clients[0].extensions, report.clients[0].extensions);
        assert.deepEqual(fromCli.clients[0].settings, report.clients[0].settings);
        if (scenario.name === 'managed-only hooks retain only managed handlers' || scenario.blockingRule) {
          const outputFile = path.join(w.root, 'managed-report.html');
          execFileSync(process.execPath, [builtCli, 'report', ...flags, '--format', 'html', '--output', outputFile], { env });
          const exported = await readFile(outputFile, 'utf8');
          const snapshot = JSON.parse(exported.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/)![1]);
          if (scenario.blockingRule) {
            const blocked = snapshot.findings.find((finding: any) => finding.ruleId === scenario.rule);
            assert.equal(blocked.related[0].key, scenario.blockingRule.key);
            assert.equal(blocked.related[0].line, scenario.blockingRule.line);
          } else assert.ok(snapshot.clients[0].extensions.filter((entry: any) => entry.kind === 'hook' && entry.status === 'ignored').every((entry: any) => entry.origins[0].location.key === 'allowManagedHooksOnly'));
          assert.ok(!exported.includes(JSON.stringify(w.home).slice(1, -1)));
        }
      }
      return report;
    };
    execFileSync('git', ['-c', 'init.templateDir=', 'init', '--quiet', w.repo], { env });
    if (scenario.tracked) execFileSync('git', ['add', '.claude/settings.local.json'], { env, cwd: w.repo });
    const trust = { hasTrustDialogAccepted: scenario.trusted !== false };
    const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { env, cwd: w.repo, encoding: 'utf8' }).trim();
    await writeFile(path.join(w.home, '.claude.json'), JSON.stringify({
      hasCompletedOnboarding: true,
      projects: {
        [w.repo]: trust,
        [w.repo.replaceAll('\\', '/')]: trust,
        [await realpath(w.repo)]: trust,
        [gitRoot]: trust,
      },
    }));
    messages = [];
    const child = spawn(runtime, ['-p', 'Run the isolated fixture.', '--output-format', 'json', '--permission-mode', 'manual', '--permission-prompts', 'none', '--no-session-persistence', '--tools', 'Bash', '--strict-mcp-config', '--system-prompt', 'Use the fixture tool.'], { cwd: w.repo, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '', errors = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    try {
      const [status] = await once(child, 'close');
      if (scenario.startupBlocked) {
        assert.notEqual(status, 0, errors);
        assert.equal(messages.length, 0);
        assert.match(errors + output, /managed.settings|policy/i);
        const report = await inspect();
        assert.ok(report.findings.some(finding => finding.ruleId === 'claude.managed-policy-invalid'));
        assert.ok(report.clients[0].extensions.every(extension => !['active', 'conditional'].includes(extension.status)));
        return;
      }
      assert.equal(status, 0, errors);
      assert.equal(messages.length, 2);
      assert.equal(JSON.parse(output).is_error, false);
      assert.equal(await readFile(path.join(w.repo, marker), 'utf8').catch(() => null), scenario.allowed ? 'permission-fixture' : null, errors);
      if (scenario.removed) assert.ok(!messages[0].tools.some((tool: any) => tool.name === 'Bash'));
      if (scenario.rule === 'permission.ask-overrides-allow') assert.equal(JSON.parse(output).permission_denials.length, 1);
      const report = await inspect();
      const allow = report.clients[0].extensions.find(extension => extension.kind === 'permission' && extension.config.action === 'allow')!;
      if (scenario.rejected) {
        assert.equal(allow, undefined);
        assert.ok(report.clients[0].decisions.some(decision => decision.path === path.join(w.home, '.claude/settings.json') && decision.status === 'invalid'));
      } else if (scenario.noAllow) assert.equal(allow, undefined);
      else assert.equal(allow.status, scenario.status ?? (scenario.allowed ? 'active' : 'shadowed'));
      if (scenario.rule) assert.ok(report.findings.some(finding => finding.ruleId === scenario.rule));
      else assert.ok(!report.findings.some(finding => finding.ruleId.startsWith('permission.')));
      if (scenario.blockingRule) {
        const blocked = report.findings.find(finding => finding.ruleId === scenario.rule)!;
        assert.equal(blocked.related[0].key, scenario.blockingRule.key);
        assert.equal(blocked.related[0].line, scenario.blockingRule.line);
      }
      if (scenario.effectiveDeny) assert.deepEqual(report.clients[0].settings.find(setting => setting.key === 'permissions.deny' && setting.status === 'active')?.value, scenario.effectiveDeny);
      for (const scope of scenario.hookScopes ?? []) {
        const ran = scenario.hooksRun?.includes(scope) ?? false;
        assert.equal(await readFile(path.join(w.repo, `hook-${scope}.txt`), 'utf8').catch(() => null), ran ? 'hook-fixture' : null, scope);
        const hook = report.clients[0].extensions.find(extension => extension.kind === 'hook' && String(extension.config.command).includes(`hook-${scope}.txt`))!;
        if (scenario.rejected && scope === 'user') { assert.equal(hook, undefined); continue; }
        assert.equal(hook.status, ran ? 'active' : 'ignored', scope);
        if (!ran) assert.ok(hook.origins?.[0].location.key);
      }
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

test('Claude personal MCP approval retains its scope inside a wider inspection boundary', { timeout: 30000 }, async t => {
  const w = await workspace({ 'server.mjs': fixtureServer }, { '.claude/settings.json': '{"enableAllProjectMcpServers":true}' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const env = isolatedEnvironment(w.home);
  await writeFile(path.join(w.root, '.mcp.json'), JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: [path.join(w.repo, 'server.mjs')] } } }));
  const actual = readServer(w.root, env);
  assert.equal(actual.status, 0, actual.text);
  assert.match(actual.text, /Connected/);
  const report = await scan({ ...w, repo: w.root, target: 'index.ts', clients: ['claude'] });
  assert.equal(report.clients[0].extensions.find(extension => extension.name === 'fixture')?.status, 'active');
  assert.equal(report.sources.find(source => source.path === path.join(w.home, '.claude/settings.json'))?.scope, 'user');
});

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

test('Claude native MCP loading leaves malformed sibling project configuration outside the current scope', async t => {
  const w = await workspace({
    '.mcp.json': '{"mcpServers":{"fixture":{"type":"http","url":"https://127.0.0.1:1/mcp"}}}',
    'sibling/.mcp.json': '{ broken MCP JSON',
    'sibling/.claude/settings.local.json': '{ broken settings JSON',
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const actual = readServer(w.repo, isolatedEnvironment(w.home));
  assert.equal(actual.status, 0, actual.text);
  assert.match(actual.text, /Scope: Project config/);
  const report = await scan({ ...w, clients: ['claude'], user: false });
  assert.equal(report.clients[0].extensions.find(extension => extension.name === 'fixture')?.status, 'conditional');
  assert.ok(!report.findings.some(finding => finding.ruleId.startsWith('parse.')));
  const sibling = await scan({ ...w, repo: path.join(w.repo, 'sibling'), clients: ['claude'], user: false });
  assert.ok(sibling.findings.some(finding => finding.ruleId === 'parse.json'));
});

test('Claude native MCP policy matching agrees with public scans and explicit probes', { timeout: 90000 }, async t => {
  const w = await workspace({ '.mcp.json': '{}', '.claude/settings.json': '{}', 'server.mjs': fixtureServer }, { '.claude/settings.json': '{}' });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  const env = { ...isolatedEnvironment(w.home), SIGHTLINE_POLICY_COMMAND: process.execPath, SIGHTLINE_POLICY_HOST: '127.0.0.1', SIGHTLINE_POLICY_PORT: '1', SIGHTLINE_POLICY_WILDCARD: '*', SIGHTLINE_POLICY_PATH: 'api/Mcp:2', SIGHTLINE_POLICY_PARENT: '../Mcp' };
  const command = [process.execPath, path.join(w.repo, 'server.mjs')];
  const stdio = { command: command[0], args: command.slice(1) };
  const remote = { type: 'http', url: 'https://127.0.0.1:1/Mcp' };
  const cases: { name: string; config?: Record<string, unknown>; user?: Record<string, unknown>; project?: Record<string, unknown>; allowed: boolean }[] = [
    { name: 'unset allowlist', allowed: true },
    { name: 'empty allowlist', user: { allowedMcpServers: [] }, allowed: false },
    { name: 'matching name', user: { allowedMcpServers: [{ serverName: 'fixture' }] }, allowed: true },
    { name: 'names are literal', user: { allowedMcpServers: [{ serverName: 'fixt*' }] }, allowed: false },
    { name: 'name denial beats allow', user: { allowedMcpServers: [{ serverName: 'fixture' }], deniedMcpServers: [{ serverName: 'fixture' }] }, allowed: false },
    { name: 'scope allowlists merge', user: { allowedMcpServers: [] }, project: { allowedMcpServers: [{ serverName: 'fixture' }] }, allowed: true },
    { name: 'ordinary managed lock is ignored', user: { allowedMcpServers: [{ serverName: 'fixture' }], allowManagedMcpServersOnly: true }, allowed: true },
    { name: 'exact command', config: stdio, user: { allowedMcpServers: [{ serverCommand: command }] }, allowed: true },
    { name: 'command arguments differ', config: stdio, user: { allowedMcpServers: [{ serverCommand: [command[0]] }] }, allowed: false },
    { name: 'command entry supersedes name', config: stdio, user: { allowedMcpServers: [{ serverName: 'fixture' }, { serverCommand: ['different-command'] }] }, allowed: false },
    { name: 'URL entry leaves stdio name eligible', config: stdio, user: { allowedMcpServers: [{ serverName: 'fixture' }, { serverUrl: 'https://different.test' }] }, allowed: true },
    { name: 'command env expands', config: stdio, user: { allowedMcpServers: [{ serverCommand: ['${SIGHTLINE_POLICY_COMMAND}', command[1]] }] }, allowed: true },
    { name: 'command env block is not compared', config: { ...stdio, env: { FIXTURE: 'different' } }, user: { allowedMcpServers: [{ serverCommand: command }] }, allowed: true },
    { name: 'missing command env default', config: stdio, user: { allowedMcpServers: [{ serverCommand: ['${SIGHTLINE_MISSING_COMMAND:-' + command[0] + '}', command[1]] }] }, allowed: true },
    { name: 'exact URL', user: { allowedMcpServers: [{ serverUrl: remote.url }] }, allowed: true },
    { name: 'URL entry supersedes name', user: { allowedMcpServers: [{ serverName: 'fixture' }, { serverUrl: 'https://different.test' }] }, allowed: false },
    { name: 'command entry leaves remote name eligible', user: { allowedMcpServers: [{ serverName: 'fixture' }, { serverCommand: ['different-command'] }] }, allowed: true },
    { name: 'exact host without port uses default', user: { allowedMcpServers: [{ serverUrl: 'https://127.0.0.1/*' }] }, allowed: false },
    { name: 'wildcard port', user: { allowedMcpServers: [{ serverUrl: 'https://127.0.0.1:*/*' }] }, allowed: true },
    { name: 'wildcard host includes nondefault port', user: { allowedMcpServers: [{ serverUrl: 'https://127.*/*' }] }, allowed: true },
    { name: 'no path matches any path', user: { allowedMcpServers: [{ serverUrl: 'https://127.0.0.1:1' }] }, allowed: true },
    { name: 'path case differs', user: { allowedMcpServers: [{ serverUrl: 'https://127.0.0.1:1/mcp' }] }, allowed: false },
    { name: 'query is part of path matching', config: { ...remote, url: remote.url + '?key=value' }, user: { allowedMcpServers: [{ serverUrl: remote.url }] }, allowed: false },
    { name: 'query wildcard matches', config: { ...remote, url: remote.url + '?key=value' }, user: { allowedMcpServers: [{ serverUrl: remote.url + '?key=*' }] }, allowed: true },
    { name: 'fragments are ignored', config: { ...remote, url: remote.url + '#actual' }, user: { allowedMcpServers: [{ serverUrl: remote.url + '#different' }] }, allowed: true },
    { name: 'literal dot segments normalize', user: { allowedMcpServers: [{ serverUrl: 'https://127.0.0.1:1/api/../Mcp' }] }, allowed: true },
    { name: 'safe path expansion includes slash and colon', config: { ...remote, url: 'https://127.0.0.1:1/api/Mcp:2' }, user: { allowedMcpServers: [{ serverUrl: 'https://127.0.0.1:1/${SIGHTLINE_POLICY_PATH}' }] }, allowed: true },
    { name: 'path expansion cannot traverse to parent', user: { allowedMcpServers: [{ serverUrl: 'https://127.0.0.1:1/api/${SIGHTLINE_POLICY_PARENT}' }] }, allowed: false },
    { name: 'scheme wildcard', user: { allowedMcpServers: [{ serverUrl: '*://127.0.0.1:*/*' }] }, allowed: true },
    { name: 'default port normalization', config: { type: 'http', url: 'https://127.0.0.1:443/Mcp' }, user: { allowedMcpServers: [{ serverUrl: 'https://127.0.0.1/Mcp' }] }, allowed: true },
    { name: 'host case and trailing dot', config: { type: 'http', url: 'https://LOCALHOST.:1/Mcp' }, user: { allowedMcpServers: [{ serverUrl: 'https://localhost:*/*' }] }, allowed: true },
    { name: 'URL denial ignores default-port mismatch', user: { deniedMcpServers: [{ serverUrl: 'https://127.0.0.1/*' }] }, allowed: true },
    { name: 'URL denial any port', user: { deniedMcpServers: [{ serverUrl: '*://127.0.0.1:*/*' }] }, allowed: false },
    { name: 'policy host and port env', user: { allowedMcpServers: [{ serverUrl: 'https://${SIGHTLINE_POLICY_HOST}:${SIGHTLINE_POLICY_PORT}/*' }] }, allowed: true },
    { name: 'allow URL env cannot add wildcard scope', user: { allowedMcpServers: [{ serverUrl: 'https://${SIGHTLINE_POLICY_WILDCARD}:*/*' }] }, allowed: false },
    { name: 'deny URL env can widen scope', user: { deniedMcpServers: [{ serverUrl: 'https://${SIGHTLINE_POLICY_WILDCARD}:*/*' }] }, allowed: false },
    { name: 'user env fills live server', config: { type: 'http', url: 'https://${SIGHTLINE_USER_HOST}:1/Mcp' }, user: { env: { SIGHTLINE_USER_HOST: '127.0.0.1' }, allowedMcpServers: [{ serverUrl: remote.url }] }, allowed: true },
    { name: 'user env cannot broaden allow policy', user: { env: { SIGHTLINE_USER_HOST: '127.0.0.1' }, allowedMcpServers: [{ serverUrl: 'https://${SIGHTLINE_USER_HOST}:1/Mcp' }] }, allowed: false },
    { name: 'user env can broaden deny policy', user: { env: { SIGHTLINE_USER_HOST: '127.0.0.1' }, deniedMcpServers: [{ serverUrl: 'https://${SIGHTLINE_USER_HOST}:1/Mcp' }] }, allowed: false },
    { name: 'project env cannot broaden deny policy', project: { env: { SIGHTLINE_USER_HOST: '127.0.0.1' }, deniedMcpServers: [{ serverUrl: 'https://${SIGHTLINE_USER_HOST}:1/Mcp' }] }, allowed: true },
  ];
  for (const scenario of cases) await t.test(scenario.name, async () => {
    await writeFile(path.join(w.repo, '.mcp.json'), JSON.stringify({ mcpServers: { fixture: scenario.config ?? remote } }));
    await writeFile(path.join(w.home, '.claude/settings.json'), JSON.stringify({ enableAllProjectMcpServers: true, ...scenario.user }));
    await writeFile(path.join(w.repo, '.claude/settings.json'), JSON.stringify(scenario.project ?? {}));
    const native = readServer(w.repo, env);
    assert.equal(native.status, scenario.allowed ? 0 : 1, native.text);
    const report = await scan({ ...w, env, clients: ['claude'], trust: 'trusted', probe: true });
    const extension = report.clients[0].extensions.find(extension => extension.name === 'fixture')!;
    assert.equal(extension.status, scenario.allowed ? 'active' : 'ignored');
    if (!scenario.allowed) assert.ok(!report.findings.some(finding => finding.ruleId.startsWith('probe.') || finding.ruleId === 'mcp.command-missing'));
  });
});

test('Claude native managed MCP files agree with SDK, built CLI and portable reports', { timeout: 90000, skip: process.env.SIGHTLINE_TEST_MANAGED_POLICY !== '1' }, async t => {
  assert.equal(process.platform, 'linux');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  const managedRoot = '/etc/claude-code';
  assert.deepEqual(await readdir(managedRoot), [], 'Native managed MCP checks require the isolated empty CI policy directory.');
  const remote = { type: 'http', url: 'https://127.0.0.1:1/Mcp' };
  const cases: { name: string; managed?: Record<string, unknown>; user?: Record<string, unknown>; project?: Record<string, unknown>; dropins?: Record<string, unknown>; exclusive?: unknown; raw?: string; config?: Record<string, unknown>; unreadable?: boolean; directory?: boolean; brokenSymlink?: boolean; allowed: boolean; source?: string }[] = [
    { name: 'managed empty allowlist', managed: { allowedMcpServers: [] }, allowed: false },
    { name: 'ordinary allowlist broadens managed list without lock', managed: { allowedMcpServers: [] }, user: { allowedMcpServers: [{ serverName: 'fixture' }] }, allowed: true },
    { name: 'managed-only lock excludes ordinary allowlist', managed: { allowedMcpServers: [], allowManagedMcpServersOnly: true }, user: { allowedMcpServers: [{ serverName: 'fixture' }] }, allowed: false },
    { name: 'managed-only quoted false unlocks ordinary list', managed: { allowedMcpServers: [], allowManagedMcpServersOnly: 'false' }, user: { allowedMcpServers: [{ serverName: 'fixture' }] }, allowed: true },
    { name: 'invalid managed lock fails closed', managed: { allowedMcpServers: [], allowManagedMcpServersOnly: 42 }, user: { allowedMcpServers: [{ serverName: 'fixture' }] }, allowed: false },
    { name: 'managed allowlist repair fails closed', managed: { allowedMcpServers: 42 }, allowed: false },
    { name: 'managed allowlist drops invalid predecessor', managed: { allowedMcpServers: [42, { serverName: 'fixture' }] }, allowed: true },
    { name: 'managed denylist drops invalid predecessor', managed: { deniedMcpServers: [42, { serverName: 'fixture' }] }, allowed: false },
    { name: 'invalid managed denylist is dropped', managed: { deniedMcpServers: 42 }, allowed: true },
    { name: 'null managed allowlist fails closed', managed: { allowedMcpServers: null }, allowed: false },
    { name: 'file allowlists merge with dropins', managed: { allowedMcpServers: [] }, dropins: { '20-allow.json': { allowedMcpServers: [{ serverName: 'fixture' }] } }, allowed: true },
    { name: 'provided server bypasses allowlist', managed: { managedMcpServers: { fixture: remote }, allowedMcpServers: [] }, allowed: true, source: 'managed-settings.json' },
    { name: 'provided HTTP alias', managed: { managedMcpServers: { fixture: { ...remote, type: 'streamable-http' } }, allowedMcpServers: [] }, allowed: true, source: 'managed-settings.json' },
    { name: 'personal denial blocks provided server', managed: { managedMcpServers: { fixture: remote }, allowedMcpServers: [] }, user: { deniedMcpServers: [{ serverName: 'fixture' }] }, allowed: false },
    { name: 'invalid provided HTTP falls back to project', managed: { managedMcpServers: { fixture: { ...remote, url: 'http://127.0.0.1:1/Mcp' } } }, allowed: true, source: '.mcp.json' },
    { name: 'invalid provided env falls back to project', managed: { managedMcpServers: { fixture: { ...remote, env: {} } } }, allowed: true, source: '.mcp.json' },
    { name: 'provided entries replace whole across dropins', managed: { managedMcpServers: { fixture: { ...remote, headers: { 'X-Test': 'synthetic-key' } } } }, dropins: { '20-replace.json': { managedMcpServers: { fixture: { ...remote, type: 'sse' } } } }, allowed: true, source: '20-replace.json' },
    { name: 'empty exclusive file removes personal servers', exclusive: { mcpServers: {} }, allowed: false },
    { name: 'exclusive server bypasses empty allowlist', exclusive: { mcpServers: { fixture: remote } }, managed: { allowedMcpServers: [] }, allowed: true, source: 'managed-mcp.json' },
    { name: 'personal denial blocks exclusive server', exclusive: { mcpServers: { fixture: remote } }, user: { deniedMcpServers: [{ serverName: 'fixture' }] }, allowed: false },
    { name: 'exclusive file takes priority over provided server', exclusive: { mcpServers: { fixture: remote } }, managed: { managedMcpServers: { fixture: { ...remote, type: 'sse' } } }, allowed: true, source: 'managed-mcp.json' },
    { name: 'empty exclusive retains provided server', exclusive: { mcpServers: {} }, managed: { managedMcpServers: { fixture: remote }, allowedMcpServers: [] }, allowed: true, source: 'managed-settings.json' },
    { name: 'exclusive outside-env expansion requires allowlist', exclusive: { mcpServers: { fixture: { type: 'http', url: 'https://${SIGHTLINE_MANAGED_HOST}:1/Mcp' } } }, managed: { allowedMcpServers: [] }, allowed: false },
    { name: 'malformed exclusive file suppresses project', raw: '{ broken JSON', allowed: false },
    { name: 'exclusive file without server map suppresses project', exclusive: {}, allowed: false },
    { name: 'exclusive invalid server map suppresses project', exclusive: { mcpServers: 42 }, allowed: false },
    { name: 'empty exclusive file suppresses project', raw: '', allowed: false },
    { name: 'nonobject exclusive file suppresses project', exclusive: [], allowed: false },
    { name: 'malformed exclusive file retains provided server', raw: '{ broken JSON', managed: { managedMcpServers: { fixture: remote } }, allowed: true, source: 'managed-settings.json' },
    { name: 'unreadable exclusive file suppresses project', exclusive: { mcpServers: { fixture: remote } }, unreadable: true, allowed: false },
    { name: 'directory-shaped exclusive path suppresses project', directory: true, allowed: false },
    { name: 'broken exclusive symlink leaves project available', brokenSymlink: true, allowed: true, source: '.mcp.json' },
  ];
  for (const scenario of cases) await t.test(scenario.name, async scenarioTest => {
    const w = await workspace({ '.mcp.json': JSON.stringify({ mcpServers: { fixture: scenario.config ?? remote } }), '.claude/settings.json': JSON.stringify(scenario.project ?? {}) }, { '.claude/settings.json': JSON.stringify({ enableAllProjectMcpServers: true, ...scenario.user }) });
    scenarioTest.after(async () => {
      await rm(w.root, { recursive: true, force: true, maxRetries: 5 });
      for (const name of ['managed-settings.json', 'managed-mcp.json', 'managed-settings.d']) await rm(path.join(managedRoot, name), { recursive: true, force: true, maxRetries: 5 });
    });
    await writeFile(path.join(managedRoot, 'managed-settings.json'), JSON.stringify(scenario.managed ?? {}, null, 2));
    if (scenario.raw !== undefined || scenario.exclusive !== undefined) await writeFile(path.join(managedRoot, 'managed-mcp.json'), scenario.raw ?? JSON.stringify(scenario.exclusive));
    if (scenario.unreadable) await chmod(path.join(managedRoot, 'managed-mcp.json'), 0o000);
    if (scenario.directory) await mkdir(path.join(managedRoot, 'managed-mcp.json'));
    if (scenario.brokenSymlink) await symlink(path.join(w.root, 'missing-exclusive.json'), path.join(managedRoot, 'managed-mcp.json'));
    if (scenario.dropins) {
      await mkdir(path.join(managedRoot, 'managed-settings.d'));
      for (const [name, value] of Object.entries(scenario.dropins)) await writeFile(path.join(managedRoot, 'managed-settings.d', name), JSON.stringify(value));
    }
    const env = { ...isolatedEnvironment(w.home), SIGHTLINE_MANAGED_HOST: '127.0.0.1' };
    const native = readServer(w.repo, env);
    assert.equal(native.status, scenario.allowed ? 0 : 1, native.text);
    const report = await scan({ ...w, env, system: true, clients: ['claude'], trust: 'trusted' });
    const active = report.clients[0].extensions.filter(extension => extension.kind === 'mcp' && extension.status === 'active');
    assert.equal(active.length, scenario.allowed ? 1 : 0);
    if (scenario.source) assert.ok(active[0].location.path.endsWith(scenario.source));
    const cli = JSON.parse(execFileSync(process.execPath, [path.resolve('dist/cli/index.js'), '--repo', w.repo, '--home', w.home, '--system', '--client', 'claude', '--trust', 'trusted', '--json'], { env, encoding: 'utf8' }));
    assert.deepEqual(cli.clients[0].extensions, report.clients[0].extensions);
    if (scenario.name === 'managed denylist drops invalid predecessor') {
      const blocked = report.clients[0].extensions.find(extension => extension.status === 'ignored')!;
      assert.ok(blocked.origins?.some(origin => origin.location.key === 'deniedMcpServers.1' && origin.location.line === 4));
      const file = path.join(w.root, 'policy.html');
      execFileSync(process.execPath, [path.resolve('dist/cli/index.js'), 'report', '--repo', w.repo, '--home', w.home, '--system', '--client', 'claude', '--trust', 'trusted', '--format', 'html', '--output', file], { env });
      const exported = await readFile(file, 'utf8');
      assert.ok(!exported.includes(JSON.stringify(w.home).slice(1, -1)));
      assert.ok(exported.includes('deniedMcpServers.1'));
    }
  });
});
