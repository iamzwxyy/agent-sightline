import path from 'node:path';
import { realpath } from 'node:fs/promises';
import type { AdapterMetadata, Context, Source, Status } from '../core/types.js';
import { readUserTree } from '../core/discovery.js';
import { cmp, finding, locate, matches, plainObject, slash, within } from '../core/utils.js';
import { adapter, addInstruction, base, decision, effectiveValue, expand, finish, hooks, mcp, pathPatterns, skills } from './common.js';
import { copilotSettings, copilotRepositorySettings } from './copilot-settings.js';

export const copilotMetadata: AdapterMetadata = {
  id: 'copilot', name: 'GitHub Copilot CLI', maturity: 'verified', ruleVersion: '1.0.110', verifiedOn: '2026-11-14',
  evidence: ['https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions', 'https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference', 'https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference', 'https://docs.github.com/en/copilot/reference/hooks-reference', 'https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/customization-locations'],
  limitations: ['Copilot CLI rules only; VS Code, code review and cloud-agent rules differ.', 'Applicable instruction files have no documented general precedence; shown order is deterministic display order.', 'Session /instructions toggles, enterprise policy, saved tool permissions and plugin contents are not inferred.', 'Additional customization directories retain unresolved declarations and mark discovery incomplete.', 'Fourteen repository-overridable settings have native merge/type comparisons. Registered personal aliases and file loading have native comparisons. Other personal settings retain partial value-schema coverage.', 'Conflicting same-scope Copilot/Claude settings and workspace MCP file ties remain conditional.'],
};
async function discover(ctx: Context): Promise<Source[]> {
  if (ctx.options.user !== false) {
    for (const [n, kind] of [['copilot-instructions.md', 'instructions'], ['mcp-config.json', 'mcp'], ['settings.json', 'settings'], ['config.json', 'settings']] as const) await ctx.read(path.join(ctx.copilotHome, n), 'copilot', kind, 'user');
    await readUserTree(ctx, path.join(ctx.copilotHome, 'instructions'), 'copilot', 'rules', '.instructions.md');
    await readUserTree(ctx, path.join(ctx.copilotHome, 'skills'), 'copilot', 'skill', 'SKILL.md');
    await readUserTree(ctx, path.join(ctx.copilotHome, 'hooks'), 'copilot', 'hooks', '.json');
    await readUserTree(ctx, path.join(ctx.home, '.agents/skills'), 'copilot', 'skill', 'SKILL.md');
  }
  return ctx.sources.filter(s => s.owners.includes('copilot'));
}
export const copilot = adapter(copilotMetadata, discover, async ctx => {
  const e = await base(copilotMetadata, ctx);
  const state = ctx.sources.find(s => s.path === path.join(ctx.copilotHome, 'config.json'));
  const userSettings = ctx.sources.find(s => s.path === path.join(ctx.copilotHome, 'settings.json'));
  if (state) decision(e, state, 'ignored', 'config.json contains internal state; user settings belong in settings.json in 1.0.110.');
  const directory = await realpath(ctx.directory);
  const trustedFolders = state?.data.trustedFolders ?? state?.data.trusted_folders;
  const trusted = ctx.options.trust === 'trusted' || ctx.options.trust !== 'untrusted' && !state?.invalid && Array.isArray(trustedFolders) && trustedFolders.some((folder: unknown) => typeof folder === 'string' && (within(folder, ctx.directory) || within(folder, directory)));
  const status: Status = trusted ? 'active' : ctx.options.trust === 'untrusted' ? 'ignored' : 'conditional';
  if (userSettings) copilotSettings(e, userSettings, status);
  copilotRepositorySettings(e, ctx, status);
  const seen = new Map<string, Source>();
  const apply = async (s: Source, include: boolean) => {
    const content = s.body.trim();
    const duplicate = seen.get(content);
    if (duplicate) { decision(e, s, 'ignored', 'Copilot deduplicates identical agent/repository instruction bodies.'); e.findings.push(finding('instructions.duplicate', 'info', locate(s), 'Identical instruction body is already loaded.', 'Copilot removes identical non-modular instruction copies.', 'Keep one canonical instruction source.', 'copilot', [locate(duplicate)])); return; }
    seen.set(content, s);
    if (include) await expand(e, ctx, s); else addInstruction(e, s, 'Applicable agent instructions; no general precedence is documented.');
  };
  const personal = ctx.sources.find(s => s.path === path.join(ctx.copilotHome, 'copilot-instructions.md'));
  if (personal) await apply(personal, true);
  for (const d of ctx.dirs) {
    for (const n of ['.github/copilot-instructions.md', 'AGENTS.md', 'CLAUDE.md', '.claude/CLAUDE.md', 'GEMINI.md']) {
      const s = ctx.sources.find(s => s.path === path.join(d, n)); if (s) await apply(s, n !== 'GEMINI.md');
    }
  }
  const moduleRoots = [path.join(ctx.repo, '.github/instructions'), path.join(ctx.directory, '.github/instructions'), ...(ctx.options.user !== false ? [path.join(ctx.copilotHome, 'instructions')] : [])];
  for (const s of ctx.sources.filter(s => s.path.endsWith('.instructions.md') && moduleRoots.some(d => within(d, s.path))).sort((a, b) => cmp(a.path, b.path))) {
    const patterns = pathPatterns(e, s, 'applyTo');
    if (patterns === null) { decision(e, s, 'ignored', 'Modular instructions require applyTo frontmatter.'); e.findings.push(finding('copilot.applyto-missing', 'warn', locate(s), 'Modular instructions have no applyTo matcher.', 'The file is path-specific and has no declared target match.', 'Add applyTo: "**" or a narrower glob.', 'copilot')); continue; }
    if (matches(slash(path.relative(ctx.repo, ctx.target)), patterns)) addInstruction(e, s, 'applyTo glob matches the opened target; excludeAgent does not disable CLI instructions.');
    else decision(e, s, 'ignored', 'applyTo does not match the target file.');
  }
  const sharedRuleRoots = [ctx.repo, ctx.directory].map(directory => path.join(directory, '.claude/rules'));
  for (const source of ctx.sources.filter(source => source.kind === 'rules' && sharedRuleRoots.some(root => within(root, source.path))).sort((a, b) => cmp(a.path, b.path))) {
    const patterns = pathPatterns(e, source, 'paths');
    if (patterns === null || matches(slash(path.relative(ctx.repo, ctx.target)), patterns)) addInstruction(e, source, patterns ? 'Claude paths metadata maps to Copilot applyTo and matches the opened target.' : 'Unconditional Claude rule discovered by Copilot at the repository root or current directory.');
    else decision(e, source, 'ignored', 'The shared rule paths do not match the target file.');
  }
  const userMcp = ctx.sources.find(s => s.path === path.join(ctx.copilotHome, 'mcp-config.json'));
  if (userMcp) { decision(e, userMcp, 'active', 'Personal MCP configuration.'); mcp(e, userMcp, userMcp.data.mcpServers, 'mcpServers', 'active'); }
  for (const d of ctx.dirs) {
    const files = ['.mcp.json', '.github/mcp.json'].map(n => ctx.sources.find(s => s.path === path.join(d, n))).filter((s): s is Source => !!s);
    for (const s of files) { decision(e, s, status, 'Workspace MCP loads from cwd to Git root, after workspace trust; closer definitions win.'); mcp(e, s, s.data.mcpServers, 'mcpServers', status); }
    if (files.length === 2 && plainObject(files[0].data.mcpServers) && plainObject(files[1].data.mcpServers)) {
      const names = Object.keys(files[0].data.mcpServers ?? {}).filter(n => n in (files[1].data.mcpServers ?? {}));
      for (const n of names) {
        e.extensions.filter(x => x.kind === 'mcp' && x.name === n && ['active', 'conditional'].includes(x.status) && files.some(s => s.path === x.location.path)).forEach(x => { x.status = 'conditional'; x.reason = 'Same-directory workspace source tie; authoritative ordering is not documented.'; });
        e.findings.push(finding('copilot.mcp-tie', 'warn', locate(files[0], `mcpServers.${n}`), `MCP server "${n}" has two same-directory workspace definitions.`, 'The official contract defines workspace priority, but not the tie between these two files.', 'Keep the server in one workspace file.', 'copilot', [locate(files[1], `mcpServers.${n}`)]));
      }
    }
  }
  for (const s of ctx.sources.filter(s => s.kind === 'hooks' && s.owners.includes('copilot') && (s.scope === 'user' || within(path.join(ctx.repo, '.github/hooks'), s.path)))) { decision(e, s, 'active', 'User or repository hook definitions.'); if (s.data.version !== 1) e.findings.push(finding('hook.version', 'error', locate(s, 'version'), 'Copilot hook configuration requires version: 1.', 'The hook loader expects schema version 1.', 'Set version to the numeric value 1.', 'copilot')); else hooks(e, s, s.data.hooks, 'active'); }
  const projectSkillRoots = [
    path.join(ctx.directory, '.github/skills'),
    path.join(ctx.directory, '.agents/skills'),
    path.join(ctx.directory, '.claude/skills'),
    ...ctx.dirs.slice(0, -1).reverse().map(d => path.join(d, '.github/skills')),
  ];
  const personalSkillRoots = ctx.options.user !== false ? [path.join(ctx.copilotHome, 'skills'), path.join(ctx.home, '.agents/skills')] : [];
  const ignoredSetting = e.settings.findLast(setting => setting.key === 'ignoredSkillsLocations' && setting.status === 'active');
  const ignoredLocations = ((ignoredSetting?.value ?? []) as string[]).map(location => {
    if (location === '~') return ctx.home;
    if (location.startsWith('~/') || location.startsWith('~' + path.sep)) return path.join(ctx.home, location.slice(2));
    return path.normalize(location);
  }).filter(location => path.isAbsolute(location));
  const ignores = (root: string) => ignoredLocations.some(location => within(location, root));
  // POSIX cwd resolves aliases, while Windows keeps its supplied short-path
  // spelling. Personal roots and exclusion values also retain their spelling.
  const skillDirectory = process.platform === 'win32' ? ctx.directory : directory;
  const ignoredRoots = [
    ...projectSkillRoots.filter(root => ignores(path.resolve(skillDirectory, path.relative(ctx.directory, root)))),
    ...personalSkillRoots.filter(ignores),
  ];
  await skills(e, ctx, [...projectSkillRoots, ...personalSkillRoots], 'first', ignoredRoots);
  const disabledServers = effectiveValue(e, 'disabledMcpServers', []) as string[];
  const disabledSkills = new Set((effectiveValue(e, 'disabledSkills', []) as string[]).map(name => name.toLowerCase()));
  const hookDisableUnknown = e.settings.some(setting => setting.key === 'disableAllHooks' && setting.status === 'conditional');
  for (const extension of e.extensions) {
    if (extension.kind === 'skill' && ignoredSetting && ignoredRoots.some(root => within(root, extension.location.path))) extension.origins = [{ key: 'ignoredSkillsLocations', location: ignoredSetting.location }];
    if (extension.kind === 'hook' && hookDisableUnknown && extension.status === 'active') { extension.status = 'conditional'; extension.reason = 'Conflicting shared settings leave disableAllHooks unresolved.'; continue; }
    const setting = extension.kind === 'mcp' && disabledServers.includes(extension.name) ? 'disabledMcpServers'
      : extension.kind === 'skill' && disabledSkills.has(extension.name.toLowerCase()) ? 'disabledSkills'
      : extension.kind === 'hook' && effectiveValue(e, 'disableAllHooks') === true ? 'disableAllHooks' : null;
    if (setting && ['active', 'conditional'].includes(extension.status)) {
      extension.status = 'ignored'; extension.reason = `Disabled by the effective Copilot ${setting} setting.`;
      if (extension.kind === 'skill') for (const source of e.decisions) if (source.kind === 'skill' && source.path === extension.location.path) { source.status = 'ignored'; source.reason = extension.reason; }
    }
  }
  e.notes.push('Instruction order is stable display order, not an asserted model precedence. Copilot combines applicable files.', 'This report targets Copilot CLI 1.0.110; the 4,000-character code-review limit does not apply to CLI.', 'Workspace trust and enterprise allowlists can restrict MCP servers; session state and remote policies are not inspected.');
  return finish(e, ctx);
});
