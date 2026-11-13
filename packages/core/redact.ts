import type { Finding, Location, Report, Source } from './types.js';

const sensitiveKey = /(?:secret|token|password|passwd|api[_-]?key|cookie|authorization|credential|private[_-]?key|client[_-]?secret)/i;
export const privateMappings: ReadonlySet<string> = new Set(['env', 'headers', 'http_headers']);
export const isSensitiveKey = (key: string): boolean => key !== 'estimatedTokens' && sensitiveKey.test(key);
const lineBreaks = (text: string): string => text.match(/\r\n|\r|\n/g)?.join('') ?? '';
const mask = (text: string, label = '[REDACTED]'): string => label + lineBreaks(text);

export function redactText(text: string): string {
  return text
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, value => mask(value, '[REDACTED PRIVATE KEY]'))
    .replace(/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|AKIA[A-Z0-9]{16})\b/g, '[REDACTED]')
    .replace(/((?:Authorization|Cookie|Set-Cookie)\s*:\s*)[^\r\n]+/gi, '$1[REDACTED]')
    .replace(/(\b(?:Bearer|Basic)\s+)[A-Za-z0-9+/_=.-]+/gi, '$1[REDACTED]')
    .replace(/((?:[A-Za-z0-9_.-]*(?:secret|token|password|passwd|api[_-]?key|cookie|authorization|credential|private[_-]?key)[A-Za-z0-9_.-]*)["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'[^']*'|[^\s,;}]+)/gi, (_match, prefix: string, value: string) => prefix + mask(value))
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/([?&](?:token|key|api_key|secret|password|access_token)=)[^&\s"'<>]+/gi, '$1[REDACTED]')
    .replace(/(--(?:token|password|api-key|secret)(?:=|\s+))("[^"]*"|'[^']*'|[^\s]+)/gi, (_match, prefix: string, value: string) => prefix + mask(value));
}
export function createRedactor(envValues: string[] = []): <T>(value: T) => T {
  const values = [...new Set(envValues.filter(Boolean))].sort((a, b) => b.length - a.length);
  const pattern = values.length ? new RegExp(values.map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g') : undefined;
  const scrub = (text: string): string => redactText(pattern ? text.replace(pattern, value => mask(value)) : text);
  const walk = (v: any, key = '', parent = ''): any => {
    if (privateMappings.has(parent)) return '[REDACTED]';
    if (isSensitiveKey(key)) return '[REDACTED]';
    if (typeof v === 'string') return scrub(v);
    if (Array.isArray(v)) return v.map(x => walk(x, '', key));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [scrub(k), walk(x, k, key)]));
    return v;
  };
  return value => walk(value);
}
export function redact<T>(value: T, envValues: string[] = []): T {
  return createRedactor(envValues)(value);
}

export function redactSourcePreview(source: Source, scrub: ReturnType<typeof createRedactor>): string {
  const parts: string[] = [];
  let cursor = 0;
  const ranges = [...source.valueRanges ?? []].sort((a, b) => a.offset - b.offset || b.length - a.length || Number(!!b.private) - Number(!!a.private));
  for (const range of ranges) {
    if (range.offset < cursor) continue;
    const value = range.private ? '[REDACTED]' : typeof range.value === 'string' ? scrub(range.value) : range.value;
    if (!range.private && value === range.value) continue;
    const original = source.text.slice(range.offset, range.offset + range.length);
    parts.push(source.text.slice(cursor, range.offset), JSON.stringify(value) + lineBreaks(original));
    cursor = range.offset + range.length;
  }
  parts.push(source.text.slice(cursor));
  return scrub(parts.join(''));
}

/** Apply captured private values to scan payloads while retaining engine-generated report structure. */
export function redactScanReport(report: Report, scrub: ReturnType<typeof createRedactor>, privateSettings: ReadonlySet<string>): Report {
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
        ...setting, key: scrub(setting.key), value: privateSettings.has(setting.location.path + '\0' + setting.key) ? '[REDACTED]' : scrub(setting.value), reason: scrub(setting.reason),
        location: location(setting.location), overrides: setting.overrides.map(location),
      })),
      extensions: client.extensions.map(extension => ({
        ...extension, name: scrub(extension.name), config: scrub(extension.config), reason: scrub(extension.reason), location: location(extension.location),
        ...(extension.origins ? { origins: extension.origins.map(origin => ({ key: scrub(origin.key), location: location(origin.location) })) } : {}),
      })),
      findings: client.findings.map(finding),
    })),
    findings: report.findings.map(finding),
    diff: report.diff.map(entry => ({ ...entry, content: scrub(entry.content), sources: entry.sources.map(location) })),
  };
}
