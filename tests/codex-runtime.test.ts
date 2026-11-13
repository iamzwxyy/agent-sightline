import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import readline from 'node:readline';
import { scan } from '../packages/core/index.js';
import { codexMetadata } from '../packages/adapters/codex.js';
import { workspace } from './helpers.js';

const require = createRequire(import.meta.url);
const packageFile = require.resolve('@openai/codex/package.json');
const runtimePackage = require('@openai/codex/package.json');
const runtime = path.resolve(path.dirname(packageFile), runtimePackage.bin.codex);

function isolatedEnvironment(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH, PATHEXT: process.env.PATHEXT, SystemRoot: process.env.SystemRoot,
    COMSPEC: process.env.COMSPEC, TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR,
    HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, '.codex'),
    APPDATA: path.join(home, 'AppData/Roaming'), LOCALAPPDATA: path.join(home, 'AppData/Local'),
    XDG_CONFIG_HOME: path.join(home, '.config'), GIT_CONFIG_NOSYSTEM: '1',
  };
}

async function readRuntimeConfig(cwd: string, env: NodeJS.ProcessEnv): Promise<any> {
  const child = spawn(process.execPath, [runtime, 'app-server'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let requestId = 0;
  let finished = false;
  const fail = (error: Error) => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
    pending.clear();
  };
  const closed = new Promise<number | null>(resolve => child.once('close', code => {
    finished = true;
    fail(new Error(`Codex exited with code ${code} before replying.`));
    resolve(code);
  }));
  child.once('error', error => fail(error));
  child.stdin.on('error', error => fail(error));
  child.stderr.on('data', () => { /* Client logs stay private. */ });
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { fail(new Error('Codex emitted invalid JSON.')); return; }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(`Codex rejected a configuration request (${message.error.code}).`));
    else request.resolve(message.result);
  });
  const request = (method: string, params: Record<string, unknown>): Promise<any> => new Promise((resolve, reject) => {
    const id = ++requestId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Codex timed out during ${method}.`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  try {
    const initialized = await request('initialize', { clientInfo: { name: 'sightline_conformance', version: '1' } });
    assert.ok(initialized.userAgent.includes('/' + codexMetadata.ruleVersion));
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    return await request('config/read', { cwd, includeLayers: true });
  } finally {
    child.stdin.end();
    const timer = setTimeout(() => {
      if (finished || !child.pid) return;
      if (process.platform === 'win32') {
        const killer = spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        killer.once('error', () => child.kill('SIGKILL'));
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      }
    }, 1000);
    await closed;
    clearTimeout(timer); lines.close();
  }
}

interface RuntimeCase {
  name: string;
  user: string;
  files: Record<string, string>;
  cwd?: string;
  trust?: 'trusted' | 'untrusted';
  trustRoot?: string;
  gitRoots?: string[];
  alias?: boolean;
  trustAlias?: boolean;
  canonicalTrust?: 'trusted' | 'untrusted';
  keys: string[];
  originKeys?: string[];
}

function assertConfiguredValue(configured: any, actual: any, key: string): void {
  if (Array.isArray(configured)) {
    assert.ok(Array.isArray(actual), `${key} is not an array in Codex.`);
    assert.equal(actual.length, configured.length, `${key} has a different number of entries.`);
    configured.forEach((value, index) => assertConfiguredValue(value, actual[index], `${key}.${index}`));
  } else if (configured && typeof configured === 'object') {
    for (const [field, value] of Object.entries(configured)) {
      const canonical = key.startsWith('hooks.') && field === 'command_windows' ? 'commandWindows' : field;
      assertConfiguredValue(value, actual?.[canonical], `${key}.${canonical}`);
    }
  } else assert.deepEqual(configured, actual, `${key} differs from the installed Codex configuration.`);
}

const cases: RuntimeCase[] = [
  {
    name: 'trusted user, repository and nested layers',
    user: 'model="user-model"\nmodel_reasoning_effort="low"\n',
    files: { '.codex/config.toml': 'model="repository-model"\nmodel_reasoning_effort="medium"\n', 'src/.codex/config.toml': 'model_reasoning_effort="high"\n' },
    keys: ['model', 'model_reasoning_effort'],
  },
  {
    name: 'untrusted project layers', trust: 'untrusted',
    user: 'model="user-model"\nmodel_reasoning_effort="low"\n',
    files: { '.codex/config.toml': 'model="repository-model"\n', 'src/.codex/config.toml': 'model_reasoning_effort="high"\n' },
    keys: ['model', 'model_reasoning_effort'],
  },
  {
    name: 'project-only machine fields',
    user: 'model="user-model"\nmodel_provider="openai"\n',
    files: { '.codex/config.toml': 'model="repository-model"\nmodel_provider=42\nprofile="ignored"\n' },
    keys: ['model', 'model_provider'],
  },
  {
    name: 'MCP field merging',
    user: `model="user-model"\n[mcp_servers.fixture]\ncommand=${JSON.stringify(process.execPath)}\nargs=["user-argument"]\n`,
    files: { '.codex/config.toml': '[mcp_servers.fixture]\nargs=["project-argument"]\n' },
    keys: ['mcp_servers.fixture.command', 'mcp_servers.fixture.args'],
  },
  {
    name: 'nested MCP field sources and private mapping origins',
    user: `[mcp_servers.fixture]\ncommand=${JSON.stringify(process.execPath)}\ncwd=${JSON.stringify(path.parse(process.execPath).root)}\nenv_vars=["SIGHTLINE_NATIVE_REQUIRED"]\n[mcp_servers.fixture.env]\nSHARED="origin-user-sentinel"\nUSER_ONLY="origin-user-only-sentinel"\n`,
    files: {
      '.codex/config.toml': '[mcp_servers.fixture]\nargs=["root-argument"]\n[mcp_servers.fixture.env]\nSHARED="origin-project-sentinel"\n',
      'src/.codex/config.toml': '[mcp_servers.fixture]\nenv_vars=["SIGHTLINE_PROJECT_REQUIRED"]\n',
    },
    keys: ['mcp_servers.fixture.command', 'mcp_servers.fixture.cwd', 'mcp_servers.fixture.args', 'mcp_servers.fixture.env_vars'],
    originKeys: ['mcp_servers.fixture.env.SHARED', 'mcp_servers.fixture.env.USER_ONLY'],
  },
  {
    name: 'persisted hook review state',
    user: 'model="user-model"\n[hooks.state.fixture]\nenabled=false\ntrusted_hash="reviewed-fixture-hash"\n',
    files: {},
    keys: ['hooks.state.fixture.enabled', 'hooks.state.fixture.trusted_hash'],
  },
  {
    name: 'TOML Windows hook command aliases',
    user: '[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype="command"\ncommand="echo posix"\ncommand_windows="echo windows"\n[[hooks.Stop.hooks]]\ntype="command"\ncommand="echo fallback"\ncommandWindows="echo override"\n',
    files: {}, keys: ['hooks.Stop'],
  },
  {
    name: 'model request and skipped hook handlers',
    user: '[[hooks.PreModelRequest]]\n[[hooks.PreModelRequest.hooks]]\ntype="mcp_tool"\nserver="fixture"\ntool="inspect"\n[[hooks.PostModelRequest]]\n[[hooks.PostModelRequest.hooks]]\ntype="command"\ncommand="echo safe"\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype="prompt"\n[[hooks.Stop.hooks]]\ntype="agent"\n',
    files: {}, keys: ['hooks.PreModelRequest', 'hooks.PostModelRequest', 'hooks.Stop'],
  },
  {
    name: 'project disables hooks after user configuration',
    user: '[features]\nhooks=true\n',
    files: { '.codex/config.toml': '[features]\nhooks=false\n' },
    keys: ['features.hooks'],
  },
  {
    name: 'project enables hooks after user configuration',
    user: '[features]\nhooks=false\n',
    files: { '.codex/config.toml': '[features]\nhooks=true\n' },
    keys: ['features.hooks'],
  },
  {
    name: 'nearest nested Git repository', cwd: 'nested/src', trustRoot: 'nested', gitRoots: ['.', 'nested'],
    user: 'model="user-model"\nmodel_reasoning_effort="low"\n',
    files: { '.codex/config.toml': 'model="outer-model"\n', 'nested/.codex/config.toml': 'model_reasoning_effort="medium"\n', 'nested/src/.codex/config.toml': 'model_reasoning_effort="high"\n' },
    keys: ['model', 'model_reasoning_effort'],
  },
  {
    name: 'directory without a Git ancestor', trustRoot: 'src', gitRoots: [],
    user: 'model="user-model"\nmodel_reasoning_effort="low"\n',
    files: { '.codex/config.toml': 'model="outer-model"\n', 'src/.codex/config.toml': 'model_reasoning_effort="high"\n' },
    keys: ['model', 'model_reasoning_effort'],
  },
  {
    name: 'trust stored above a nested Git repository', cwd: 'nested/src', gitRoots: ['.', 'nested'],
    user: 'model="user-model"\n',
    files: { 'nested/.codex/config.toml': 'model="nested-model"\n' },
    keys: ['model'],
  },
  {
    name: 'trust stored at an intermediate directory', cwd: 'src/deep', trustRoot: 'src',
    user: 'model="user-model"\n',
    files: { '.codex/config.toml': 'model="repository-model"\n' },
    keys: ['model'],
  },
  {
    name: 'custom project root markers', trustRoot: 'src', gitRoots: [],
    user: 'model="user-model"\nproject_root_markers=["project.marker"]\n',
    files: { 'project.marker': '', '.codex/config.toml': 'model="repository-model"\n' },
    keys: ['model'],
  },
  {
    name: 'disabled project root markers', trustRoot: 'src',
    user: 'model="user-model"\nproject_root_markers=[]\n',
    files: { '.codex/config.toml': 'model="repository-model"\n', 'src/.codex/config.toml': 'model="nested-model"\n' },
    keys: ['model'],
  },
  {
    name: 'custom root markers with root trust', gitRoots: [],
    user: 'model="user-model"\nproject_root_markers=["project.marker"]\n',
    files: { 'project.marker': '', '.codex/config.toml': 'model="repository-model"\n' },
    keys: ['model'],
  },
  {
    name: 'canonical trust through a directory alias', alias: true,
    user: 'model="user-model"\n',
    files: { '.codex/config.toml': 'model="repository-model"\n' },
    keys: ['model'],
  },
  {
    name: 'trust stored under a directory alias', alias: true, trustAlias: true,
    user: 'model="user-model"\n',
    files: { '.codex/config.toml': 'model="repository-model"\n' },
    keys: ['model'],
  },
  {
    name: 'canonical trusted and alias untrusted', alias: true, trustAlias: true, trust: 'untrusted', canonicalTrust: 'trusted',
    user: 'model="user-model"\n', files: { '.codex/config.toml': 'model="repository-model"\n' }, keys: ['model'],
  },
  {
    name: 'canonical untrusted and alias trusted', alias: true, trustAlias: true, canonicalTrust: 'untrusted',
    user: 'model="user-model"\n', files: { '.codex/config.toml': 'model="repository-model"\n' }, keys: ['model'],
  },
];

test('the configuration oracle uses the pinned Codex binary', () => {
  assert.equal(runtimePackage.version, codexMetadata.ruleVersion);
  assert.equal(execFileSync(process.execPath, [runtime, '--version'], { encoding: 'utf8' }).trim(), 'codex-cli ' + codexMetadata.ruleVersion);
});

for (const fixture of cases) test(`Codex runtime configuration matches Sightline for ${fixture.name}`, { timeout: 30000 }, async t => {
  const w = await workspace(fixture.files);
  t.after(() => rm(w.root, { recursive: true, force: true }));
  await rm(path.join(w.repo, '.git'), { recursive: true });
  const repo = await realpath(w.repo);
  const home = await realpath(w.home);
  const env = isolatedEnvironment(home);
  await mkdir(path.join(home, '.codex'), { recursive: true });
  await mkdir(path.join(repo, fixture.cwd ?? 'src'), { recursive: true });
  for (const relative of fixture.gitRoots ?? ['.']) execFileSync('git', ['-c', 'init.templateDir=', 'init', '--quiet', path.join(repo, relative)], { env, stdio: 'pipe' });
  let boundary = repo;
  if (fixture.alias) { boundary = path.join(await realpath(w.root), 'alias'); await symlink(repo, boundary, process.platform === 'win32' ? 'junction' : 'dir'); }
  const trustRoot = fixture.trustAlias ? boundary : path.join(repo, fixture.trustRoot ?? '.');
  const canonicalTrust = fixture.canonicalTrust ? `\n[projects.${JSON.stringify(repo)}]\ntrust_level=${JSON.stringify(fixture.canonicalTrust)}\n` : '';
  await writeFile(path.join(home, '.codex/config.toml'), fixture.user + `\n[analytics]\nenabled=false\n[projects.${JSON.stringify(trustRoot)}]\ntrust_level=${JSON.stringify(fixture.trust ?? 'trusted')}\n` + canonicalTrust);
  const cwd = path.join(boundary, fixture.cwd ?? 'src');
  const actual = await readRuntimeConfig(cwd, env);
  const report = await scan({ repo: boundary, target: path.join(fixture.cwd ?? 'src', 'example.ts'), home, env, clients: ['codex'] });
  for (const key of [...fixture.keys, ...fixture.originKeys ?? []]) {
    const value = key.split('.').reduce((object, part) => object?.[part], actual.config);
    const setting = report.clients[0].settings.find(setting => setting.key === key && setting.status === 'active');
    assert.ok(setting, `No active Sightline value for ${key}.`);
    if (fixture.keys.includes(key)) assertConfiguredValue(setting.value, value, key);
    else assert.equal(setting.value, '[REDACTED]');
    const originKeys = Object.keys(actual.origins).filter(originKey => originKey === key || originKey.startsWith(key + '.'));
    assert.ok(originKeys.length, `Codex did not expose origins for ${key}.`);
    for (const originKey of originKeys) {
      const origin = actual.origins[originKey];
      assert.ok(origin, `Codex did not expose the origin for ${originKey}.`);
      const file = origin.name.type === 'project' ? path.join(origin.name.dotCodexFolder, 'config.toml') : origin.name.file;
      assert.equal(await realpath(setting.location.path), await realpath(file), `${originKey} has a different winning source.`);
      if (key.startsWith('mcp_servers.')) {
        const [, name, ...parts] = originKey.split('.');
        const extension = report.clients[0].extensions.find(extension => extension.kind === 'mcp' && extension.name === name && extension.status === 'active');
        const field = extension?.origins?.find(origin => origin.key === parts.join('.'));
        assert.ok(field, `No MCP field origin for ${originKey}.`);
        assert.equal(await realpath(field.location.path), await realpath(file), `${originKey} has a different MCP field source.`);
      }
    }
  }
  assert.ok(!report.findings.some(finding => finding.ruleId.startsWith('parse.') || finding.ruleId === 'config.schema'));
  assert.ok(!report.findings.some(finding => finding.ruleId === 'hook.type'));
  if ((fixture.canonicalTrust ?? fixture.trust) === 'untrusted') assert.ok(actual.layers.some((layer: any) => layer.name.type === 'project' && layer.disabledReason));
  // Only initialize, initialized and config/read are sent to the real client.
  assert.equal(actual.config.analytics.enabled, false);
});
