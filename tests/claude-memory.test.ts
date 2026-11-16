import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { scan } from '../packages/core/index.js';
import { html, portable } from '../packages/reporter/index.js';
import { claudeMetadata } from '../packages/adapters/claude.js';
import type { Status } from '../packages/core/types.js';
import { workspace } from './helpers.js';
import { hash } from '../packages/core/utils.js';
import claudeModels from '../packages/adapters/claude-models.json' with { type: 'json' };

const require = createRequire(import.meta.url);
const platformPackage = `@anthropic-ai/claude-code-${process.platform}-${process.arch}`;
const runtime = path.join(path.dirname(require.resolve(platformPackage + '/package.json')), process.platform === 'win32' ? 'claude.exe' : 'claude');

interface MemoryScenario {
  name: string;
  files: Record<string, string>;
  home?: Record<string, string>;
  directory?: string;
  sessionDirectory?: string;
  target?: string;
  approval?: boolean;
  approvalScope?: 'project' | 'directory' | 'main' | 'shared';
  approvalKey?: 'logical' | 'canonical' | 'native';
  readTarget?: boolean;
  noGit?: boolean;
  worktree?: boolean;
  canonicalPaths?: boolean;
  separateGitDir?: boolean;
  environment?: NodeJS.ProcessEnv;
  expectedMemory?: { path: string; status: Status; limit?: number };
}

function blockText(block: any): string {
  if (block.type === 'text') return block.text;
  if (block.type === 'tool_result') {
    if (typeof block.content === 'string') return block.content;
    return block.content.map(blockText).join('\n');
  }
  return '';
}

test('Claude instruction order and imports agree with the pinned native request', { timeout: 240000 }, async t => {
  assert.equal(require(platformPackage + '/package.json').version, claudeMetadata.ruleVersion);
  const scenarios: MemoryScenario[] = [
    {
      name: 'root session reads nested instructions after startup', directory: '.', sessionDirectory: '.', readTarget: true,
      files: {
        'CLAUDE.md': 'ROOT_INSTRUCTION\n@docs/policy.md\n',
        'docs/policy.md': 'IMPORTED_INSTRUCTION\n',
        'src/CLAUDE.md': 'CHILD_INSTRUCTION\n',
        'src/.claude/CLAUDE.md': 'CHILD_DOT_INSTRUCTION\n',
        'src/CLAUDE.local.md': 'CHILD_LOCAL_INSTRUCTION\n',
        'src/.claude/rules/all.md': 'CHILD_RULE_INSTRUCTION\n',
        'src/.claude/rules/ts.md': '---\npaths: ["**/*.ts"]\n---\nCHILD_SCOPED_INSTRUCTION\n',
        '.claude/rules/scoped.md': '---\npaths: ["src/**/*.ts"]\n---\nROOT_SCOPED_INSTRUCTION\n',
      },
    },
    {
      name: 'root session loads several nested instruction and scoped-rule levels', directory: '.', sessionDirectory: '.', target: 'src/deep/file.ts', readTarget: true,
      files: {
        'CLAUDE.md': 'ROOT_INSTRUCTION\n',
        'src/CLAUDE.md': 'CHILD_INSTRUCTION\n',
        'src/.claude/rules/scoped.md': '---\npaths: ["**/*.ts"]\n---\nCHILD_SCOPED_INSTRUCTION\n',
        'src/deep/CLAUDE.md': 'DEEP_INSTRUCTION\n',
        'src/deep/.claude/rules/scoped.md': '---\npaths: ["**/*.ts"]\n---\nDEEP_SCOPED_INSTRUCTION\n',
        'src/deep/file.ts': 'export {};\n',
        '.claude/rules/scoped.md': '---\npaths: ["src/**/*.ts"]\n---\nROOT_SCOPED_INSTRUCTION\n',
      },
    },
    {
      name: 'root Claude instructions and nested AGENTS after reading a target', directory: '.', sessionDirectory: '.', readTarget: true,
      files: { 'CLAUDE.md': 'ROOT_INSTRUCTION\n', 'src/AGENTS.md': 'CHILD_AGENT_INSTRUCTION\n' },
    },
    {
      name: 'startup AGENTS fallback precedes nested Claude instructions', directory: '.', sessionDirectory: '.', readTarget: true,
      files: { 'AGENTS.md': 'ROOT_AGENT_INSTRUCTION\n', 'src/CLAUDE.md': 'CHILD_INSTRUCTION\n', 'src/AGENTS.md': 'CHILD_AGENT_INSTRUCTION\n' },
    },
    {
      name: 'root AGENTS and nested AGENTS after reading a target', directory: '.', sessionDirectory: '.', readTarget: true,
      files: { 'AGENTS.md': 'ROOT_AGENT_INSTRUCTION\n', 'src/AGENTS.md': 'CHILD_AGENT_INSTRUCTION\n' },
    },
    {
      name: 'combined mode keeps nested on-demand instruction discovery', directory: '.', sessionDirectory: '.', readTarget: true,
      home: { '.claude/settings.json': '{"pluginConfigs":{"cc-plugin-agents-md@builtin":{"options":{"instructionFiles":"claude-md-and-agents-md"}}}}' },
      files: { 'CLAUDE.md': 'ROOT_INSTRUCTION\n', 'AGENTS.md': 'ROOT_AGENT_INSTRUCTION\n', 'src/CLAUDE.md': 'CHILD_INSTRUCTION\n', 'src/AGENTS.md': 'CHILD_AGENT_INSTRUCTION\n' },
    },
    {
      name: 'a sibling session reads target instructions with its startup context', directory: 'docs', sessionDirectory: 'docs', readTarget: true,
      files: { 'CLAUDE.md': 'ROOT_INSTRUCTION\n', 'docs/CLAUDE.md': 'SESSION_INSTRUCTION\n', 'src/CLAUDE.md': 'CHILD_INSTRUCTION\n' },
    },
    {
      name: 'personal rule paths use the starting session location', directory: 'src', sessionDirectory: 'src', readTarget: true,
      home: { '.claude/rules/scoped.md': '---\npaths: ["src/**/*.ts"]\n---\nPERSONAL_SCOPED_INSTRUCTION\n' },
      files: { 'CLAUDE.md': 'ROOT_INSTRUCTION\n' },
    },
    {
      name: 'sibling session scoped rules distinguish their target-relative bases', directory: 'docs', sessionDirectory: 'docs', readTarget: true,
      home: { '.claude/rules/scoped.md': '---\npaths: ["../src/**/*.ts"]\n---\nPERSONAL_SCOPED_INSTRUCTION\n' },
      files: {
        'CLAUDE.md': 'ROOT_INSTRUCTION\n', 'docs/CLAUDE.md': 'SESSION_INSTRUCTION\n',
        'docs/.claude/rules/relative.md': '---\npaths: ["../src/**/*.ts"]\n---\nRELATIVE_SCOPED_INSTRUCTION\n',
        'docs/.claude/rules/repository.md': '---\npaths: ["src/**/*.ts"]\n---\nREPOSITORY_SCOPED_INSTRUCTION\n',
      },
    },
    {
      name: 'native project path spelling selects saved import approval',
      directory: 'src', approval: true, approvalKey: 'native',
      files: { 'CLAUDE.md': 'ROOT_INSTRUCTION\n@docs/policy.md\n', 'docs/policy.md': 'IMPORTED_INSTRUCTION\n' },
    },
    {
      name: 'linked worktree imports use native shared project approval',
      directory: 'src', worktree: true, approval: true, approvalScope: 'main',
      files: { 'CLAUDE.md': 'ROOT_INSTRUCTION\n@docs/policy.md\n', 'docs/policy.md': 'IMPORTED_INSTRUCTION\n' },
    },
    {
      name: 'linked worktree state keys follow native project selection',
      directory: 'src', worktree: true, approval: true,
      files: { 'CLAUDE.md': 'ROOT_INSTRUCTION\n@docs/policy.md\n', 'docs/policy.md': 'IMPORTED_INSTRUCTION\n' },
    },
    {
      name: 'canonical linked worktree imports use native shared project approval',
      directory: 'src', worktree: true, canonicalPaths: true, approval: true, approvalScope: 'main',
      files: { 'CLAUDE.md': 'ROOT_INSTRUCTION\n@docs/policy.md\n', 'docs/policy.md': 'IMPORTED_INSTRUCTION\n' },
    },
    {
      name: 'canonical linked worktree state keys follow native project selection',
      directory: 'src', worktree: true, canonicalPaths: true, approval: true,
      files: { 'CLAUDE.md': 'ROOT_INSTRUCTION\n@docs/policy.md\n', 'docs/policy.md': 'IMPORTED_INSTRUCTION\n' },
    },
    {
      name: 'separate Git directory supplies the native worktree approval entry',
      directory: 'src', worktree: true, canonicalPaths: true, separateGitDir: true, approval: true, approvalScope: 'shared',
      files: { 'CLAUDE.md': 'ROOT_INSTRUCTION\n@docs/policy.md\n', 'docs/policy.md': 'IMPORTED_INSTRUCTION\n' },
    },
    {
      name: 'separate Git directory keeps main-checkout approval outside its worktree entry',
      directory: 'src', worktree: true, canonicalPaths: true, separateGitDir: true, approval: true, approvalScope: 'main',
      files: { 'CLAUDE.md': 'ROOT_INSTRUCTION\n@docs/policy.md\n', 'docs/policy.md': 'IMPORTED_INSTRUCTION\n' },
    },
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
      name: 'canonical saved project keys follow native project selection', directory: 'src', approval: true, approvalKey: 'canonical', files: {
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
  const longBody = 'LIMIT_HEAD_INSTRUCTION\n' + ('x'.repeat(79) + '\n').repeat(2750) + 'LIMIT_TAIL_INSTRUCTION\n';
  const scopedRule = (body: string) => '---\npaths: ["src/**/*.ts"]\n---\n' + body;
  const modelScenarios = [
    { name: 'legacy model uses a 40000-character budget', user: { model: 'claude-sonnet-4-6' }, limit: 40000 },
    { name: 'legacy 1M model uses a 200000-character budget', user: { model: 'claude-sonnet-4-6[1m]' }, limit: 200000 },
    { name: 'current model uses its three-character token estimate', user: { model: 'claude-opus-5-5' }, limit: 150000 },
    { name: 'unknown model takes its file-configured context window', user: { model: 'fixture-model', env: { CLAUDE_CODE_MAX_CONTEXT_TOKENS: '500000' } }, limit: 75000 },
    { name: 'known model retains its catalog window over a context override', user: { model: 'claude-sonnet-4-6', env: { CLAUDE_CODE_MAX_CONTEXT_TOKENS: '1000000' } }, limit: 40000 },
    { name: 'disabled compaction permits a known model context override', user: { model: 'claude-sonnet-4-6', env: { CLAUDE_CODE_MAX_CONTEXT_TOKENS: '1000000', DISABLE_COMPACT: '1' } }, limit: 200000 },
    { name: 'disabled long context removes a model suffix', user: { model: 'claude-sonnet-4-6[1m]', env: { CLAUDE_CODE_DISABLE_1M_CONTEXT: '1' } }, limit: 40000 },
    { name: 'model environment values override the model setting', user: { model: 'claude-sonnet-4-6', env: { ANTHROPIC_MODEL: 'fixture-model', CLAUDE_CODE_MAX_CONTEXT_TOKENS: '500000' } }, limit: 75000 },
    { name: 'process environment selects the modeled context', user: { model: 'claude-sonnet-4-6' }, environment: { ANTHROPIC_MODEL: 'fixture-model', CLAUDE_CODE_MAX_CONTEXT_TOKENS: '500000' }, limit: 75000 },
    { name: 'a model alias follows its file environment pin', user: { model: 'sonnet', env: { ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-6[1m]' } }, limit: 200000 },
    { name: 'provider model overrides retain the canonical context', user: { model: 'fixture-model[1m]', modelOverrides: { 'claude-sonnet-4-6': 'fixture-model' } }, limit: 200000 },
    { name: 'a personal model picker supplies canonical behavior', user: { model: 'fixture-model[1m]', modelPicker: { options: [{ model: 'fixture-model', behavesAs: 'claude-sonnet-4-6' }] } }, limit: 200000 },
    { name: 'an explicit compaction override precedes a 1M suffix', user: { model: 'claude-sonnet-4-6[1m]', env: { CLAUDE_CODE_MAX_CONTEXT_TOKENS: '500000', DISABLE_COMPACT: 'true' } }, limit: 100000 },
    { name: 'a dated legacy model keeps its four-character estimate', user: { model: 'claude-3-opus-20240229', env: { CLAUDE_CODE_MAX_CONTEXT_TOKENS: '500000', DISABLE_COMPACT: 'true' } }, limit: 100000 },
    { name: 'a legacy model suffix keeps its four-character estimate', user: { model: 'claude-3-opus[1m]' }, limit: 200000 },
  ];
  for (const scenario of modelScenarios) scenarios.push({
    name: scenario.name, directory: '.', sessionDirectory: '.', readTarget: true,
    files: { 'CLAUDE.md': 'ROOT_INSTRUCTION\n', '.claude/rules/large.md': scopedRule(longBody) },
    home: { '.claude/settings.json': JSON.stringify(scenario.user) }, environment: scenario.environment,
    expectedMemory: { path: '.claude/rules/large.md', status: 'truncated', limit: scenario.limit },
  });
  scenarios.push({
    name: 'project and local model environment settings override process and personal choices',
    directory: '.', sessionDirectory: '.', readTarget: true,
    files: {
      'CLAUDE.md': 'ROOT_INSTRUCTION\n', '.claude/rules/large.md': scopedRule(longBody),
      '.claude/settings.json': '{"model":"claude-opus-5-5"}',
      '.claude/settings.local.json': '{"env":{"ANTHROPIC_MODEL":"fixture-model","CLAUDE_CODE_MAX_CONTEXT_TOKENS":"500000"}}',
    },
    home: { '.claude/settings.json': '{"model":"claude-sonnet-4-6"}' },
    environment: { ANTHROPIC_MODEL: 'claude-sonnet-4-6[1m]' },
    expectedMemory: { path: '.claude/rules/large.md', status: 'truncated', limit: 75000 },
  }, {
    name: 'an empty project model override map retains the personal mapping',
    directory: '.', sessionDirectory: '.', readTarget: true,
    files: { 'CLAUDE.md': 'ROOT_INSTRUCTION\n', '.claude/rules/large.md': scopedRule(longBody), '.claude/settings.json': '{"modelOverrides":{}}' },
    home: { '.claude/settings.json': '{"model":"fixture-model[1m]","modelOverrides":{"claude-sonnet-4-6":"fixture-model"}}' },
    expectedMemory: { path: '.claude/rules/large.md', status: 'truncated', limit: 200000 },
  }, {
    name: 'an unrelated project model override retains the personal mapping',
    directory: '.', sessionDirectory: '.', readTarget: true,
    files: { 'CLAUDE.md': 'ROOT_INSTRUCTION\n', '.claude/rules/large.md': scopedRule(longBody), '.claude/settings.json': '{"modelOverrides":{"claude-opus-5-5":"other-model"}}' },
    home: { '.claude/settings.json': '{"model":"fixture-model[1m]","modelOverrides":{"claude-sonnet-4-6":"fixture-model"}}' },
    expectedMemory: { path: '.claude/rules/large.md', status: 'truncated', limit: 200000 },
  }, {
    name: 'a project model override replaces the same personal mapping',
    directory: '.', sessionDirectory: '.', readTarget: true,
    files: { 'CLAUDE.md': 'ROOT_INSTRUCTION\n', '.claude/rules/large.md': scopedRule(longBody), '.claude/settings.json': '{"modelOverrides":{"claude-sonnet-4-6":"another-model"}}' },
    home: { '.claude/settings.json': '{"model":"fixture-model[1m]","modelOverrides":{"claude-sonnet-4-6":"fixture-model"}}' },
    expectedMemory: { path: '.claude/rules/large.md', status: 'truncated', limit: 150000 },
  }, {
    name: 'project model picker declarations retain personal model behavior',
    directory: '.', sessionDirectory: '.', readTarget: true,
    files: { 'CLAUDE.md': 'ROOT_INSTRUCTION\n', '.claude/rules/large.md': scopedRule(longBody), '.claude/settings.json': '{"modelPicker":{"options":[{"model":"fixture-model","behavesAs":"claude-opus-5-5"}]}}' },
    home: { '.claude/settings.json': '{"model":"fixture-model[1m]","modelPicker":{"options":[{"model":"fixture-model","behavesAs":"claude-sonnet-4-6"}]}}' },
    expectedMemory: { path: '.claude/rules/large.md', status: 'truncated', limit: 200000 },
  });
  for (const model of claudeModels) scenarios.push({
    name: 'catalog character budget for ' + model.id,
    directory: '.', sessionDirectory: '.', readTarget: true,
    files: { 'CLAUDE.md': 'ROOT_INSTRUCTION\n', '.claude/rules/large.md': scopedRule(longBody) },
    home: { '.claude/settings.json': JSON.stringify({ model: model.id, env: { CLAUDE_CODE_DISABLE_LEGACY_MODEL_REMAP: 'true' } }) },
    expectedMemory: { path: '.claude/rules/large.md', status: 'truncated', limit: Math.max(40000, model.contextWindow * 0.05 * model.charactersPerToken) },
  });
  for (const [name, body] of [
    ['inline comment', 'head <!-- retained --> tail'],
    ['multiline inline comment', 'head <!-- retained\ncomment --> tail'],
    ['indented comment', '  <!-- retained -->'],
    ['fenced comment', '```html\n<!-- retained -->\n```'],
    ['standalone comment', '<!-- removed -->'],
    ['adjacent comments', '<!-- removed --> <!-- removed too -->'],
    ['standalone comment with trailing text', '<!-- removed --> retained tail'],
    ['unclosed comment', '<!-- retained'],
  ]) scenarios.push({
    name: 'native content retains the ' + name + ' behavior',
    directory: '.', sessionDirectory: '.', readTarget: true,
    files: { 'CLAUDE.md': 'ROOT_INSTRUCTION\n', '.claude/rules/large.md': scopedRule('LIMIT_HEAD_INSTRUCTION\n' + body + '\nLIMIT_TAIL_INSTRUCTION\n') },
    home: { '.claude/settings.json': '{"model":"claude-sonnet-4-6"}' },
    expectedMemory: { path: '.claude/rules/large.md', status: 'active' },
  });
  for (const filename of ['src/CLAUDE.md', 'src/.claude/rules/large.md']) scenarios.push({
    name: 'on-demand unconditional source is truncated at ' + filename,
    directory: '.', sessionDirectory: '.', readTarget: true,
    files: { 'CLAUDE.md': 'ROOT_INSTRUCTION\n', [filename]: longBody },
    home: { '.claude/settings.json': '{"model":"claude-sonnet-4-6"}' },
    expectedMemory: { path: filename, status: 'truncated', limit: 40000 },
  });
  scenarios.push({
    name: 'startup instructions retain their complete content above the on-demand budget',
    directory: '.', sessionDirectory: '.', readTarget: true,
    files: { 'CLAUDE.md': longBody }, home: { '.claude/settings.json': '{"model":"claude-sonnet-4-6"}' },
    expectedMemory: { path: 'CLAUDE.md', status: 'active' },
  }, {
    name: 'removed HTML comments consume no on-demand character budget',
    directory: '.', sessionDirectory: '.', readTarget: true,
    files: { 'CLAUDE.md': 'ROOT_INSTRUCTION\n', '.claude/rules/large.md': scopedRule('LIMIT_HEAD_INSTRUCTION\n<!--' + 'comment\n'.repeat(8000) + '-->\nLIMIT_TAIL_INSTRUCTION\n') },
    home: { '.claude/settings.json': '{"model":"claude-sonnet-4-6"}' },
    expectedMemory: { path: '.claude/rules/large.md', status: 'active' },
  });
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
    scenarioTest.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
    if (scenario.canonicalPaths || scenario.readTarget && process.platform === 'win32') {
      w.repo = await realpath(w.repo);
    }
    const env = {
      PATH: process.env.PATH, PATHEXT: process.env.PATHEXT, SystemRoot: process.env.SystemRoot,
      COMSPEC: process.env.COMSPEC, TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR,
      HOME: w.home, USERPROFILE: w.home, APPDATA: path.join(w.home, 'AppData/Roaming'), LOCALAPPDATA: path.join(w.home, 'AppData/Local'),
      XDG_CONFIG_HOME: path.join(w.home, '.config'), GIT_CONFIG_NOSYSTEM: '1', NO_COLOR: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
      ANTHROPIC_API_KEY: 'synthetic-fixture-key', ANTHROPIC_BASE_URL: 'http://127.0.0.1:' + (server.address() as AddressInfo).port,
      ...scenario.environment,
    };
    const mainRepository = w.repo;
    if (scenario.noGit) await rm(path.join(w.repo, '.git'), { recursive: true });
    else execFileSync('git', ['-c', 'init.templateDir=', 'init', '--quiet', ...(scenario.separateGitDir ? ['--separate-git-dir', path.join(w.root, 'metadata')] : []), w.repo], { env });
    if (scenario.worktree) {
      execFileSync('git', ['add', '.'], { cwd: w.repo, env });
      execFileSync('git', ['-c', 'user.name=Memory fixture', '-c', 'user.email=memory-fixture@example.test', 'commit', '--quiet', '-m', 'Create the isolated memory fixture'], { cwd: w.repo, env });
      const linked = path.join(scenario.canonicalPaths ? await realpath(w.root) : w.root, 'linked');
      execFileSync('git', ['worktree', 'add', '--quiet', '-b', 'memory-fixture', linked], { cwd: w.repo, env });
      w.repo = linked;
    }
    const directory = path.join(w.repo, scenario.directory ?? '.');
    const project = scenario.noGit ? await realpath(directory) : execFileSync('git', ['rev-parse', '--show-toplevel'], { env, cwd: directory, encoding: 'utf8' }).trim();
    const projects: Record<string, Record<string, unknown>> = {};
    const sharedDirectory = path.join(w.root, 'metadata');
    for (const location of [w.repo, project, directory, mainRepository, await realpath(mainRepository), await realpath(w.repo), await realpath(directory), ...(scenario.separateGitDir ? [sharedDirectory, await realpath(sharedDirectory)] : [])]) {
      for (const key of [location, location.replaceAll('\\', '/')]) projects[key] = { hasTrustDialogAccepted: true };
    }
    if (scenario.approval !== undefined) {
      const approvedDirectory = scenario.approvalScope === 'directory' ? directory : scenario.approvalScope === 'main' ? mainRepository : scenario.approvalScope === 'shared' ? sharedDirectory : w.repo;
      const canonical = await realpath(approvedDirectory);
      const variants = [approvedDirectory, canonical, approvedDirectory.replaceAll('\\', '/'), canonical.replaceAll('\\', '/'), ...(scenario.approvalScope === undefined || scenario.approvalScope === 'project' ? [project] : [])];
      const explicitKeys = { logical: approvedDirectory, canonical, native: process.platform === 'win32' ? approvedDirectory.replaceAll('\\', '/') : canonical };
      const keys = scenario.approvalKey ? [explicitKeys[scenario.approvalKey]] : variants;
      for (const location of keys) projects[location].hasClaudeMdExternalIncludesApproved = scenario.approval;
    }
    await writeFile(path.join(w.home, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, projects, account: { email: 'private-state-sentinel@example.test' } }));
    requests = [];
    readPath = scenario.readTarget ? path.join(w.repo, scenario.target ?? 'src/file.ts') : undefined;
    const child = spawn(runtime, ['-p', 'Run the isolated fixture.', '--output-format', 'json', '--no-session-persistence', '--strict-mcp-config', '--tools', readPath ? 'Read' : '', '--allowedTools', 'Read', '--system-prompt', 'Fixture system.'], { env, cwd: directory, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
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
      const report = await scan({ ...w, env: { ...w.env, ...scenario.environment }, target: scenario.target ?? (scenario.directory ? 'src/file.ts' : '.'), sessionDirectory: scenario.sessionDirectory, clients: ['claude'], trust: 'trusted' });
      assert.ok(!JSON.stringify(report).includes('private-state-sentinel@example.test'));
      const nativeState = JSON.parse(await readFile(path.join(w.home, '.claude.json'), 'utf8'));
      const nativeMessages = requests.at(-1).messages;
      const diagnostics = {
        platform: process.platform,
        directory,
        readPath,
        gitPointer: scenario.worktree ? await readFile(path.join(w.repo, '.git'), 'utf8') : undefined,
        projects: Object.entries(nativeState.projects ?? {}).map(([key, entry]: [string, any]) => ({
          key,
          approved: entry.hasClaudeMdExternalIncludesApproved ?? null,
          trusted: entry.hasTrustDialogAccepted ?? null,
        })),
        environment: nativeMessages.filter((message: any) => message.role === 'system').flatMap((message: any) => message.content).map(blockText).join('\n'),
        toolResults: nativeMessages.filter((message: any) => message.role === 'user').flatMap((message: any) => message.content).filter((block: any) => block.type === 'tool_result').map(blockText).map((text: string) => text.length > 1200 ? text.slice(0, 600) + '\n[…]\n' + text.slice(-600) : text),
        permissionDenials: JSON.parse(output).permission_denials,
      };
      assert.deepEqual(diagnostics.permissionDenials, [], JSON.stringify(diagnostics));
      assert.deepEqual(report.clients[0].instructions.match(/[A-Z_]+_INSTRUCTION/g) ?? [], memory.match(/[A-Z_]+_INSTRUCTION/g) ?? [], JSON.stringify(diagnostics));
      const nativeFiles = await Promise.all([...memory.matchAll(/^Contents of (.+?)(?: \([^\n]*\))?:$/gm)].map(match => realpath(match[1])));
      const fixturePaths = new Map(Object.keys(scenario.files).map(filename => {
        const absolute = path.join(w.repo, filename);
        return [hash(absolute), absolute];
      }));
      const reportedFiles = await Promise.all(report.clients[0].decisions.filter(source => ['instructions', 'rules'].includes(source.kind) && ['active', 'truncated'].includes(source.status) && source.content.trim()).map(source => realpath(fixturePaths.get(source.sourceId) ?? source.path)));
      assert.deepEqual(reportedFiles, nativeFiles);
      if (scenario.expectedMemory) {
        const expected = scenario.expectedMemory;
        const contribution = report.clients[0].decisions.find(source => source.sourceId === hash(path.join(w.repo, expected.path)))!;
        assert.equal(contribution.status, expected.status);
        const marker = memory.indexOf('LIMIT_HEAD_INSTRUCTION');
        const suffix = memory.slice(marker);
        const nativeContent = suffix.split('\n> Only the start of this file is shown.')[0].split('\n</system-reminder>')[0];
        assert.equal(createHash('sha256').update(contribution.content.trimEnd()).digest('hex'), createHash('sha256').update(nativeContent.trimEnd()).digest('hex'));
        assert.equal(contribution.truncation?.limit, expected.limit);
      }
      if (scenario.worktree) {
        const exported = JSON.stringify(portable(report));
        for (const privatePath of [mainRepository, await realpath(mainRepository)]) {
          assert.ok(!exported.includes(JSON.stringify(privatePath).slice(1, -1)), 'Portable worktree approval includes the main checkout path.');
        }
      }
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
  const project = process.platform === 'win32' ? w.repo.replaceAll('\\', '/') : await realpath(w.repo);
  await writeFile(path.join(w.home, '.claude.json'), JSON.stringify({ projects: { [project]: { hasClaudeMdExternalIncludesApproved: true } } }));
  const approved = await scan({ ...w, target: 'src/file.ts', clients: ['claude'], trust: 'trusted' });
  assert.ok(approved.clients[0].instructions.includes('IMPORTED_INSTRUCTION'));
  const excluded = await scan({ ...w, target: 'src/file.ts', clients: ['claude'], trust: 'trusted', user: false });
  assert.ok(!excluded.clients[0].instructions.includes('IMPORTED_INSTRUCTION'));
  assert.equal(excluded.clients[0].decisions.find(source => source.path.endsWith('policy.md'))?.status, 'conditional');
  assert.ok(excluded.sources.every(source => !source.path.startsWith(w.home)));
});

test('uncaptured Claude model choices retain conditional on-demand content', async t => {
  const w = await workspace({
    'CLAUDE.md': 'ROOT_INSTRUCTION\n', 'src/file.ts': '',
    '.claude/settings.json': '{}',
    '.claude/rules/large.md': '---\npaths: ["src/**/*.ts"]\n---\nCONDITIONAL_HEAD\n' + 'x'.repeat(50000),
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  for (const settings of [{}, { model: 'sonnet' }, { model: 'claude-unknown-fixture', env: { CLAUDE_CODE_MAX_CONTEXT_TOKENS: '500000' } }]) {
    await writeFile(path.join(w.repo, '.claude/settings.json'), JSON.stringify(settings));
    const report = await scan({ ...w, target: 'src/file.ts', sessionDirectory: '.', user: false, clients: ['claude'], trust: 'trusted' });
    const source = report.clients[0].decisions.find(source => source.kind === 'rules')!;
    assert.equal(source.status, 'conditional');
    assert.equal(source.truncation, undefined);
    assert.ok(!report.clients[0].instructions.includes('CONDITIONAL_HEAD'));
  }
});

test('Claude model mapping provenance merges entries while picker ownership follows eligible sources', async t => {
  const w = await workspace({
    '.claude/settings.json': '{"modelOverrides":{},"modelPicker":{"options":[{"model":"project-model"}]}}',
  }, {
    '.claude/settings.json': '{"modelOverrides":{"claude-sonnet-4-6":"old-model"},"modelPicker":{"options":[{"model":"personal-model"}]}}',
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, clients: ['claude'], trust: 'trusted' });
  const settings = report.clients[0].settings;
  assert.equal(settings.find(setting => setting.key === 'modelOverrides.claude-sonnet-4-6')?.status, 'active');
  const active = settings.find(setting => setting.key === 'modelOverrides' && setting.status === 'active')!;
  assert.deepEqual(active.value, {});
  assert.deepEqual(active.overrides, []);
  assert.deepEqual(settings.find(setting => setting.key === 'modelPicker.options' && setting.status === 'active')?.value, [{ model: 'personal-model' }]);
  assert.deepEqual(settings.find(setting => setting.key === 'modelPicker.options' && setting.status === 'ignored')?.value, [{ model: 'project-model' }]);
});

test('Claude import origins retain original lines after standalone comments', async t => {
  const w = await workspace({ 'CLAUDE.md': '<!-- hidden -->\n\nROOT_INSTRUCTION\n@docs/policy.md\n', 'docs/policy.md': 'POLICY_INSTRUCTION\n' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['claude'], trust: 'trusted' });
  assert.equal(report.clients[0].decisions.find(source => source.path.endsWith('policy.md'))?.importedFrom?.line, 4);
});

test('truncated instruction prefixes conceal captured private values at the cutoff', async t => {
  const secret = 'private-boundary-captured-value-' + 'z'.repeat(200) + '-tail';
  const body = 'LIMIT_HEAD_INSTRUCTION' + 'x'.repeat(39920) + secret + '\n';
  const w = await workspace({
    'AGENTS.md': body, 'CLAUDE.md': 'ROOT_INSTRUCTION\n\n' + body, 'src/file.ts': '',
    '.claude/rules/large.md': '---\npaths: ["src/**/*.ts"]\n---\n' + body,
    '.claude/settings.json': JSON.stringify({ model: 'claude-sonnet-4-6', env: { PRIVATE_BOUNDARY: secret } }),
    '.codex/config.toml': 'project_doc_max_bytes = 40000\n',
  }, { '.codex/AGENTS.md': body });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, target: 'src/file.ts', sessionDirectory: '.', clients: ['codex', 'claude'], trust: 'trusted' });
  for (const client of report.clients) {
    const contribution = client.decisions.find(source => source.status === 'truncated')!;
    assert.ok(contribution, client.client);
    assert.ok(!contribution.content.includes(secret.slice(0, 40)), client.client + ' exposes a private prefix in instruction content.');
    assert.ok(contribution.content.includes('[REDACTED]'), client.client);
  }
  for (const output of [JSON.stringify(report), JSON.stringify(portable(report)), html(report)]) {
    assert.ok(!output.includes(secret.slice(0, 40)), 'A public output contains a private instruction prefix.');
    assert.ok(!output.includes(secret.slice(-40)), 'A public output contains a private instruction suffix.');
  }
});

test('unresolvable Git metadata makes external approval conditional only when needed', async t => {
  const w = await workspace({ 'CLAUDE.md': 'ROOT_INSTRUCTION\n', 'docs/policy.md': 'IMPORTED_INSTRUCTION\n', 'src/file.ts': 'export {};\n' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  await rm(path.join(w.repo, '.git'), { recursive: true });
  await writeFile(path.join(w.repo, '.git'), 'gitdir: missing-metadata\n');
  const project = process.platform === 'win32' ? w.repo.replaceAll('\\', '/') : await realpath(w.repo);
  await writeFile(path.join(w.home, '.claude.json'), JSON.stringify({ projects: { [project]: { hasClaudeMdExternalIncludesApproved: true } } }));
  const ordinary = await scan({ ...w, target: 'src/file.ts', clients: ['claude'], trust: 'trusted' });
  assert.ok(ordinary.clients[0].instructions.includes('ROOT_INSTRUCTION'));
  assert.ok(!ordinary.findings.some(finding => finding.ruleId === 'claude.project-state'));

  await writeFile(path.join(w.repo, 'CLAUDE.md'), 'ROOT_INSTRUCTION\n@docs/policy.md\n@docs/policy.md\n');
  const external = await scan({ ...w, target: 'src/file.ts', clients: ['claude'], trust: 'trusted' });
  assert.ok(!external.clients[0].instructions.includes('IMPORTED_INSTRUCTION'));
  assert.equal(external.clients[0].decisions.find(source => source.path === path.join(w.repo, 'docs/policy.md'))?.status, 'conditional');
  assert.equal(external.findings.filter(finding => finding.ruleId === 'claude.project-state').length, 1);
});
