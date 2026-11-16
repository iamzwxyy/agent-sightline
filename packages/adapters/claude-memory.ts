import path from 'node:path';
import { realpath } from 'node:fs/promises';
import type { Context, Effective, Location, Source, Status } from '../core/types.js';
import { finding, locate, matches, parents, slash, stripComments, within } from '../core/utils.js';
import { addInstruction, decision, effectiveValue, imports, pathPatterns, rootOf } from './common.js';
import { claudeProjectStateRoot } from './claude-project.js';
import { claudeMemoryLimit } from './claude-model.js';

interface Contribution {
  status: Status;
  reason: string;
  importedFrom?: Location;
  onDemand?: boolean;
}

export async function resolveClaudeMemory(e: Effective, ctx: Context, mode: string, state?: Source, layers: Source[] = []): Promise<void> {
  const memoryLimit = claudeMemoryLimit(e, ctx, layers);
  const excludes = effectiveValue(e, 'claudeMdExcludes', []);
  const excluded = (source: Source) => source.scope !== 'system' && Array.isArray(excludes) && matches(slash(source.path), excludes.filter(value => typeof value === 'string'));
  const hasClaude = ctx.sources.some(source => ctx.dirs.some(directory => ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md'].some(name => source.path === path.join(directory, name))));
  const useAgents = mode === 'claude-md-and-agents-md' || mode === 'claude-md-or-agents-md' && !hasClaude;
  let approval: { approved?: unknown; location?: Location } | undefined;
  const externalApproval = async () => {
    if (approval) return approval;
    approval = {};
    if (!state || state.invalid) return approval;
    try {
      const projectKey = await claudeProjectStateRoot(ctx);
      if (Object.hasOwn(state.data.projects ?? {}, projectKey)) {
        approval.approved = state.data.projects[projectKey]?.hasClaudeMdExternalIncludesApproved;
        const origin = locate(state, `projects.${projectKey}.hasClaudeMdExternalIncludesApproved`);
        // Private state keys can embed another checkout's path. Keep file/line provenance.
        approval.location = { path: origin.path, line: origin.line, column: origin.column };
      }
    } catch {
      ctx.options.signal?.throwIfAborted();
      e.findings.push(finding('claude.project-state', 'warn', { path: path.join(ctx.repo, '.git'), line: 1, column: 1 }, 'Claude project approval state cannot be resolved.', 'The selected Git directory pointer or shared-worktree metadata could not be inspected.', 'Repair the Git metadata and rerun the inspection.', 'claude'));
    }
    return approval;
  };
  const sessionDirectory = await realpath(ctx.directory);
  const targetInSession = within(sessionDirectory, await realpath(ctx.targetDirectory ?? ctx.directory));
  const expanded = new Set<string>();
  const scopedRules: { source: Source; patterns: string[]; contribution: Contribution }[] = [];

  const addMemory = (source: Source, contribution: Contribution, reason: string) => {
    const removed: { offset: number; length: number }[] = [];
    const body = stripComments(source.body, false, removed);
    let content = body;
    let status = contribution.status;
    if (contribution.onDemand && body.length > (memoryLimit.limit ?? 40000)) {
      if (memoryLimit.limit === undefined) {
        status = 'conditional';
        reason += ' The on-demand character limit depends on model or session context that this inspection cannot determine.';
        e.findings.push(finding('claude.conditional-truncation', 'warn', locate(source), 'On-demand instructions may be truncated by the model-specific character limit.', 'The captured files and environment do not determine the session character budget.', 'Select the model and context through supported file settings, or verify the active session limit.', 'claude', memoryLimit.locations));
      } else {
        let end = memoryLimit.limit;
        if (/[\uD800-\uDBFF]/.test(body[end - 1] ?? '') && /[\uDC00-\uDFFF]/.test(body[end] ?? '')) end--;
        const newline = body.lastIndexOf('\n', end - 1);
        if (newline >= 0) end = newline + 1;
        content = body.slice(0, end);
        let offset = end;
        for (const range of removed) if (range.offset <= offset) offset += range.length;
        const prefix = source.body.slice(0, offset);
        const location = { path: source.path, line: source.bodyLine + (prefix.match(/\n/g)?.length ?? 0), column: prefix.length - prefix.lastIndexOf('\n') };
        status = contribution.status === 'active' ? 'truncated' : contribution.status;
        reason += ` On-demand content is limited to ${memoryLimit.limit} characters and ends at a complete line when possible.`;
        addInstruction(e, source, reason, content, status);
        const entry = e.decisions.at(-1)!;
        entry.truncation = { unit: 'characters', limit: memoryLimit.limit, line: location.line, column: location.column };
        if (contribution.importedFrom) entry.importedFrom = contribution.importedFrom;
        e.findings.push(finding('claude.instructions-truncated', 'warn', location, 'On-demand instructions exceed the model-specific character limit.', `Claude applies a ${memoryLimit.limit}-character per-file budget to content loaded after startup.`, 'Shorten this file or select the intended model and context window in Claude settings.', 'claude', memoryLimit.locations));
        return;
      }
    }
    addInstruction(e, source, reason, content, status);
    if (contribution.importedFrom) e.decisions.at(-1)!.importedFrom = contribution.importedFrom;
  };

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
    const body = stripComments(source.body, true).replace(/\0/g, ' ');
    if (patterns) scopedRules.push({ source, patterns, contribution });
    else {
      addMemory(source, contribution, contribution.reason);
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
        const { approved, location: approvalLocation } = await externalApproval();
        if (approved !== true) {
          status = approved === false ? 'ignored' : 'conditional';
          reason = approved === false ? 'Saved project state rejects imports outside the session directory.' : 'Loading this import depends on separate external-import approval for this project.';
          e.findings.push(finding('claude.import-approval', 'info', location, 'External instruction import requires project approval.', reason, 'Review external-import approval in Claude Code, or start the session from a directory containing the imported file.', 'claude', approvalLocation ? [approvalLocation] : []));
        } else if (approvalLocation) reason += ` External imports are approved at ${approvalLocation.path}:${approvalLocation.line}.`;
      }
      const imported = await ctx.read(target, 'claude', 'instructions', source.scope === 'user' ? 'user' : 'import');
      if (imported) await expandSource(imported, { status, reason, importedFrom: location, onDemand: contribution.onDemand }, [...stack, canonical], depth + 1);
    }
  };

  const loadRules = async (directory?: string, onDemand = false) => {
    const sources = ctx.sources.filter(source => source.kind === 'rules' && source.owners.includes('claude') && (directory === undefined ? source.scope === 'user' : source.scope !== 'user' && rootOf(source, '.claude') === directory)).sort((left, right) => left.path.localeCompare(right.path));
    for (const source of sources) {
      if (excluded(source) || mode === 'managed-only') decision(e, source, 'ignored', 'Excluded by instruction mode or claudeMdExcludes.');
      else await expandSource(source, { status: 'active', reason: 'Rule discovered in the user/project rules directory.', onDemand });
    }
  };
  const applyScopedRules = (rules: typeof scopedRules) => {
    for (const { source, patterns, contribution } of rules) {
      if (!targetInSession) {
        decision(e, source, 'ignored', 'Target is outside the session starting directory. Claude does not load on-demand instructions for this file.', '', contribution.importedFrom);
        continue;
      }
      const baseDir = source.scope === 'user' ? ctx.directory : rootOf(source, '.claude');
      if (!matches(slash(path.relative(baseDir, ctx.target)), patterns, true)) {
        decision(e, source, 'ignored', 'paths frontmatter does not match the target file.', '', contribution.importedFrom);
        continue;
      }
      addMemory(source, { ...contribution, onDemand: true }, contribution.reason + ' Its paths frontmatter matches the opened target file after startup instructions load.');
    }
  };
  for (const source of ctx.sources.filter(source => source.kind === 'instructions' && (source.scope === 'system' || source.path === path.join(ctx.claudeHome, 'CLAUDE.md')) && source.owners.includes('claude'))) {
    if (mode !== 'managed-only' || source.scope === 'system') await expandSource(source, { status: 'active', reason: source.scope === 'system' ? 'Managed instruction source.' : 'User instructions for every project.' });
    else decision(e, source, 'ignored', 'Project instruction mode is managed-only.');
  }
  await loadRules();
  const targetDirectories = targetInSession ? parents(ctx.repo, ctx.targetDirectory ?? ctx.directory) : [];
  const directories = [...ctx.dirs, ...targetDirectories.filter(directory => !ctx.dirs.includes(directory))];
  let startupRuleCount = scopedRules.length;
  for (const directory of directories) {
    const onDemand = !ctx.dirs.includes(directory);
    for (const name of ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.claude/AGENTS.md']) {
      if (name === 'CLAUDE.local.md' && !onDemand) await loadRules(directory);
      const source = ctx.sources.find(source => source.path === path.join(directory, name));
      if (!source) continue;
      const agent = name.includes('AGENTS.md');
      if (mode === 'managed-only' || agent && (!useAgents || onDemand)) {
        decision(e, source, 'ignored', mode === 'managed-only' ? 'Project instruction mode is managed-only.' : onDemand ? 'AGENTS.md discovery follows the session starting directory chain.' : 'AGENTS.md is disabled by the instruction mode or an ancestor CLAUDE.md/CLAUDE.local.md.');
        continue;
      }
      if (excluded(source)) { decision(e, source, 'ignored', 'Excluded by claudeMdExcludes.'); continue; }
      await expandSource(source, { status: 'active', reason: onDemand ? 'Instruction discovered when the target is opened after startup.' : 'Instruction file in the session starting directory’s ancestor chain.', onDemand });
    }
    if (onDemand) {
      await loadRules(directory, true);
      applyScopedRules(scopedRules.splice(startupRuleCount));
    } else startupRuleCount = scopedRules.length;
  }
  applyScopedRules(scopedRules);
  e.notes.push(`Project instruction mode: ${mode}. AGENTS.md fallback: ${useAgents ? 'enabled' : 'disabled'}.`, 'User rules precede project instructions. Startup rules load before local instruction files. Descendant instructions load when a target inside the starting directory is opened, with unconditional rules after local files. Newly discovered scoped rules precede matching startup scoped rules. Targets outside the starting directory add no on-demand instructions.', 'Project external-import approval uses the native project identity in the selected .claude.json state file. Linked worktrees use the shared Git project identity. A standard .git directory selects the main checkout, and a separate Git directory supplies its own key. Windows launch aliases that differ from the canonical path retain their own entry. Windows project keys use forward slashes. Pending approval stays conditional, and saved rejection skips the import.', 'Ancestors outside --repo, session source switches, accounts, plugins and managed cloud policies are outside this static report.');
}
