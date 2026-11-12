import path from 'node:path';
import { realpath } from 'node:fs/promises';
import type { Context, Report } from './types.js';
import { cmp, slash, within } from './utils.js';

export async function collectPathMappings(ctx: Context, configuration: unknown[]): Promise<NonNullable<Report['pathMappings']>> {
  const resolved = new Map<string, string | null | undefined>();
  const resolve = async (filename: string): Promise<string | null | undefined> => {
    if (!resolved.has(filename)) resolved.set(filename, await realpath(filename).catch((error: NodeJS.ErrnoException) => {
      return error.code === 'ENOENT' || error.code === 'ENOTDIR' ? undefined : null;
    }));
    return resolved.get(filename);
  };
  const roots: { path: string; canonical: string; replacement: string }[] = [];
  const directories = [[ctx.repo, '<repo>'], [ctx.home, '~']];
  if (ctx.options.user !== false) directories.push([ctx.codexHome, '<codex-home>'], [ctx.claudeHome, '<claude-home>'], [ctx.copilotHome, '<copilot-home>']);
  for (const [directory, fallback] of directories) {
    const canonical = await resolve(directory) ?? directory;
    const parent = roots.find(root => within(root.canonical, canonical));
    const relative = parent ? slash(path.relative(parent.canonical, canonical)) : '';
    roots.push({ path: directory, canonical, replacement: parent ? parent.replacement + (relative ? '/' + relative : '') : fallback });
  }
  const mappings = new Map<string, string>();
  const remember = (root: typeof roots[number]): void => {
    if (!mappings.has(root.path)) mappings.set(root.path, root.replacement);
    if (!mappings.has(root.canonical)) mappings.set(root.canonical, root.replacement);
  };
  remember(roots[0]);
  const candidates = new Set(ctx.sources.map(source => source.path));
  const collect = (value: unknown): void => {
    if (typeof value === 'string') {
      let filename = value;
      if (value.startsWith('--') && value.includes('=')) filename = value.slice(value.indexOf('=') + 1);
      if (value.startsWith('projects.') && value.endsWith('.trust_level')) filename = value.slice('projects.'.length, -'.trust_level'.length);
      if (path.isAbsolute(filename)) candidates.add(path.normalize(filename));
    }
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      collect(key);
      collect(child);
    }
  };
  collect(configuration);
  for (const candidate of candidates) {
    const known = roots.find(root => within(root.path, candidate) || within(root.canonical, candidate));
    if (known) remember(known);
    if (known === roots[0]) continue;
    // A configured absolute path can use another spelling of a repository or home.
    // Its nearest existing parents also cover paths to files that do not exist yet.
    let directory = candidate;
    // Keep repository and home matches independently when an alias crosses both.
    const aliases = new Map<typeof roots[number], { path: string; replacement: string }>();
    for (;;) {
      const canonical = await resolve(directory);
      // Ascend missing children, but stop on inaccessible or invalid filesystem paths.
      if (canonical === null) break;
      const root = canonical && roots.find(root => within(root.canonical, canonical));
      if (root) {
        const relative = slash(path.relative(root.canonical, canonical!));
        aliases.set(root, { path: directory, replacement: root.replacement + (relative ? '/' + relative : '') });
      } else if (aliases.size) break;
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    for (const alias of aliases.values()) if (!mappings.has(alias.path)) mappings.set(alias.path, alias.replacement);
  }
  return [...mappings].sort(([a], [b]) => cmp(a, b)).map(([path, replacement]) => ({ path, replacement }));
}
