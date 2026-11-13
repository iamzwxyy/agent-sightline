import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { scan } from '../packages/core/index.js';
import { copilotMetadata } from '../packages/adapters/copilot.js';
import { flatten } from '../packages/adapters/common.js';
import { copilotPersonalKeys, normalizeCopilotSettings } from '../packages/adapters/copilot-aliases.js';
import { fixture, workspace } from './helpers.js';

const require = createRequire(import.meta.url);
const runtimePackage = require('@github/copilot/package.json');
const runtime = path.join(path.dirname(require.resolve('@github/copilot/package.json')), runtimePackage.bin.copilot);

function isolatedEnvironment(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH, PATHEXT: process.env.PATHEXT, SystemRoot: process.env.SystemRoot,
    COMSPEC: process.env.COMSPEC, TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR,
    HOME: home, USERPROFILE: home, COPILOT_HOME: path.join(home, '.copilot'),
    COPILOT_CACHE_HOME: path.join(home, '.cache/copilot'),
    APPDATA: path.join(home, 'AppData/Roaming'), LOCALAPPDATA: path.join(home, 'AppData/Local'),
    XDG_CONFIG_HOME: path.join(home, '.config'), GIT_CONFIG_NOSYSTEM: '1', NO_COLOR: '1',
  };
}

async function withRuntime(home: string, cwd: string, run: (request: (method: string, params?: Record<string, unknown>) => Promise<any>) => Promise<void>): Promise<void> {
  const env = isolatedEnvironment(home);
  const child = spawn(process.execPath, [runtime, '--headless', '--stdio', '--no-auto-login', '--no-auto-update'], { env, cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let buffer = Buffer.alloc(0);
  let requestId = 0;
  let finished = false;
  const fail = (error: Error) => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); } pending.clear(); };
  const closed = new Promise<void>(resolve => child.once('close', () => { finished = true; fail(new Error('Copilot closed before replying.')); resolve(); }));
  child.once('error', fail); child.stdin.on('error', fail);
  child.stderr.on('data', () => { /* Native logs remain inside the isolated runtime. */ });
  child.stdout.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const end = buffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      const length = Number(buffer.subarray(0, end).toString().match(/Content-Length: (\d+)/i)?.[1]);
      if (!Number.isSafeInteger(length) || length < 1) { fail(new Error('Invalid Copilot message header.')); return; }
      if (buffer.length < end + 4 + length) return;
      let message;
      try { message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString()); }
      catch { fail(new Error('Invalid Copilot message body.')); return; }
      buffer = buffer.subarray(end + 4 + length);
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id); clearTimeout(request.timer);
      if (message.error) request.reject(new Error(`Copilot rejected ${message.error.code}.`));
      else request.resolve(message.result);
    }
  });
  const request = (method: string, params: Record<string, unknown> = {}): Promise<any> => new Promise((resolve, reject) => {
    const id = ++requestId;
    const timeout = method === 'connect' ? 30000 : 15000;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Copilot timed out during ${method}.`)); }, timeout);
    pending.set(id, { resolve, reject, timer });
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  });
  try {
    const connected = await request('connect');
    assert.equal(connected.version, copilotMetadata.ruleVersion);
    await run(request);
  } finally {
    child.stdin.end();
    const timer = setTimeout(() => {
      if (finished || !child.pid) return;
      if (process.platform === 'win32') {
        const killer = spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        killer.once('error', () => child.kill('SIGKILL'));
      } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    }, 1000);
    await closed; clearTimeout(timer);
  }
}

test('Copilot conformance uses the pinned native CLI', () => {
  assert.equal(runtimePackage.version, copilotMetadata.ruleVersion);
  assert.match(execFileSync(process.execPath, [runtime, '--version'], { encoding: 'utf8', timeout: 15000 }), /CLI 1\.0\.110\./);
});

test('Copilot aliases match the native registered catalog, normalization and personal file loading', async t => {
  const w = await workspace({}, { '.copilot/settings.json': '{}' });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  await withRuntime(w.home, w.repo, async request => {
    const catalog = (await request('user.settings.get')).settings;
    assert.deepEqual([...copilotPersonalKeys].sort(), Object.keys(catalog).sort());
    const registered = await fixture('copilot/aliases.json');
    assert.equal(registered.version, copilotMetadata.ruleVersion);
    assert.deepEqual(normalizeCopilotSettings(registered.input).data, registered.expected);
    assert.deepEqual((await request('user.settings.normalize', { settings: registered.input })).settings, registered.expected);
    const repositoryAliases = await request('user.settings.mergeRepoValue', {
      userSettings: { disableAllHooks: false },
      repoSettings: { disable_all_hooks: true, disabled_mcp_servers: ['fixture'], skill_directories: ['fixture'] },
    });
    assert.deepEqual(repositoryAliases.settingsJson, { disableAllHooks: false });
    const snake = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
    const inputs = [
      Object.fromEntries(Object.keys(catalog).map(key => [snake(key), `alias:${key}`])),
      { theme: 'github', colorMode: 'default', color_mode: 'dim' },
      { color_mode: 'dim', colorMode: 'default', theme: 'github' },
      { disableAllHooks: false, disable_all_hooks: true },
      { disable_all_hooks: true, disableAllHooks: false },
      { disable_all_hooks: true, disableAllHooks: null },
      { disableAllHooks: 42, disable_all_hooks: true },
      { sidebar: { show_header_buttons: false, showHeaderButtons: true, ctrl_ccloses_session: true, unknown_key: true }, custom_agents: { default_local_only: true }, footer: { show_ai_used: false } },
      { sandbox: { user_policy: { filesystem: { readwrite_paths: ['fixture'] }, network: { allow_outbound: false } }, credentials: { env_vars: { KEEP_THIS_ENV: { inject_hosts: ['example.test'] } } } }, subagents: { agents: { keep_this_name: { effort_level: 'high' } }, max_depth: 2 }, workflows: { default_limits: { max_ai_credits: 40, max_turns: 2 } } },
      { enabled_plugins: { keep_this_plugin: true }, extra_known_marketplaces: { keep_this_market: { auto_update: true, source: { source: 'github', repo: 'example/fixture' } } }, hooks: { session_start: [{ timeout_sec: 1, env: { KEEP_THIS_ENV: 'fixture' } }] }, unknown_key: { disable_all_hooks: true }, featureFlags: ['fixture'] },
    ];
    for (const input of inputs) assert.deepEqual(normalizeCopilotSettings(input).data, (await request('user.settings.normalize', { settings: input })).settings);
    for (const input of [
      { disable_all_hooks: true, disabled_mcp_servers: ['fixture'], show_reasoning: true, color_mode: 'dim' },
      { disableAllHooks: false, disable_all_hooks: true },
      { disable_all_hooks: true, disableAllHooks: false },
      { colorMode: 'dim', theme: 'github' },
      { theme: 'github', colorMode: 'dim' },
      { disabled_skills: ['fixture'], context_tier: 'long_context', effort_level: 'high', enabled_plugins: { keep_this_name: true } },
      { disable_all_hooks: true, disableAllHooks: 42, showReasoning: true },
      { disableAllHooks: null, disable_all_hooks: true, showReasoning: true },
      { disableAllHooks: true, disable_all_hooks: 42, disabled_mcp_servers: ['fixture'], show_reasoning: true },
      { disabled_mcp_servers: ['fixture'], disabledMcpServers: [42], showReasoning: true },
      { disabledMcpServers: ['fixture'], disabled_mcp_servers: [42], showReasoning: true },
      { effortLevel: null, effort_level: 'high', contextTier: null, context_tier: 'long_context', theme: null, color_mode: 'dim' },
      { effort_level: null, context_tier: null, color_mode: null, showReasoning: true },
      { colorMode: 42, showReasoning: true },
      { theme: 42, showReasoning: true },
      { color_mode: 42, showReasoning: true },
    ]) {
      await writeFile(path.join(w.home, '.copilot/settings.json'), JSON.stringify(input));
      const native = (await request('user.settings.get')).settings;
      const report = await scan({ ...w, clients: ['copilot'] });
      assert.deepEqual(
        Object.fromEntries(report.clients[0].settings.filter(setting => setting.status === 'active').map(setting => [setting.key, setting.value])),
        Object.fromEntries(Object.entries(native).filter(([, setting]: [string, any]) => !setting.isDefault).flatMap(([key, setting]: [string, any]) => flatten({ [key]: setting.value }))), JSON.stringify(input),
      );
    }
  });
});

const cases: { name: string; user: Record<string, unknown>; repo: Record<string, unknown>; local?: Record<string, unknown> }[] = [
  { name: 'scalar replacements', user: { model: 'user', effortLevel: 'low', contextTier: 'default', includeCoAuthoredBy: true, mergeStrategy: 'merge', disableAllHooks: true }, repo: { model: 'repo', effortLevel: 'high', contextTier: 'long_context', includeCoAuthoredBy: false, mergeStrategy: 'rebase', disableAllHooks: false } },
  { name: 'restriction unions', user: { deniedUrls: ['user.example'], disabledMcpServers: ['user'], disabledSkills: ['User', 'same'] }, repo: { deniedUrls: ['repo.example', 'user.example'], disabledMcpServers: ['repo'], disabledSkills: ['repo', 'same', 'user'] } },
  { name: 'empty restriction arrays', user: { deniedUrls: ['user.example'], disabledMcpServers: ['user'], disabledSkills: ['user'] }, repo: { deniedUrls: [], disabledMcpServers: [], disabledSkills: [] } },
  { name: 'default respectGitignore', user: {}, repo: { respectGitignore: false } },
  { name: 'personal respectGitignore opt-out', user: { respectGitignore: false }, repo: { respectGitignore: false } },
  { name: 'repository respectGitignore restriction', user: { respectGitignore: false }, repo: { respectGitignore: true } },
  { name: 'retained respectGitignore restriction', user: { respectGitignore: true }, repo: { respectGitignore: false } },
  { name: 'announcements replace', user: { companyAnnouncements: ['personal'] }, repo: { companyAnnouncements: [] } },
  { name: 'per-plugin replacement', user: { enabledPlugins: { retained: true, replaced: true } }, repo: { enabledPlugins: { replaced: false, added: true } } },
  { name: 'whole marketplace-entry replacement', user: { extraKnownMarketplaces: { retained: { source: { source: 'directory', path: 'retained' } }, replaced: { source: { source: 'directory', path: 'personal' }, autoUpdate: true } } }, repo: { extraKnownMarketplaces: { replaced: { source: { source: 'directory', path: 'repository' } } } } },
  { name: 'hooks concatenate', user: { hooks: { sessionStart: [{ bash: 'echo personal', powershell: 'echo personal' }] } }, repo: { hooks: { sessionStart: [{ bash: 'echo repository', powershell: 'echo repository' }], sessionEnd: [{ command: 'echo ended' }] } } },
  { name: 'local layer keeps repository restrictions', user: { model: 'personal', disabledSkills: ['personal'], enabledPlugins: { retained: true, replaced: true } }, repo: { model: 'repo', disabledSkills: ['repo'], enabledPlugins: { replaced: false } }, local: { model: 'local', disabledSkills: ['local'], enabledPlugins: { replaced: true } } },
  { name: 'unsupported repository keys', user: { theme: 'github', autoUpdate: false }, repo: { theme: 'dim', autoUpdate: true, misspelledSetting: true } },
];

test('Copilot repository folds match the native configuration API', async t => {
  const runtimeWorkspace = await workspace();
  t.after(() => rm(runtimeWorkspace.root, { recursive: true, force: true, maxRetries: 5 }));
  await withRuntime(runtimeWorkspace.home, runtimeWorkspace.repo, async request => {
    for (const scenario of cases) await t.test(scenario.name, async scenarioTest => {
      const w = await workspace({ '.github/copilot/settings.json': JSON.stringify(scenario.repo), ...(scenario.local ? { '.github/copilot/settings.local.json': JSON.stringify(scenario.local) } : {}) }, { '.copilot/settings.json': JSON.stringify(scenario.user) });
      scenarioTest.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
      const repository = await request('user.settings.mergeRepoValue', { userSettings: scenario.user, repoSettings: scenario.repo });
      const native = scenario.local ? await request('user.settings.mergeRepoValue', { userSettings: repository.settingsJson, repoSettings: scenario.local }) : repository;
      const report = await scan({ ...w, clients: ['copilot'], trust: 'trusted' });
      const selected = Object.fromEntries(report.clients[0].settings.filter(setting => setting.status === 'active').map(setting => [setting.key, setting.value]));
      assert.deepEqual(selected, Object.fromEntries(flatten(native.settingsJson)));
    });
  });
});

test('Copilot native validation agrees on supported setting value types', async t => {
  const w = await workspace({}, { '.copilot/settings.json': '{}' });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  await withRuntime(w.home, w.repo, async request => {
    for (const [topKey, value, expected] of [
      ['disabledSkills', ['valid'], true], ['disabledSkills', [42], false],
      ['ignoredSkillsLocations', ['~/skills'], true], ['ignoredSkillsLocations', [42], false],
      ['ignoredSkillsLocations', null, false], ['ignoredSkillsLocations', 'skills', false],
      ['disabledMcpServers', [], true], ['disabledMcpServers', false, false],
      ['deniedUrls', ['example.test'], true], ['deniedUrls', [false], false],
      ['model', 'custom-model', true], ['model', 42, false],
      ['effortLevel', 'custom-level', true], ['contextTier', 'custom-tier', true],
      ['disableAllHooks', false, true], ['disableAllHooks', 'false', false],
      ['enabledPlugins', { fixture: true }, true], ['enabledPlugins', { fixture: 'yes' }, false],
      ['respectGitignore', false, true], ['respectGitignore', 0, false],
      ['companyAnnouncements', [], true], ['companyAnnouncements', [false], false],
      ['includeCoAuthoredBy', false, true], ['includeCoAuthoredBy', 'false', false],
      ['mergeStrategy', 'rebase', true], ['mergeStrategy', 'invalid', false],
      ['extraKnownMarketplaces', { fixture: { source: { source: 'directory', path: 'fixture' } } }, true],
      ['extraKnownMarketplaces', { fixture: {} }, false],
      ['extraKnownMarketplaces', { fixture: { source: { source: 'github', repo: 'example/fixture' }, autoUpdate: 'true' } }, false],
      ['hooks', { sessionStart: [{ command: 'echo fixture' }] }, true],
      ['hooks', { SessionStart: [{ hooks: [{ type: 'command', command: 'echo fixture' }] }] }, true],
      ['hooks', { sessionStart: [{ exec: 'node', args: [] }] }, true],
      ['hooks', { sessionStart: [{ exec: 'node', command: 'echo fixture' }] }, false],
      ['hooks', { sessionStart: [{ type: 'prompt', prompt: 'fixture' }] }, true],
      ['hooks', { sessionEnd: [{ type: 'prompt', prompt: 'fixture' }] }, false],
      ['hooks', { sessionStart: [{ type: 'http', url: 'https://example.test/hook' }] }, true],
      ['hooks', { sessionStart: [{ command: 'echo fixture', timeoutSec: -1 }] }, false],
      ['hooks', { sessionStart: [{ command: 'echo fixture', env: { NORMAL: 42 } }] }, false],
    ] as const) {
      assert.equal((await request('user.settings.validate', { topKey, value })).ok, expected, topKey);
      await writeFile(path.join(w.home, '.copilot/settings.json'), JSON.stringify({ [topKey]: value }));
      const report = await scan({ ...w, clients: ['copilot'] });
      assert.equal(report.clients[0].settings.some(setting => setting.key === topKey && setting.status === 'invalid'), !expected, `${topKey} static validation`);
    }
  });
});

test('Copilot skill directory exclusions and fallback match the native inventory', async t => {
  const skill = (root: string) => `---\nname: shared\ndescription: Skill from ${root}.\n---\nFixture instructions.\n`;
  const w = await workspace({
    '.github/skills/shared/SKILL.md': skill('github'),
    '.agents/skills/shared/SKILL.md': skill('agents'),
    '.claude/skills/shared/SKILL.md': skill('claude'),
    'src/.github/skills/shared/SKILL.md': skill('nested'),
    'src/refund.ts': '',
  }, {
    '.copilot/skills/shared/SKILL.md': skill('personal-copilot'),
    '.agents/skills/shared/SKILL.md': skill('personal-agents'),
    '.copilot/settings.json': '{}',
  });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  const env = isolatedEnvironment(w.home);
  execFileSync('git', ['-c', 'init.templateDir=', 'init', '--quiet', w.repo], { env });
  const repository = await realpath(w.repo);
  const github = path.join(repository, '.github/skills');
  const agents = path.join(repository, '.agents/skills');
  const scenarios = [
    { name: 'normal priority', settings: {} },
    { name: 'excluded first root', settings: { ignoredSkillsLocations: [github] } },
    { name: 'excluded ancestor', settings: { ignoredSkillsLocations: [path.dirname(github)] } },
    { name: 'excluded first two roots', settings: { ignoredSkillsLocations: [github, agents] } },
    { name: 'personal fallback', settings: { ignoredSkillsLocations: [repository] } },
    { name: 'second personal fallback', settings: { ignoredSkillsLocations: [repository, '~/.copilot/skills'] } },
    { name: 'all conventional roots excluded', settings: { ignoredSkillsLocations: [repository, '~'] } },
    { name: 'skill leaf keeps discovery root', settings: { ignoredSkillsLocations: [path.join(github, 'shared')] } },
    { name: 'relative exclusion keeps absolute root', settings: { ignoredSkillsLocations: ['.github/skills'] } },
    { name: 'path prefix keeps sibling', settings: { ignoredSkillsLocations: [path.join(repository, '.github/sk')] } },
    { name: 'trailing separator', settings: { ignoredSkillsLocations: [github + path.sep] } },
    { name: 'normalized parent segments', settings: { ignoredSkillsLocations: [github + path.sep + '..' + path.sep + 'skills'] } },
    { name: 'personal path spelling', settings: { ignoredSkillsLocations: [repository, path.join(w.home, '.copilot/skills')] } },
    { name: 'registered alias', settings: { ignored_skills_locations: [github] } },
    { name: 'disabled fallback keeps chosen definition', settings: { ignoredSkillsLocations: [github], disabledSkills: ['SHARED'] } },
    { name: 'invalid canonical rejects siblings', settings: { ignoredSkillsLocations: [42], disabledSkills: ['shared'] } },
    { name: 'invalid alias retains canonical siblings', settings: { ignored_skills_locations: [42], disabledSkills: ['shared'] } },
    { name: 'nested first root excluded', settings: { ignoredSkillsLocations: [path.join(repository, 'src/.github/skills')] }, target: 'src/refund.ts' },
    { name: 'inherited root excluded', settings: { ignoredSkillsLocations: [github] }, target: 'src/refund.ts' },
    { name: 'forward slash root', settings: { ignoredSkillsLocations: [github.replaceAll('\\', '/')] } },
    { name: 'forward slash repository', settings: { ignoredSkillsLocations: [repository.replaceAll('\\', '/')] } },
    { name: 'forward slash personal path', settings: { ignoredSkillsLocations: [repository.replaceAll('\\', '/'), path.join(w.home, '.copilot/skills').replaceAll('\\', '/')] } },
    { name: 'supplied repository path', settings: { ignoredSkillsLocations: [path.join(w.repo, '.github/skills')] } },
    { name: 'supplied repository and personal fallback', settings: { ignoredSkillsLocations: [w.repo, '~/.copilot/skills'] } },
  ];
  for (const scenario of scenarios) await t.test(scenario.name, async () => {
    await writeFile(path.join(w.home, '.copilot/settings.json'), JSON.stringify(scenario.settings));
    const native = JSON.parse(execFileSync(process.execPath, [runtime, '--no-auto-update', 'skill', 'list', '--json'], {
      cwd: scenario.target ? path.join(w.repo, 'src') : w.repo, env, encoding: 'utf8', timeout: 30000,
    })).filter((entry: any) => entry.source !== 'builtin');
    const report = await scan({ ...w, clients: ['copilot'], target: scenario.target });
    const selected = report.clients[0].extensions.filter(extension => extension.kind === 'skill' && ['active', 'ignored'].includes(extension.status) && !extension.reason.includes('ignoredSkillsLocations'));
    assert.deepEqual(await Promise.all(selected.map(async extension => ({
      name: extension.name, directory: await realpath(path.dirname(extension.location.path)), enabled: extension.status === 'active',
    }))), await Promise.all(native.map(async (entry: any) => ({ name: entry.name, directory: await realpath(entry.path), enabled: entry.enabled }))));
    for (const excluded of report.clients[0].extensions.filter(extension => extension.kind === 'skill' && extension.reason.includes('ignoredSkillsLocations'))) {
      assert.equal(excluded.status, 'ignored');
      assert.equal(report.clients[0].decisions.find(decision => decision.path === excluded.location.path)?.status, 'ignored');
      assert.ok(!report.findings.some(finding => finding.ruleId === 'skill.name-conflict' && finding.location.path === excluded.location.path));
    }
  });
});

test('Copilot native workspace MCP inventory follows trustedFolders and disabled settings', async t => {
  const fixtureConfig = JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: ['-e', 'require("node:fs").writeFileSync("native-mcp-started","started")'] } } });
  const w = await workspace({ '.mcp.json': fixtureConfig }, { '.copilot/settings.json': '{}' });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  const env = isolatedEnvironment(w.home);
  execFileSync('git', ['-c', 'init.templateDir=', 'init', '--quiet', w.repo], { env });
  for (const key of [null, 'trustedFolders', 'trusted_folders']) {
    const isolated = await workspace({ '.mcp.json': fixtureConfig }, { '.copilot/settings.json': '{}' });
    try {
      const isolatedEnv = isolatedEnvironment(isolated.home);
      execFileSync('git', ['-c', 'init.templateDir=', 'init', '--quiet', isolated.repo], { env: isolatedEnv });
      const state = key ? { [key]: [await realpath(isolated.repo)] } : {};
      await writeFile(path.join(isolated.home, '.copilot/config.json'), JSON.stringify(state));
      const native = JSON.parse(execFileSync(process.execPath, [runtime, '--no-auto-update', 'mcp', 'list', '--json'], { cwd: isolated.repo, env: isolatedEnv, encoding: 'utf8', timeout: 30000 }));
      const report = await scan({ ...isolated, clients: ['copilot'] });
      const trusted = !!native.mcpServers.fixture;
      if (key === null) assert.equal(trusted, false);
      if (key === 'trustedFolders') assert.equal(trusted, true);
      assert.equal(report.clients[0].extensions.find(extension => extension.name === 'fixture')?.status, trusted ? 'active' : 'conditional', key ?? 'no trust state');
      await assert.rejects(readFile(path.join(isolated.repo, 'native-mcp-started')), { code: 'ENOENT' });
    } finally { await rm(isolated.root, { recursive: true, force: true, maxRetries: 5 }); }
  }
  await writeFile(path.join(w.home, '.copilot/config.json'), JSON.stringify({ trustedFolders: [w.repo] }));
  for (const key of ['disabledMcpServers', 'disabled_mcp_servers']) {
    await writeFile(path.join(w.home, '.copilot/settings.json'), JSON.stringify({ [key]: ['fixture'] }));
    const native = JSON.parse(execFileSync(process.execPath, [runtime, '--no-auto-update', 'mcp', 'list', '--json'], { cwd: w.repo, env, encoding: 'utf8', timeout: 30000 }));
    const report = await scan({ ...w, clients: ['copilot'] });
    assert.equal(native.mcpServers.fixture?.enabled, false);
    assert.equal(report.clients[0].extensions.find(extension => extension.name === 'fixture')?.status, 'ignored');
    await assert.rejects(readFile(path.join(w.repo, 'native-mcp-started')), { code: 'ENOENT' });
  }
});

test('Copilot native inventories distinguish personal JSONC and strict workspace MCP files', async t => {
  const comments = (text: string) => '// Native JSONC fixture\n/* Personal configuration */\n' + text;
  const trailingComma = (text: string) => text.replace(/\n}$/, ',\n}');
  const cases = [
    { name: 'plain baseline' },
    { name: 'commented internal state', file: 'state', transform: comments },
    { name: 'trailing comma in internal state', file: 'state', transform: trailingComma },
    { name: 'commented personal settings', file: 'settings', transform: comments, disabled: true },
    { name: 'trailing comma in personal settings', file: 'settings', transform: trailingComma, disabled: true },
    { name: 'commented personal MCP', file: 'personal', transform: comments },
    { name: 'trailing comma in personal MCP', file: 'personal', transform: trailingComma },
    { name: 'commented workspace MCP', file: 'project', transform: comments, omitted: true },
    { name: 'trailing comma in workspace MCP', file: 'project', transform: trailingComma, omitted: true },
  ];
  for (const scenario of cases) await t.test(scenario.name, async scenarioTest => {
    const w = await workspace({}, { '.copilot/settings.json': '{}' });
    scenarioTest.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
    const env = isolatedEnvironment(w.home);
    execFileSync('git', ['-c', 'init.templateDir=', 'init', '--quiet', w.repo], { env });
    const empty = JSON.stringify({ mcpServers: {} }, null, 2);
    const mcp = JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: ['-e', 'require("node:fs").writeFileSync("native-jsonc-mcp-started","started")'] } } }, null, 2);
    const inputs = {
      state: JSON.stringify({ trustedFolders: [await realpath(w.repo)] }, null, 2),
      settings: JSON.stringify(scenario.disabled ? { disabledMcpServers: ['fixture'] } : {}, null, 2),
      personal: scenario.file === 'personal' ? mcp : empty,
      project: scenario.file === 'personal' ? empty : mcp,
    };
    if (scenario.file && scenario.transform) inputs[scenario.file as keyof typeof inputs] = scenario.transform(inputs[scenario.file as keyof typeof inputs]);
    const files = new Map([
      [path.join(w.home, '.copilot/config.json'), inputs.state],
      [path.join(w.home, '.copilot/settings.json'), inputs.settings],
      [path.join(w.home, '.copilot/mcp-config.json'), inputs.personal],
      [path.join(w.repo, '.mcp.json'), inputs.project],
    ]);
    for (const [file, text] of files) await writeFile(file, text);
    const native = JSON.parse(execFileSync(process.execPath, [runtime, '--no-auto-update', 'mcp', 'list', '--json'], { cwd: w.repo, env, encoding: 'utf8', timeout: 30000 }));
    assert.equal(!!native.mcpServers.fixture, !scenario.omitted);
    if (!scenario.omitted) assert.equal(native.mcpServers.fixture.enabled, !scenario.disabled);
    for (const [file, text] of files) await writeFile(file, text);
    const report = await scan({ ...w, clients: ['copilot'] });
    const selected = report.clients[0].extensions.find(extension => extension.name === 'fixture');
    assert.equal(selected?.status, scenario.omitted ? undefined : scenario.disabled ? 'ignored' : 'active');
    assert.equal(report.findings.some(finding => finding.ruleId === 'parse.json'), !!scenario.omitted);
    await assert.rejects(readFile(path.join(w.repo, 'native-jsonc-mcp-started')), { code: 'ENOENT' });
  });
});

test('Copilot native shared-rule inventory keeps root and cwd sources with their path metadata', async t => {
  const w = await workspace({
    '.claude/rules/all.md': 'Unconditional root rule.',
    '.claude/rules/ts.md': '---\npaths: ["src/**/*.ts"]\n---\nRoot TypeScript rule.',
    'src/.claude/rules/intermediate.md': 'Intermediate rule stays outside Copilot discovery.',
    'src/deep/.claude/rules/local.md': 'Current-directory rule.',
    'src/deep/refund.ts': '',
  });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  const env = isolatedEnvironment(w.home);
  execFileSync('git', ['-c', 'init.templateDir=', 'init', '--quiet', w.repo], { env });
  const native = JSON.parse(execFileSync(process.execPath, [runtime, '--no-auto-update', 'instruction', 'list', '--json'], { cwd: path.join(w.repo, 'src/deep'), env, encoding: 'utf8', timeout: 30000 }));
  assert.deepEqual(native.map((entry: any) => entry.label).sort(), ['all.md', 'local.md', 'ts.md']);
  assert.deepEqual(native.find((entry: any) => entry.label === 'ts.md').applyTo, ['src/**/*.ts']);
  const report = await scan({ ...w, clients: ['copilot'], target: 'src/deep/refund.ts' });
  assert.equal(report.clients[0].decisions.filter(decision => decision.kind === 'rules' && decision.status === 'active').length, native.length);
  assert.ok(report.clients[0].instructions.includes('Root TypeScript rule.'));
  assert.ok(report.clients[0].instructions.includes('Current-directory rule.'));
  assert.ok(!report.clients[0].instructions.includes('Intermediate rule'));
});
