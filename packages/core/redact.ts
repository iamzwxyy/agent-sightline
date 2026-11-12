import type { Finding, Location, Report } from './types.js';

const sensitiveKey = /(?:secret|token|password|passwd|api[_-]?key|cookie|authorization|credential|private[_-]?key|client[_-]?secret)/i;

export function redactText(text: string): string {
  return text
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|AKIA[A-Z0-9]{16})\b/g, '[REDACTED]')
    .replace(/((?:Authorization|Cookie|Set-Cookie)\s*:\s*)[^\r\n]+/gi, '$1[REDACTED]')
    .replace(/(\b(?:Bearer|Basic)\s+)[A-Za-z0-9+/_=.-]+/gi, '$1[REDACTED]')
    .replace(/((?:[A-Za-z0-9_.-]*(?:secret|token|password|passwd|api[_-]?key|cookie|authorization|credential)[A-Za-z0-9_.-]*)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s,;}]+)/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/([?&](?:token|key|api_key|secret|password|access_token)=)[^&\s"'<>]+/gi, '$1[REDACTED]')
    .replace(/(--(?:token|password|api-key|secret)(?:=|\s+))(?:"[^"]*"|'[^']*'|[^\s]+)/gi, '$1[REDACTED]');
}
export function redact<T>(value: T, envValues: string[] = []): T {
  const scrub = (s: string): string => {
    for (const v of envValues) if (v.length) s = s.split(v).join('[REDACTED]');
    return redactText(s);
  };
  const walk = (v: any, key = '', parent = ''): any => {
    if (['env', 'headers', 'http_headers'].includes(parent)) return '[REDACTED]';
    if (sensitiveKey.test(key) && key !== 'estimatedTokens') return '[REDACTED]';
    if (typeof v === 'string') return scrub(v);
    if (Array.isArray(v)) return v.map(x => walk(x, '', key));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [scrub(k), walk(x, k, key)]));
    return v;
  };
  return walk(value);
}

/** Apply captured private values to scan payloads while retaining engine-generated report structure. */
export function redactScanReport(report: Report, privateValues: string[]): Report {
  const scrub = <T>(value: T): T => redact(value, privateValues);
  const location = (value: Location): Location => ({
    ...value, path: scrub(value.path), ...(value.key === undefined ? {} : { key: scrub(value.key) }),
  });
  const finding = (value: Finding): Finding => ({
    ...value, message: scrub(value.message), why: scrub(value.why), suggestion: scrub(value.suggestion),
    location: location(value.location), related: value.related.map(location),
  });
  return {
    ...report,
    ...(report.inputs ? { inputs: { codexProfile: scrub(report.inputs.codexProfile) } } : {}),
    ...(report.pathMappings ? { pathMappings: report.pathMappings.map(mapping => ({ path: scrub(mapping.path), replacement: scrub(mapping.replacement) })) } : {}),
    repository: scrub(report.repository), target: scrub(report.target), sessionDirectory: scrub(report.sessionDirectory),
    assumptions: report.assumptions.map(scrub),
    sources: report.sources.map(source => ({
      ...source, path: scrub(source.path), relativePath: scrub(source.relativePath),
      ...(source.preview === undefined ? {} : { preview: scrub(source.preview) }),
    })),
    clients: report.clients.map(client => ({
      ...client, metadata: structuredClone(client.metadata),
      executable: scrub(client.executable), instructions: scrub(client.instructions), notes: client.notes.map(scrub),
      decisions: client.decisions.map(decision => ({
        ...decision, path: scrub(decision.path), reason: scrub(decision.reason), content: scrub(decision.content),
        ...(decision.importedFrom ? { importedFrom: location(decision.importedFrom) } : {}),
      })),
      settings: client.settings.map(setting => ({
        ...setting, key: scrub(setting.key), value: scrub(setting.value), reason: scrub(setting.reason),
        location: location(setting.location), overrides: setting.overrides.map(location),
      })),
      extensions: client.extensions.map(extension => ({
        ...extension, name: scrub(extension.name), config: scrub(extension.config), reason: scrub(extension.reason), location: location(extension.location),
      })),
      findings: client.findings.map(finding),
    })),
    findings: report.findings.map(finding),
    diff: report.diff.map(entry => ({ ...entry, content: scrub(entry.content), sources: entry.sources.map(location) })),
  };
}
