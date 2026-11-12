import path from 'node:path';
import { realpath } from 'node:fs/promises';
import type { Adapter, AdapterMetadata, Context, Decision, Effective, Source, Status } from '../core/types.js';
import { bytes, cmp, executable, finding, locate, plainObject, prefix, slash, splitGlobs, within } from '../core/utils.js';
import { validateExtensions, probeMcp } from '../core/extensions.js';

export async function base(metadata: AdapterMetadata, ctx: Context): Promise<Effective> {
  const exec = await executable(metadata.id === 'cursor' ? 'cursor-agent' : metadata.id, ctx.directory, ctx.env);
  return { client: metadata.id, metadata, detected: !!exec || ctx.sources.some(s => s.owners.includes(metadata.id)), executable: exec, decisions: [], instructions: '', instructionBytes: 0, estimatedTokens: 0, settings: [], extensions: [], findings: [], notes: [] };
}
export function decision(e: Effective, s: Source, status: Status, reason: string, content = '', importedFrom?: Decision['importedFrom']): Decision {
  const d: Decision = { sourceId: s.id, path: s.path, line: s.bodyLine, kind: s.kind, scope: s.scope, status: s.invalid ? 'invalid' : status, reason: s.invalid ? 'Source has parse errors; no effective contribution can be proven.' : reason, order: status === 'active' || status === 'conditional' || status === 'truncated' ? e.decisions.filter(x => x.order !== null).length + 1 : null, bytes: s.bytes, loadedBytes: bytes(content), estimatedTokens: Math.ceil(bytes(content) / 4), content: s.invalid ? '' : content, ...(importedFrom ? { importedFrom } : {}) };
  e.decisions.push(d); return d;
}
export function addInstruction(e: Effective, s: Source, reason: string, content = s.body, status: Status = 'active'): void {
  decision(e, s, status, reason, content);
  if (!s.invalid && content.trim() && (status === 'active' || status === 'truncated')) {
    e.instructions += (e.instructions ? '\n\n' : '') + content;
    e.instructionBytes = bytes(e.instructions); e.estimatedTokens = Math.ceil(e.instructionBytes / 4);
  }
}
export function flatten(obj: Record<string, any>, p = ''): [string, unknown][] {
  return Object.entries(obj).flatMap(([k, v]) => { const key = p ? `${p}.${k}` : k; return plainObject(v) && Object.keys(v).length ? flatten(v, key) : [[key, v]]; });
}
export function settings(e: Effective, s: Source, status: Status, mergeArrays = false, data = s.data): void {
  decision(e, s, status, 'Structured configuration layer; later applicable values override earlier scalar values.');
  if (s.invalid || !['active', 'conditional'].includes(status)) return;
  for (const [key, v] of flatten(data)) {
    const old = e.settings.find(x => x.key === key && x.status === 'active');
    const merging = mergeArrays && Array.isArray(v) && Array.isArray(old?.value) && !['fallbackModel', 'modelPicker'].includes(key);
    const overrides = old && status === 'active' ? [...old.overrides, old.location] : [];
    let value = v;
    if (merging && old && status === 'active') value = [...new Set([...(old.value as unknown[]), ...(v as unknown[])])];
    if (old && status === 'active') {
      old.status = 'shadowed'; old.reason = merging ? 'Merged into a higher-priority array.' : 'A higher-priority layer supplies this key.';
      if (!merging) e.findings.push(finding('config.overridden', 'info', old.location, `Setting "${key}" is overridden.`, 'A closer or higher-priority configuration supplies the same key.', 'Remove the redundant value or edit the winning source.', e.client, [locate(s, key)]));
    }
    e.settings.push({ key, value, location: locate(s, key), status, reason: status === 'conditional' ? 'Applies only if the project is trusted.' : merging ? 'Arrays merge across settings layers.' : 'Highest inspected applicable layer defining this key.', overrides });
  }
}
export function effectiveValue(e: Effective, key: string, fallback?: any): any { return e.settings.findLast(x => x.key === key && x.status === 'active')?.value ?? fallback; }
export function mcp(e: Effective, s: Source, servers: unknown, key: string, status: Status, merge = false): void {
  if (s.invalid || !plainObject(servers)) return;
  for (const [name, data] of Object.entries(servers)) {
    const old = e.extensions.find(x => x.kind === 'mcp' && x.name === name && x.status === 'active');
    if (old && status === 'active') {
      old.status = 'shadowed'; old.reason = 'Higher-priority server configuration with the same name.';
      e.findings.push(finding('mcp.redefined', 'warn', locate(s, `${key}.${name}`), `MCP server "${name}" is defined in multiple layers.`, merge ? 'Codex merges server fields; the final command may come from a different layer than its arguments.' : 'The higher-priority definition replaces the whole server entry.', 'Keep one definition or inspect the effective server below.', e.client, [old.location]));
    }
    const config = plainObject(data) ? (merge && old && status === 'active' ? mergeTables(old.config, data) : data) : { _invalid: true };
    e.extensions.push({ kind: 'mcp', name, config, status, location: locate(s, `${key}.${name}`), reason: status === 'conditional' ? 'Workspace trust or server approval is required.' : 'Discovered in this client’s MCP configuration.' });
  }
}
function mergeTables(a: Record<string, any>, b: Record<string, any>): Record<string, any> {
  const result = { ...a }; for (const [k, v] of Object.entries(b)) result[k] = plainObject(v) && plainObject(a[k]) ? mergeTables(a[k], v) : v; return result;
}
export function hooks(e: Effective, s: Source, value: unknown, status: Status): void {
  if (s.invalid || !plainObject(value)) return;
  for (const [event, groups] of Object.entries(value)) {
    if (!Array.isArray(groups)) { e.findings.push(finding('hook.type', 'error', locate(s, `hooks.${event}`), `Hook event "${event}" must be an array.`, 'The event does not use the documented schema.', 'Wrap hook entries in an array.', e.client)); continue; }
    groups.forEach((g, i) => {
      const handlers = plainObject(g) && Array.isArray(g.hooks) ? g.hooks : [g];
      handlers.forEach((h: any, j: number) => e.extensions.push({ kind: 'hook', name: event, config: plainObject(h) ? { ...h, matcher: g?.matcher ?? '', _index: `${i}.${j}` } : { _invalid: true }, status: e.client === 'codex' && status === 'active' ? 'conditional' : status, location: locate(s, `hooks.${event}.${i}${g?.hooks ? `.hooks.${j}` : ''}.${e.client === 'copilot' ? 'bash' : 'command'}`), reason: e.client === 'codex' ? 'Discovered hook; exact-definition trust and event/matcher runtime state are not inferred.' : 'Discovered hook; runs only when its event and matcher trigger.' }));
    });
  }
}
export function permissions(e: Effective, s: Source, status: Status): void {
  const p = s.data.permissions;
  if (!plainObject(p)) return;
  for (const action of ['allow', 'deny', 'ask']) {
    if (p[action] === undefined) continue;
    if (!Array.isArray(p[action]) || p[action].some((x: unknown) => typeof x !== 'string')) { e.findings.push(finding('permission.type', 'error', locate(s, `permissions.${action}`), `permissions.${action} must contain strings.`, 'Invalid permission rules cannot be applied.', 'Use an array of permission rule strings.', e.client)); continue; }
    for (const rule of p[action]) e.extensions.push({ kind: 'permission', name: rule, config: { action }, status, location: locate(s, `permissions.${action}`), reason: 'Permission lists accumulate; deny precedes ask, which precedes allow.' });
  }
}
export async function skills(e: Effective, ctx: Context, roots: string[], behavior: 'coexist' | 'first'): Promise<void> {
  const candidates = ctx.sources.filter(s => s.kind === 'skill' && roots.some(r => within(r, s.path))).sort((a, b) => {
    const rank = (s: Source) => roots.findIndex(r => within(r, s.path)); return rank(a) - rank(b) || cmp(a.path, b.path);
  });
  for (const s of candidates) {
    const name = typeof s.data.name === 'string' ? s.data.name : path.basename(path.dirname(s.path));
    const old = e.extensions.find(x => x.kind === 'skill' && x.name === name && x.status === 'active');
    let status: Status = s.invalid ? 'invalid' : old && behavior === 'first' ? 'shadowed' : 'active';
    if (e.client === 'codex') {
      const config = effectiveValue(e, 'skills.config', []);
      for (const x of Array.isArray(config) ? config : []) if ((x.path === s.path || x.name === name) && typeof x.enabled === 'boolean') status = x.enabled ? 'active' : 'ignored';
    }
    decision(e, s, status, status === 'shadowed' ? 'A higher-priority skill with the same name wins.' : status === 'ignored' ? 'Disabled by skills.config.' : 'Skill metadata is discoverable; its body loads only on invocation.');
    e.extensions.push({ kind: 'skill', name, status, location: locate(s, 'name'), config: s.data, reason: 'Metadata available; skill body is not automatically included in effective instructions.' });
    if (old) e.findings.push(finding('skill.name-conflict', behavior === 'coexist' ? 'warn' : 'info', locate(s, 'name'), `Skill name "${name}" is duplicated.`, behavior === 'coexist' ? 'Codex does not merge these skills; both can appear in selectors.' : 'The first/highest-priority skill wins and hides this definition.', 'Rename the skill or remove the redundant definition.', e.client, [old.location]));
  }
}
export function pathPatterns(e: Effective, s: Source, key: string): string[] | null {
  const value = s.data[key];
  if (value === undefined) return null;
  if (typeof value === 'string') return splitGlobs(value);
  if (Array.isArray(value) && value.every(x => typeof x === 'string')) return value;
  e.findings.push(finding('glob.type', 'error', locate(s, key), `"${key}" must be a string or an array of strings.`, 'The rule matcher cannot parse this value.', 'Use documented glob patterns.', e.client)); return [];
}
export function finish(e: Effective, ctx: Context): Effective {
  for (const s of ctx.sources) if (!e.decisions.some(d => d.sourceId === s.id)) decision(e, s, 'ignored', s.owners.includes(e.client) ? 'Outside the client’s documented discovery scope for this target, or wrong configuration location.' : `This source belongs to ${s.owners.join(', ') || 'an unrecognized location'}; ${e.metadata.name} does not load it.`);
  e.detected = e.detected || e.decisions.some(d => d.status !== 'ignored');
  return e;
}
export function adapter(metadata: AdapterMetadata, discover: Adapter['discover'], resolve: Adapter['resolveForTarget']): Adapter {
  return { metadata, detect: async ctx => { const e = await base(metadata, ctx); return { detected: e.detected, executable: e.executable }; }, discover, parse: s => s, resolveForTarget: resolve, validate: validateExtensions, probe: probeMcp, explain: e => e.notes };
}

/** @path imports outside code spans/fences; precise referring line survives expansion. */
export function imports(s: Source): { path: string; line: number }[] {
  let fenced = false; let fence = ''; const out: { path: string; line: number }[] = [];
  s.body.split('\n').forEach((line, i) => {
    const f = line.match(/^\s*(`{3,}|~{3,})/);
    if (f) { if (!fenced) { fenced = true; fence = f[1][0]; } else if (f[1][0] === fence) fenced = false; return; }
    if (fenced) return;
    const clean = line.replace(/`[^`]*`/g, '');
    for (const m of clean.matchAll(/(?:^|\s)@((?:\\ |[^\s"'`<>])+)/g)) out.push({ path: m[1].replace(/\\ /g, ' '), line: s.bodyLine + i });
  }); return out;
}
const expandedFiles = new WeakMap<Effective, Set<string>>();
export async function expand(e: Effective, ctx: Context, s: Source, stack: string[] = [], depth = 0): Promise<void> {
  let real: string; try { real = await realpath(s.path); } catch { real = s.path; }
  if (stack.includes(real)) return;
  const seen = expandedFiles.get(e) ?? new Set<string>(); expandedFiles.set(e, seen);
  if (seen.has(real)) { decision(e, s, 'ignored', 'Already loaded through the same canonical source path.'); e.findings.push(finding('include.duplicate', 'info', locate(s), 'Instruction source referenced more than once.', 'Repeated imports resolve to the same canonical source.', 'Keep a single reference.', e.client)); return; }
  seen.add(real);
  const body = e.client === 'claude' ? stripComments(s.body) : s.body;
  addInstruction(e, s, depth ? `Imported by ${stack[stack.length - 1]}.` : 'Instruction file in the target directory’s ancestor chain.', body);
  for (const ref of imports({ ...s, body })) {
    const loc = { path: s.path, line: ref.line, column: 1 };
    if (e.client === 'claude' && depth >= 4) { e.findings.push(finding('include.depth', 'info', loc, 'Import exceeds Claude’s four-hop limit.', 'Nested imports stop after four hops.', 'Flatten the import chain.', e.client)); continue; }
    const target = path.resolve(path.dirname(s.path), ref.path.startsWith('~/') ? path.join(ctx.home, ref.path.slice(2)) : ref.path);
    const allowedRoot = s.scope === 'user' ? e.client === 'copilot' ? ctx.copilotHome : ctx.claudeHome : ctx.repo;
    if (!within(allowedRoot, target)) { e.findings.push(finding('include.outside-scope', 'warn', loc, 'Import leaves the inspected configuration scope.', e.client === 'copilot' ? 'Copilot CLI does not load out-of-repository/user-root imports.' : 'Claude can import external files, but Sightline does not inspect unrelated private files.', 'Keep shared instructions inside the repository or documented user config root, or inspect the destination separately.', e.client)); continue; }
    if (e.client === 'copilot' && (path.isAbsolute(ref.path) || ref.path.startsWith('~/') || !within(s.scope === 'user' ? ctx.copilotHome : ctx.repo, target))) { e.findings.push(finding('include.outside-scope', 'warn', loc, 'Copilot ignores this import path.', 'Imports must be relative and remain inside the repository or user instruction directory.', 'Use a repository-relative import.', e.client)); continue; }
    if (depth >= 32) { e.findings.push(finding('include.inspection-depth', 'warn', loc, 'Import inspection stopped at 32 hops.', 'This is an inspector recursion limit, not a claimed Copilot limit.', 'Shorten the import chain.', e.client)); continue; }
    let r: string; try { r = await realpath(target); } catch { e.findings.push(finding('include.missing', 'error', loc, 'Imported instruction file does not exist.', 'The @ reference cannot be resolved.', 'Correct the path relative to the referring file.', e.client)); continue; }
    if ([...stack, real].includes(r)) { e.findings.push(finding('include.cycle', 'error', loc, 'Circular instruction import.', 'This file resolves to an ancestor in the import chain.', 'Remove the back-reference.', e.client, [locate(s)])); continue; }
    if (!within(await realpath(allowedRoot), r)) { e.findings.push(finding('include.outside-scope', 'warn', loc, 'Import symlink leaves the inspected configuration scope.', 'External symlink contents are not read.', 'Use a source inside the declared root.', e.client)); continue; }
    const imported = await ctx.read(target, e.client, 'instructions', s.scope === 'user' ? 'user' : 'import');
    if (imported) { await expand(e, ctx, imported, [...stack, real], depth + 1); const d = e.decisions.findLast(x => x.path === imported.path); if (d) d.importedFrom = loc; }
  }
}
export function stripComments(body: string): string {
  let fence = false; return body.split(/(^\s*```.*$|^\s*~~~.*$)/m).map(p => { if (/^\s*(```|~~~)/.test(p)) { fence = !fence; return p; } return fence ? p : p.replace(/<!--[\s\S]*?-->/g, ''); }).join('');
}
export function truncated(e: Effective, s: Source, limit: number): string {
  const content = prefix(s.text, limit).trim();
  e.findings.push(finding('instructions.truncated', 'warn', { path: s.path, line: s.text.slice(0, prefix(s.text, limit).length).split('\n').length, column: 1 }, `Instruction source is truncated at the configured byte budget (${limit} bytes remaining).`, 'Codex stops reading project instructions at project_doc_max_bytes; later sources receive no remaining budget.', 'Raise project_doc_max_bytes in an active config layer or shorten the instruction chain.', e.client));
  return content;
}
export function rootOf(s: Source, folder: string): string { const p = slash(s.path); const i = p.lastIndexOf(`/${folder}/`); return i >= 0 ? p.slice(0, i) : s.baseDir; }
