import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import crossSpawn from 'cross-spawn';
import type { ClientId, Context, Effective, Extension, Finding, Location, Source } from './types.js';
import { executable, finding, locate, plainObject, within } from './utils.js';
import { VERSION } from './version.js';

const mcpKeys = new Set(['command', 'args', 'env', 'env_vars', 'cwd', 'url', 'type', 'transport', 'headers', 'http_headers', 'env_http_headers', 'bearer_token_env_var', 'startup_timeout_sec', 'startup_timeout_ms', 'tool_timeout_sec', 'enabled', 'required', 'enabled_tools', 'disabled_tools', 'tools', 'timeout', 'description', 'name', 'oauth', 'headersHelper', 'alwaysLoad', 'output_token_budget', 'sandbox']);
const claudeRemoteTransports = new Set(['http', 'streamable-http', 'sse', 'ws']);
const claudeIgnoredMcpFields = new Set(['cwd', 'enabled', 'transport', 'env_vars', 'env_http_headers', 'http_headers', 'bearer_token_env_var']);
const claudeStdioFields = new Set(['command', 'args', 'env']);
const claudeRemoteFields = new Set(['url', 'headers', 'headersHelper', 'oauth']);
const events: Record<string, Set<string>> = {
  codex: new Set(['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreModelRequest', 'PostModelRequest', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact', 'Interrupt']),
  claude: new Set(['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied', 'Notification', 'Stop', 'StopFailure', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact', 'TaskCompleted', 'TeammateIdle', 'ConfigChange', 'InstructionsLoaded', 'WorktreeCreate', 'WorktreeRemove', 'Elicitation', 'ElicitationResult']),
  copilot: new Set(['sessionStart', 'sessionEnd', 'userPromptSubmitted', 'preToolUse', 'postToolUse', 'postToolUseFailure', 'errorOccurred', 'agentStop', 'subagentStart', 'subagentStop', 'notification', 'permissionRequest', 'preCompact', 'userPromptTransformed', 'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'SubagentStart', 'SubagentStop', 'Notification', 'PermissionRequest', 'PreCompact']),
};
const builtins = new Set(['echo', 'printf', 'cd', 'export', 'set', 'exit', 'true', 'false', 'test', '[', 'read', 'pwd', 'command', 'exec', 'type', 'ulimit', 'umask', 'source', '.', 'return']);

export function hookCommandField(client: ClientId, handler: Record<string, any> | null | undefined, filename: string, platform = process.platform): string {
  if (client === 'copilot') {
    if (handler?.exec !== undefined) return 'exec';
    const field = platform === 'win32' ? 'powershell' : 'bash';
    return handler?.[field] !== undefined ? field : 'command';
  }
  if (client === 'codex' && platform === 'win32') {
    if (handler?.commandWindows !== undefined) return 'commandWindows';
    if (filename.endsWith('.toml') && handler?.command_windows !== undefined) return 'command_windows';
  }
  return 'command';
}

export function extensionFieldLocation(extension: Extension, field: string, source?: Source): Location {
  let key = field;
  while (key) {
    const origin = extension.origins?.find(origin => origin.key === key);
    if (origin) return origin.location;
    const separator = key.lastIndexOf('.');
    key = separator < 0 ? '' : key.slice(0, separator);
  }
  return source && extension.location.key ? locate(source, extension.location.key + '.' + field) : extension.location;
}

export function mcpRuntimeConfig(config: Record<string, any>, client?: ClientId): Record<string, any> {
  if (client !== 'claude') return config;
  const ignoredTransportFields = claudeRemoteTransports.has(config.type) ? claudeStdioFields : claudeRemoteFields;
  return Object.fromEntries(Object.entries(config).filter(([key]) => !claudeIgnoredMcpFields.has(key) && !ignoredTransportFields.has(key)));
}

export function validateMcpConfiguration(extension: Extension, client: ClientId, source?: Source): Finding[] {
  const out: Finding[] = [];
  const error = (rule: string, message: string, why: string, suggestion: string, field?: string): void => {
    out.push(finding(rule, 'error', field ? extensionFieldLocation(extension, field, source) : extension.location, message, why, suggestion, client));
  };
  const config = extension.config;
  if (config._invalid) {
    error('mcp.type', `MCP server "${extension.name}" must be an object.`, 'The client skips invalid server definitions.', 'Use a documented MCP server object.'); return out;
  }
  if (client === 'claude') {
    const type = config.type === undefined ? 'stdio' : config.type;
    if (type !== 'stdio' && !claudeRemoteTransports.has(type)) {
      error('mcp.transport-type', `Claude MCP server "${extension.name}" has an unsupported transport type.`, type === 'sdk' ? 'SDK servers are registered by an embedding application.' : 'Claude file-based MCP definitions use stdio, http, streamable-http, sse or ws.', 'Set type to a supported transport.', 'type'); return out;
    }
    if (config.type === undefined && config.command === undefined && config.url !== undefined) {
      error('mcp.transport-type', `Claude remote MCP server "${extension.name}" needs an explicit type.`, 'An omitted type selects the stdio schema in Claude Code.', 'Add type "http", "sse" or "ws" for this endpoint.', 'url'); return out;
    }
    const field = type === 'stdio' ? 'command' : 'url';
    if (config[field] === undefined) {
      error('mcp.transport', `Claude MCP server "${extension.name}" needs ${field} for its transport.`, 'The selected transport requires this field.', `Add a string ${field} to the server definition.`, config.type === undefined ? undefined : 'type'); return out;
    }
  }
  const declared = mcpRuntimeConfig(config, client);
  for (const key of ['command', 'url', 'cwd']) if (declared[key] !== undefined && typeof declared[key] !== 'string') error(key === 'cwd' ? 'extension.cwd-type' : 'mcp.field-type', `MCP server "${extension.name}" ${key} must be a string.`, 'This field has an invalid configuration type.', 'Replace the value with a string.', key);
  if (declared.args !== undefined) {
    const invalidIndex = Array.isArray(declared.args) ? declared.args.findIndex((arg: unknown) => typeof arg !== 'string') : -1;
    if (!Array.isArray(declared.args) || invalidIndex >= 0) error('mcp.args-type', `MCP server "${extension.name}" args must be strings.`, 'Arguments are passed as a string array, not a shell command.', 'Use args: ["argument"].', invalidIndex >= 0 ? `args.${invalidIndex}` : 'args');
  }
  for (const key of ['env', 'headers', 'http_headers', 'env_http_headers']) if (declared[key] !== undefined && (!plainObject(declared[key]) || Object.values(declared[key]).some(value => typeof value !== 'string'))) {
    const invalidName = plainObject(declared[key]) ? Object.keys(declared[key]).find(name => typeof declared[key][name] !== 'string') : undefined;
    error('mcp.env-type', `${key} must map names to strings.`, 'This client’s MCP format expects a string mapping.', 'Replace non-string values.', invalidName === undefined ? key : `${key}.${invalidName}`);
  }
  return out;
}

function expandEnvironmentReferences(value: any, env: NodeJS.ProcessEnv, strict = true): any {
  if (typeof value === 'string') return value.replace(/\$\{(?:env:)?([A-Za-z_][\w]*)(?:(:-|-)([^}]*))?\}/g, (_match, name, operator, fallback) => {
    if (env[name] !== undefined) return env[name];
    if (operator) return fallback;
    if (!strict) return _match;
    throw new Error('Missing environment variable.');
  });
  if (Array.isArray(value)) return value.map(item => expandEnvironmentReferences(item, env, strict));
  if (plainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expandEnvironmentReferences(item, env, strict)]));
  return value;
}

export async function validateExtensions(ctx: Context, e: Effective): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const x of e.extensions) {
    if (!['active', 'conditional'].includes(x.status)) continue;
    const source = ctx.sources.find(source => source.path === x.location.path);
    const baseKey = x.kind === 'hook' ? x.location.key?.replace(/\.(?:command|commandWindows|command_windows|bash|powershell|exec|type)$/, '') : x.location.key;
    const issue = (rule: string, message: string, why: string, suggestion: string, severity: 'error' | 'warn' | 'info' = 'error', field?: string, related: Location[] = []) => {
      const location = field && x.kind === 'mcp' ? extensionFieldLocation(x, field, source) : source && baseKey && field ? locate(source, `${baseKey}.${field}`) : x.location;
      out.push(finding(rule, severity, location, message, why, suggestion, e.client, related));
    };
    const invalid = (rule: string, message: string, why: string, suggestion: string, field?: string) => {
      x.status = 'invalid'; x.reason = why;
      issue(rule, message, why, suggestion, 'error', field);
    };
    if (x.kind === 'mcp') {
      if (e.client !== 'claude' && x.config.enabled === false) { x.status = 'ignored'; x.reason = 'Server is explicitly disabled.'; continue; }
      const errors = validateMcpConfiguration(x, e.client, source);
      if (errors.length) { x.status = 'invalid'; x.reason = errors.at(-1)!.why; out.push(...errors); continue; }
      for (const key of Object.keys(x.config)) if (!mcpKeys.has(key)) issue('mcp.unknown-field', `Unknown MCP field "${key}".`, 'This field is absent from the supported server schema.', 'Check spelling and this client’s MCP format.', 'warn', key);
      const declared = mcpRuntimeConfig(x.config, e.client);
      if (e.client === 'claude') for (const field of Object.keys(x.config)) if (!Object.hasOwn(declared, field)) issue('mcp.unsupported-field', `Claude MCP server "${x.name}" ignores the field "${field}".`, field === 'cwd' ? 'Claude starts stdio MCP processes in the session directory.' : 'This field is outside the selected Claude MCP transport schema.', field === 'cwd' ? 'Use a wrapper command to change directories.' : 'Remove the field or use the documented transport fields.', 'warn', field);
      const remote = typeof declared.url === 'string';
      if (e.client === 'claude' && remote && declared.url === '') { x.status = 'ignored'; x.reason = 'The remote MCP endpoint is empty and awaits configuration.'; continue; }
      if (!remote && typeof declared.command !== 'string') { x.status = 'invalid'; issue('mcp.transport', `MCP server "${x.name}" has neither a command nor a URL.`, 'Stdio requires a command; remote transport requires a URL.', 'Add command or url.'); continue; }
      const required = new Map<string, Set<string>>();
      const requireVariable = (name: unknown, field: string): void => {
        if (typeof name !== 'string') return;
        const fields = required.get(name) ?? new Set<string>();
        fields.add(field); required.set(name, fields);
      };
      if (Array.isArray(declared.env_vars)) declared.env_vars.forEach((name: unknown, index: number) => requireVariable(name, 'env_vars.' + index));
      requireVariable(declared.bearer_token_env_var, 'bearer_token_env_var');
      for (const [key, name] of Object.entries(declared.env_http_headers ?? {})) requireVariable(name, 'env_http_headers.' + key);
      if (e.client === 'claude' || e.client === 'copilot') {
        const pattern = e.client === 'claude' ? /\$\{([A-Za-z_][\w]*)(?:(:-|-)([^}]*))?\}/g : /\$\{(?:env:)?([A-Za-z_][\w]*)\}/g;
        const references = (value: unknown, field = ''): void => {
          if (typeof value === 'string') {
            for (const match of value.matchAll(pattern)) if (!match[2]) requireVariable(match[1], field);
          } else if (value && typeof value === 'object') {
            for (const [key, child] of Object.entries(value)) references(child, field ? field + '.' + key : key);
          }
        };
        references(declared);
      }
      for (const [name, fields] of required) if (ctx.env[name] === undefined) {
        const [first, ...rest] = fields;
        issue('mcp.env-missing', `MCP server "${x.name}" requires missing environment variable ${name}.`, 'Only variable presence is inspected; values are never exported.', `Set ${name} in the launching environment or configure a supported default.`, 'error', first, rest.map(field => extensionFieldLocation(x, field, source)));
      }
      const expandsEnvironment = e.client === 'claude' || e.client === 'copilot';
      const config = expandsEnvironment ? expandEnvironmentReferences(declared, ctx.env, false) : declared;
      if (remote && (!expandsEnvironment || !config.url.includes('${'))) {
        try { const u = new URL(config.url); if (!['http:', 'https:', ...(e.client === 'claude' ? ['ws:', 'wss:'] : [])].includes(u.protocol)) throw new Error(); }
        catch { invalid('mcp.url', `MCP server "${x.name}" has an invalid remote URL.`, 'Remote MCP URLs must use supported transport schemes.', 'Provide a valid endpoint with a supported scheme.', 'url'); continue; }
      }
      if (remote && config.command) issue('mcp.transport', `MCP server "${x.name}" defines both command and URL.`, 'Ambiguous transport configuration is not a reliable startup definition.', 'Keep one transport.', 'warn', 'url', [extensionFieldLocation(x, 'command', source)]);
      if (expandsEnvironment && typeof config.cwd === 'string' && config.cwd.includes('${')) continue;
      const cwd = typeof config.cwd === 'string' ? path.resolve(ctx.directory, config.cwd) : ctx.directory;
      try { if (!(await stat(cwd)).isDirectory()) throw new Error(); } catch { issue('extension.cwd-missing', `Working directory for "${x.name}" does not exist.`, 'The child process cannot start in the configured directory.', 'Correct cwd or create the expected directory.', 'error', typeof config.cwd === 'string' ? 'cwd' : undefined); }
      if (!remote && typeof config.command === 'string' && !/\$\{/.test(config.command)) {
        const env = { ...ctx.env, ...(config.env ?? {}) };
        const unresolvedPath = expandsEnvironment && (/\$\{/.test(env.PATH ?? '') || process.platform === 'win32' && /\$\{/.test(env.PATHEXT ?? ''));
        if (!unresolvedPath && !(await executable(config.command, cwd, env))) issue('mcp.command-missing', `MCP command for "${x.name}" was not found or is not executable.`, 'The command is resolved against cwd and PATH without executing it.', 'Install the runtime or use the correct executable path.', 'error', 'command');
        if (process.platform !== 'win32' && /^[A-Za-z]:[\\/]/.test(config.command)) issue('path.platform', 'Windows executable path on a POSIX host.', 'This absolute path cannot resolve on this platform.', 'Use a PATH-resolved command or a platform-specific definition.', 'warn', 'command');
      }
    } else if (x.kind === 'skill') {
      const src = ctx.sources.find(s => s.path === x.location.path);
      if (e.client !== 'claude' && (typeof x.config.name !== 'string' || !x.config.name.trim())) issue('skill.metadata', 'Skill requires non-empty name metadata.', 'SKILL.md must describe the skill in YAML frontmatter.', 'Add name and description to frontmatter.');
      if (typeof x.config.description !== 'string' || !x.config.description.trim()) issue('skill.metadata', `Skill "${x.name}" needs a description.`, 'The skill cannot be reliably selected from an absent or invalid description.', 'Add a non-empty description string.');
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(x.name) || x.name.length > 64) issue('skill.name', `Skill "${x.name}" does not use a portable skill name.`, 'Agent Skills names use lowercase letters, digits and hyphens (up to 64 characters). Client-specific leniency varies.', 'Use a lowercase hyphenated name.', 'warn');
      if (src && src.bodyLine === 1 && e.client !== 'claude') issue('skill.frontmatter', 'SKILL.md has no metadata frontmatter.', 'A Markdown heading is not skill metadata.', 'Add a YAML frontmatter block.');
      for (const k of ['disable-model-invocation', 'user-invocable']) if (x.config[k] !== undefined && typeof x.config[k] !== 'boolean') issue('skill.metadata-type', `Skill field "${k}" must be boolean.`, 'Quoted boolean values are strings.', 'Use true or false without quotes.');
    } else if (x.kind === 'hook') {
      if (x.config._invalid) { invalid('hook.type', 'Hook handler must be an object.', 'The handler has an invalid configuration structure.', 'Use a documented hook handler object.'); continue; }
      if (e.client === 'copilot') {
        for (const field of ['timeoutSec', 'timeout']) if (x.config[field] !== undefined && (typeof x.config[field] !== 'number' || !Number.isFinite(x.config[field]) || x.config[field] <= 0)) invalid('hook.timeout', `Hook ${field} must be a positive number.`, 'The hook timeout is measured in seconds.', 'Supply a positive numeric timeout.', field);
        for (const field of ['command', 'bash', 'powershell', 'exec']) if (x.config[field] !== undefined && typeof x.config[field] !== 'string') invalid('hook.command', `Hook ${field} must be a string.`, 'Configured hook commands require string values.', 'Correct the command field type.', field);
        if (x.status === 'invalid') continue;
      }
      if (events[e.client] && !events[e.client].has(x.name)) issue('hook.unknown-event', `Unknown hook event "${x.name}".`, 'Event names are client-specific and case-sensitive.', 'Use an event name from the adapter’s verified documentation.', 'warn');
      const handlerTypes = e.client === 'codex' ? ['command', 'mcp_tool', 'prompt', 'agent'] : ['command', ...(e.client === 'claude' ? ['prompt', 'agent', 'http', 'mcp_tool'] : e.client === 'copilot' ? ['http', 'prompt'] : [])];
      if ((x.config.type !== undefined || e.client === 'codex') && !handlerTypes.includes(x.config.type)) { invalid('hook.unsupported-type', 'Hook has an unsupported handler type.', 'This handler type is not supported by the client.', 'Use the documented handler type.', 'type'); continue; }
      if (e.client === 'codex' && ['prompt', 'agent'].includes(x.config.type)) { x.status = 'ignored'; x.reason = 'Codex parses this handler type but it is skipped at runtime.'; continue; }
      if (e.client === 'codex' && x.config.type === 'mcp_tool') {
        for (const field of ['server', 'tool']) if (typeof x.config[field] !== 'string') invalid('hook.mcp-field', `MCP hook ${field} must be a string.`, 'MCP hook handlers require a server and tool name.', 'Supply the documented MCP hook fields.', field);
        if (x.config.input !== undefined && !plainObject(x.config.input)) invalid('hook.mcp-field', 'MCP hook input must be an object.', 'MCP hook arguments use a JSON object.', 'Supply an object containing tool arguments.', 'input');
      }
      if (e.client === 'copilot' && x.config.type === 'prompt') {
        if (!['sessionStart', 'SessionStart'].includes(x.name) || typeof x.config.prompt !== 'string') invalid('hook.prompt', 'Copilot prompt hooks require sessionStart and a string prompt.', 'Prompt hooks run only when a new interactive session starts.', 'Use sessionStart with a prompt string.', 'prompt');
        else { x.status = 'conditional'; x.reason = 'Prompt hooks require a new interactive session.'; }
      }
      if (e.client === 'copilot' && x.config.type === 'http') {
        if (x.config.headers !== undefined && (!plainObject(x.config.headers) || Object.values(x.config.headers).some(value => typeof value !== 'string'))) invalid('hook.headers-type', 'HTTP hook headers must map names to strings.', 'The header collection has an invalid structure.', 'Use string-valued HTTP headers.', 'headers');
        if (x.config.allowedEnvVars !== undefined && (!Array.isArray(x.config.allowedEnvVars) || x.config.allowedEnvVars.some((value: unknown) => typeof value !== 'string'))) invalid('hook.env-list-type', 'HTTP hook allowedEnvVars must contain strings.', 'Only listed environment variable names can be expanded in headers.', 'Use an array of variable names.', 'allowedEnvVars');
        let endpoint: URL | undefined;
        try { endpoint = new URL(x.config.url); } catch { /* Report an invalid endpoint below. */ }
        const loopback = endpoint && /^(?:localhost|127(?:\.\d+){3}|\[::1\])$/.test(endpoint.hostname);
        const permissionEvent = ['preToolUse', 'PreToolUse', 'permissionRequest', 'PermissionRequest'].includes(x.name);
        if (!endpoint || endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && loopback && ctx.env.COPILOT_HOOK_ALLOW_LOCALHOST === '1' && !permissionEvent && x.config.allowedEnvVars === undefined)) invalid('hook.http-url', 'Copilot HTTP hook URL is unavailable under the configured transport policy.', 'Hooks require HTTPS, with an explicit localhost exception for non-permission events.', 'Use an HTTPS URL or the documented localhost development option.', 'url');
      }
      if (x.config.type !== 'command' && x.config.type !== undefined) continue;
      if (e.client === 'claude') for (const field of ['cwd', 'env', 'commandWindows']) if (x.config[field] !== undefined) issue('hook.unsupported-field', `Claude command hooks do not use the field "${field}".`, 'The documented command hook fields use command and optional args, with the session working directory and environment.', 'Use a wrapper command or the documented hook fields.', 'warn', field);
      if (e.client === 'codex') {
        for (const field of ['cwd', 'env', 'args']) if (x.config[field] !== undefined) issue('hook.unsupported-field', `Codex command hooks do not use the field "${field}".`, 'Codex uses the command string and session working directory.', 'Put arguments in command and use a wrapper for custom environment or directory changes.', 'warn', field);
        const commandFields = ['command', 'commandWindows', ...(source?.path.endsWith('.toml') ? ['command_windows'] : [])];
        for (const field of commandFields) if ((field === 'command' || x.config[field] !== undefined) && typeof x.config[field] !== 'string') invalid('hook.command', `Hook ${field} must be a string.`, 'Codex command hooks require command and string platform overrides.', 'Supply the documented command fields.', field);
        if (source?.path.endsWith('.toml') && x.config.commandWindows !== undefined && x.config.command_windows !== undefined) invalid('hook.command-alias', 'Hook declares both Windows command aliases.', 'Both names address the same Codex command override.', 'Keep one of commandWindows or command_windows.', 'command_windows');
        if (x.status === 'invalid') continue;
      }
      const cmd = x.config[hookCommandField(e.client, x.config, x.location.path)];
      if (e.client === 'copilot' && cmd === undefined && (typeof x.config.bash === 'string' || typeof x.config.powershell === 'string')) { x.status = 'ignored'; x.reason = 'This hook supplies a shell command only for another operating system.'; continue; }
      if (typeof cmd !== 'string') { invalid('hook.command', 'Hook has no string command for this platform.', 'Copilot uses bash on POSIX and powershell on Windows; other clients require command.', 'Set the correct platform command.'); continue; }
      const execForm = e.client === 'claude' && x.config.args !== undefined || e.client === 'copilot' && x.config.exec !== undefined;
      if (execForm && x.config.args !== undefined && (!Array.isArray(x.config.args) || x.config.args.some((arg: unknown) => typeof arg !== 'string'))) { invalid('hook.args-type', 'Hook args must be an array of strings.', 'Exec-form hook arguments are passed directly to the executable.', 'Use one string per argument.', 'args'); continue; }
      if (e.client === 'copilot' && execForm && ['command', 'bash', 'powershell'].some(field => x.config[field] !== undefined)) { invalid('hook.exec-conflict', 'Copilot hook combines exec with shell commands.', 'A hook uses either a direct executable or a shell command.', 'Keep exec or the shell command fields.', 'exec'); continue; }
      if (e.client === 'copilot' && x.config.cwd !== undefined && typeof x.config.cwd !== 'string') { invalid('extension.cwd-type', 'Hook working directory must be a string.', 'The hook cannot resolve this working-directory value.', 'Use a directory path string.', 'cwd'); continue; }
      if (e.client === 'copilot' && x.config.env !== undefined && (!plainObject(x.config.env) || Object.values(x.config.env).some(value => typeof value !== 'string'))) { invalid('hook.env-type', 'Hook environment must map names to strings.', 'The hook environment contains an invalid value type.', 'Use an object containing string environment values.', 'env'); continue; }
      const cwd = e.client === 'copilot' ? path.resolve(ctx.repo, x.config.cwd ?? '.') : ctx.directory;
      try { if (!(await stat(cwd)).isDirectory()) throw new Error(); } catch { issue('extension.cwd-missing', 'Hook working directory does not exist.', 'The hook cannot start in this directory.', 'Correct the cwd path.'); }
      // Complex shell programs are not guessed or executed. A simple leading command is provable.
      const first = cmd.match(/^\s*(?:"([^"]+)"|'([^']+)'|([^\s;&|<>]+))/);
      const token = execForm ? cmd : first?.[1] ?? first?.[2] ?? first?.[3];
      const env = e.client === 'copilot' ? { ...ctx.env, ...x.config.env } : ctx.env;
      const shellBuiltin = !execForm && token && builtins.has(token);
      if (token && !shellBuiltin && !/[=$`{}()]/.test(token) && !(await executable(token, cwd, env))) issue('hook.command-missing', 'Hook command was not found or is not executable.', 'The literal executable cannot be found in cwd or PATH.', 'Install the executable or fix its path.');
    }
  }
  const permissionRules = e.extensions.filter(rule => rule.kind === 'permission' && ['active', 'conditional'].includes(rule.status));
  if (e.client === 'claude') for (const rule of permissionRules.filter(rule => rule.name.split('(')[0] === 'EndConversation')) {
    if (rule.config.action === 'ask') { rule.status = 'ignored'; rule.reason = 'EndConversation bypasses ask prompts.'; }
    if (rule.config.action === 'deny') { rule.status = 'conditional'; rule.reason = 'Claude keeps EndConversation while other tools remain. Its denial depends on the session tool inventory.'; }
  }
  const denies = permissionRules.filter(rule => rule.config.action === 'deny' && rule.status === 'active');
  const asks = permissionRules.filter(rule => rule.config.action === 'ask' && rule.status === 'active');
  for (const rule of permissionRules.filter(rule => ['allow', 'ask'].includes(rule.config.action) && ['active', 'conditional'].includes(rule.status))) {
    const tool = rule.name.split('(')[0];
    if (e.client === 'claude' && tool === 'EndConversation') continue;
    const higherRules = rule.config.action === 'allow' ? [...denies, ...asks] : denies;
    const matches = higherRules.filter(higher => higher.name === rule.name || higher.name === '*' || higher.name === tool || tool === 'Bash' && higher.name === 'Bash(*)');
    const action = matches[0]?.config.action;
    if (!action) continue;
    const blockers = matches.filter(higher => higher.config.action === action);
    const title = action === 'deny' ? 'Deny' : 'Ask';
    rule.status = 'shadowed'; rule.reason = `An exact or tool-wide ${action} rule takes precedence.`;
    rule.origins = blockers.map(blocker => ({ key: blocker.location.key ?? `permissions.${action}`, location: blocker.location }));
    out.push(finding(`permission.${action}-overrides-${rule.config.action}`, 'warn', rule.location, `${title} overrides ${rule.config.action} for "${rule.name}".`, `${title} rules are evaluated before ${rule.config.action} rules.`, `Remove the redundant ${rule.config.action} or narrow the ${action} intentionally.`, e.client, blockers.map(blocker => blocker.location)));
  }
  if (!e.executable && e.detected) out.push(finding('client.not-installed', 'info', { path: ctx.repo, line: 1, column: 1 }, `${e.metadata.name} configuration found; its CLI is not on PATH.`, 'Configuration can be diagnosed without installing the client.', 'Install the client before relying on these project extensions.', e.client));
  return out;
}

export async function probeMcp(extension: Extension, ctx: Context, client?: ClientId): Promise<Finding[]> {
  const runtimeConfig = mcpRuntimeConfig(extension.config, client);
  if (extension.kind !== 'mcp' || extension.status !== 'active' || runtimeConfig.url || typeof runtimeConfig.command !== 'string') return [];
  let x = { ...extension, config: runtimeConfig };
  if (client === 'claude' || client === 'copilot') {
    try { x = { ...extension, config: expandEnvironmentReferences(runtimeConfig, ctx.env) }; } catch { return [finding('probe.env-missing', 'error', extension.location, 'MCP startup probe has unresolved environment references.', 'The client would need these variables before starting the server.', 'Set the missing variables and retry the explicit probe.', client)]; }
  }
  const cwd = x.config.cwd ? path.resolve(ctx.directory, x.config.cwd) : ctx.directory;
  const cwdLocation = typeof x.config.cwd === 'string' ? extensionFieldLocation(x, 'cwd') : x.location;
  if (!within(ctx.repo, cwd)) return [finding('probe.outside-scope', 'warn', cwdLocation, 'MCP probe skipped outside repository.', 'Probe execution is restricted to the inspected repository.', 'Use a working directory inside --repo.', client)];
  try { if (!within(await realpath(ctx.repo), await realpath(cwd))) return [finding('probe.outside-scope', 'warn', cwdLocation, 'MCP probe working directory resolves outside repository.', 'An external directory symlink is not an in-repository probe location.', 'Choose a working directory inside --repo.', client)]; } catch { return []; }
  const command = await executable(x.config.command, cwd, { ...ctx.env, ...x.config.env });
  if (!command) return [];
  ctx.options.signal?.throwIfAborted();
  return new Promise(resolve => {
    let ended = false; let buffer = ''; let initialized = false; let ready = false;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    const child = crossSpawn.spawn(command, x.config.args ?? [], { cwd, env: { ...ctx.env, ...x.config.env }, stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true, detached: process.platform !== 'win32' });
    const terminate = (signal: 'SIGTERM' | 'SIGKILL') => {
      if (!child.pid) return;
      if (process.platform !== 'win32') {
        // The probe owns this process group, including ordinary runtime wrappers.
        try { process.kill(-child.pid, signal); } catch { child.kill(signal); }
      } else if (child.exitCode === null && child.signalCode === null) {
        if (signal === 'SIGKILL') { child.kill(signal); return; }
        const taskkill = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
        const killer = spawn(taskkill, ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        killer.once('error', () => { child.kill(); });
      }
    };
    const done = (ok: boolean) => {
      if (ended) return; ended = true; ready = ok; clearTimeout(timer);
      child.stdin.end(); terminate('SIGTERM');
      forceTimer = setTimeout(() => { terminate('SIGKILL'); child.stdout.destroy(); child.stderr.destroy(); }, 1000);
    };
    const timer = setTimeout(() => done(false), 5000);
    const abort = () => done(false);
    ctx.options.signal?.addEventListener('abort', abort, { once: true });
    child.once('close', () => {
      if (!ended) done(false);
      clearTimeout(timer); clearTimeout(forceTimer);
      ctx.options.signal?.removeEventListener('abort', abort);
      resolve([finding(ready ? 'probe.mcp-ready' : 'probe.mcp-failed', ready ? 'info' : 'error', x.location, ready ? `MCP server "${x.name}" initialized and listed tools.` : `MCP server "${x.name}" failed the startup probe.`, ready ? 'A local JSON-RPC initialize and tools/list exchange completed; no tool was invoked.' : 'The process exited, emitted invalid protocol data, or timed out after 5 seconds. Raw process output is never exported.', ready ? 'Use the client to verify its permission and authentication state.' : 'Run the server directly and check its private logs.')]);
    });
    child.on('error', () => done(false)); child.on('exit', () => done(false)); child.stderr.on('data', () => { /* drain without exporting logs */ });
    child.stdout.on('data', chunk => {
      if (ended) return;
      buffer += chunk.toString(); if (buffer.length > 1024 * 1024) { done(false); return; }
      let i;
      while (!ended && (i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
        let reply; try { reply = JSON.parse(line); } catch { continue; }
        if (reply.id === 1 && reply.result && !initialized) {
          initialized = true;
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
        } else if (reply.id === 2 && reply.result && Array.isArray(reply.result.tools)) done(true);
        else if (reply.error) done(false);
      }
    });
    child.stdin.on('error', () => done(false));
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'agent-sightline', version: VERSION } } }) + '\n');
  });
}
