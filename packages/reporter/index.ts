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
  const font = readFileSync(new URL('../web/assets/fonts/instrument-sans.woff2', import.meta.url)).toString('base64');
  const style = `@font-face{font-family:'Instrument Sans';font-style:normal;font-weight:400 700;font-display:swap;src:url(data:font/woff2;base64,${font}) format('woff2')}\n` + readFileSync(new URL('../web/assets/style.css', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
  const sha = (s: string) => createHash('sha256').update(s).digest('base64');
  const safeJson = JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const csp = `default-src 'none'; script-src 'sha256-${sha(script)}'; style-src 'sha256-${sha(style)}'; font-src data:; connect-src ${options.live ? "'self'" : "'none'"}; img-src data:; base-uri 'none'; form-action 'none'`;
  const shell = readFileSync(new URL('../web/assets/shell.html', import.meta.url), 'utf8');
  return shell.replace(/\{\{(CSP|STYLE|LIVE|DATA|SCRIPT)\}\}/g, (_match, key: string) => ({
    CSP: csp,
    STYLE: style,
    LIVE: options.live ? 'true' : 'false',
    DATA: safeJson,
    SCRIPT: script,
  })[key]!);
}
