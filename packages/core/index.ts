import { adapters } from '../adapters/index.js';
import { finish } from '../adapters/common.js';
import { discoverRepository, makeContext, selectedClients } from './discovery.js';
import { diagnose } from './diagnostics.js';
import { createRedactor, isSensitiveKey, privateMappings, redactScanReport, redactSourcePreview } from './redact.js';
import { collectPathMappings } from './paths.js';
import { compareInstructions } from './comparison.js';
import { cmp } from './utils.js';
import { VERSION } from './version.js';
import type { Context, Effective, Report, ScanOptions } from './types.js';
export type * from './types.js';
export { adapters } from '../adapters/index.js';

function privateData(ctx: Context): { values: string[]; settings: Set<string> } {
  const values = new Set<string>();
  const settings = new Set<string>();
  for (const source of ctx.sources) {
    const walk = (value: unknown, sensitive = false, mapping = false, keys?: string[]): void => {
      if (mapping && keys) settings.add(source.path + '\0' + keys.join('.'));
      if (typeof value === 'string') { if (sensitive) values.add(value); return; }
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        const privateMapping = mapping || privateMappings.has(key);
        walk(child, sensitive || privateMapping || isSensitiveKey(key), privateMapping, keys ? [...keys, key] : undefined);
      }
    };
    walk(source.data, false, false, []);
    for (const range of source.valueRanges ?? []) if (range.private) walk(range.value, true);
  }
  return { values: [...values].filter(value => value && !/^\$\{(?:env:)?[A-Za-z_][\w]*\}$/.test(value)), settings };
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
    return !source || source.owners.some(owner => chosen.some(adapter => adapter.metadata.id === owner));
  });
  const findings = [...discoveryFindings, ...clients.flatMap(e => e.findings), ...diagnose(ctx, clients)];
  const unique = [...new Map(findings.map(f => [f.id, f])).values()].sort((a, b) => ({ error: 0, warn: 1, info: 2 }[a.severity] - { error: 0, warn: 1, info: 2 }[b.severity] || cmp(a.location.path, b.location.path) || a.location.line - b.location.line || a.location.column - b.location.column || cmp(a.ruleId, b.ruleId) || cmp(a.client ?? '', b.client ?? '')));
  const diff = new Map<string, Report['diff'][number]>();
  for (const e of clients) for (const d of e.decisions) if (['active', 'truncated'].includes(d.status) && d.content.trim()) {
    const key = d.content.trim(); const entry = diff.get(key) ?? { content: key, clients: [], sources: [] };
    if (!entry.clients.includes(e.client)) entry.clients.push(e.client);
    if (!entry.sources.some(x => x.path === d.path && x.line === d.line)) entry.sources.push({ path: d.path, line: d.line, column: 1 });
    diff.set(key, entry);
  }
  const privateValues = privateData(ctx);
  const scrub = createRedactor(privateValues.values);
  const report: Report = {
    schemaVersion: '1.0', tool: { name: 'Agent Sightline', version: VERSION }, repository: ctx.repo, target: ctx.target, sessionDirectory: ctx.directory,
    ...(options.codexProfile ? { inputs: { codexProfile: options.codexProfile } } : {}),
    discovery: ctx.discovery,
    assumptions: ['Fresh session launched in sessionDirectory, with target opened for path matching.', `User configuration: ${options.user === false ? 'excluded' : 'documented locations only (marked user)'}.`, `Trust: ${options.trust ?? 'auto'}; unknown trust remains conditional. --trust trusted also assumes project MCP approval for Claude.`, 'Only sources within --repo and explicit user/system configuration locations are read; external ancestors/imports may add context.', 'Token estimates use UTF-8 bytes / 4, not a model tokenizer. No model call or telemetry.', ...(options.codexProfile ? [`Codex profile ${options.codexProfile} loads after user defaults and before applicable project layers.`] : [])],
    sources: ctx.sources.sort((a, b) => cmp(a.path, b.path)).map(source => {
      const { id, path, relativePath, owners, kind, scope, bytes, bodyLine, invalid } = source;
      // Syntax errors can discard private values during parsing, including overwritten duplicate keys.
      // Account/session state files only expose the parsed fields used by adapters.
      const privateState = /[/\\]\.claude\.json$/.test(path) || source.scope === 'user' && source.owners.includes('copilot') && /[/\\]config\.json$/.test(path);
      return { id, path, relativePath, owners, kind, scope, bytes, bodyLine, invalid, ...(privateState || invalid ? {} : { preview: redactSourcePreview(source, scrub) }) };
    }),
    clients, findings: unique, diff: [...diff.values()], instructionDiff: compareInstructions(clients, ctx.sources, scrub),
  };
  const result = redactScanReport(report, scrub, privateValues.settings);
  const configuration = [result.clients, result.findings];
  result.pathMappings = (await collectPathMappings(ctx, configuration)).map(mapping => ({
    path: scrub(mapping.path), replacement: scrub(mapping.replacement),
  }));
  options.signal?.throwIfAborted();
  return result;
}
