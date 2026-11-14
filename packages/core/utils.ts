import path from 'node:path';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { minimatch } from 'minimatch';
import type { ClientId, Finding, Location, Severity, Source } from './types.js';

export const slash = (s: string): string => s.replace(/\\/g, '/');
export const cmp = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
export const bytes = (s: string): number => Buffer.byteLength(s, 'utf8');
export const hash = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);
export function stripComments(body: string, preserveOffsets = false): string {
  let fence = false;
  return body.split(/(^\s*```.*$|^\s*~~~.*$)/m).map(part => {
    if (/^\s*(```|~~~)/.test(part)) { fence = !fence; return part; }
    return fence ? part : part.replace(/<!--[\s\S]*?-->/g, comment => preserveOffsets ? comment.replace(/[^\r\n]/g, '\0') : '');
  }).join('');
}
export function within(root: string, file: string): boolean {
  const rel = path.relative(root, file);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}
export function parents(root: string, dir: string): string[] {
  const out = [dir];
  while (dir !== root) { const next = path.dirname(dir); if (next === dir || !within(root, next)) break; out.unshift(next); dir = next; }
  return out;
}
export function lineAt(text: string, offset: number): number { return text.slice(0, offset).split('\n').length; }
export function locate(s: Source, key?: string): Location {
  let line = s.bodyLine;
  if (key) { let p = key; while (p) { if (s.lines[p]) { line = s.lines[p]; break; } p = p.includes('.') ? p.slice(0, p.lastIndexOf('.')) : ''; } }
  return { path: s.path, line, column: 1, ...(key ? { key } : {}) };
}
export function finding(ruleId: string, severity: Severity, location: Location, message: string, why: string, suggestion: string, client?: ClientId, related: Location[] = []): Finding {
  return { id: hash(`${ruleId}:${client ?? ''}:${location.path}:${location.line}:${location.column}:${location.key ?? ''}:${message}`), ruleId, severity, client, message, location, related, why, suggestion };
}
export function splitGlobs(s: string): string[] {
  const result: string[] = []; let start = 0; let depth = 0;
  for (let i = 0; i < s.length; i++) { if ('{['.includes(s[i])) depth++; if ('}]'.includes(s[i])) depth--; if (s[i] === ',' && depth === 0) { result.push(s.slice(start, i).trim()); start = i + 1; } }
  result.push(s.slice(start).trim()); return result.filter(Boolean);
}
export function matches(file: string, patterns: string[], matchBase = false): boolean {
  return patterns.some(p => minimatch(slash(file), slash(p).replace(/^\//, ''), { dot: true, matchBase: matchBase && !p.startsWith('/'), nonegate: true }));
}
/** Return a UTF-8 prefix without manufacturing a partial code point. */
export function prefix(text: string, limit: number): string {
  const buf = Buffer.from(text); let end = Math.max(0, Math.min(limit, buf.length));
  if (end < buf.length) while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString('utf8');
}
export function environmentValue(env: NodeJS.ProcessEnv, name: string, platform = process.platform): string | undefined {
  // Node forwards the first case-insensitive key in lexicographic order on Windows.
  const key = platform === 'win32' ? Object.keys(env).sort().find(key => key.toUpperCase() === name.toUpperCase()) : name;
  return key === undefined ? undefined : env[key];
}
export async function executable(command: string, cwd: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const windows = process.platform === 'win32';
  const extensions = windows ? (environmentValue(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';') : [''];
  const direct = path.isAbsolute(command) || command.includes('/') || command.includes('\\');
  const dirs = direct ? [''] : (environmentValue(env, 'PATH') ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) for (const ext of extensions) {
    const name = windows && path.extname(command) ? command : command + ext;
    const candidate = direct ? path.resolve(cwd, name) : path.resolve(dir, name);
    try { await access(candidate, windows ? constants.F_OK : constants.X_OK); if ((await stat(candidate)).isFile()) return candidate; } catch { /* next candidate */ }
  }
  return null;
}
export function plainObject(value: unknown): value is Record<string, any> { return !!value && typeof value === 'object' && !Array.isArray(value); }
