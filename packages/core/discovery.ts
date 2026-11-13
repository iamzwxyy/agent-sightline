import path from 'node:path';
import os from 'node:os';
import { lstat, realpath, readdir, readFile, stat } from 'node:fs/promises';
import { CLIENTS, type ClientId, type Context, type Discovery, type Kind, type ScanOptions, type Source } from './types.js';
import { bytes, cmp, finding, hash, parents, slash, within } from './utils.js';
import { parseSource } from './parse.js';

export const excludedDirectories = new Set(['.git', 'node_modules', '.next', '.venv', 'venv', 'dist', 'build', 'coverage', 'vendor', 'target']);
export const DEFAULT_ENTRY_LIMIT = 50_000;
export const DEFAULT_USER_FILE_LIMIT = 4_000;

export function discoveryLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer.`);
  return value;
}
function createDiscoveryState(options: ScanOptions): Discovery {
  return {
    complete: true,
    repositoryEntries: 0,
    repositoryEntryLimit: discoveryLimit(options.maxFiles ?? DEFAULT_ENTRY_LIMIT, 'Repository entry limit'),
    userFileLimit: discoveryLimit(options.maxUserFiles ?? DEFAULT_USER_FILE_LIMIT, 'User configuration file limit'),
  };
}
function discoveryState(ctx: Context): Discovery {
  return ctx.discovery ??= createDiscoveryState(ctx.options);
}
function unreadableDirectory(ctx: Context, directory: string, owner?: ClientId): void {
  discoveryState(ctx).complete = false;
  ctx.findings.push(finding('source.unreadable', 'warn', { path: directory, line: 1, column: 1 }, 'Directory cannot be inspected.', 'Some configuration sources may be hidden by filesystem access errors.', 'Check the directory and its read permissions, then rerun the inspection.', owner));
}
export function classify(file: string): { owners: ClientId[]; kind: Kind } | null {
  const p = slash(file); const n = path.posix.basename(p); const parent = path.posix.basename(path.posix.dirname(p));
  if (/^AGENTS(?:\.override|\.local)?\.md$/.test(n)) return { owners: ['codex', 'claude', 'copilot', 'cursor', 'opencode'], kind: 'instructions' };
  if (/^CLAUDE(?:\.local)?\.md$/.test(n)) return { owners: ['claude', 'copilot', 'opencode'], kind: 'instructions' };
  if (n === 'GEMINI.md') return { owners: ['gemini', 'copilot'], kind: 'instructions' };
  if (n === '.cursorrules') return { owners: ['cursor'], kind: 'instructions' };
  if (n === 'copilot-instructions.md' || n.endsWith('.instructions.md')) return { owners: ['copilot'], kind: 'rules' };
  if (n === 'SKILL.md') {
    const owners: ClientId[] = [];
    if (p.includes('/.agents/skills/')) owners.push('codex', 'copilot', 'opencode');
    if (p.includes('/.claude/skills/')) owners.push('claude', 'copilot', 'opencode');
    if (p.includes('/.github/skills/') || p.includes('/.copilot/skills/')) owners.push('copilot');
    if (p.includes('/.codex/skills/')) owners.push('codex');
    if (p.includes('/.gemini/skills/')) owners.push('gemini');
    if (p.includes('/.cursor/skills/')) owners.push('cursor');
    return { owners, kind: 'skill' };
  }
  if (p.includes('/.claude/rules/') && n.endsWith('.md')) return { owners: ['claude', 'copilot'], kind: 'rules' };
  if (p.includes('/.cursor/rules/') && /\.mdc?$/.test(n)) return { owners: ['cursor'], kind: 'rules' };
  if (n === '.mcp.json') return { owners: ['claude', 'copilot'], kind: 'mcp' };
  if (n === 'mcp.json' && (p.includes('/.cursor/') || p.includes('/.github/') || p.includes('/.vscode/'))) return { owners: p.includes('/.cursor/') ? ['cursor'] : ['copilot'], kind: 'mcp' };
  if (n === 'mcp-config.json') return { owners: ['copilot'], kind: 'mcp' };
  if (/^settings(?:\.local)?\.json$/.test(n)) {
    if (parent === '.claude') return { owners: ['claude', 'copilot'], kind: 'settings' };
    const owner = parent === '.gemini' ? 'gemini' : parent === '.codex' ? 'codex' : parent === '.copilot' || parent === 'copilot' && p.includes('/.github/copilot/') ? 'copilot' : null;
    return owner ? { owners: [owner], kind: 'settings' } : null;
  }
  if (n === 'config.toml' && parent === '.codex') return { owners: ['codex'], kind: 'settings' };
  if (n === 'config.json' && parent === '.copilot') return { owners: ['copilot'], kind: 'settings' };
  if (n === 'config.json' && parent === '.claude') return { owners: ['claude'], kind: 'settings' };
  if (/^opencode\.jsonc?$/.test(n)) return { owners: ['opencode'], kind: 'settings' };
  if (n === 'hooks.json' && p.includes('/.codex/')) return { owners: ['codex'], kind: 'hooks' };
  if (p.includes('/.github/hooks/') && n.endsWith('.json')) return { owners: ['copilot'], kind: 'hooks' };
  return null;
}

export async function findRepositoryRoot(directory: string, signal?: AbortSignal): Promise<string> {
  let candidate = directory;
  for (;;) {
    signal?.throwIfAborted();
    try {
      const marker = await stat(path.join(candidate, '.git'));
      if (marker.isDirectory() || marker.isFile()) return candidate;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw new Error('Cannot inspect an ancestor for a Git root. Use --repo <directory> to choose the inspection boundary.');
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) return directory;
    candidate = parent;
  }
}

export async function makeContext(options: ScanOptions): Promise<Context> {
  if (options.codexProfile !== undefined) {
    if (!/^[A-Za-z0-9_-]+$/.test(options.codexProfile)) throw new Error('Codex profile names must contain only letters, numbers, hyphens and underscores.');
    if (options.user === false) throw new Error('Codex profiles are user configuration. Remove --no-user to inspect a profile.');
    if (options.clients && !options.clients.includes('codex')) throw new Error('A Codex profile requires Codex in the selected clients.');
  }
  const discovery = createDiscoveryState(options);
  const cwd = process.cwd();
  const repo = options.repo === undefined ? await findRepositoryRoot(cwd, options.signal) : path.resolve(options.repo);
  if (!(await stat(repo)).isDirectory()) throw new Error('Repository must be an existing directory. Use --repo <directory>.');
  const target = path.resolve(options.repo === undefined ? cwd : repo, options.target ?? '.');
  if (!within(repo, target)) throw new Error('Target must be inside --repo. Choose a repository-relative path.');
  let directory = path.dirname(target);
  try { if ((await stat(target)).isDirectory()) directory = target; } catch { if (!path.extname(target) && options.target?.endsWith('/')) directory = target; }
  // A not-yet-created source file is a valid target, but its parent must exist.
  if (!(await stat(directory)).isDirectory()) throw new Error('Target parent directory does not exist. Choose an existing directory.');
  const env = options.env ?? process.env;
  const home = path.resolve(options.home ?? os.homedir());
  const ctx: Context = {
    repo, target, directory, home, env, options, discovery, dirs: parents(repo, directory), sources: [], findings: [],
    codexHome: options.home ? path.join(home, '.codex') : path.resolve(env.CODEX_HOME ?? path.join(home, '.codex')),
    claudeHome: options.home ? path.join(home, '.claude') : path.resolve(env.CLAUDE_CONFIG_DIR ?? path.join(home, '.claude')),
    copilotHome: options.home ? path.join(home, '.copilot') : path.resolve(env.COPILOT_HOME ?? path.join(home, '.copilot')),
    read: async () => null,
  };
  ctx.read = async (file, owner, kind, scope) => {
    ctx.options.signal?.throwIfAborted();
    const abs = path.resolve(file);
    const existing = ctx.sources.find(s => s.path === abs);
    if (existing) { if (!existing.owners.includes(owner)) existing.owners.push(owner); return existing; }
    let info;
    try { info = await lstat(abs); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        discovery.complete = false;
        ctx.findings.push(finding('source.unreadable', 'error', { path: abs, line: 1, column: 1 }, 'Configuration cannot be read.', 'Filesystem access was denied.', 'Check file and parent-directory permissions.', owner));
      }
      return null;
    }
    try {
      const real = await realpath(abs);
      // Only explicitly selected config paths and imports are read outside the repo.
      if (!within(await realpath(repo), real) && scope !== 'user' && scope !== 'system') {
        discovery.complete = false;
        ctx.findings.push(finding('source.external-symlink', 'warn', { path: abs, line: 1, column: 1 }, 'Symlink points outside the inspected repository.', 'The client may follow it; Sightline does not read unrelated private files.', 'Inspect that directory explicitly with --repo, or place the configuration inside this repository.', owner)); return null;
      }
      info = await stat(abs);
      if (!info.isFile()) return null;
      if (info.size > 2 * 1024 * 1024) { discovery.complete = false; ctx.findings.push(finding('source.read-limit', 'warn', { path: abs, line: 1, column: 1 }, 'Configuration exceeds the 2 MiB inspection limit.', 'This is a Sightline safety limit, not a client truncation rule.', 'Split the file into smaller instruction sources.', owner)); return null; }
      const text = await readFile(abs, { encoding: 'utf8', signal: ctx.options.signal });
      const owners = scope === undefined ? classify(abs)?.owners ?? [owner] : [owner];
      const s: Source = { id: hash(abs), path: abs, relativePath: within(repo, abs) ? slash(path.relative(repo, abs)) : abs, owners, kind, scope: scope ?? (path.dirname(abs) === repo ? 'repository' : 'directory'), baseDir: path.dirname(abs), bytes: bytes(text), text, body: text, bodyLine: 1, data: {}, lines: {}, invalid: false };
      ctx.findings.push(...parseSource(s)); ctx.sources.push(s); return s;
    } catch (error) {
      ctx.options.signal?.throwIfAborted();
      discovery.complete = false;
      const code = (error as NodeJS.ErrnoException).code;
      ctx.findings.push(finding(code === 'ENOENT' ? 'source.broken-symlink' : 'source.unreadable', 'error', { path: abs, line: 1, column: 1 }, code === 'ENOENT' ? 'Broken configuration symlink.' : 'Configuration cannot be read.', 'The source exists but cannot be opened.', 'Repair the symlink or check file permissions.', owner)); return null;
    }
  };
  return ctx;
}

export async function discoverRepository(ctx: Context): Promise<void> {
  const coverage = discoveryState(ctx);
  coverage.repositoryEntries = 0;
  let stopped = false;
  const seen = new Set<string>();
  const realRepo = await realpath(ctx.repo);
  const walk = async (dir: string): Promise<void> => {
    ctx.options.signal?.throwIfAborted();
    if (stopped) return;
    let real: string;
    try { real = await realpath(dir); } catch { unreadableDirectory(ctx, dir); return; }
    if (!within(realRepo, real)) { coverage.complete = false; ctx.findings.push(finding('source.external-symlink', 'warn', { path: dir, line: 1, column: 1 }, 'Directory symlink points outside the repository.', 'External trees are not scanned.', 'Scan the destination explicitly if needed.')); return; }
    if (seen.has(real)) { ctx.findings.push(finding('source.symlink-cycle', 'info', { path: dir, line: 1, column: 1 }, 'Repeated or cyclic directory symlink skipped.', 'The same directory was already scanned.', 'Remove cyclic links or use the canonical directory.')); return; }
    seen.add(real);
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { unreadableDirectory(ctx, dir); return; }
    for (const entry of entries.sort((a, b) => cmp(a.name, b.name))) {
      if (stopped) return;
      if (coverage.repositoryEntries >= coverage.repositoryEntryLimit) {
        coverage.complete = false;
        stopped = true;
        const limit = coverage.repositoryEntryLimit;
        ctx.findings.push(finding('source.scan-limit', 'warn', { path: ctx.repo, line: 1, column: 1 }, 'Repository discovery reached its entry limit.', `The discovery budget is ${limit.toLocaleString('en-US')} filesystem ${limit === 1 ? 'entry' : 'entries'}. Additional locations were left uninspected.`, 'Raise --max-entries to inspect more of this repository.'));
        return;
      }
      coverage.repositoryEntries++;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!excludedDirectories.has(entry.name)) await walk(p); }
      else {
        const type = classify(p);
        if (type) { const s = await ctx.read(p, type.owners[0] ?? 'codex', type.kind); if (s) s.owners = type.owners; }
        else if (entry.isSymbolicLink()) { try { if ((await stat(p)).isDirectory()) await walk(p); } catch { /* unrelated broken link */ } }
      }
    }
  };
  await walk(ctx.repo);
}

export async function readUserTree(ctx: Context, dir: string, owner: ClientId, kind: Kind, suffix: string): Promise<void> {
  const coverage = discoveryState(ctx);
  const seen = new Set<string>();
  let files = 0;
  let stopped = false;
  let realRoot: string;
  try { realRoot = await realpath(dir); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') unreadableDirectory(ctx, dir, owner); return; }
  const walk = async (d: string): Promise<void> => {
    ctx.options.signal?.throwIfAborted();
    if (stopped) return;
    let real: string; try { real = await realpath(d); } catch { unreadableDirectory(ctx, d, owner); return; }
    // User skill/rule symlinks can lead to private unrelated trees. Report instead.
    if (!within(realRoot, real)) { coverage.complete = false; ctx.findings.push(finding('source.external-symlink', 'warn', { path: d, line: 1, column: 1 }, 'User configuration directory points outside its declared root.', 'Sightline keeps user scans within documented configuration directories.', 'Inspect the destination explicitly.', owner)); return; }
    if (seen.has(real)) return; seen.add(real);
    let entries; try { entries = await readdir(d, { withFileTypes: true }); } catch { unreadableDirectory(ctx, d, owner); return; }
    for (const e of entries.sort((a, b) => cmp(a.name, b.name))) {
      if (stopped) return;
      const p = path.join(d, e.name);
      if (e.isDirectory() || (e.isSymbolicLink() && !e.name.endsWith(suffix))) await walk(p);
      else if (e.name.endsWith(suffix)) {
        if (files >= coverage.userFileLimit) {
          coverage.complete = false;
          stopped = true;
          ctx.findings.push(finding('source.user-file-limit', 'warn', { path: p, line: 1, column: 1 }, 'User configuration discovery reached its file limit.', `The discovery budget is ${coverage.userFileLimit.toLocaleString('en-US')} matching files per user configuration root. Additional files were left uninspected.`, 'Raise --max-user-files to inspect the remaining configuration files.', owner));
          return;
        }
        files++;
        await ctx.read(p, owner, kind, 'user');
      }
    }
  };
  await walk(dir);
}

export const selectedClients = (options: ScanOptions): ClientId[] => options.clients ?? [...CLIENTS];
