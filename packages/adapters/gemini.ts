import path from 'node:path';
import { realpath } from 'node:fs/promises';
import type { AdapterMetadata, Context, Effective, Source } from '../core/types.js';
import { finding, locate, within } from '../core/utils.js';
import { adapter, base, decision, finish, mcp, settings } from './common.js';
import { resolveGeminiMemory } from './gemini-memory.js';

export const geminiMetadata: AdapterMetadata = {
  id: 'gemini', name: 'Gemini CLI', maturity: 'experimental', verifiedOn: '2026-11-15',
  ruleVersion: '0.68.0 startup, trust and context imports',
  evidence: [
    'https://geminicli.com/docs/reference/configuration/',
    'https://geminicli.com/docs/cli/trusted-folders/',
    'https://github.com/google-gemini/gemini-cli/blob/v0.68.0/packages/cli/src/config/settings.ts',
    'https://github.com/google-gemini/gemini-cli/blob/v0.68.0/packages/core/src/utils/trust.ts',
    'https://github.com/google-gemini/gemini-cli/blob/v0.68.0/packages/core/src/utils/paths.ts',
    'https://github.com/google-gemini/gemini-cli/blob/v0.68.0/packages/core/src/utils/memoryImportProcessor.ts',
  ],
  limitations: [
    'User/project settings, persisted folder trust, bare context filenames and in-boundary context imports have executable comparisons with published 0.68.0 modules.',
    'IDE trust, system settings, extension contexts, hooks, skills, policy, .env loading, user-project memory and additional workspaces remain partial.',
  ],
};

interface WorkspaceTrust {
  status: 'active' | 'ignored' | 'conditional';
  reason: string;
  blocked?: boolean;
}

function normalized(filename: string, directory: string): string {
  const absolute = path.resolve(directory, filename);
  return process.platform === 'win32' || process.platform === 'darwin' ? absolute.toLowerCase() : absolute;
}

async function canonical(filename: string): Promise<string> {
  return realpath(filename).catch(() => filename);
}

async function workspaceTrust(e: Effective, ctx: Context, user: Source | null, project: Source | null): Promise<WorkspaceTrust> {
  if (user?.invalid || project?.invalid) return { status: 'ignored', blocked: true, reason: 'Gemini startup stops because an applicable settings file has invalid JSON.' };
  if (ctx.options.trust === 'trusted') return { status: 'active', reason: 'The inspection assumes a trusted Gemini workspace.' };
  if (ctx.options.trust === 'untrusted') return { status: 'ignored', reason: 'The inspection assumes an untrusted Gemini workspace.' };
  if (ctx.env.GEMINI_RESTRICTED_MODE === 'true' || ctx.env.GEMINI_CLI_TRUST_WORKSPACE === 'false') return { status: 'ignored', reason: 'Gemini workspace trust is disabled by its process environment.' };
  if (ctx.env.GEMINI_CLI_TRUST_WORKSPACE === 'true') return { status: 'active', reason: 'Gemini workspace trust is granted by GEMINI_CLI_TRUST_WORKSPACE.' };
  if (user?.data.security?.folderTrust?.enabled === false) return { status: 'active', reason: 'User settings disable the folder-trust check.' };
  const pending: WorkspaceTrust = { status: 'conditional', reason: 'Gemini folder trust awaits approval. Project settings and context apply after the workspace is trusted.' };
  if (ctx.options.user === false) return pending;
  const runtime = ctx.env.SANDBOX === 'sandbox-exec' ? path.join(path.dirname(ctx.geminiHome), '.cache/.gemini') : ctx.geminiHome;
  const filename = ctx.env.GEMINI_CLI_TRUSTED_FOLDERS_PATH ? path.resolve(ctx.directory, ctx.env.GEMINI_CLI_TRUSTED_FOLDERS_PATH) : path.join(runtime, 'trustedFolders.json');
  const source = await ctx.read(filename, 'gemini', 'settings', 'user', { format: 'json' });
  if (!source) return pending;
  (ctx.privateStatePaths ??= new Set()).add(source.path);
  const privateValues = new Set(Object.keys(source.data));
  for (const range of source.valueRanges ?? []) {
    if (typeof range.value === 'string' && !['TRUST_FOLDER', 'TRUST_PARENT', 'DO_NOT_TRUST'].includes(range.value)) privateValues.add(range.value);
  }
  (ctx.privateSourceValues ??= new Map()).set(source.path, privateValues);
  for (const item of ctx.findings) if (item.location.path === source.path && item.ruleId === 'parse.duplicate-key') item.message = 'Duplicate key in saved Gemini folder trust.';
  if (source.invalid) {
    decision(e, source, 'invalid', 'Gemini cannot load an invalid saved folder-trust file.');
    return { status: 'ignored', blocked: true, reason: 'Gemini startup stops because saved folder trust cannot be parsed.' };
  }
  const rules = new Map<string, { key: string; level: string }>();
  let invalid = false;
  for (const [key, level] of Object.entries(source.data)) {
    if (!['TRUST_FOLDER', 'TRUST_PARENT', 'DO_NOT_TRUST'].includes(level)) {
      const location = locate(source, key);
      delete location.key;
      e.findings.push(finding('gemini.trust-level', 'error', location, 'Saved Gemini folder trust has an invalid level.', 'Gemini stops before loading workspace configuration when any trust entry is invalid.', 'Use TRUST_FOLDER, TRUST_PARENT or DO_NOT_TRUST for each saved entry.', 'gemini'));
      invalid = true;
    } else rules.set(normalized(key, ctx.directory), { key, level });
  }
  if (invalid) {
    decision(e, source, 'invalid', 'Gemini cannot load saved folder trust with an invalid entry.');
    return { status: 'ignored', blocked: true, reason: 'Gemini startup stops because a saved folder-trust entry is invalid.' };
  }
  const directory = normalized(await canonical(ctx.directory), ctx.directory);
  let selected: { key: string; level: string; root: string; length: number } | undefined;
  for (const [key, rule] of rules) {
    ctx.options.signal?.throwIfAborted();
    const root = rule.level === 'TRUST_PARENT' ? path.dirname(key) : key;
    const comparisonRoot = normalized(await canonical(root), ctx.directory);
    if (within(comparisonRoot, directory) && (!selected || key.length > selected.length)) selected = { ...rule, root, length: key.length };
  }
  decision(e, source, 'active', selected ? 'Saved Gemini folder-trust entry selected for this workspace.' : 'No saved Gemini folder-trust entry matches this workspace.');
  if (!selected) return pending;
  privateValues.delete(selected.key);
  ctx.geminiTrustRoot = selected.root;
  const location = locate(source, selected.key);
  const trusted = selected.level !== 'DO_NOT_TRUST';
  const reason = trusted ? 'The selected saved trust rule permits this workspace.' : 'The selected saved trust rule rejects this workspace.';
  e.settings.push({ key: selected.key, value: selected.level, status: 'active', location, reason, overrides: [] });
  return { status: trusted ? 'active' : 'ignored', reason };
}

function configuration(e: Effective, user: Source | null, project: Source | null, trust: WorkspaceTrust): void {
  const serverStatus = trust.status === 'conditional' ? 'active' : trust.status;
  if (user) {
    settings(e, user, trust.blocked ? 'ignored' : 'active');
    mcp(e, user, user.data.mcpServers, 'mcpServers', serverStatus);
  }
  if (project) {
    settings(e, project, trust.status);
    const source = e.decisions.at(-1)!;
    source.reason = project.invalid ? source.reason : trust.reason;
    mcp(e, project, project.data.mcpServers, 'mcpServers', serverStatus);
  }
  for (const extension of e.extensions) {
    if (trust.status === 'conditional' && extension.status === 'active') {
      extension.status = 'conditional';
      extension.reason = 'This MCP server can connect after Gemini workspace approval.';
    }
    if (extension.status === 'ignored') extension.reason = trust.reason;
  }
}

async function discover(ctx: Context): Promise<Source[]> {
  if (ctx.options.user !== false) {
    await ctx.read(path.join(ctx.geminiHome, 'settings.json'), 'gemini', 'settings', 'user');
    await ctx.read(path.join(ctx.geminiHome, 'GEMINI.md'), 'gemini', 'instructions', 'user');
  }
  return ctx.sources.filter(source => source.owners.includes('gemini'));
}

export const gemini = adapter(geminiMetadata, discover, async ctx => {
  const e = await base(geminiMetadata, ctx);
  const user = ctx.options.user === false ? null : await ctx.read(path.join(ctx.geminiHome, 'settings.json'), 'gemini', 'settings', 'user');
  const sameHome = normalized(await canonical(ctx.directory), ctx.directory) === normalized(await canonical(path.dirname(ctx.geminiHome)), ctx.directory);
  const project = sameHome ? null : await ctx.read(path.join(ctx.directory, '.gemini/settings.json'), 'gemini', 'settings');
  const trust = await workspaceTrust(e, ctx, user, project);
  configuration(e, user, project, trust);
  e.notes.push(trust.reason);
  if (trust.blocked) {
    for (const source of ctx.sources.filter(source => source.owners.includes('gemini') && source.kind === 'instructions')) decision(e, source, 'ignored', trust.reason);
  } else {
    await resolveGeminiMemory(e, ctx, trust.status === 'active');
    if (trust.status === 'conditional') {
      const candidate = await base(geminiMetadata, ctx);
      configuration(candidate, user, project, { status: 'active', reason: 'Configuration after Gemini workspace approval.' });
      await resolveGeminiMemory(candidate, ctx);
      for (const entry of candidate.decisions.filter(entry => entry.kind === 'instructions')) {
        if (e.decisions.some(current => current.sourceId === entry.sourceId && current.line === entry.line && current.column === entry.column && current.content === entry.content)) continue;
        entry.status = 'conditional';
        entry.reason = 'Context contribution in native trusted loading order, after workspace approval.';
        e.decisions.push(entry);
      }
      e.findings.push(...candidate.findings.map(item => ({ ...item, why: 'After workspace approval, ' + item.why[0].toLowerCase() + item.why.slice(1) })));
      e.notes.push('Effective text shows the pre-approval global context. Conditional sources describe the context after workspace approval. Select an explicit trust assumption to inspect that resolved state.');
    }
    if (trust.status === 'ignored') for (const source of ctx.sources.filter(source => source.owners.includes('gemini') && source.kind === 'instructions' && source.scope !== 'user' && ctx.dirs.includes(path.dirname(source.path)))) decision(e, source, 'ignored', trust.reason);
  }
  e.notes.push(...geminiMetadata.limitations);
  return finish(e, ctx);
});
