import path from 'node:path';
import type { AdapterMetadata, ClientId, Context, Source } from '../core/types.js';
import { readUserTree } from '../core/discovery.js';
import { cmp, finding, locate, matches, slash, within } from '../core/utils.js';
import { adapter, addInstruction, base, decision, effectiveValue, finish, mcp, pathPatterns, rootOf, settings } from './common.js';

const metadata = (id: ClientId, name: string, evidence: string[], limitations: string[]): AdapterMetadata => ({ id, name, maturity: 'experimental', ruleVersion: 'official documentation snapshot 2026-11-12', verifiedOn: '2026-11-12', evidence, limitations });
export const geminiMetadata = metadata('gemini', 'Gemini CLI', ['https://geminicli.com/docs/reference/configuration/', 'https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md'], ['Default user/project settings and ancestor/JIT instruction files only.', 'Imports, extension contexts, policy engine, .env loading and workspace trust are not fully resolved.']);
export const cursorMetadata = metadata('cursor', 'Cursor', ['https://cursor.com/docs/rules', 'https://cursor.com/docs/mcp'], ['Local project rules and AGENTS.md only; editor user/team state and installed plugins are not inspected.', 'Intelligent/manual rules remain conditional; @references are not inlined.']);
export const opencodeMetadata = metadata('opencode', 'OpenCode V2', ['https://opencode.ai/docs/instructions/', 'https://opencode.ai/docs/config/'], ['V2 configuration and AGENTS.md; V1 CLAUDE.md fallback is not asserted.', 'Only in-boundary local files; remote/configured glob instructions, plugins and policy evaluation are not resolved.']);
async function discover(ctx: Context, id: ClientId): Promise<Source[]> {
  if (ctx.options.user !== false) {
    if (id === 'gemini') for (const [n, kind] of [['settings.json', 'settings'], ['GEMINI.md', 'instructions']] as const) await ctx.read(path.join(ctx.home, '.gemini', n), id, kind, 'user');
    if (id === 'cursor') await ctx.read(path.join(ctx.home, '.cursor/mcp.json'), id, 'mcp', 'user');
    if (id === 'opencode') {
      const dir = path.join(ctx.home, '.config/opencode');
      for (const [n, kind] of [['opencode.json', 'settings'], ['opencode.jsonc', 'settings'], ['AGENTS.md', 'instructions']] as const) await ctx.read(path.join(dir, n), id, kind, 'user');
      await readUserTree(ctx, path.join(dir, 'skills'), id, 'skill', 'SKILL.md');
    }
  }
  return ctx.sources.filter(s => s.owners.includes(id));
}
export const gemini = adapter(geminiMetadata, ctx => discover(ctx, 'gemini'), async ctx => {
  const e = await base(geminiMetadata, ctx);
  for (const file of [...(ctx.options.user !== false ? [path.join(ctx.home, '.gemini/settings.json')] : []), path.join(ctx.directory, '.gemini/settings.json')]) {
    const s = ctx.sources.find(s => s.path === file); if (s) { settings(e, s, 'active'); mcp(e, s, s.data.mcpServers, 'mcpServers', 'active'); }
  }
  const filenames = effectiveValue(e, 'context.fileName', 'GEMINI.md');
  const names = Array.isArray(filenames) ? filenames : [filenames];
  for (const dir of [...(ctx.options.user !== false ? [path.join(ctx.home, '.gemini')] : []), ...ctx.dirs]) for (const n of names) {
    if (typeof n !== 'string' || n.includes('/') || n.includes('\\')) continue;
    const s = await ctx.read(path.join(dir, n), 'gemini', 'instructions', within(ctx.repo, dir) ? undefined : 'user');
    if (s) { addInstruction(e, s, 'Global, ancestor or target JIT context file.'); if (/@\S+/.test(s.body)) e.findings.push(finding('experimental.imports', 'info', locate(s), 'Gemini imports require deeper resolution.', 'This experimental adapter displays the literal context; imports are not expanded.', 'Verify the loaded context with Gemini /memory show.', 'gemini')); }
  }
  e.notes.push(...geminiMetadata.limitations); return finish(e, ctx);
});
export const cursor = adapter(cursorMetadata, ctx => discover(ctx, 'cursor'), async ctx => {
  const e = await base(cursorMetadata, ctx);
  for (const d of ctx.dirs) {
    const s = ctx.sources.find(s => s.path === path.join(d, 'AGENTS.md')); if (s) addInstruction(e, s, 'AGENTS.md applies to this directory and its children.');
  }
  for (const s of ctx.sources.filter(s => s.kind === 'rules' && s.owners.includes('cursor')).sort((a, b) => cmp(a.path, b.path))) {
    if (!ctx.dirs.includes(rootOf(s, '.cursor'))) continue;
    if (!s.path.endsWith('.mdc')) { decision(e, s, 'ignored', 'Cursor project rules require .mdc extension.'); e.findings.push(finding('cursor.rule-extension', 'warn', locate(s), 'Cursor ignores a plain .md project rule.', 'The project rules loader requires .mdc.', 'Rename to .mdc and add frontmatter, or use AGENTS.md.', 'cursor')); continue; }
    if (s.data.alwaysApply !== undefined && typeof s.data.alwaysApply !== 'boolean') e.findings.push(finding('cursor.frontmatter-type', 'error', locate(s, 'alwaysApply'), 'alwaysApply must be boolean.', 'Quoted booleans do not select the always-apply rule type.', 'Use alwaysApply: true or false.', 'cursor'));
    const patterns = pathPatterns(e, s, 'globs');
    if (s.data.alwaysApply === true || patterns && matches(slash(path.relative(rootOf(s, '.cursor'), ctx.target)), patterns)) addInstruction(e, s, s.data.alwaysApply ? 'alwaysApply is true; globs are ignored.' : 'globs match the target file.');
    else decision(e, s, patterns ? 'ignored' : 'conditional', patterns ? 'globs do not match this target.' : s.data.description ? 'The agent decides relevance; selection cannot be inferred locally.' : 'Manual @mention is required.', s.body);
  }
  for (const file of [...(ctx.options.user !== false ? [path.join(ctx.home, '.cursor/mcp.json')] : []), path.join(ctx.repo, '.cursor/mcp.json')]) { const s = ctx.sources.find(s => s.path === file); if (s) { decision(e, s, 'active', 'Local Cursor MCP configuration.'); mcp(e, s, s.data.mcpServers, 'mcpServers', 'active'); } }
  e.notes.push(...cursorMetadata.limitations); return finish(e, ctx);
});
export const opencode = adapter(opencodeMetadata, ctx => discover(ctx, 'opencode'), async ctx => {
  const e = await base(opencodeMetadata, ctx);
  const global = path.join(ctx.home, '.config/opencode');
  const layers = [...(ctx.options.user !== false ? [global] : []), ...ctx.dirs, ...ctx.dirs.map(d => path.join(d, '.opencode'))];
  for (const d of layers) for (const n of ['opencode.json', 'opencode.jsonc']) {
    const s = ctx.sources.find(s => s.path === path.join(d, n)); if (!s) continue;
    settings(e, s, 'active');
    if (Array.isArray(s.data.instructions) && s.data.instructions.length) e.findings.push(finding('experimental.configured-instructions', 'info', locate(s, 'instructions'), 'OpenCode configured instruction entries are not expanded.', 'Paths, globs and remote URLs require additional V2 resolution.', 'Verify the configured instruction list in OpenCode.', 'opencode'));
  }
  for (const d of [...(ctx.options.user !== false ? [global] : []), ...[...ctx.dirs].reverse()]) {
    const s = ctx.sources.find(s => s.path === path.join(d, 'AGENTS.md')); if (s && !(ctx.env.OPENCODE_DISABLE_PROJECT_CONFIG === '1' && within(ctx.repo, s.path))) addInstruction(e, s, 'OpenCode V2: global first, then workspace-to-root AGENTS.md (nearest first).');
  }
  e.notes.push(...opencodeMetadata.limitations); return finish(e, ctx);
});
