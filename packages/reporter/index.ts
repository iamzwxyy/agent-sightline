import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Extension, Finding, Report, Severity } from '../core/types.js';
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
  report = redact(report);
  const extensionLines = (extension: Extension): string[] => [
    `  ${extension.kind} ${extension.name} [${extension.status}] ${JSON.stringify(extension.config)}  ← ${extension.location.path}:${extension.location.line}`,
    ...extension.origins?.map(origin => `    ${origin.key} ← ${origin.location.path}:${origin.location.line}`) ?? [],
  ];
  const grouped = new Map<string, { item: Finding; clients: string[] }>();
  for (const finding of report.findings) {
    const key = JSON.stringify([finding.ruleId, finding.severity, finding.message, finding.location, finding.why, finding.suggestion, finding.related]);
    let group = grouped.get(key);
    if (!group) {
      group = { item: finding, clients: [] };
      grouped.set(key, group);
    }
    if (finding.client && !group.clients.includes(finding.client)) group.clients.push(finding.client);
  }
  const groups = [...grouped.values()];
  const summaryFindings = mode === 'scan' ? groups.map(group => group.item) : report.findings;
  const counts = { error: 0, warn: 0, info: 0 };
  for (const finding of summaryFindings) counts[finding.severity]++;
  const lines = ['Agent Sightline', '────────────────────────────────────────────────────────', `Repository: ${report.repository}`, `Target:     ${report.target}`, ''];
  if (report.inputs?.codexProfile) lines.push(`Codex profile: ${report.inputs.codexProfile}`, '');
  const detected = report.clients.filter(c => c.detected);
  const clientNames = detected.map(client => client.metadata.name + (client.metadata.maturity === 'experimental' ? ' (experimental)' : ''));
  lines.push(`Clients:    ${clientNames.join(', ') || '(no compatible configuration found)'}`, '');
  lines.push(`${detected.length} compatible clients · ${report.sources.length} sources · ${summaryFindings.length} findings`, `Errors ${counts.error} · Warnings ${counts.warn} · Info ${counts.info}`, '');
  if (report.discovery?.complete === false) lines.push('Configuration discovery is incomplete.', 'Use --severity warn to review skipped locations and discovery limits.', '');
  if (mode === 'explain') for (const e of report.clients) {
    lines.push(`${e.metadata.name} · ${e.metadata.maturity} rules ${e.metadata.ruleVersion}`, '');
    for (const d of e.decisions.sort((a, b) => (a.order ?? 999999) - (b.order ?? 999999))) {
      lines.push(`  ${d.order ?? '–'}  ${d.status.toUpperCase().padEnd(11)} ${d.path}:${d.line}`, `     ${d.reason}`, `     ${d.loadedBytes}/${d.bytes} bytes · ~${d.estimatedTokens} tokens · ${d.scope}`);
    }
    lines.push('', `Effective instructions · ${e.instructionBytes} bytes · ~${e.estimatedTokens} tokens`, e.instructions || '(no proven active instructions)', '', 'Effective settings');
    for (const s of e.settings.filter(s => s.status !== 'shadowed')) lines.push(`  [${s.status}] ${s.key} = ${JSON.stringify(s.value)}  ← ${s.location.path}:${s.location.line}`);
    lines.push('', 'Extensions');
    for (const x of e.extensions) lines.push(...extensionLines(x));
    lines.push('', ...e.notes.map(n => `  Note: ${n}`), '');
  }
  if (mode === 'diff') {
    lines.push('Instruction content by receiving client', '');
    for (const d of report.diff) lines.push(`  ${d.clients.join(', ')}${d.clients.length === report.clients.length ? ' · shared by all' : ''}`, `  ${d.sources.map(s => `${s.path}:${s.line}`).join(', ')}`, ...d.content.split('\n').map(l => `    ${l}`), '');
    for (const e of report.clients) { lines.push(`${e.metadata.name} extensions`); for (const x of e.extensions) lines.push(...extensionLines(x)); lines.push(''); }
  }
  const findings = mode === 'scan' ? groups.slice(0, 12).map(group => ({ ...group.item, clientLabel: group.clients.join(', ') })) : report.findings.map(f => ({ ...f, clientLabel: f.client }));
  for (const finding of findings) {
    lines.push(`${finding.severity.toUpperCase().padEnd(5)} ${finding.message}${finding.clientLabel ? ` [${finding.clientLabel}]` : ''}`, `      ${finding.location.path}:${finding.location.line}:${finding.location.column} · ${finding.ruleId}`);
    const related = new Map(finding.related.map(location => [JSON.stringify(location), location]));
    related.delete(JSON.stringify(finding.location));
    for (const location of related.values()) lines.push(`      Related ${location.path}:${location.line}:${location.column}`);
    lines.push(`      ${finding.why}`, `      Next: ${finding.suggestion}`, '');
  }
  if (!report.findings.length && report.discovery?.complete !== false) {
    if (mode === 'scan' && !report.sources.length) lines.push('No agent configuration was discovered in this scan.', 'Explore the bundled example with agent-sightline demo', '');
    else lines.push('No deterministic configuration problems found.', '');
  }
  if (mode === 'scan' && groups.length > findings.length) lines.push(`Showing ${findings.length} of ${groups.length} distinct findings. Use --json or explain to inspect the rest.`, '');
  if (mode === 'scan' && report.findings.length > groups.length) lines.push('Identical findings at the same source are grouped across clients.', '');
  if (mode === 'scan') lines.push('Inspect a target: agent-sightline explain <file> --client codex', 'Compare clients:  agent-sightline diff <file> --clients codex,claude,copilot', 'Browse locally:   agent-sightline ui', '');
  lines.push('Local · read-only · no model calls · no telemetry');
  return redactText(lines.join('\n')) + '\n';
}
export function portable(report: Report): Report {
  const data = redact(report);
  const mappings = [...data.pathMappings ?? [], { path: data.repository, replacement: '<repo>' }]
    .filter(mapping => /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(mapping.path))
    .sort((a, b) => b.path.length - a.path.length);
  delete data.pathMappings;
  const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const before = "(^|file:/+|[\\s\"'`=(:,;\\[{}<>])";
  const after = "(?=$|[/\\\\\\s\"'`),;:\\]}<>])";
  const replacements = mappings.map(mapping => {
    const windows = /^(?:[A-Za-z]:[\\/]|\\\\)/.test(mapping.path);
    const variants = new Set([mapping.path, JSON.stringify(mapping.path).slice(1, -1)]);
    const pattern = windows
      ? mapping.path.split(/[\\/]+/).map(escape).join('[/\\\\]+')
      : [...variants].sort((a, b) => b.length - a.length).map(escape).join('|');
    const trailingSeparator = windows ? /[\\/]$/.test(mapping.path) : mapping.path.endsWith('/');
    return {
      exact: new RegExp('^(?:' + pattern + ')$', windows ? 'i' : ''),
      path: new RegExp(before + '(?:' + pattern + ')' + (trailingSeparator ? '' : after), windows ? 'gi' : 'g'),
      replacement: mapping.replacement,
      suffix: trailingSeparator ? '/' : '',
    };
  });
  const commonHome = new RegExp(before + "(?:/(?:Users|home)/[^/\"\\\\\\r\\n]+|[A-Za-z]:[/\\\\]+Users[/\\\\]+[^/\\\\\"\\r\\n]+)", 'g');
  const scrub = (text: string): string => {
    // Flattened configuration keys keep their final setting name separate from the path.
    const pathKey = text.match(/^(projects\.|hooks\.state\.)(.*)(\.[^.]+)$/);
    if (pathKey) text = pathKey[2];
    for (const rule of replacements) {
      if (rule.exact.test(text)) { text = rule.replacement; continue; }
      text = text.replace(rule.path, (_match, prefix: string) => prefix + rule.replacement + rule.suffix);
    }
    text = text.replace(commonHome, (_match, prefix: string) => prefix + '~');
    return pathKey ? pathKey[1] + text + pathKey[3] : text;
  };
  const claudeProjectRoots = data.clients.filter(client => client.client === 'claude').flatMap(client => client.extensions.flatMap(extension => {
    const key = extension.location.key;
    const suffix = `.mcpServers.${extension.name}`;
    return extension.kind === 'mcp' && key?.startsWith('projects.') && key.endsWith(suffix)
      ? [{ path: extension.location.path, root: key.slice('projects.'.length, -suffix.length) }]
      : [];
  }));
  const walk = (value: any): any => {
    if (typeof value === 'string') return scrub(value);
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      // Claude embeds the complete project path before a multi-component MCP field suffix.
      const project = typeof value.key === 'string' ? claudeProjectRoots.find(project => project.path === value.path && value.key.startsWith(`projects.${project.root}.mcpServers.`)) : undefined;
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [scrub(key), project && key === 'key'
        ? `projects.${scrub(project.root)}${value.key.slice('projects.'.length + project.root.length)}`
        : walk(child)]));
    }
    return value;
  };
  const result = walk(data) as Report;
  result.repository = '<repo>';
  return result;
}
export function html(report: Report, options: { live?: boolean; portable?: boolean } = {}): string {
  const data = options.portable === false ? redact(report) : portable(report);
  // HTML parsing normalizes CRLF before CSP hashing; Windows checkouts must agree.
  const script = readFileSync(new URL('../web/assets/app.js', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
  const font = readFileSync(new URL('../web/assets/fonts/instrument-sans.woff2', import.meta.url)).toString('base64');
  const style = `@font-face{font-family:'Instrument Sans';font-style:normal;font-weight:400 700;font-display:swap;src:url(data:font/woff2;base64,${font}) format('woff2')}\n` + readFileSync(new URL('../web/assets/style.css', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
  const sha = (s: string) => createHash('sha256').update(s).digest('base64');
  const safeJson = (value: Report | string | null) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const csp = `default-src 'none'; script-src 'sha256-${sha(script)}'; style-src 'sha256-${sha(style)}'; font-src data:; connect-src ${options.live ? "'self'" : "'none'"}; img-src data:; base-uri 'none'; form-action 'none'`;
  const shell = readFileSync(new URL('../web/assets/shell.html', import.meta.url), 'utf8');
  const values: Record<string, string> = {
    CSP: csp,
    STYLE: style,
    LIVE: options.live ? 'true' : 'false',
    DATA: safeJson(data),
    EXPORT: options.live ? safeJson(html(report)) : 'null',
    SCRIPT: script,
  };
  return shell.replace(/\{\{(CSP|STYLE|LIVE|DATA|EXPORT|SCRIPT)\}\}/g, (_match, key: string) => values[key]!);
}
