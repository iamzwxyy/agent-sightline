import { basename, join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { adapters } from '../adapters/index.js';
import { finish, sourceInScope } from '../adapters/common.js';
import { discoverRepository, makeContext, selectedClients } from './discovery.js';
import { diagnose } from './diagnostics.js';
import { createRedactor, isSensitiveKey, isPrivateMapping, redactScanReport, redactSourcePreview, redactTruncatedInstruction, scalarText } from './redact.js';
import { collectPathMappings } from './paths.js';
import { compareInstructions } from './comparison.js';
import { cmp, stripComments } from './utils.js';
import { VERSION } from './version.js';
import type { Context, Effective, Report, ScanOptions, Source } from './types.js';
export type * from './types.js';
export { adapters } from '../adapters/index.js';

// Boolean/null masking uses parsed ranges and private setting paths.
function copiedValueText(value: unknown): string | undefined {
  if (typeof value === 'boolean' || value === null) return undefined;
  return scalarText(value);
}

function encodedPrivateValues(sources: Source[], values: ReadonlySet<string>): string[] {
  const retained = new Set(values);
  for (const source of sources) for (const range of source.valueRanges ?? []) {
    const value = copiedValueText(range.value);
    if (value === undefined || !values.has(value)) continue;
    let literal = source.text.slice(range.offset, range.offset + range.length);
    if ((literal.startsWith('"') || literal.startsWith("'")) && literal.endsWith(literal[0])) literal = literal.slice(1, -1);
    if (literal && literal !== value) retained.add(literal);
  }
  return [...retained];
}

function privateData(ctx: Context): { values: string[]; settings: Set<string> } {
  const values = new Set<string>(ctx.privateInstructionValues);
  const settings = new Set<string>();
  for (const source of ctx.sources) {
    const walk = (value: unknown, sensitive = false, mapping = false, keys?: string[], stack = new Set<object>()): void => {
      if (sensitive && keys) settings.add(source.path + '\0' + keys.join('.'));
      const scalar = copiedValueText(value);
      if (scalar !== undefined) { if (sensitive) values.add(scalar); return; }
      if (!value || typeof value !== 'object') return;
      if (stack.has(value)) return;
      stack.add(value);
      for (const [key, child] of Object.entries(value)) {
        const privateMapping = mapping || isPrivateMapping(key);
        walk(child, sensitive || privateMapping || isSensitiveKey(key), privateMapping, keys ? [...keys, key] : undefined, stack);
      }
      stack.delete(value);
    };
    walk(source.data, false, false, []);
    // Recovered statement trees retain private keys after whole-file parse failure.
    for (const range of source.valueRanges ?? []) walk(range.value, range.private === true);
  }
  const retained = new Set([...values].filter(value => value && !/^\$\{(?:env:)?[A-Za-z_][\w]*\}$/.test(value)));
  return { values: encodedPrivateValues(ctx.sources, retained), settings };
}
export async function scan(options: ScanOptions & { probe?: boolean } = {}): Promise<Report> {
  options.signal?.throwIfAborted();
  const ctx = await makeContext(options);
  await discoverRepository(ctx);
  const chosen = adapters.filter(a => selectedClients(options).includes(a.metadata.id));
  // Ordered discovery shares a bounded cache and keeps all imported sources visible to diff.
  for (const a of chosen) { options.signal?.throwIfAborted(); await a.discover(ctx); }
  const clients: Effective[] = [];
  for (const a of chosen) {
    options.signal?.throwIfAborted();
    const e = await a.resolveForTarget(ctx);
    e.findings.push(...await a.validate(ctx, e));
    if (options.probe) for (const x of e.extensions) { options.signal?.throwIfAborted(); e.findings.push(...await a.probe(x, ctx)); }
    clients.push(e);
  }
  options.signal?.throwIfAborted();
  // Later adapters can discover imported files. Every client must explain those too.
  for (const e of clients) finish(e, ctx);
  const discoveryFindings = ctx.findings.filter(finding => {
    if (!finding.ruleId.startsWith('parse.') && finding.ruleId !== 'source.empty') return true;
    const source = ctx.sources.find(source => source.path === finding.location.path);
    return !source || clients.some(client => sourceInScope(client, source));
  });
  const findings = [...discoveryFindings, ...clients.flatMap(e => e.findings), ...diagnose(ctx, clients)];
  const unique = [...new Map(findings.map(f => [f.id, f])).values()].sort((a, b) => ({ error: 0, warn: 1, info: 2 }[a.severity] - { error: 0, warn: 1, info: 2 }[b.severity] || cmp(a.location.path, b.location.path) || a.location.line - b.location.line || a.location.column - b.location.column || cmp(a.ruleId, b.ruleId) || cmp(a.client ?? '', b.client ?? '')));
  const privateValues = privateData(ctx);
  const scrub = createRedactor(privateValues.values);
  const sourceById = new Map(ctx.sources.map(source => [source.id, source]));
  for (const client of clients) {
    let clipped = false;
    for (const contribution of client.decisions) {
      if (contribution.status !== 'truncated' || !contribution.content) continue;
      const source = sourceById.get(contribution.sourceId);
      if (!source) continue;
      const complete = client.client === 'claude' ? stripComments(source.body) : source.text;
      const redacted = redactTruncatedInstruction(contribution.content, complete, privateValues.values);
      if (redacted !== contribution.content) {
        (ctx.redactedInstructionContent ??= new WeakMap()).set(contribution, redacted);
        clipped = true;
      }
    }
    if (!clipped) continue;
    const parts: string[] = [];
    let cursor = 0;
    for (const contribution of client.decisions) {
      if (!['active', 'truncated'].includes(contribution.status) || !['instructions', 'rules'].includes(contribution.kind) || !contribution.content.trim()) continue;
      const start = client.instructions.indexOf(contribution.content, cursor);
      if (start < 0) continue;
      parts.push(client.instructions.slice(cursor, start), ctx.redactedInstructionContent?.get(contribution) ?? contribution.content);
      cursor = start + contribution.content.length;
    }
    parts.push(client.instructions.slice(cursor));
    client.instructions = parts.join('');
  }
  const diff = new Map<string, Report['diff'][number]>();
  for (const e of clients) for (const d of e.decisions) if (['active', 'truncated'].includes(d.status) && d.content.trim()) {
    const key = d.content.trim(); const entry = diff.get(key) ?? { content: key, clients: [], sources: [] };
    const redactedContent = ctx.redactedInstructionContent?.get(d);
    if (redactedContent !== undefined && redactedContent.trim() !== key) entry.content = '[REDACTED]';
    if (!entry.clients.includes(e.client)) entry.clients.push(e.client);
    if (!entry.sources.some(x => x.path === d.path && x.line === d.line && x.column === (d.column ?? 1))) entry.sources.push({ path: d.path, line: d.line, column: d.column ?? 1 });
    diff.set(key, entry);
  }
  const privateSourceScrubbers = new Map<string, ReturnType<typeof createRedactor>>();
  for (const [filename, values] of ctx.privateSourceValues ?? []) {
    const state = ctx.sources.find(source => source.path === filename)!;
    const stateScrub = createRedactor(encodedPrivateValues([state], values));
    for (const source of ctx.sources) {
      if (source.path === filename || state.canonicalPath && source.canonicalPath === state.canonicalPath) privateSourceScrubbers.set(source.path, stateScrub);
    }
  }
  const instructionDiff = compareInstructions(clients, ctx.sources, scrub, ctx.redactedInstructionContent);
  for (const client of clients) for (const contribution of client.decisions) {
    const redacted = ctx.redactedInstructionContent?.get(contribution);
    if (redacted !== undefined) contribution.content = redacted;
  }
  const copilotState = join(ctx.copilotHome, 'config.json');
  const privateStatePaths = new Set([copilotState, ...ctx.privateStatePaths ?? []]);
  for (const source of ctx.sources) if (basename(source.path) === '.claude.json') privateStatePaths.add(source.path);
  const canonicalStates = new Set(ctx.sources.filter(source => privateStatePaths.has(source.path)).map(source => source.canonicalPath));
  const canonicalState = await realpath(copilotState).catch(() => undefined);
  if (canonicalState) canonicalStates.add(canonicalState);
  for (const source of ctx.sources) if (source.canonicalPath && canonicalStates.has(source.canonicalPath)) privateStatePaths.add(source.path);
  const report: Report = {
    schemaVersion: '1.0', tool: { name: 'Agent Sightline', version: VERSION }, repository: ctx.repo, target: ctx.target, sessionDirectory: ctx.directory,
    ...(options.codexProfile || options.sessionDirectory !== undefined || options.trust !== undefined ? { inputs: {
      ...(options.codexProfile ? { codexProfile: options.codexProfile } : {}),
      ...(options.sessionDirectory !== undefined ? { sessionDirectory: ctx.directory } : {}),
      ...(options.trust !== undefined ? { trust: options.trust } : {}),
    } } : {}),
    discovery: ctx.discovery,
    assumptions: ['Fresh session launched in sessionDirectory, with target opened for path matching.', `User configuration: ${options.user === false ? 'excluded' : 'documented locations only (marked user)'}.`, `Trust: ${options.trust ?? 'auto'}; unknown trust remains conditional. --trust trusted also assumes project MCP approval for Claude.`, 'Only sources within --repo and explicit user/system configuration locations are read; external ancestors/imports may add context.', 'Token estimates use UTF-8 bytes / 4, not a model tokenizer. No model call or telemetry.', ...(options.codexProfile ? [`Codex profile ${options.codexProfile} loads after user defaults and before applicable project layers.`] : [])],
    sources: ctx.sources.sort((a, b) => cmp(a.path, b.path)).map(source => {
      const { id, path, relativePath, owners, kind, scope, bytes, bodyLine, invalid } = source;
      // Syntax errors can discard private values during parsing, including overwritten duplicate keys.
      // Account/session state files only expose the parsed fields used by adapters.
      const privateState = privateStatePaths.has(path);
      return { id, path, relativePath, owners, kind, scope, bytes, bodyLine, invalid, ...(privateState || invalid ? {} : { preview: redactSourcePreview(source, scrub) }) };
    }),
    clients, findings: unique, diff: [...diff.values()], instructionDiff,
  };
  const result = redactScanReport(report, scrub, privateValues.settings, privateSourceScrubbers);
  const configuration = [result.clients, result.findings];
  result.pathMappings = (await collectPathMappings(ctx, configuration)).map(mapping => ({
    path: scrub(mapping.path), replacement: scrub(mapping.replacement),
  }));
  options.signal?.throwIfAborted();
  return result;
}
