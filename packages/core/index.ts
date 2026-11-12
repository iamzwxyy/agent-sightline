import { adapters } from '../adapters/index.js';
import { finish } from '../adapters/common.js';
import { discoverRepository, makeContext, selectedClients } from './discovery.js';
import { diagnose } from './diagnostics.js';
import { redact } from './redact.js';
import { collectPathMappings } from './paths.js';
import { cmp } from './utils.js';
import { VERSION } from './version.js';
import type { Context, Effective, Report, ScanOptions } from './types.js';
export type * from './types.js';
export { adapters } from '../adapters/index.js';

function envValues(ctx: Context): string[] {
  const values = new Set<string>();
  const walk = (v: unknown, sensitive = false) => {
    if (typeof v === 'string') { if (sensitive) values.add(v); return; }
    if (!v || typeof v !== 'object') return;
    for (const [key, value] of Object.entries(v)) walk(value, sensitive || ['env', 'headers', 'http_headers'].includes(key) || /secret|token|password|api[_-]?key|cookie|authorization|credential/i.test(key));
  };
  for (const s of ctx.sources) walk(s.data);
  return [...values].filter(v => v && !v.startsWith('${'));
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
  const report: Report = {
    schemaVersion: '1.0', tool: { name: 'Agent Sightline', version: VERSION }, repository: ctx.repo, target: ctx.target, sessionDirectory: ctx.directory,
    ...(options.codexProfile ? { inputs: { codexProfile: options.codexProfile } } : {}),
    discovery: ctx.discovery,
    assumptions: ['Fresh session launched in sessionDirectory, with target opened for path matching.', `User configuration: ${options.user === false ? 'excluded' : 'documented locations only (marked user)'}.`, `Trust: ${options.trust ?? 'auto'}; unknown trust remains conditional. --trust trusted also assumes project MCP approval for Claude.`, 'Only sources within --repo and explicit user/system configuration locations are read; external ancestors/imports may add context.', 'Token estimates use UTF-8 bytes / 4, not a model tokenizer. No model call or telemetry.', ...(options.codexProfile ? [`Codex profile ${options.codexProfile} loads after user defaults and before applicable project layers.`] : [])],
    sources: ctx.sources.sort((a, b) => cmp(a.path, b.path)).map(source => {
      const { id, path, relativePath, owners, kind, scope, bytes, bodyLine, invalid } = source;
      // Account/session state files only expose the parsed fields used by adapters.
      const privateState = /[/\\]\.claude\.json$/.test(path) || source.scope === 'user' && source.owners.includes('copilot') && /[/\\]config\.json$/.test(path);
      return { id, path, relativePath, owners, kind, scope, bytes, bodyLine, invalid, ...(privateState ? {} : { preview: source.text }) };
    }),
    clients, findings: unique, diff: [...diff.values()],
  };
  const privateValues = envValues(ctx);
  const result = redact(report, privateValues);
  const configuration = [result.clients, result.findings];
  result.pathMappings = redact(await collectPathMappings(ctx, configuration), privateValues);
  return result;
}
