import path from 'node:path';
import type { Adapter, AdapterMetadata, Context, Source, Status } from '../core/types.js';
import { readUserTree } from '../core/discovery.js';
import { parseSource } from '../core/parse.js';
import { finding, locate, plainObject, within } from '../core/utils.js';
import { adapter, base, decision, finish, hooks, mcp, permissions, settings, skills } from './common.js';
import { applyClaudePolicy, claudeSettingsSource, discoverClaudeManagedSettings } from './claude-policy.js';
import { applyClaudeMcpPolicy, claudeExclusiveMcpLocation, claudeMcpSettingsSource } from './claude-mcp.js';
import { probeMcp, validateExtensions } from '../core/extensions.js';
import { resolveClaudeMemory } from './claude-memory.js';
import { claudeProjectStateRoot, claudeStatePath } from './claude-project.js';
import { applyClaudeModelSettings } from './claude-model.js';

export const claudeMetadata: AdapterMetadata = {
  id: 'claude', name: 'Claude Code', maturity: 'verified', ruleVersion: '2.1.322', verifiedOn: '2026-11-16',
  evidence: ['https://code.claude.com/docs/en/memory', 'https://code.claude.com/docs/en/settings', 'https://code.claude.com/docs/en/mcp', 'https://code.claude.com/docs/en/skills', 'https://code.claude.com/docs/en/permissions', 'https://code.claude.com/docs/en/hooks', 'https://code.claude.com/docs/en/managed-settings', 'https://code.claude.com/docs/en/settings-reference', 'https://code.claude.com/docs/en/managed-mcp'],
  limitations: [
    'Repository boundary excludes filesystem ancestors outside --repo; they may contribute instructions.',
    'No account-synced or plugin/managed-cloud configuration. AGENTS.md fallback models the documented 2.1.277+ default.',
    'On-demand character budgets use captured model settings and environment inputs. Unpinned aliases, account-selected defaults, unknown context, automatic legacy Opus 4.0/4.1 remapping and managed model allowlists retain conditional limits. Startup instructions retain complete content within the inspection read limit.',
    'Nested skills may also be directory-qualified at runtime; bare-name preference is shown.',
    'Local permission grants without explicit workspace trust depend on native Git and session checks; shown as conditional. Session permission modes and the remaining tool inventory are outside this static inspection.',
    'Managed file-policy results assume the file-based tier is selected. Remote, MDM, registry and embedding-host selection require session evidence. Managed schema repairs cover the implemented Boolean controls, permission lists and MCP lists/provided entries.',
  ],
};
async function discover(ctx: Context): Promise<Source[]> {
  if (ctx.options.user !== false) {
    for (const [n, kind] of [['settings.json', 'settings'], ['CLAUDE.md', 'instructions']] as const) await ctx.read(path.join(ctx.claudeHome, n), 'claude', kind, 'user');
    await ctx.read(claudeStatePath(ctx), 'claude', 'mcp', 'user');
    await readUserTree(ctx, path.join(ctx.claudeHome, 'rules'), 'claude', 'rules', '.md');
    await readUserTree(ctx, path.join(ctx.claudeHome, 'skills'), 'claude', 'skill', 'SKILL.md');
  }
  if (ctx.options.system) {
    await discoverClaudeManagedSettings(ctx);
  }
  return ctx.sources.filter(s => s.owners.includes('claude'));
}
const sessionEnvironments = new WeakMap<Context, NodeJS.ProcessEnv>();
const claudeAdapter = adapter(claudeMetadata, discover, async ctx => {
  const e = await base(claudeMetadata, ctx);
  const user = ctx.options.user !== false ? ctx.sources.find(s => s.path === path.join(ctx.claudeHome, 'settings.json')) : undefined;
  const layers = [user, ctx.sources.find(s => s.path === path.join(ctx.repo, '.claude/settings.json')), ctx.sources.find(s => s.path === path.join(ctx.repo, '.claude/settings.local.json')), ...ctx.sources.filter(s => s.scope === 'system' && s.owners.includes('claude') && s.kind === 'settings')].filter((s): s is Source => !!s).map(source => {
    let strict = source;
    if (!source.invalid && source.owners.includes('copilot')) {
      strict = { ...source, owners: ['claude'], lines: {}, valueRanges: [] };
      e.findings.push(...parseSource(strict).map(finding => ({ ...finding, client: 'claude' as const })));
    }
    return claudeMcpSettingsSource(e, claudeSettingsSource(e, strict));
  });
  const permissionPolicy = layers.findLast(source => !source.invalid && source.scope === 'system' && typeof source.data.allowManagedPermissionRulesOnly === 'boolean');
  const hookPolicy = layers.findLast(source => !source.invalid && source.scope === 'system' && typeof source.data.allowManagedHooksOnly === 'boolean');
  const hookDisable = layers.findLast(source => !source.invalid && typeof source.data.disableAllHooks === 'boolean');
  const mcpPolicy = layers.findLast(source => !source.invalid && source.scope === 'system' && typeof source.data.allowManagedMcpServersOnly === 'boolean');
  for (const s of layers) {
    const excluded = ctx.options.trust !== 'trusted' && s.scope !== 'user' && s.scope !== 'system' ? ['enableAllProjectMcpServers', 'enabledMcpjsonServers'] : [];
    let hookGate: Source | undefined;
    let hookGateKey = 'allowManagedHooksOnly';
    if (hookDisable?.data.disableAllHooks === true && (s.scope !== 'system' || hookDisable.scope === 'system')) { hookGate = hookDisable; hookGateKey = 'disableAllHooks'; }
    else if (s.scope !== 'system' && hookPolicy?.data.allowManagedHooksOnly === true) hookGate = hookPolicy;
    if (hookGate) excluded.push('hooks');
    if (s.scope !== 'system' && mcpPolicy?.data.allowManagedMcpServersOnly === true) excluded.push('allowedMcpServers');
    const data = Object.fromEntries(Object.entries(s.data).filter(([key]) => !excluded.includes(key)));
    delete data.managedMcpServers;
    delete data.modelPicker;
    if (!s.invalid && permissionPolicy?.data.allowManagedPermissionRulesOnly === true && s.scope !== 'system' && plainObject(data.permissions)) {
      data.permissions = { ...data.permissions };
      for (const key of ['allow', 'ask', 'deny']) if (Object.hasOwn(data.permissions, key)) {
        e.settings.push({ key: 'permissions.' + key, value: data.permissions[key], status: 'ignored', location: locate(s, 'permissions.' + key), reason: `Only managed permission rules apply under ${permissionPolicy.path}.`, overrides: [] });
        e.findings.push(finding('claude.policy-ignored', 'info', locate(s, 'permissions.' + key), `Claude ignores permissions.${key} under managed-only policy.`, 'allowManagedPermissionRulesOnly restricts settings-file permission rules to managed policy.', 'Review the controlling managed policy before changing this declaration.', 'claude', [locate(permissionPolicy, 'allowManagedPermissionRulesOnly')]));
        delete data.permissions[key];
      }
      if (Object.keys(data.permissions).length === 0) delete data.permissions;
    }
    const local = path.basename(s.path) === 'settings.local.json';
    const grantStatus: Status = s.scope === 'user' || s.scope === 'system' || ctx.options.trust === 'trusted' ? 'active'
      : local || ctx.options.trust !== 'untrusted' ? 'conditional' : 'ignored';
    const grantReason = grantStatus === 'active' ? 'Allow rule discovered in an applicable settings layer.'
      : local ? 'Local grants depend on workspace trust, Git tracking and session trust checks. These runtime checks are outside this inspection.'
      : 'Shared project grants become available after workspace trust.';
    const grants: [string, unknown][] = [];
    if (grantStatus !== 'active' && plainObject(data.permissions)) {
      const restricted = { ...data.permissions };
      for (const key of ['allow', 'additionalDirectories']) if (Object.hasOwn(restricted, key)) { grants.push([key, restricted[key]]); delete restricted[key]; }
      if (grants.length > 0 && Object.keys(restricted).length === 0) delete data.permissions;
      else data.permissions = restricted;
    }
    settings(e, s, 'active', true, data);
    if (!s.invalid) for (const [key, value] of grants) e.settings.push({ key: 'permissions.' + key, value, status: grantStatus, location: locate(s, 'permissions.' + key), reason: grantReason, overrides: [] });
    if (!s.invalid) for (const key of excluded) if (s.data[key] !== undefined) {
      e.settings.push({ key, value: s.data[key], location: locate(s, key), status: 'ignored', reason: key === 'hooks' ? `Hooks are disabled by ${hookGateKey}.` : key === 'allowedMcpServers' ? 'Only the managed MCP allowlist applies under allowManagedMcpServersOnly.' : 'Workspace MCP approval settings require explicit trust.', overrides: [] });
      if (key === 'hooks') e.findings.push(finding('claude.policy-ignored', 'info', locate(s, key), `Claude ignores these hooks under ${hookGateKey}.`, 'The effective hook control excludes handlers from this settings layer.', 'Review the controlling setting to confirm which hooks can run.', 'claude', [locate(hookGate!, hookGateKey)]));
      if (key === 'allowedMcpServers') e.findings.push(finding('claude.policy-ignored', 'info', locate(s, key), 'Claude ignores this ordinary MCP allowlist under managed-only policy.', 'allowManagedMcpServersOnly restricts the allowlist to managed sources. Denials still merge from every scope.', 'Review the controlling managed policy.', 'claude', [locate(mcpPolicy!, 'allowManagedMcpServersOnly')]));
    }
    hooks(e, s, s.data.hooks, 'active'); permissions(e, s, 'active', { status: grantStatus, reason: grantReason }, s.permissionLocations);
  }
  applyClaudeModelSettings(e, layers);
  const mode = layers.find(source => source.path === user?.path && !source.invalid)?.data.pluginConfigs?.['cc-plugin-agents-md@builtin']?.options?.instructionFiles ?? 'claude-md-or-agents-md';
  const globalMcp = ctx.options.user !== false ? ctx.sources.find(s => s.path === claudeStatePath(ctx)) : undefined;
  await resolveClaudeMemory(e, ctx, mode, globalMcp, layers);
  const exclusiveMcp = claudeExclusiveMcpLocation(ctx);
  const ordinaryMcpStatus = exclusiveMcp ? 'ignored' : 'active';
  const exclusiveReason = 'The exclusive managed MCP file suppresses ordinary MCP sources.';
  if (globalMcp) { decision(e, globalMcp, ordinaryMcpStatus, exclusiveMcp ? exclusiveReason + ' Project external-import approval is also inspected from this state file.' : 'Global/current-project MCP entries and project external-import approval are inspected.'); mcp(e, globalMcp, globalMcp.data.mcpServers, 'mcpServers', ordinaryMcpStatus); }
  const validLayers = layers.filter(source => !source.invalid);
  const stringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
  for (const source of validLayers) for (const key of ['enableAllProjectMcpServers', 'enabledMcpjsonServers', 'disabledMcpjsonServers']) {
    const value = source.data[key];
    if (value !== undefined && (key === 'enableAllProjectMcpServers' ? typeof value !== 'boolean' : !stringArray(value))) e.findings.push(finding('claude.mcp-approval-type', 'error', locate(source, key), `Claude MCP approval setting "${key}" has an invalid type.`, key === 'enableAllProjectMcpServers' ? 'This setting requires a boolean.' : 'This setting requires an array of server-name strings.', 'Use the documented approval setting type.', 'claude'));
  }
  const projectMcp = ctx.sources.find(s => s.path === path.join(ctx.repo, '.mcp.json'));
  if (projectMcp) {
    const approvalLayers = validLayers.filter(source => source.scope === 'user' || source.scope === 'system');
    const enabled = approvalLayers.findLast(source => source.data.enableAllProjectMcpServers !== undefined)?.data.enableAllProjectMcpServers === true;
    const approved = approvalLayers.flatMap(source => stringArray(source.data.enabledMcpjsonServers) ? source.data.enabledMcpjsonServers : []);
    const disabled = validLayers.flatMap(source => stringArray(source.data.disabledMcpjsonServers) ? source.data.disabledMcpjsonServers : []);
    const projectDecision = decision(e, projectMcp, exclusiveMcp ? 'ignored' : 'conditional', exclusiveMcp ? exclusiveReason : 'Project MCP definitions need server approval in interactive sessions.');
    mcp(e, projectMcp, projectMcp.data.mcpServers, 'mcpServers', exclusiveMcp ? 'ignored' : 'conditional');
    const projectEntries = e.extensions.filter(x => x.kind === 'mcp' && x.location.path === projectMcp.path);
    for (const x of projectEntries) {
      if (exclusiveMcp || x.status === 'invalid') continue;
      if (disabled.includes(x.name)) { x.status = 'ignored'; x.reason = 'disabledMcpjsonServers blocks this server.'; }
      else if (enabled || approved.includes(x.name) || ctx.options.trust === 'trusted') {
        x.status = 'active'; x.reason = ctx.options.trust === 'trusted' ? 'Project/server approval explicitly assumed by --trust trusted.' : 'Enabled by a user or managed MCP approval setting.';
        const old = e.extensions.find(y => y !== x && y.kind === 'mcp' && y.name === x.name && y.status === 'active'); if (old) { old.status = 'shadowed'; old.reason = 'Project MCP definition takes priority over user scope.'; }
      }
      else x.reason = 'Project MCP approval is pending. Repository approval settings require an explicitly trusted workspace.';
    }
    if (!exclusiveMcp && !projectMcp.invalid && projectEntries.every(extension => extension.status !== 'conditional')) {
      projectDecision.status = 'active'; projectDecision.reason = 'Project MCP definitions are inspected with their individual approval and validation states.';
    }
  }
  if (globalMcp && !globalMcp.invalid && Object.values(globalMcp.data.projects ?? {}).some(project => plainObject(project) && project.mcpServers !== undefined)) {
    try {
      const project = await claudeProjectStateRoot(ctx);
      const start = e.extensions.length;
      mcp(e, globalMcp, globalMcp.data.projects?.[project]?.mcpServers, `projects.${project}.mcpServers`, ordinaryMcpStatus);
      for (const local of e.extensions.slice(start)) if (local.status === 'active') local.reason = 'Local MCP server configured for this project in ~/.claude.json.';
    } catch {
      ctx.options.signal?.throwIfAborted();
      if (ordinaryMcpStatus === 'active') e.findings.push(finding('claude.project-state', 'warn', locate(globalMcp), 'Local MCP project state cannot be resolved.', 'The selected Git directory pointer or shared-worktree metadata could not be inspected.', 'Repair the Git metadata and rerun the inspection.', 'claude'));
    }
  }
  sessionEnvironments.set(ctx, applyClaudeMcpPolicy(e, ctx, layers).live);
  await skills(e, ctx, [...(ctx.options.user !== false ? [path.join(ctx.claudeHome, 'skills')] : []), ...ctx.dirs.map(d => path.join(d, '.claude/skills'))], 'first');
  for (const x of e.extensions.filter(x => x.kind === 'skill')) if (['synced', 'anthropic-skills'].includes(x.name)) { x.status = 'ignored'; x.reason = 'Reserved Claude skill directory name.'; }
  applyClaudePolicy(e, ctx);
  e.notes.push(ctx.options.system ? 'Managed file-policy results assume this machine selects the file-based tier. Remote, MDM, registry and embedding-host selection require session evidence.' : 'System file policy is excluded. Add --system to inspect managed permissions, hooks and MCP controls.');
  if (ctx.dirs.some(d => d !== ctx.repo) && layers.every(s => !within(ctx.directory, s.path))) e.notes.push('Settings resolution models the repository project, while instruction discovery follows the target directory chain.');
  return finish(e, ctx);
});

export const claude: Adapter = {
  ...claudeAdapter,
  validate: (ctx, effective) => validateExtensions({ ...ctx, env: sessionEnvironments.get(ctx) ?? ctx.env }, effective),
  probe: (extension, ctx) => probeMcp(extension, { ...ctx, env: sessionEnvironments.get(ctx) ?? ctx.env }, 'claude'),
};
