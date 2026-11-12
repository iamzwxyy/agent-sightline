import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import crossSpawn from 'cross-spawn';
import type { ClientId, Context, Effective, Extension, Finding } from './types.js';
import { executable, finding, plainObject, within } from './utils.js';
import { VERSION } from './version.js';

const mcpKeys = new Set(['command', 'args', 'env', 'env_vars', 'cwd', 'url', 'type', 'transport', 'headers', 'http_headers', 'env_http_headers', 'bearer_token_env_var', 'startup_timeout_sec', 'startup_timeout_ms', 'tool_timeout_sec', 'enabled', 'required', 'enabled_tools', 'disabled_tools', 'tools', 'timeout', 'description', 'name', 'oauth', 'headersHelper', 'output_token_budget', 'sandbox']);
const events: Record<string, Set<string>> = {
  codex: new Set(['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'Notification', 'Stop', 'StopFailure', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact', 'TaskCompleted', 'TeammateIdle', 'ConfigChange', 'InstructionsLoaded', 'WorktreeCreate', 'WorktreeRemove', 'Interrupt']),
  claude: new Set(['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied', 'Notification', 'Stop', 'StopFailure', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact', 'TaskCompleted', 'TeammateIdle', 'ConfigChange', 'InstructionsLoaded', 'WorktreeCreate', 'WorktreeRemove', 'Elicitation', 'ElicitationResult']),
  copilot: new Set(['sessionStart', 'sessionEnd', 'userPromptSubmitted', 'preToolUse', 'postToolUse', 'errorOccurred', 'agentStop', 'subagentStart', 'subagentStop']),
};
const builtins = new Set(['echo', 'printf', 'cd', 'export', 'set', 'exit', 'true', 'false', 'test', '[', 'read', 'pwd', 'command', 'exec', 'type', 'ulimit', 'umask', 'source', '.', 'return']);

export async function validateExtensions(ctx: Context, e: Effective): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const x of e.extensions) {
    if (!['active', 'conditional'].includes(x.status)) continue;
    const issue = (rule: string, message: string, why: string, suggestion: string, severity: 'error' | 'warn' | 'info' = 'error') => out.push(finding(rule, severity, x.location, message, why, suggestion, e.client));
    if (x.kind === 'mcp') {
      if (x.config.enabled === false) { x.status = 'ignored'; x.reason = 'Server is explicitly disabled.'; continue; }
      if (x.config._invalid) { x.status = 'invalid'; issue('mcp.type', `MCP server "${x.name}" must be an object.`, 'The client skips invalid server definitions.', 'Use a documented MCP server object.'); continue; }
      for (const k of Object.keys(x.config)) if (!mcpKeys.has(k)) issue('mcp.unknown-field', `Unknown MCP field "${k}".`, 'This field is absent from the supported server schema.', 'Check spelling and this client’s MCP format.', 'warn');
      const remote = typeof x.config.url === 'string';
      if (!remote && typeof x.config.command !== 'string') { x.status = 'invalid'; issue('mcp.transport', `MCP server "${x.name}" has neither a command nor a URL.`, 'Stdio requires a command; remote transport requires a URL.', 'Add command or url.'); continue; }
      if (remote) {
        try { const u = new URL(x.config.url.replace(/\$\{[^}]+\}/g, 'placeholder')); if (!['http:', 'https:', ...(e.client === 'claude' ? ['ws:', 'wss:'] : [])].includes(u.protocol)) throw new Error(); }
        catch { issue('mcp.url', `MCP server "${x.name}" has an invalid remote URL.`, 'Remote MCP URLs must use supported transport schemes.', 'Provide a valid HTTP(S) endpoint.'); }
        if (x.config.command) issue('mcp.transport', `MCP server "${x.name}" defines both command and URL.`, 'Ambiguous transport configuration is not a reliable startup definition.', 'Keep one transport.', 'warn');
      }
      if (x.config.args !== undefined && (!Array.isArray(x.config.args) || x.config.args.some((a: unknown) => typeof a !== 'string'))) { x.status = 'invalid'; issue('mcp.args-type', `MCP server "${x.name}" args must be strings.`, 'Arguments are passed as a string array, not a shell command.', 'Use args: ["argument"].'); }
      for (const key of ['env', 'headers', 'http_headers', 'env_http_headers']) if (x.config[key] !== undefined && (!plainObject(x.config[key]) || Object.values(x.config[key]).some(v => typeof v !== 'string'))) { x.status = 'invalid'; issue('mcp.env-type', `${key} must map names to strings.`, 'This client’s MCP format expects a string mapping.', 'Replace non-string values.'); }
      const required = new Set<string>();
      if (Array.isArray(x.config.env_vars)) for (const v of x.config.env_vars) if (typeof v === 'string') required.add(v);
      for (const v of [x.config.bearer_token_env_var, ...Object.values(x.config.env_http_headers ?? {})]) if (typeof v === 'string') required.add(v);
      if (e.client === 'claude') {
        const text = JSON.stringify(x.config);
        for (const m of text.matchAll(/\$\{([A-Za-z_][\w]*)(?:(:-|-)([^}]*))?\}/g)) if (!m[2]) required.add(m[1]);
      } else if (e.client === 'copilot') {
        for (const m of JSON.stringify(x.config).matchAll(/\$\{(?:env:)?([A-Za-z_][\w]*)\}/g)) required.add(m[1]);
      }
      for (const name of required) if (ctx.env[name] === undefined) issue('mcp.env-missing', `MCP server "${x.name}" requires missing environment variable ${name}.`, 'Only variable presence is inspected; values are never exported.', `Set ${name} in the launching environment or configure a supported default.`);
      const cwd = typeof x.config.cwd === 'string' ? path.resolve(ctx.directory, x.config.cwd) : ctx.directory;
      try { if (!(await stat(cwd)).isDirectory()) throw new Error(); } catch { issue('extension.cwd-missing', `Working directory for "${x.name}" does not exist.`, 'The child process cannot start in the configured directory.', 'Correct cwd or create the expected directory.'); }
      if (!remote && typeof x.config.command === 'string' && !/\$\{/.test(x.config.command)) {
        if (!(await executable(x.config.command, cwd, { ...ctx.env, ...(x.config.env ?? {}) }))) issue('mcp.command-missing', `MCP command for "${x.name}" was not found or is not executable.`, 'The command is resolved against cwd and PATH without executing it.', 'Install the runtime or use the correct executable path.');
        if (process.platform !== 'win32' && /^[A-Za-z]:[\\/]/.test(x.config.command)) issue('path.platform', 'Windows executable path on a POSIX host.', 'This absolute path cannot resolve on this platform.', 'Use a PATH-resolved command or a platform-specific definition.', 'warn');
      }
    } else if (x.kind === 'skill') {
      const src = ctx.sources.find(s => s.path === x.location.path);
      if (e.client !== 'claude' && (typeof x.config.name !== 'string' || !x.config.name.trim())) issue('skill.metadata', 'Skill requires non-empty name metadata.', 'SKILL.md must describe the skill in YAML frontmatter.', 'Add name and description to frontmatter.');
      if (typeof x.config.description !== 'string' || !x.config.description.trim()) issue('skill.metadata', `Skill "${x.name}" needs a description.`, 'The skill cannot be reliably selected from an absent or invalid description.', 'Add a non-empty description string.');
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(x.name) || x.name.length > 64) issue('skill.name', `Skill "${x.name}" does not use a portable skill name.`, 'Agent Skills names use lowercase letters, digits and hyphens (up to 64 characters). Client-specific leniency varies.', 'Use a lowercase hyphenated name.', 'warn');
      if (src && src.bodyLine === 1 && e.client !== 'claude') issue('skill.frontmatter', 'SKILL.md has no metadata frontmatter.', 'A Markdown heading is not skill metadata.', 'Add a YAML frontmatter block.');
      for (const k of ['disable-model-invocation', 'user-invocable']) if (x.config[k] !== undefined && typeof x.config[k] !== 'boolean') issue('skill.metadata-type', `Skill field "${k}" must be boolean.`, 'Quoted boolean values are strings.', 'Use true or false without quotes.');
    } else if (x.kind === 'hook') {
      if (events[e.client] && !events[e.client].has(x.name)) issue('hook.unknown-event', `Unknown hook event "${x.name}".`, 'Event names are client-specific and case-sensitive.', 'Use an event name from the adapter’s verified documentation.', 'warn');
      if (x.config.type && !['command', ...(e.client === 'copilot' ? [] : ['prompt', 'agent', 'http'])].includes(x.config.type)) issue('hook.unsupported-type', `Unsupported hook type "${x.config.type}".`, 'This handler type is not supported by the client.', 'Use the documented handler type.');
      if (x.config.type !== 'command' && x.config.type !== undefined) continue;
      const cmd = e.client === 'copilot' ? x.config[process.platform === 'win32' ? 'powershell' : 'bash'] : process.platform === 'win32' ? x.config.commandWindows ?? x.config.command : x.config.command;
      if (typeof cmd !== 'string') { issue('hook.command', 'Hook has no command for this platform.', 'Copilot uses bash on POSIX and powershell on Windows; other clients require command.', 'Set the correct platform command.'); continue; }
      const cwd = x.config.cwd ? path.resolve(ctx.directory, x.config.cwd) : ctx.directory;
      try { if (!(await stat(cwd)).isDirectory()) throw new Error(); } catch { issue('extension.cwd-missing', 'Hook working directory does not exist.', 'The hook cannot start in this directory.', 'Correct the cwd path.'); }
      // Complex shell programs are not guessed or executed. A simple leading command is provable.
      const first = cmd.match(/^\s*(?:"([^"]+)"|'([^']+)'|([^\s;&|<>]+))/);
      const token = first?.[1] ?? first?.[2] ?? first?.[3];
      if (token && !builtins.has(token) && !/[=$`{}()]/.test(token) && !(await executable(token, cwd, ctx.env))) issue('hook.command-missing', 'Hook command was not found or is not executable.', 'The literal leading executable cannot be found in cwd or PATH.', 'Install the executable or fix its path.');
    }
  }
  const allows = e.extensions.filter(x => x.kind === 'permission' && x.config.action === 'allow' && x.status === 'active');
  for (const allow of allows) {
    const deny = e.extensions.find(x => x.kind === 'permission' && x.config.action === 'deny' && x.status === 'active' && (x.name === allow.name || x.name === '*' || x.name === allow.name.split('(')[0]));
    if (deny) { allow.status = 'shadowed'; allow.reason = 'An exact or tool-wide deny rule takes precedence.'; out.push(finding('permission.deny-overrides-allow', 'warn', allow.location, `Deny overrides allow for "${allow.name}".`, 'Deny rules are evaluated before allow rules.', 'Remove the redundant allow or narrow the deny intentionally.', e.client, [deny.location])); }
  }
  if (!e.executable && e.detected) out.push(finding('client.not-installed', 'info', { path: ctx.repo, line: 1, column: 1 }, `${e.metadata.name} configuration found; its CLI is not on PATH.`, 'Configuration can be diagnosed without installing the client.', 'Install the client before relying on these project extensions.', e.client));
  return out;
}

export async function probeMcp(extension: Extension, ctx: Context, client?: ClientId): Promise<Finding[]> {
  if (extension.kind !== 'mcp' || extension.status !== 'active' || extension.config.url || typeof extension.config.command !== 'string') return [];
  let x = extension;
  if (client === 'claude' || client === 'copilot') {
    const expand = (v: any): any => {
      if (typeof v === 'string') return v.replace(/\$\{(?:env:)?([A-Za-z_][\w]*)(?:(:-|-)([^}]*))?\}/g, (_m, name, op, fallback) => { if (ctx.env[name] !== undefined) return ctx.env[name]; if (op) return fallback; throw new Error('Missing variable.'); });
      if (Array.isArray(v)) return v.map(expand);
      if (plainObject(v)) return Object.fromEntries(Object.entries(v).map(([k, value]) => [k, expand(value)]));
      return v;
    };
    try { x = { ...extension, config: expand(extension.config) }; } catch { return [finding('probe.env-missing', 'error', extension.location, 'MCP startup probe has unresolved environment references.', 'The client would need these variables before starting the server.', 'Set the missing variables and retry the explicit probe.', client)]; }
  }
  const cwd = x.config.cwd ? path.resolve(ctx.directory, x.config.cwd) : ctx.directory;
  if (!within(ctx.repo, cwd)) return [finding('probe.outside-scope', 'warn', x.location, 'MCP probe skipped outside repository.', 'Probe execution is restricted to the inspected repository.', 'Use a working directory inside --repo.')];
  try { if (!within(await realpath(ctx.repo), await realpath(cwd))) return [finding('probe.outside-scope', 'warn', x.location, 'MCP probe working directory resolves outside repository.', 'An external directory symlink is not an in-repository probe location.', 'Choose a working directory inside --repo.', client)]; } catch { return []; }
  const command = await executable(x.config.command, cwd, { ...ctx.env, ...x.config.env });
  if (!command) return [];
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
    child.once('close', () => {
      if (!ended) done(false);
      clearTimeout(timer); clearTimeout(forceTimer);
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
