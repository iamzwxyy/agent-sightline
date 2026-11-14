import path from 'node:path';
import { realpath } from 'node:fs/promises';
import type { Context, Effective, Location, Source, Status } from '../core/types.js';
import { findRepositoryRoot } from '../core/discovery.js';
import { finding, locate, matches, slash, stripComments, within } from '../core/utils.js';
import { addInstruction, decision, effectiveValue, imports, pathPatterns, rootOf } from './common.js';

interface Contribution {
  status: Status;
  reason: string;
  importedFrom?: Location;
}

export async function resolveClaudeMemory(e: Effective, ctx: Context, mode: string, state?: Source): Promise<void> {
  const excludes = effectiveValue(e, 'claudeMdExcludes', []);
  const excluded = (source: Source) => source.scope !== 'system' && Array.isArray(excludes) && matches(slash(source.path), excludes.filter(value => typeof value === 'string'));
  const hasClaude = ctx.sources.some(source => ctx.dirs.some(directory => ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md'].some(name => source.path === path.join(directory, name))));
  const useAgents = mode === 'claude-md-and-agents-md' || mode === 'claude-md-or-agents-md' && !hasClaude;
  const projectRoot = state && !state.invalid ? await realpath(await findRepositoryRoot(ctx.directory, ctx.options.signal)) : ctx.repo;
  const projectKey = [projectRoot, slash(projectRoot)].find(key => Object.hasOwn(state?.data.projects ?? {}, key));
  const approved = projectKey && !state?.invalid ? state?.data.projects?.[projectKey]?.hasClaudeMdExternalIncludesApproved : undefined;
  const approvalLocation = state && projectKey ? locate(state, `projects.${projectKey}.hasClaudeMdExternalIncludesApproved`) : undefined;
  const sessionDirectory = await realpath(ctx.directory);
  const expanded = new Set<string>();
  const scopedRules: { source: Source; patterns: string[]; contribution: Contribution }[] = [];

  const expandSource = async (source: Source, contribution: Contribution, stack: string[] = [], depth = 0): Promise<void> => {
    if (contribution.status === 'ignored') {
      decision(e, source, 'ignored', contribution.reason, '', contribution.importedFrom);
      return;
    }
    const canonical = source.canonicalPath ?? await realpath(source.path).catch(() => source.path);
    if (expanded.has(canonical)) {
      decision(e, source, 'ignored', 'Already discovered through the same canonical instruction source.', '', contribution.importedFrom);
      e.findings.push(finding('include.duplicate', 'info', locate(source), 'Instruction source referenced more than once.', 'Repeated imports resolve to the same canonical source.', 'Keep a single reference.', 'claude'));
      return;
    }
    if (contribution.status === 'active') expanded.add(canonical);
    const emptyPaths = Array.isArray(source.data.paths) && source.data.paths.length === 0;
    const patterns = source.kind === 'rules' && !emptyPaths ? pathPatterns(e, source, 'paths') : null;
    const body = stripComments(source.body);
    if (patterns) scopedRules.push({ source, patterns, contribution });
    else {
      addInstruction(e, source, contribution.reason, body, contribution.status);
      if (contribution.importedFrom) e.decisions.at(-1)!.importedFrom = contribution.importedFrom;
    }

    // Native discovery expands imports even when the referring rule waits for a matching file.
    for (const reference of imports({ ...source, body })) {
      const location = { path: source.path, line: reference.line, column: 1 };
      if (depth >= 4) {
        e.findings.push(finding('include.depth', 'info', location, 'Import exceeds Claude’s four-hop limit.', 'Nested imports stop after four hops.', 'Flatten the import chain.', 'claude'));
        continue;
      }
      const target = path.resolve(path.dirname(source.path), reference.path.startsWith('~/') ? path.join(ctx.home, reference.path.slice(2)) : reference.path);
      const allowedRoot = source.scope === 'user' ? ctx.claudeHome : ctx.repo;
      if (!within(allowedRoot, target)) {
        e.findings.push(finding('include.outside-scope', 'warn', location, 'Import leaves the inspected configuration scope.', 'Sightline limits import inspection to the selected repository and documented user configuration root.', 'Keep shared instructions inside the repository or documented user config root, or inspect the destination separately.', 'claude'));
        continue;
      }
      const resolved = await realpath(target).catch(() => undefined);
      if (!resolved) {
        e.findings.push(finding('include.missing', 'error', location, 'Imported instruction file does not exist.', 'The @ reference cannot be resolved.', 'Correct the path relative to the referring file.', 'claude'));
        continue;
      }
      if ([...stack, canonical].includes(resolved)) {
        e.findings.push(finding('include.cycle', 'error', location, 'Circular instruction import.', 'This file resolves to an ancestor in the import chain.', 'Remove the back-reference.', 'claude', [locate(source)]));
        continue;
      }
      if (!within(await realpath(allowedRoot), resolved)) {
        e.findings.push(finding('include.outside-scope', 'warn', location, 'Import symlink leaves the inspected configuration scope.', 'The resolved symlink target is outside the inspected configuration scope.', 'Use a source inside the declared root.', 'claude'));
        continue;
      }
      let status: Status = contribution.status;
      let reason = `Imported by ${canonical}.`;
      if (source.scope !== 'user' && source.scope !== 'system' && !within(sessionDirectory, resolved)) {
        if (approved !== true) {
          status = approved === false ? 'ignored' : 'conditional';
          reason = approved === false ? 'Saved project state rejects imports outside the session directory.' : 'Loading this import depends on separate external-import approval for this project.';
          e.findings.push(finding('claude.import-approval', 'info', location, 'External instruction import requires project approval.', reason, 'Review external-import approval in Claude Code, or start the session from a directory containing the imported file.', 'claude', approvalLocation ? [approvalLocation] : []));
        } else if (approvalLocation) reason += ` External imports are approved at ${approvalLocation.path}:${approvalLocation.line}.`;
      }
      const imported = await ctx.read(target, 'claude', 'instructions', source.scope === 'user' ? 'user' : 'import');
      if (imported) await expandSource(imported, { status, reason, importedFrom: location }, [...stack, canonical], depth + 1);
    }
  };

  const loadRules = async (directory?: string) => {
    const sources = ctx.sources.filter(source => source.kind === 'rules' && source.owners.includes('claude') && (directory === undefined ? source.scope === 'user' : source.scope !== 'user' && rootOf(source, '.claude') === directory)).sort((left, right) => left.path.localeCompare(right.path));
    for (const source of sources) {
      if (excluded(source) || mode === 'managed-only') decision(e, source, 'ignored', 'Excluded by instruction mode or claudeMdExcludes.');
      else await expandSource(source, { status: 'active', reason: 'Rule discovered in the user/project rules directory.' });
    }
  };
  for (const source of ctx.sources.filter(source => source.kind === 'instructions' && (source.scope === 'system' || source.path === path.join(ctx.claudeHome, 'CLAUDE.md')) && source.owners.includes('claude'))) {
    if (mode !== 'managed-only' || source.scope === 'system') await expandSource(source, { status: 'active', reason: source.scope === 'system' ? 'Managed instruction source.' : 'User instructions for every project.' });
    else decision(e, source, 'ignored', 'Project instruction mode is managed-only.');
  }
  await loadRules();
  for (const directory of ctx.dirs) {
    for (const name of ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.claude/AGENTS.md']) {
      if (name === 'CLAUDE.local.md') await loadRules(directory);
      const source = ctx.sources.find(source => source.path === path.join(directory, name));
      if (!source) continue;
      const agent = name.includes('AGENTS.md');
      if (mode === 'managed-only' || agent && !useAgents) {
        decision(e, source, 'ignored', agent ? 'AGENTS.md is disabled by the instruction mode or an ancestor CLAUDE.md/CLAUDE.local.md.' : 'Project instruction mode is managed-only.');
        continue;
      }
      if (excluded(source)) { decision(e, source, 'ignored', 'Excluded by claudeMdExcludes.'); continue; }
      await expandSource(source, { status: 'active', reason: 'Instruction file in the target directory’s ancestor chain.' });
    }
  }
  for (const { source, patterns, contribution } of scopedRules) {
    const baseDir = source.scope === 'user' ? ctx.directory : rootOf(source, '.claude');
    if (!matches(slash(path.relative(baseDir, ctx.target)), patterns, true)) {
      decision(e, source, 'ignored', 'paths frontmatter does not match the target file.', '', contribution.importedFrom);
      continue;
    }
    const conditional = source.body.length > 40000;
    if (conditional) e.findings.push(finding('claude.conditional-truncation', 'warn', locate(source), 'Path-scoped rule may be truncated by the model-specific character limit.', '2.1.309+ uses 40,000 characters for 200K context and larger limits for 1M context.', 'Shorten the rule or verify the session context limit.', 'claude'));
    addInstruction(e, source, conditional ? 'On-demand rule exceeds the 200K-context per-file character limit; exact truncation depends on model/context size.' : contribution.reason + ' Its paths frontmatter matches the opened target file after startup instructions load.', stripComments(source.body), conditional ? 'conditional' : contribution.status);
    if (contribution.importedFrom) e.decisions.at(-1)!.importedFrom = contribution.importedFrom;
  }
  e.notes.push(`Project instruction mode: ${mode}. AGENTS.md fallback: ${useAgents ? 'enabled' : 'disabled'}.`, 'User rules precede project instructions. Unconditional rules load before local instruction files at each directory level. Matching path-scoped rules follow startup instructions.', 'Project external-import approval uses the saved canonical project state in ~/.claude.json. Pending approval stays conditional, and saved rejection skips the import.', 'Ancestors outside --repo, session source switches, accounts, plugins and managed cloud policies are outside this static report.');
}
