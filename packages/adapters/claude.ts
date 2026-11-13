import path from 'node:path';
import type { AdapterMetadata, Context, Source } from '../core/types.js';
import { readUserTree } from '../core/discovery.js';
import { parseSource } from '../core/parse.js';
import { finding, locate, matches, slash, within } from '../core/utils.js';
import { adapter, addInstruction, base, decision, effectiveValue, expand, finish, hooks, mcp, pathPatterns, permissions, rootOf, settings, skills } from './common.js';

export const claudeMetadata: AdapterMetadata = {
  id: 'claude', name: 'Claude Code', maturity: 'verified', ruleVersion: '2.1.322', verifiedOn: '2026-11-13',
  evidence: ['https://code.claude.com/docs/en/memory', 'https://code.claude.com/docs/en/settings', 'https://code.claude.com/docs/en/mcp', 'https://code.claude.com/docs/en/skills', 'https://code.claude.com/docs/en/permissions', 'https://code.claude.com/docs/en/hooks'],
  limitations: ['Repository boundary excludes filesystem ancestors outside --repo; they may contribute instructions.', 'No account-synced or plugin/managed-cloud configuration. AGENTS.md fallback models the documented 2.1.277+ default.', 'Path-scoped rules over 40,000 characters are conditional because model/context-specific limits cannot be inferred. No universal CLAUDE.md truncation budget is invented.', 'Nested skills may also be directory-qualified at runtime; bare-name preference is shown.'],
};
async function discover(ctx: Context): Promise<Source[]> {
  if (ctx.options.user !== false) {
    for (const [n, kind] of [['settings.json', 'settings'], ['CLAUDE.md', 'instructions']] as const) await ctx.read(path.join(ctx.claudeHome, n), 'claude', kind, 'user');
    await ctx.read(path.join(ctx.home, '.claude.json'), 'claude', 'mcp', 'user');
    await readUserTree(ctx, path.join(ctx.claudeHome, 'rules'), 'claude', 'rules', '.md');
    await readUserTree(ctx, path.join(ctx.claudeHome, 'skills'), 'claude', 'skill', 'SKILL.md');
  }
  if (ctx.options.system) {
    const system = process.platform === 'darwin' ? '/Library/Application Support/ClaudeCode' : process.platform === 'win32' ? path.join(ctx.env.ProgramFiles ?? 'C:\\Program Files', 'ClaudeCode') : '/etc/claude-code';
    await ctx.read(path.join(system, 'managed-settings.json'), 'claude', 'settings', 'system');
    await ctx.read(path.join(system, 'CLAUDE.md'), 'claude', 'instructions', 'system');
  }
  return ctx.sources.filter(s => s.owners.includes('claude'));
}
export const claude = adapter(claudeMetadata, discover, async ctx => {
  const e = await base(claudeMetadata, ctx);
  const user = ctx.sources.find(s => s.path === path.join(ctx.claudeHome, 'settings.json'));
  const layers = [user, ctx.sources.find(s => s.path === path.join(ctx.repo, '.claude/settings.json')), ctx.sources.find(s => s.path === path.join(ctx.repo, '.claude/settings.local.json')), ...ctx.sources.filter(s => s.scope === 'system' && s.owners.includes('claude') && s.kind === 'settings')].filter((s): s is Source => !!s).map(source => {
    if (source.invalid || !source.owners.includes('copilot')) return source;
    const strict: Source = { ...source, owners: ['claude'], lines: {}, valueRanges: [] };
    e.findings.push(...parseSource(strict).map(finding => ({ ...finding, client: 'claude' as const })));
    return strict;
  });
  for (const s of layers) {
    const excluded = ctx.options.trust !== 'trusted' && s.scope !== 'user' && s.scope !== 'system' ? ['enableAllProjectMcpServers', 'enabledMcpjsonServers'] : [];
    const data = Object.fromEntries(Object.entries(s.data).filter(([key]) => !excluded.includes(key)));
    settings(e, s, 'active', true, data);
    if (!s.invalid) for (const key of excluded) if (s.data[key] !== undefined) e.settings.push({ key, value: s.data[key], location: locate(s, key), status: 'ignored', reason: 'Workspace MCP approval settings require explicit trust.', overrides: [] });
    hooks(e, s, s.data.hooks, 'active'); permissions(e, s, 'active');
  }
  const excludes = effectiveValue(e, 'claudeMdExcludes', []);
  const excluded = (s: Source) => s.scope !== 'system' && Array.isArray(excludes) && matches(slash(s.path), excludes.filter(x => typeof x === 'string'));
  const mode = user?.data.pluginConfigs?.['cc-plugin-agents-md@builtin']?.options?.instructionFiles ?? 'claude-md-or-agents-md';
  const hasClaude = ctx.sources.some(s => ctx.dirs.some(d => ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md'].some(n => s.path === path.join(d, n))));
  const useAgents = mode === 'claude-md-and-agents-md' || mode === 'claude-md-or-agents-md' && !hasClaude;
  for (const s of ctx.sources.filter(s => s.kind === 'instructions' && (s.scope === 'system' || s.path === path.join(ctx.claudeHome, 'CLAUDE.md')) && s.owners.includes('claude'))) {
    if (mode !== 'managed-only' || s.scope === 'system') await expand(e, ctx, s);
  }
  for (const d of ctx.dirs) {
    for (const n of ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.claude/AGENTS.md']) {
      const s = ctx.sources.find(s => s.path === path.join(d, n)); if (!s) continue;
      const agent = n.includes('AGENTS.md');
      if (mode === 'managed-only' || agent && !useAgents || !agent && mode === 'managed-only') { decision(e, s, 'ignored', agent ? 'AGENTS.md is disabled by the instruction mode or an ancestor CLAUDE.md/CLAUDE.local.md.' : 'Project instruction mode is managed-only.'); continue; }
      if (excluded(s)) { decision(e, s, 'ignored', 'Excluded by claudeMdExcludes.'); continue; }
      await expand(e, ctx, s);
    }
  }
  for (const s of ctx.sources.filter(s => s.kind === 'rules' && s.owners.includes('claude')).sort((a, b) => (a.scope === 'user' ? -1 : 1) - (b.scope === 'user' ? -1 : 1) || a.path.localeCompare(b.path))) {
    const baseDir = s.scope === 'user' ? ctx.directory : rootOf(s, '.claude');
    if (s.scope !== 'user' && !ctx.dirs.includes(baseDir)) continue;
    if (excluded(s) || mode === 'managed-only') { decision(e, s, 'ignored', 'Excluded by instruction mode or claudeMdExcludes.'); continue; }
    const patterns = pathPatterns(e, s, 'paths');
    if (patterns && !matches(slash(path.relative(baseDir, ctx.target)), patterns, true)) { decision(e, s, 'ignored', 'paths frontmatter does not match the target file.'); continue; }
    if (patterns && s.body.length > 40000) { decision(e, s, 'conditional', 'On-demand rule exceeds the 200K-context per-file character limit; exact truncation depends on model/context size.', s.body); e.findings.push(finding('claude.conditional-truncation', 'warn', locate(s), 'Path-scoped rule may be truncated by the model-specific character limit.', '2.1.309+ uses 40,000 characters for 200K context and larger limits for 1M context.', 'Shorten the rule or verify the session context limit.', 'claude')); }
    else addInstruction(e, s, patterns ? 'paths frontmatter matches the opened target file.' : 'Unconditional rule in the user/project rules directory.');
  }
  const globalMcp = ctx.sources.find(s => s.path === path.join(ctx.home, '.claude.json'));
  if (globalMcp) { decision(e, globalMcp, 'active', 'Only global and this project’s MCP entries are inspected; session/account state is not exported.'); mcp(e, globalMcp, globalMcp.data.mcpServers, 'mcpServers', 'active'); }
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
    const projectDecision = decision(e, projectMcp, 'conditional', 'Project MCP definitions need server approval in interactive sessions.');
    mcp(e, projectMcp, projectMcp.data.mcpServers, 'mcpServers', 'conditional');
    const projectEntries = e.extensions.filter(x => x.kind === 'mcp' && x.location.path === projectMcp.path);
    for (const x of projectEntries) {
      if (x.status === 'invalid') continue;
      if (disabled.includes(x.name)) { x.status = 'ignored'; x.reason = 'disabledMcpjsonServers blocks this server.'; }
      else if (enabled || approved.includes(x.name) || ctx.options.trust === 'trusted') {
        x.status = 'active'; x.reason = ctx.options.trust === 'trusted' ? 'Project/server approval explicitly assumed by --trust trusted.' : 'Enabled by a user or managed MCP approval setting.';
        const old = e.extensions.find(y => y !== x && y.kind === 'mcp' && y.name === x.name && y.status === 'active'); if (old) { old.status = 'shadowed'; old.reason = 'Project MCP definition takes priority over user scope.'; }
      }
      else x.reason = 'Project MCP approval is pending. Repository approval settings require an explicitly trusted workspace.';
    }
    if (!projectMcp.invalid && projectEntries.every(extension => extension.status !== 'conditional')) {
      projectDecision.status = 'active'; projectDecision.reason = 'Project MCP definitions are inspected with their individual approval and validation states.';
    }
  }
  if (globalMcp) mcp(e, globalMcp, globalMcp.data.projects?.[ctx.repo]?.mcpServers, `projects.${ctx.repo}.mcpServers`, 'active');
  await skills(e, ctx, [...(ctx.options.user !== false ? [path.join(ctx.claudeHome, 'skills')] : []), ...ctx.dirs.map(d => path.join(d, '.claude/skills'))], 'first');
  for (const x of e.extensions.filter(x => x.kind === 'skill')) if (['synced', 'anthropic-skills'].includes(x.name)) { x.status = 'ignored'; x.reason = 'Reserved Claude skill directory name.'; }
  e.notes.push(`Project instruction mode: ${mode}. AGENTS.md fallback: ${useAgents ? 'enabled' : 'disabled'}.`, 'CLAUDE.md and rule bodies accumulate; local instruction files are appended per directory.', 'Ancestors outside --repo, session source switches, external import approval, accounts, plugins and managed cloud policies are outside this static report.');
  if (ctx.dirs.some(d => d !== ctx.repo) && layers.every(s => !within(ctx.directory, s.path))) e.notes.push('Settings resolution models the repository project, while instruction discovery follows the target directory chain.');
  return finish(e, ctx);
});
