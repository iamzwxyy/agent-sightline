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
