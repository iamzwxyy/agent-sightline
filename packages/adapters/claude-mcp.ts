import type { Context, Effective, Extension, Location, Source } from '../core/types.js';
import { finding, locate, plainObject } from '../core/utils.js';
import { validateMcpConfiguration } from '../core/extensions.js';
import { decision, mcp } from './common.js';

type PolicyEntry = { serverName: string } | { serverCommand: string[] } | { serverUrl: string };
interface PolicyRule { entry: PolicyEntry; location: Location }
interface McpSettingsSource extends Source { mcpPolicyLocations?: Record<string, Location> }
const listKeys = ['allowedMcpServers', 'deniedMcpServers'] as const;
const selectors = ['serverName', 'serverCommand', 'serverUrl'];
const variable = /\$\{([A-Za-z_][\w]*)(?:(:-|-)([^}]*))?\}/g;
const urlPattern = /^([^:/]+):\/\/(\[[^\]]+\]|[^/:?#]+)(?::([^/?#]+))?([/?][^#]*)?(?:#.*)?$/;

function validEntry(value: unknown, allow: boolean): value is PolicyEntry {
  if (!plainObject(value) || selectors.filter(key => Object.hasOwn(value, key)).length !== 1) return false;
  if (Object.hasOwn(value, 'serverName')) return typeof value.serverName === 'string' && (allow ? /^[A-Za-z0-9_-]+$/.test(value.serverName) : value.serverName.length > 0 && value.serverName.trim() === value.serverName);
  if (Object.hasOwn(value, 'serverCommand')) return Array.isArray(value.serverCommand) && value.serverCommand.length > 0 && value.serverCommand.every(item => typeof item === 'string');
  return typeof value.serverUrl === 'string';
}

function providedError(config: unknown, name: string): string | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return 'Managed server names require letters, numbers, hyphens or underscores.';
  if (!plainObject(config)) return 'A provided server must be an HTTP or SSE server object.';
  if (!['http', 'streamable-http', 'sse'].includes(config.type)) return 'Provided servers require the http, streamable-http or sse transport.';
  if (typeof config.url !== 'string') return 'Provided servers require an HTTPS URL.';
  try { if (new URL(config.url).protocol !== 'https:') return 'Provided servers require HTTPS, including on localhost.'; }
  catch { return 'The provided server URL must be a valid HTTPS URL.'; }
  for (const key of ['command', 'args', 'env', 'headersHelper']) if (Object.hasOwn(config, key)) return `Provided servers cannot declare ${key}.`;
  const inspect = (value: unknown): boolean => {
    if (typeof value === 'string') return /[\p{Cc}\p{Cf}]/u.test(value) || /\$\{[^}]+\}/.test(value);
    return value !== null && typeof value === 'object' && Object.entries(value).some(([key, child]) => /[\p{Cc}\p{Cf}]/u.test(key) || inspect(child));
  };
  if (inspect(config)) return 'Provided server keys and values cannot contain environment references or control/formatting characters.';
  return undefined;
}

export function claudeMcpSettingsSource<T extends Source>(e: Effective, source: T): T & McpSettingsSource {
  if (source.invalid) return source;
  const data = { ...source.data };
  const mcpPolicyLocations: Record<string, Location> = {};
  if (Object.hasOwn(data, 'managedMcpServers')) {
    const value = data.managedMcpServers;
    if (source.scope !== 'system') {
      e.settings.push({ key: 'managedMcpServers', value, location: locate(source, 'managedMcpServers'), status: 'ignored', reason: 'Provided MCP servers are accepted only from managed policy.', overrides: [] });
      e.findings.push(finding('claude.managed-only', 'warn', locate(source, 'managedMcpServers'), 'managedMcpServers requires managed settings.', 'Claude drops this key from user, project and local settings.', 'Ask an administrator to provide the servers through managed settings.', 'claude'));
      delete data.managedMcpServers;
    } else if (value === null) delete data.managedMcpServers;
    else if (!plainObject(value)) {
      e.findings.push(finding('claude.managed-mcp-invalid', 'error', locate(source, 'managedMcpServers'), 'managedMcpServers must be an object keyed by server name.', 'Claude drops this provided-server collection.', 'Use an object containing HTTPS HTTP or SSE server entries.', 'claude'));
      delete data.managedMcpServers;
    } else {
      data.managedMcpServers = {};
      for (const [name, config] of Object.entries(value)) {
        const key = 'managedMcpServers.' + name;
        const extension: Extension = { kind: 'mcp', name, status: 'active', config: plainObject(config) ? config : { _invalid: true }, location: locate(source, key), reason: 'Provided by the organization.' };
        const errors = validateMcpConfiguration(extension, 'claude', source);
        const reason = providedError(config, name) ?? errors.at(-1)?.why;
        if (!reason) { data.managedMcpServers[name] = config; continue; }
        e.findings.push(...errors);
        e.findings.push(finding('claude.managed-mcp-invalid', 'error', locate(source, key), `Provided MCP server "${name}" is invalid.`, reason, 'Repair this entry using the managed remote-server schema.', 'claude'));
        e.extensions.push({ ...extension, status: 'invalid', reason });
      }
    }
  }
  for (const key of listKeys) {
    const value = data[key];
    if (value === undefined) continue;
    if (source.scope === 'system' && value === null) { delete data[key]; continue; }
    if (!Array.isArray(value)) {
      const closed = source.scope === 'system' && key === 'allowedMcpServers';
      const reason = closed ? 'Claude enforces an empty managed MCP allowlist until this value is repaired.' : 'Claude drops this unreadable MCP policy list.';
      e.findings.push(finding('claude.mcp-policy-type', 'error', locate(source, key), `${key} must be an array.`, reason, 'Use an array of serverName, serverCommand or serverUrl entries.', 'claude'));
      e.settings.push({ key, value, location: locate(source, key), status: 'invalid', reason, overrides: [] });
      if (closed) data[key] = []; else delete data[key];
      continue;
    }
    const accepted: PolicyEntry[] = [];
    value.forEach((entry: unknown, index: number) => {
      const location = locate(source, `${key}.${index}`);
      if (validEntry(entry, key === 'allowedMcpServers')) {
        mcpPolicyLocations[`${key}.${accepted.length}`] = location;
        accepted.push(entry);
      } else e.findings.push(finding('claude.mcp-policy-type', 'error', location, `Invalid ${key} entry.`, 'Claude skips this entry while retaining other policy entries.', 'Supply exactly one documented serverName, serverCommand or serverUrl selector.', 'claude'));
    });
    data[key] = accepted;
  }
  return { ...source, data, mcpPolicyLocations };
}

export function claudeMcpEnvironments(ctx: Context, layers: Source[]): { live: NodeJS.ProcessEnv; pinned: NodeJS.ProcessEnv; denied: NodeJS.ProcessEnv } {
  const live = { ...ctx.env };
  const pinned = { ...ctx.env };
  const denied = { ...ctx.env };
  for (const source of layers) if (!source.invalid && plainObject(source.data.env)) {
    for (const [name, value] of Object.entries(source.data.env)) if (typeof value === 'string') {
      live[name] = value;
      if (source.scope === 'system') pinned[name] = value;
      if (source.scope === 'system' || source.scope === 'user') denied[name] = value;
    }
  }
  for (const [name, value] of Object.entries(pinned)) if (value !== undefined) denied[name] = value;
  return { live, pinned, denied };
}

function expand(value: string, env: NodeJS.ProcessEnv, fallbackEnv = env): string | undefined {
  let valid = true;
  const result = value.replace(variable, (_match, name: string, operator: string | undefined, fallback: string) => {
    const replacement = env[name] ?? (operator ? fallback : fallbackEnv[name]);
    if (replacement === undefined) valid = false;
    return replacement ?? '';
  });
  return valid ? result : undefined;
}

function expandAllowUrl(value: string, env: NodeJS.ProcessEnv): string | undefined {
  const references: { token: string; raw: string }[] = [];
  let template = value.replace(variable, raw => {
    const token = 'sightlineenv' + references.length;
    references.push({ token, raw });
    return token;
  });
  const parts = template.match(urlPattern);
  if (!parts) return undefined;
  for (const { token, raw } of references) {
    const replacement = expand(raw, env);
    if (replacement === undefined || /[\s*?#\\]/.test(replacement)) return undefined;
    if (parts[4]?.includes(token)) {
      if (replacement.split('/').some(segment => /^(?:\.|%2e){1,2}$/i.test(segment))) return undefined;
    } else if (/[/:@]/.test(replacement)) return undefined;
    template = template.replace(token, () => replacement);
  }
  return template;
}

function wildcardMatch(pattern: string, value: string): boolean {
  const expression = pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp('^' + expression + '$').test(value);
}

function urlMatches(pattern: string, value: string): boolean {
  const parts = pattern.match(urlPattern);
  if (!parts) return false;
  let actual: URL;
  try { actual = new URL(value); } catch { return false; }
  const scheme = actual.protocol.slice(0, -1).toLowerCase();
  const host = actual.hostname.toLowerCase().replace(/\.$/, '');
  const expectedHost = parts[2].toLowerCase().replace(/\.$/, '');
  if (!wildcardMatch(parts[1].toLowerCase(), scheme) || !wildcardMatch(expectedHost, host)) return false;
  const defaultPort = scheme === 'https' || scheme === 'wss' ? '443' : scheme === 'http' || scheme === 'ws' ? '80' : '';
  const port = actual.port || defaultPort;
  if (parts[3] ? !wildcardMatch(parts[3], port) : !expectedHost.includes('*') && port !== defaultPort) return false;
  if (parts[4] === undefined) return true;
  try {
    const path = new URL('https://sightline.invalid' + (parts[4].startsWith('?') ? '/' : '') + parts[4]);
    return wildcardMatch(path.pathname + path.search, actual.pathname + actual.search);
  } catch { return false; }
}

function policyMatches(rule: PolicyRule, extension: Extension, environments: ReturnType<typeof claudeMcpEnvironments>, allow: boolean): boolean {
  const entry = rule.entry;
  if ('serverName' in entry) return entry.serverName === extension.name;
  const { config } = extension;
  const remote = ['http', 'streamable-http', 'sse', 'ws'].includes(config.type);
  const policyEnv = environments.pinned;
  const fallback = allow ? policyEnv : environments.denied;
  if ('serverCommand' in entry) {
    if (remote || typeof config.command !== 'string') return false;
    const command = [config.command, ...config.args ?? []].map(value => expand(value, environments.live));
    const expected = entry.serverCommand.map(value => expand(value, policyEnv, fallback));
    return command.every(value => value !== undefined) && expected.length === command.length && expected.every((value, index) => value !== undefined && value === command[index]);
  }
  if (!remote || typeof config.url !== 'string') return false;
  const url = expand(config.url, environments.live);
  const pattern = allow ? expandAllowUrl(entry.serverUrl, policyEnv) : expand(entry.serverUrl, policyEnv, fallback);
  return url !== undefined && pattern !== undefined && urlMatches(pattern, url);
}

export function applyClaudeMcpPolicy(e: Effective, ctx: Context, layers: McpSettingsSource[]): ReturnType<typeof claudeMcpEnvironments> {
  const valid = layers.filter(source => !source.invalid);
  const exclusive = ctx.sources.find(source => source.scope === 'system' && source.kind === 'mcp' && !source.invalid && plainObject(source.data.mcpServers));
  if (exclusive) {
    for (const extension of e.extensions) if (extension.kind === 'mcp' && ['active', 'conditional'].includes(extension.status)) block(extension, 'managed-mcp.json', [locate(exclusive)], 'The exclusive managed MCP file suppresses user, project and local servers.');
  }
  for (const source of valid) if (plainObject(source.data.managedMcpServers)) {
    for (const [name, value] of Object.entries(source.data.managedMcpServers)) {
      const key = 'managedMcpServers.' + name;
      const old = e.settings.findLast(setting => setting.key === key && setting.status === 'active');
      if (old) { old.status = 'shadowed'; old.reason = 'A later managed file replaces the whole provided-server entry.'; }
      e.settings.push({ key, value, location: locate(source, key), status: 'active', reason: 'Provided by the organization; later definitions replace the whole server entry.', overrides: old ? [...old.overrides, old.location] : [] });
    }
    mcp(e, source, source.data.managedMcpServers, 'managedMcpServers', 'active');
  }
  const managedFile = ctx.sources.find(source => source.scope === 'system' && source.kind === 'mcp');
  if (managedFile) {
    decision(e, managedFile, 'active', 'Exclusive managed MCP server configuration.');
    mcp(e, managedFile, managedFile.data.mcpServers, 'mcpServers', 'active');
  }
  const lock = valid.findLast(source => source.scope === 'system' && typeof source.data.allowManagedMcpServersOnly === 'boolean');
  const rules = (key: typeof listKeys[number]): PolicyRule[] => valid
    .filter(source => key !== 'allowedMcpServers' || lock?.data.allowManagedMcpServersOnly !== true || source.scope === 'system')
    .flatMap(source => (source.data[key] ?? []).map((entry: PolicyEntry, index: number) => ({
      entry, location: source.mcpPolicyLocations?.[`${key}.${index}`] ?? locate(source, `${key}.${index}`),
    })));
  const allow = rules('allowedMcpServers');
  const deny = rules('deniedMcpServers');
  const allowSources = valid.filter(source => Array.isArray(source.data.allowedMcpServers) && (lock?.data.allowManagedMcpServersOnly !== true || source.scope === 'system'));
  const environments = claudeMcpEnvironments(ctx, valid);
  for (const extension of e.extensions) {
    if (extension.kind !== 'mcp' || !['active', 'conditional'].includes(extension.status)) continue;
    const denied = deny.filter(rule => policyMatches(rule, extension, environments, false));
    if (denied.length) { block(extension, 'deniedMcpServers', denied.map(rule => rule.location), 'A matching MCP denylist entry blocks this server.'); continue; }
    const provided = extension.location.key?.startsWith('managedMcpServers.');
    const expandsOutsideEnv = Object.entries(extension.config).some(([key, value]) => key !== 'env' && /\$\{[^}]+\}/.test(JSON.stringify(value) ?? ''));
    if (provided || extension.location.path === exclusive?.path && !expandsOutsideEnv || !allowSources.length) continue;
    const remote = ['http', 'streamable-http', 'sse', 'ws'].includes(extension.config.type);
    const selector = remote ? 'serverUrl' : 'serverCommand';
    const specific = allow.some(rule => selector in rule.entry);
    if (!allow.some(rule => (!specific || selector in rule.entry) && policyMatches(rule, extension, environments, true))) block(extension, 'allowedMcpServers', allowSources.map(source => locate(source, 'allowedMcpServers')), specific ? `This ${remote ? 'remote' : 'stdio'} server requires a matching ${selector} allowlist entry.` : 'This server has no matching MCP allowlist entry.');
  }
  return environments;

  function block(extension: Extension, key: string, locations: Location[], reason: string): void {
    extension.status = 'ignored'; extension.reason = reason;
    extension.origins = [...extension.origins ?? [], ...locations.map(location => ({ key, location }))];
    e.findings.push(finding('claude.mcp-policy-blocked', 'info', extension.location, `Claude excludes MCP server "${extension.name}" under ${key}.`, reason, 'Review the controlling policy before changing the server declaration.', 'claude', locations));
  }
}
