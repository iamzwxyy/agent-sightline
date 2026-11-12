import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { excludedDirectories } from '../core/discovery.js';
import { cmp, slash, within } from '../core/utils.js';

interface SearchOptions {
  query?: string;
  limit?: number;
  maxEntries?: number;
  signal?: AbortSignal;
}

function scorePath(value: string, query: string, terms: string[]): number {
  if (!query) return 0;
  const candidate = value.toLowerCase().replace(/\/$/, '');
  const name = path.posix.basename(candidate);
  if (candidate === query) return 0;
  if (name === query) return 1;
  if (candidate.startsWith(query)) return 2;
  if (name.startsWith(query)) return 3;
  if (name.includes(query)) return 4;
  if (candidate.includes(query)) return 5;
  if (terms.every(term => candidate.includes(term))) return 6;
  let offset = 0;
  for (const character of query.replace(/\s/g, '')) {
    const index = candidate.indexOf(character, offset);
    if (index === -1) return -1;
    offset = index + 1;
  }
  return 7;
}

export async function searchTargets(repository: string, options: SearchOptions = {}): Promise<{ paths: string[]; hasMore: boolean; truncated: boolean }> {
  let rawQuery = options.query?.trim() ?? '';
  if (path.isAbsolute(rawQuery) && within(repository, rawQuery)) rawQuery = path.relative(repository, rawQuery);
  const query = slash(rawQuery).replace(/^\.\//, '').replace(/\/$/, '').toLowerCase();
  const terms = query.split(/\s+/);
  const limit = options.limit ?? (query ? 60 : 1500);
  const maxEntries = options.maxEntries ?? 50000;
  const matches: { path: string; score: number }[] = [];
  let visited = 0;
  let stopped = false;
  let truncated = false;
  const add = (relative: string) => {
    const score = scorePath(relative, query, terms);
    if (score >= 0) matches.push({ path: relative, score });
    if (!query && matches.length > limit) stopped = true;
  };
  add('.');

  async function walk(directory: string, depth: number): Promise<void> {
    if (stopped || options.signal?.aborted) return;
    if (depth > 48) { truncated = true; return; }
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch { truncated = true; return; }
    for (const entry of entries.sort((a, b) => cmp(a.name, b.name))) {
      if (stopped || options.signal?.aborted) return;
      if (visited >= maxEntries) { truncated = true; stopped = true; return; }
      visited++;
      if (entry.isSymbolicLink() || entry.name === '.git' || entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      const relative = slash(path.relative(repository, absolute));
      if (entry.isDirectory()) {
        add(relative + '/');
        await walk(absolute, depth + 1);
      } else if (entry.isFile()) add(relative);
    }
  }

  await walk(repository, 0);
  matches.sort((a, b) => a.score - b.score || cmp(a.path, b.path));
  return { paths: matches.slice(0, limit).map(match => match.path), hasMore: matches.length > limit, truncated };
}
