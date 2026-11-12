import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Report, Severity } from '../core/types.js';
import { redact, redactText } from '../core/redact.js';
export function json(report: Report): string { return JSON.stringify(redact(report), null, 2) + '\n'; }
export function filter(report: Report, severity?: Severity): Report {
  const levels = { error: 0, warn: 1, info: 2 };
  if (!severity) return report;
  return { ...report, findings: report.findings.filter(f => levels[f.severity] <= levels[severity]) };
}
export function failed(report: Report, failOn: Severity | 'none'): boolean {
  return failOn !== 'none' && filter(report, failOn).findings.length > 0;
}
export function terminal(report: Report, mode = 'scan'): string {
  const lines = ['Agent Sightline', '────────────────────────────────────────────────────────', `Repository: ${report.repository}`, `Target:     ${report.target}`, ''];
  const detected = report.clients.filter(c => c.detected);
  lines.push(`Clients:    ${detected.map(c => c.metadata.name).join(', ') || '(no compatible configuration found)'}`, '');
  lines.push(`${detected.length} compatible clients · ${report.sources.length} sources · ${report.findings.length} findings`, '');
  if (mode === 'explain') for (const e of report.clients) {
    lines.push(`${e.metadata.name} · ${e.metadata.maturity} rules ${e.metadata.ruleVersion}`, '');
    for (const d of e.decisions.sort((a, b) => (a.order ?? 999999) - (b.order ?? 999999))) {
      lines.push(`  ${d.order ?? '–'}  ${d.status.toUpperCase().padEnd(11)} ${d.path}:${d.line}`, `     ${d.reason}`, `     ${d.loadedBytes}/${d.bytes} bytes · ~${d.estimatedTokens} tokens · ${d.scope}`);
    }
    lines.push('', `Effective instructions · ${e.instructionBytes} bytes · ~${e.estimatedTokens} tokens`, e.instructions || '(no proven active instructions)', '', 'Effective settings');
    for (const s of e.settings.filter(s => s.status !== 'shadowed')) lines.push(`  [${s.status}] ${s.key} = ${JSON.stringify(s.value)}  ← ${s.location.path}:${s.location.line}`);
    lines.push('', 'Extensions');
    for (const x of e.extensions) lines.push(`  ${x.kind} ${x.name} [${x.status}] ${JSON.stringify(x.config)}  ← ${x.location.path}:${x.location.line}`);
    lines.push('', ...e.notes.map(n => `  Note: ${n}`), '');
  }
  if (mode === 'diff') {
    lines.push('Instruction content by receiving client', '');
    for (const d of report.diff) lines.push(`  ${d.clients.join(', ')}${d.clients.length === report.clients.length ? ' · shared by all' : ''}`, `  ${d.sources.map(s => `${s.path}:${s.line}`).join(', ')}`, ...d.content.split('\n').map(l => `    ${l}`), '');
    for (const e of report.clients) { lines.push(`${e.metadata.name} extensions`); for (const x of e.extensions) lines.push(`  ${x.kind} ${x.name} [${x.status}] ${JSON.stringify(x.config)} ← ${x.location.path}:${x.location.line}`); lines.push(''); }
  }
  const grouped = new Map<string, { item: Report['findings'][number]; clients: string[] }>();
  for (const f of report.findings) { const key = `${f.ruleId}:${f.message}`; const g = grouped.get(key) ?? { item: f, clients: [] }; if (f.client && !g.clients.includes(f.client)) g.clients.push(f.client); grouped.set(key, g); }
  const findings = mode === 'scan' ? [...grouped.values()].slice(0, 12).map(g => ({ ...g.item, clientLabel: g.clients.join(', ') })) : report.findings.map(f => ({ ...f, clientLabel: f.client }));
  for (const f of findings) lines.push(`${f.severity.toUpperCase().padEnd(5)} ${f.message}${f.clientLabel ? ` [${f.clientLabel}]` : ''}`, `      ${f.location.path}:${f.location.line} · ${f.ruleId}`, `      ${f.why}`, `      Next: ${f.suggestion}`, '');
  if (!report.findings.length) lines.push('No deterministic configuration problems found.', '');
  if (mode === 'scan' && report.findings.length > findings.length) lines.push('Repeated client findings are grouped. Use --json or explain for every source location.', '');
  if (mode === 'scan') lines.push('Inspect a target: agent-sightline explain <file> --client codex', 'Compare clients:  agent-sightline diff <file> --clients codex,claude,copilot', 'Browse locally:   agent-sightline ui', '');
  lines.push('Local · read-only · no model calls · no telemetry');
  return redactText(lines.join('\n')) + '\n';
}
export function portable(report: Report): Report {
  const serialized = JSON.stringify(redact(report)).split(report.repository).join('<repo>').replace(/(?:\/Users\/[^/"\\]+|\/home\/[^/"\\]+|[A-Za-z]:\\\\Users\\\\[^\\"/]+)/g, '~');
  return JSON.parse(serialized);
}
export function html(report: Report, options: { live?: boolean; portable?: boolean } = {}): string {
  const data = options.portable === false ? redact(report) : portable(report);
  // HTML parsing normalizes CRLF before CSP hashing; Windows checkouts must agree.
  const script = readFileSync(new URL('../web/assets/app.js', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
  const style = readFileSync(new URL('../web/assets/style.css', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
  const sha = (s: string) => createHash('sha256').update(s).digest('base64');
  const safeJson = JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const csp = `default-src 'none'; script-src 'sha256-${sha(script)}'; style-src 'sha256-${sha(style)}'; connect-src ${options.live ? "'self'" : "'none'"}; img-src data:; base-uri 'none'; form-action 'none'`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>Agent Sightline — configuration inspector</title><style>${style}</style></head><body data-live="${options.live ? 'true' : 'false'}"><header><a class="brand" href="#">◉ <span>Agent Sightline</span></a><span class="privacy">LOCAL / READ ONLY</span><button id="export">Export HTML</button></header><main><section class="intro"><p class="eyebrow">SEE WHAT YOUR CODING AGENT ACTUALLY SEES</p><h1>Configuration, in focus.</h1><p id="repository"></p><form id="target-form"><label for="target">Target file or directory</label><div class="target-row"><input id="target" autocomplete="off" placeholder="src/payments/refund.ts"><button id="inspect" type="submit">Inspect target</button></div><p id="error" role="alert"></p></form><div id="stats"></div></section><nav class="tabs" aria-label="View"><button id="effective-tab" aria-pressed="true">Effective configuration</button><button id="compare-tab" aria-pressed="false">Compare clients</button><button id="findings-tab" aria-pressed="false">Findings <span id="finding-count"></span></button></nav><section id="effective" class="workspace"><aside><h2>Clients & sources</h2><div id="clients"></div><div id="sources"></div></aside><article><div id="effective-title"></div><div id="instructions"></div><h2>Structured settings</h2><div id="settings"></div><h2>Extensions</h2><div id="extensions"></div></article><aside class="why"><h2>Why this applies</h2><div id="why"></div></aside></section><section id="compare" hidden></section><section id="findings" hidden><div class="filters"><label>Severity <select id="severity"><option value="all">All</option><option value="error">Errors</option><option value="warn">Warnings</option><option value="info">Info</option></select></label><label>Client <select id="finding-client"><option value="all">All clients</option></select></label></div><div id="findings-list"></div></section><footer><p>Deterministic configuration diagnostics. Token estimates use bytes / 4.</p><details><summary>Scope & assumptions</summary><ul id="assumptions"></ul></details></footer></main><script type="application/json" id="report-data">${safeJson}</script><script>${script}</script></body></html>`;
}
