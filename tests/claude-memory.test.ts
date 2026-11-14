import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { realpath, rm, writeFile } from 'node:fs/promises';
import { scan } from '../packages/core/index.js';
import { claudeMetadata } from '../packages/adapters/claude.js';
import { workspace } from './helpers.js';

const require = createRequire(import.meta.url);
const platformPackage = `@anthropic-ai/claude-code-${process.platform}-${process.arch}`;
const runtime = path.join(path.dirname(require.resolve(platformPackage + '/package.json')), process.platform === 'win32' ? 'claude.exe' : 'claude');

interface MemoryScenario {
  name: string;
  files: Record<string, string>;
  home?: Record<string, string>;
  directory?: string;
  approval?: boolean;
  approvalScope?: 'project' | 'directory';
  approvalKey?: 'logical' | 'canonical';
  readTarget?: boolean;
  noGit?: boolean;
}

function blockText(block: any): string {
  if (block.type === 'text') return block.text;
  if (block.type === 'tool_result') {
    if (typeof block.content === 'string') return block.content;
    return block.content.map(blockText).join('\n');
  }
  return '';
}

test('Claude instruction order and imports agree with the pinned native request', { timeout: 90000 }, async t => {
  assert.equal(require(platformPackage + '/package.json').version, claudeMetadata.ruleVersion);
  const scenarios: MemoryScenario[] = [
    {
      name: 'user rules precede project instructions and local files follow each directory rules', directory: 'src',
      home: {
        '.claude/CLAUDE.md': 'USER_INSTRUCTION\n', '.claude/rules/a.md': 'USER_RULE_INSTRUCTION\n'
      },
      files: {
        'CLAUDE.md': 'ROOT_INSTRUCTION\n', '.claude/CLAUDE.md': 'DOT_ROOT_INSTRUCTION\n', 'CLAUDE.local.md': 'LOCAL_ROOT_INSTRUCTION\n', '.claude/rules/a.md': 'ROOT_RULE_INSTRUCTION\n',
        'src/CLAUDE.md': 'NESTED_INSTRUCTION\n', 'src/CLAUDE.local.md': 'LOCAL_NESTED_INSTRUCTION\n', 'src/.claude/rules/a.md': 'NESTED_RULE_INSTRUCTION\n',
      },
    },
    {
      name: 'recursive project imports retain referring order', files: {
        'CLAUDE.md': 'ROOT_INSTRUCTION\n@docs/a.md\n', 'docs/a.md': 'IMPORT_A_INSTRUCTION\n@b.md\n', 'docs/b.md': 'IMPORT_B_INSTRUCTION\n'
      }
    },
    {
      name: 'user rule imports load before project instructions', files: {
        'CLAUDE.md': 'ROOT_INSTRUCTION\n'
      }, home: {
        '.claude/CLAUDE.md': 'USER_INSTRUCTION\n', '.claude/rules/a.md': 'USER_RULE_INSTRUCTION\n@../policy.md\n', '.claude/policy.md': 'USER_IMPORT_INSTRUCTION\n'
      }
    },
    {
      name: 'project rules expand their imports', files: {
        'CLAUDE.md': 'ROOT_INSTRUCTION\n', '.claude/rules/a.md': 'PROJECT_RULE_INSTRUCTION\n@../policy.md\n', '.claude/policy.md': 'PROJECT_IMPORT_INSTRUCTION\n'
      }
    },
    {
      name: 'ancestor import outside the session directory waits for its own approval', directory: 'src', files: {
        'CLAUDE.md': 'ROOT_INSTRUCTION\n@docs/policy.md\n', 'docs/policy.md': 'IMPORTED_INSTRUCTION\n'
      }
    },
    {
      name: 'saved project approval permits an ancestor import', directory: 'src', approval: true, files: {
        'CLAUDE.md': 'ROOT_INSTRUCTION\n@docs/policy.md\n', 'docs/policy.md': 'IMPORTED_INSTRUCTION\n'
      }
    },
    {
      name: 'saved rejection excludes an ancestor import', directory: 'src', approval: false, files: {
        'CLAUDE.md': 'ROOT_INSTRUCTION\n@docs/policy.md\n', 'docs/policy.md': 'IMPORTED_INSTRUCTION\n'
      }
    },
    {
      name: 'a nested directory state does not approve the Git project imports', directory: 'src', approval: true, approvalScope: 'directory', files: {
        'CLAUDE.md': 'ROOT_INSTRUCTION\n@docs/policy.md\n', 'docs/policy.md': 'IMPORTED_INSTRUCTION\n'
      }
    },
    {
      name: 'imports inside the session directory load after a saved external rejection', directory: 'src', approval: false, files: {
        'CLAUDE.md': 'ROOT_INSTRUCTION\n@src/policy.md\n', 'src/policy.md': 'IMPORTED_INSTRUCTION\n'
      }
    },
    {
      name: 'personal imports need no project approval', directory: 'src', approval: false, files: {
        'CLAUDE.md': 'ROOT_INSTRUCTION\n'
      }, home: {
        '.claude/CLAUDE.md': 'USER_INSTRUCTION\n@policy.md\n', '.claude/policy.md': 'USER_IMPORT_INSTRUCTION\n'
      }
    },
    {
      name: 'AGENTS fallback and unconditional rules keep the native order', directory: 'src', files: {
        'AGENTS.md': 'ROOT_AGENTS_INSTRUCTION\n', 'src/AGENTS.md': 'NESTED_AGENTS_INSTRUCTION\n', '.claude/rules/a.md': 'ROOT_RULE_INSTRUCTION\n', 'src/.claude/rules/a.md': 'NESTED_RULE_INSTRUCTION\n'
      }
    },
    {
      name: 'explicit combined instruction mode keeps the native order', directory: 'src', home: {
        '.claude/settings.json': '{"pluginConfigs":{"cc-plugin-agents-md@builtin":{"options":{"instructionFiles":"claude-md-and-agents-md"}}}}'
      }, files: {
        'CLAUDE.md': 'ROOT_INSTRUCTION\n', 'AGENTS.md': 'ROOT_AGENTS_INSTRUCTION\n', 'src/CLAUDE.md': 'NESTED_INSTRUCTION\n', 'src/AGENTS.md': 'NESTED_AGENTS_INSTRUCTION\n', '.claude/rules/a.md': 'ROOT_RULE_INSTRUCTION\n'
      }
    },
    {
      name: 'a conditional import can later load as an unconditional rule', directory: 'src', files: {
        'CLAUDE.md': 'ROOT_INSTRUCTION\n@.claude/rules/a.md\n', '.claude/rules/a.md': 'PROJECT_RULE_INSTRUCTION\n'
      }
    },
    {
      name: 'a rejected import can later load as an unconditional rule', directory: 'src', approval: false, files: {
        'CLAUDE.md': 'ROOT_INSTRUCTION\n@.claude/rules/a.md\n', '.claude/rules/a.md': 'PROJECT_RULE_INSTRUCTION\n'
      }
    },
    {
      name: 'ancestor rule imports use separate external approval', directory: 'src', files: {
        'CLAUDE.md': 'ROOT_INSTRUCTION\n', '.claude/rules/a.md': 'PROJECT_RULE_INSTRUCTION\n@../policy.md\n', '.claude/policy.md': 'PROJECT_IMPORT_INSTRUCTION\n'
      }
    },
    {
      name: 'combined instructions append local files before AGENTS', directory: 'src', home: {
        '.claude/settings.json': '{"pluginConfigs":{"cc-plugin-agents-md@builtin":{"options":{"instructionFiles":"claude-md-and-agents-md"}}}}'
      }, files: {
        'CLAUDE.md': 'ROOT_INSTRUCTION\n', 'CLAUDE.local.md': 'ROOT_LOCAL_INSTRUCTION\n', 'AGENTS.md': 'ROOT_AGENTS_INSTRUCTION\n', '.claude/AGENTS.md': 'DOT_AGENTS_INSTRUCTION\n', '.claude/rules/a.md': 'ROOT_RULE_INSTRUCTION\n', 'src/CLAUDE.local.md': 'NESTED_LOCAL_INSTRUCTION\n', 'src/AGENTS.md': 'NESTED_AGENTS_INSTRUCTION\n'
      }
    },
    {
      name: 'managed-only mode excludes personal and project instructions', home: {
        '.claude/CLAUDE.md': 'USER_INSTRUCTION\n', '.claude/rules/a.md': 'USER_RULE_INSTRUCTION\n', '.claude/settings.json': '{"pluginConfigs":{"cc-plugin-agents-md@builtin":{"options":{"instructionFiles":"managed-only"}}}}'
      }, files: {
        'CLAUDE.md': 'ROOT_INSTRUCTION\n', '.claude/rules/a.md': 'ROOT_RULE_INSTRUCTION\n', 'AGENTS.md': 'ROOT_AGENTS_INSTRUCTION\n'
      }
    },
    {
      name: 'matching rules load when the target is opened after startup instructions', directory: 'src', readTarget: true, home: {
        '.claude/CLAUDE.md': 'USER_INSTRUCTION\n', '.claude/rules/a.md': '---\npaths: ["*.ts"]\n---\nUSER_SCOPED_INSTRUCTION\n'
      }, files: {
        'CLAUDE.md': 'ROOT_INSTRUCTION\n', 'src/CLAUDE.md': 'NESTED_INSTRUCTION\n', 'src/CLAUDE.local.md': 'LOCAL_NESTED_INSTRUCTION\n', '.claude/rules/a.md': '---\npaths: ["src/**/*.ts"]\n---\nROOT_SCOPED_INSTRUCTION\n', 'src/.claude/rules/a.md': '---\npaths: ["*.ts"]\n---\nNESTED_SCOPED_INSTRUCTION\n'
      }
    },
    {
      name: 'canonical saved project state approves external imports', directory: 'src', approval: true, approvalKey: 'canonical', files: {
        'CLAUDE.md': 'ROOT_INSTRUCTION\n@docs/policy.md\n', 'docs/policy.md': 'IMPORTED_INSTRUCTION\n'
      }
    },
    {
      name: 'logical saved project keys follow native canonical selection', directory: 'src', approval: true, approvalKey: 'logical', files: {
        'CLAUDE.md': 'ROOT_INSTRUCTION\n@docs/policy.md\n', 'docs/policy.md': 'IMPORTED_INSTRUCTION\n'
      }
    },
    {
      name: 'a non-Git session reads its own directory approval', directory: 'src', noGit: true, approval: true, approvalScope: 'directory', files: {
        'CLAUDE.md': 'ROOT_INSTRUCTION\n@docs/policy.md\n', 'docs/policy.md': 'IMPORTED_INSTRUCTION\n'
      }
    },
    {
      name: 'personal scoped-rule imports load at startup before their referring rule', directory: 'src', readTarget: true, files: {
        'CLAUDE.md': 'ROOT_INSTRUCTION\n'
      }, home: {
        '.claude/rules/a.md': '---\npaths: ["*.ts"]\n---\nUSER_SCOPED_INSTRUCTION\n@../policy.md\n', '.claude/policy.md': 'USER_IMPORT_INSTRUCTION\n'
      }
    },
    {
      name: 'project scoped-rule imports load at startup with separate approval', directory: 'src', readTarget: true, approval: true, files: {
        'CLAUDE.md': 'ROOT_INSTRUCTION\n', '.claude/rules/a.md': '---\npaths: ["src/**/*.ts"]\n---\nPROJECT_SCOPED_INSTRUCTION\n@../policy.md\n', '.claude/policy.md': 'PROJECT_IMPORT_INSTRUCTION\n'
      }
    },
    {
      name: 'empty path lists follow native startup behavior', directory: 'src', files: {
        'CLAUDE.md': 'ROOT_INSTRUCTION\n', '.claude/rules/a.md': '---\npaths: []\n---\nEMPTY_PATHS_INSTRUCTION\n'
      }
    },
    {
      name: 'an unmatched rule still expands unconditional imports at startup', directory: 'src', files: {
        'CLAUDE.md': 'ROOT_INSTRUCTION\n', '.claude/rules/a.md': '---\npaths: ["**/*.py"]\n---\nUNMATCHED_SCOPED_INSTRUCTION\n@../policy.md\n', '.claude/policy.md': 'PROJECT_IMPORT_INSTRUCTION\n'
      }, approval: true
    },
    {
      name: 'an imported rules file retains its own path matching and imports', directory: 'src', readTarget: true, approval: true, files: {
        'CLAUDE.md': 'ROOT_INSTRUCTION\n', '.claude/rules/a.md': '---\npaths: ["**/*.py"]\n---\nUNMATCHED_SCOPED_INSTRUCTION\n@b.md\n', '.claude/rules/b.md': '---\npaths: ["src/**/*.ts"]\n---\nCHILD_SCOPED_INSTRUCTION\n@../policy.md\n', '.claude/policy.md': 'PROJECT_IMPORT_INSTRUCTION\n'
      }
    },
  ];
  let requests: any[] = [];
  let readPath: string | undefined;
  const server = createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    const data = JSON.parse(text);
    response.setHeader('Content-Type', 'application/json');
    if (request.url?.includes('count_tokens')) { response.end(JSON.stringify({ input_tokens: 1 })); return; }
    requests.push(data);
    const useTool = !!readPath && requests.length === 1;
    const block = useTool ? { type: 'tool_use', id: 'fixture-read', name: 'Read', input: { file_path: readPath } } : { type: 'text', text: 'Fixture complete.' };
    const reply = { id: 'instruction-fixture', type: 'message', role: 'assistant', model: data.model, content: [block], stop_reason: useTool ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
    if (!data.stream) { response.end(JSON.stringify(reply)); return; }
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
  for (const scenario of scenarios) await t.test(scenario.name, async scenarioTest => {
    const w = await workspace({ 'src/file.ts': 'export {};\n', ...scenario.files }, scenario.home);
    scenarioTest.after(() => rm(w.root, { recursive: true, force: true }));
    const env = {
      PATH: process.env.PATH, PATHEXT: process.env.PATHEXT, SystemRoot: process.env.SystemRoot,
      COMSPEC: process.env.COMSPEC, TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR,
      HOME: w.home, USERPROFILE: w.home, APPDATA: path.join(w.home, 'AppData/Roaming'), LOCALAPPDATA: path.join(w.home, 'AppData/Local'),
      XDG_CONFIG_HOME: path.join(w.home, '.config'), GIT_CONFIG_NOSYSTEM: '1', NO_COLOR: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
      ANTHROPIC_API_KEY: 'synthetic-fixture-key', ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + (server.address() as AddressInfo).port,
    };
    if (scenario.noGit) await rm(path.join(w.repo, '.git'), { recursive: true });
    else execFileSync('git', ['-c', 'init.templateDir=', 'init', '--quiet', w.repo], { env });
    const directory = path.join(w.repo, scenario.directory ?? '.');
    const project = scenario.noGit ? await realpath(directory) : execFileSync('git', ['rev-parse', '--show-toplevel'], { env, cwd: directory, encoding: 'utf8' }).trim();
    const projects: Record<string, Record<string, unknown>> = {};
    for (const location of [w.repo, project, directory, await realpath(w.repo), await realpath(directory)]) projects[location] = { hasTrustDialogAccepted: true };
    if (scenario.approval !== undefined) {
      const approvedDirectory = scenario.approvalScope === 'directory' ? directory : w.repo;
      const keys = scenario.approvalKey === 'logical' ? [approvedDirectory] : scenario.approvalKey === 'canonical' ? [await realpath(approvedDirectory)] : [approvedDirectory, await realpath(approvedDirectory), ...(scenario.approvalScope === 'directory' ? [] : [project])];
      for (const location of keys) projects[location].hasClaudeMdExternalIncludesApproved = scenario.approval;
    }
    await writeFile(path.join(w.home, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, projects, account: { email: 'private-state-sentinel@example.test' } }));
    requests = [];
    readPath = scenario.readTarget ? await realpath(path.join(w.repo, 'src/file.ts')) : undefined;
    const child = spawn(runtime, ['-p', 'Run the isolated fixture.', '--output-format', 'json', '--no-session-persistence', '--strict-mcp-config', '--tools', readPath ? 'Read' : '', '--system-prompt', 'Fixture system.'], { env, cwd: directory, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '', errors = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    try {
      const [status] = await once(child, 'close');
      assert.equal(status, 0, errors);
      assert.equal(JSON.parse(output).result, 'Fixture complete.');
      assert.equal(requests.length, scenario.readTarget ? 2 : 1);
      if (scenario.readTarget) {
        const startup = requests[0].messages.filter((message: any) => message.role === 'user').flatMap((message: any) => message.content).map(blockText).join('\n');
        assert.ok(!startup.includes('SCOPED_INSTRUCTION'));
      }
      const memory = requests.at(-1).messages.filter((message: any) => message.role === 'user').flatMap((message: any) => message.content).map(blockText).join('\n');
      const report = await scan({ ...w, target: scenario.directory ? 'src/file.ts' : '.', clients: ['claude'], trust: 'trusted' });
      assert.ok(!JSON.stringify(report).includes('private-state-sentinel@example.test'));
      assert.deepEqual(report.clients[0].instructions.match(/[A-Z_]+_INSTRUCTION/g) ?? [], memory.match(/[A-Z_]+_INSTRUCTION/g) ?? []);
      const nativeFiles = await Promise.all([...memory.matchAll(/^Contents of (.+?)(?: \([^\n]*\))?:$/gm)].map(match => realpath(match[1])));
      const reportedFiles = await Promise.all(report.clients[0].decisions.filter(source => ['instructions', 'rules'].includes(source.kind) && source.status === 'active' && source.content.trim()).map(source => realpath(source.path)));
      assert.deepEqual(reportedFiles, nativeFiles);
      if (scenario.directory && scenario.files['docs/policy.md']) {
        const imported = report.clients[0].decisions.find(source => source.path === path.join(w.repo, 'docs/policy.md'))!;
        const loaded = nativeFiles.includes(await realpath(imported.path));
        assert.equal(imported.status, loaded ? 'active' : scenario.approval === false ? 'ignored' : 'conditional');
        assert.equal(imported.importedFrom?.line, 2);
        if (!loaded) assert.ok(report.findings.some(finding => finding.ruleId === 'claude.import-approval' && finding.location.line === 2));
      }
    } finally { clearTimeout(timer); }
  });
});

test('excluding personal configuration withholds saved external-import approval', async t => {
  const w = await workspace({ 'CLAUDE.md': '@docs/policy.md\n', 'docs/policy.md': 'IMPORTED_INSTRUCTION\n', 'src/file.ts': 'export {};\n' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  await writeFile(path.join(w.home, '.claude.json'), JSON.stringify({ projects: { [await realpath(w.repo)]: { hasClaudeMdExternalIncludesApproved: true } } }));
  const approved = await scan({ ...w, target: 'src/file.ts', clients: ['claude'], trust: 'trusted' });
  assert.ok(approved.clients[0].instructions.includes('IMPORTED_INSTRUCTION'));
  const excluded = await scan({ ...w, target: 'src/file.ts', clients: ['claude'], trust: 'trusted', user: false });
  assert.ok(!excluded.clients[0].instructions.includes('IMPORTED_INSTRUCTION'));
  assert.equal(excluded.clients[0].decisions.find(source => source.path.endsWith('policy.md'))?.status, 'conditional');
  assert.ok(excluded.sources.every(source => !source.path.startsWith(w.home)));
});
