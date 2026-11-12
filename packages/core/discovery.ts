import path from 'node:path';
import os from 'node:os';
import { lstat, realpath, readdir, readFile, stat } from 'node:fs/promises';
import { CLIENTS, type ClientId, type Context, type Kind, type ScanOptions, type Source } from './types.js';
import { bytes, cmp, finding, hash, parents, slash, within } from './utils.js';
import { parseSource } from './parse.js';

export const excludedDirectories = new Set(['.git', 'node_modules', '.next', '.venv', 'venv', 'dist', 'build', 'coverage', 'vendor', 'target']);
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
  if (p.includes('/.claude/rules/') && n.endsWith('.md')) return { owners: ['claude'], kind: 'rules' };
  if (p.includes('/.cursor/rules/') && /\.mdc?$/.test(n)) return { owners: ['cursor'], kind: 'rules' };
  if (n === '.mcp.json') return { owners: ['claude', 'copilot'], kind: 'mcp' };
  if (n === 'mcp.json' && (p.includes('/.cursor/') || p.includes('/.github/') || p.includes('/.vscode/'))) return { owners: p.includes('/.cursor/') ? ['cursor'] : ['copilot'], kind: 'mcp' };
  if (n === 'mcp-config.json') return { owners: ['copilot'], kind: 'mcp' };
  if (/^settings(?:\.local)?\.json$/.test(n)) {
    const owner = parent === '.claude' ? 'claude' : parent === '.gemini' ? 'gemini' : parent === '.codex' ? 'codex' : null;
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

export async function makeContext(options: ScanOptions): Promise<Context> {
  const repo = path.resolve(options.repo ?? process.cwd());
  if (!(await stat(repo)).isDirectory()) throw new Error('Repository must be an existing directory. Use --repo <directory>.');
  const target = path.resolve(repo, options.target ?? '.');
  if (!within(repo, target)) throw new Error('Target must be inside --repo. Choose a repository-relative path.');
  let directory = path.dirname(target);
  try { if ((await stat(target)).isDirectory()) directory = target; } catch { if (!path.extname(target) && options.target?.endsWith('/')) directory = target; }
  // A not-yet-created source file is a valid target, but its parent must exist.
  if (!(await stat(directory)).isDirectory()) throw new Error('Target parent directory does not exist. Choose an existing directory.');
  const env = options.env ?? process.env;
  const home = path.resolve(options.home ?? os.homedir());
  const ctx: Context = {
    repo, target, directory, home, env, options, dirs: parents(repo, directory), sources: [], findings: [],
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
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') ctx.findings.push(finding('source.unreadable', 'error', { path: abs, line: 1, column: 1 }, 'Configuration cannot be read.', 'Filesystem access was denied.', 'Check file and parent-directory permissions.', owner));
      return null;
    }
    try {
      const real = await realpath(abs);
      // Only explicitly selected config paths and imports are read outside the repo.
      if (!within(await realpath(repo), real) && scope !== 'user' && scope !== 'system') {
        ctx.findings.push(finding('source.external-symlink', 'warn', { path: abs, line: 1, column: 1 }, 'Symlink points outside the inspected repository.', 'The client may follow it; Sightline does not read unrelated private files.', 'Inspect that directory explicitly with --repo, or place the configuration inside this repository.', owner)); return null;
      }
      info = await stat(abs);
      if (!info.isFile()) return null;
      if (info.size > 2 * 1024 * 1024) { ctx.findings.push(finding('source.read-limit', 'warn', { path: abs, line: 1, column: 1 }, 'Configuration exceeds the 2 MiB inspection limit.', 'This is a Sightline safety limit, not a client truncation rule.', 'Split the file into smaller instruction sources.', owner)); return null; }
      const text = await readFile(abs, 'utf8');
      const s: Source = { id: hash(abs), path: abs, relativePath: within(repo, abs) ? slash(path.relative(repo, abs)) : abs, owners: [owner], kind, scope: scope ?? (path.dirname(abs) === repo ? 'repository' : 'directory'), baseDir: path.dirname(abs), bytes: bytes(text), text, body: text, bodyLine: 1, data: {}, lines: {}, invalid: false };
      ctx.findings.push(...parseSource(s)); ctx.sources.push(s); return s;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      ctx.findings.push(finding(code === 'ENOENT' ? 'source.broken-symlink' : 'source.unreadable', 'error', { path: abs, line: 1, column: 1 }, code === 'ENOENT' ? 'Broken configuration symlink.' : 'Configuration cannot be read.', 'The source exists but cannot be opened.', 'Repair the symlink or check file permissions.', owner)); return null;
    }
  };
  return ctx;
}

export async function discoverRepository(ctx: Context): Promise<void> {
  let count = 0; const seen = new Set<string>();
  const realRepo = await realpath(ctx.repo);
  const walk = async (dir: string, depth: number): Promise<void> => {
    ctx.options.signal?.throwIfAborted();
    if (depth > 48) return;
    let real: string;
    try { real = await realpath(dir); } catch { return; }
    if (!within(realRepo, real)) { ctx.findings.push(finding('source.external-symlink', 'warn', { path: dir, line: 1, column: 1 }, 'Directory symlink points outside the repository.', 'External trees are not scanned.', 'Scan the destination explicitly if needed.')); return; }
    if (seen.has(real)) { ctx.findings.push(finding('source.symlink-cycle', 'info', { path: dir, line: 1, column: 1 }, 'Repeated or cyclic directory symlink skipped.', 'The same directory was already scanned.', 'Remove cyclic links or use the canonical directory.')); return; }
    seen.add(real);
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { ctx.findings.push(finding('source.unreadable', 'warn', { path: dir, line: 1, column: 1 }, 'Directory cannot be inspected.', 'Some configuration sources may be hidden by permissions.', 'Check directory read permissions.')); return; }
    for (const entry of entries.sort((a, b) => cmp(a.name, b.name))) {
      if (++count > (ctx.options.maxFiles ?? 50000)) return;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!excludedDirectories.has(entry.name)) await walk(p, depth + 1); }
      else {
        const type = classify(p);
        if (type) { const s = await ctx.read(p, type.owners[0] ?? 'codex', type.kind); if (s) s.owners = type.owners; }
        else if (entry.isSymbolicLink()) { try { if ((await stat(p)).isDirectory()) await walk(p, depth + 1); } catch { /* unrelated broken link */ } }
      }
    }
  };
  await walk(ctx.repo, 0);
  if (count > (ctx.options.maxFiles ?? 50000)) ctx.findings.push(finding('source.scan-limit', 'warn', { path: ctx.repo, line: 1, column: 1 }, 'Repository scan reached its entry limit.', 'Discovery is incomplete after 50,000 filesystem entries.', 'Inspect a smaller directory using --repo.'));
}

export async function readUserTree(ctx: Context, dir: string, owner: ClientId, kind: Kind, suffix: string): Promise<void> {
  const seen = new Set<string>();
  let realRoot: string; try { realRoot = await realpath(dir); } catch { return; }
  const walk = async (d: string, depth: number): Promise<void> => {
    ctx.options.signal?.throwIfAborted();
    if (depth > 8 || ctx.sources.length > 4000) return;
    let real: string; try { real = await realpath(d); } catch { return; }
    // User skill/rule symlinks can lead to private unrelated trees. Report instead.
    if (!within(realRoot, real)) { ctx.findings.push(finding('source.external-symlink', 'warn', { path: d, line: 1, column: 1 }, 'User configuration directory points outside its declared root.', 'Sightline keeps user scans within documented configuration directories.', 'Inspect the destination explicitly.', owner)); return; }
    if (seen.has(real)) return; seen.add(real);
    let entries; try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => cmp(a.name, b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory() || (e.isSymbolicLink() && !e.name.endsWith(suffix))) await walk(p, depth + 1);
      else if (e.name.endsWith(suffix)) await ctx.read(p, owner, kind, 'user');
    }
  };
  await walk(dir, 0);
}

export const selectedClients = (options: ScanOptions): ClientId[] => options.clients ?? [...CLIENTS];
