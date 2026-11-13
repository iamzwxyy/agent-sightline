import path from 'node:path';
import type { Context, Effective, Finding } from './types.js';
import { cmp, finding, locate, splitGlobs } from './utils.js';
import { extensionFieldLocation, mcpRuntimeConfig } from './extensions.js';
import { outsideScopeReason, sourceInScope } from '../adapters/common.js';

export function diagnose(ctx: Context, clients: Effective[]): Finding[] {
  const out: Finding[] = [];
  const selected = new Set(clients.map(client => client.client));
  for (const e of clients) {
    if (!e.detected) continue;
    for (const d of e.decisions) {
      const s = ctx.sources.find(s => s.id === d.sourceId)!;
      if (d.status === 'ignored' && s.scope !== 'user' && !s.owners.includes(e.client)) out.push(finding('source.client-ignored', 'info', locate(s), `${e.metadata.name} does not load ${s.relativePath}.`, d.reason, `Use ${e.client === 'codex' ? 'AGENTS.md or .codex/config.toml' : e.client === 'claude' ? 'CLAUDE.md, AGENTS.md fallback, or .claude/rules' : e.client === 'copilot' ? '.github/copilot-instructions.md or .github/instructions' : 'this client’s documented source locations'}, or keep this source for its intended client.`, e.client));
      if (d.status === 'ignored' && s.owners.includes(e.client) && s.scope !== 'user' && d.reason === outsideScopeReason) {
        const name = path.basename(s.path);
        const wrongName = s.kind === 'settings' && (e.client === 'codex' && name !== 'config.toml' || e.client === 'claude' && !/^settings(?:\.local)?\.json$/.test(name) || e.client === 'gemini' && name !== 'settings.json');
        if (wrongName && ctx.dirs.includes(path.dirname(s.baseDir))) out.push(finding('source.wrong-location', 'warn', locate(s), `${e.metadata.name} does not read the configuration filename ${name}.`, 'This file is in an agent configuration directory with an unsupported configuration filename.', `Use ${e.client === 'codex' ? '.codex/config.toml' : e.client === 'claude' ? '.claude/settings.json or .claude/settings.local.json' : '.gemini/settings.json'} with the documented format.`, e.client));
        else out.push(finding('source.outside-target', 'info', locate(s), `${s.relativePath} is outside this target’s ${e.metadata.name} configuration scope.`, d.reason, 'Inspect the owning project with --repo, or select its intended target.', e.client));
      }
      if (d.status === 'ignored' && s.owners.includes(e.client) && /does not match|do not match/.test(d.reason)) out.push(finding('rule.target-unmatched', 'info', locate(s), 'Path-scoped rule does not match this target.', d.reason, 'Inspect a matching file or correct the rule’s glob.', e.client));
      const patterns = s.data.paths ?? s.data.applyTo ?? s.data.globs;
      if (patterns === undefined || !sourceInScope(e, s)) continue;
      const globs = typeof patterns === 'string' ? splitGlobs(patterns) : Array.isArray(patterns) ? patterns : [];
      for (const g of globs) if (typeof g === 'string' && (g.startsWith('../') || /^[A-Za-z]:[\\/]/.test(g) || g.includes('\0') || /\[[^\]]*$/.test(g))) out.push(finding('glob.impossible', 'warn', locate(s, s.data.applyTo ? 'applyTo' : s.data.globs ? 'globs' : 'paths'), 'Glob cannot match the inspected repository-relative target convention.', 'Parent traversal, platform drive prefixes or unclosed character classes do not match these relative paths.', 'Use a valid relative glob such as src/**/*.ts.', e.client));
    }
  }
  const servers = clients.flatMap(e => e.extensions.filter(x => x.kind === 'mcp' && ['active', 'conditional'].includes(x.status)).map(x => ({ ...x, config: mcpRuntimeConfig(x.config, e.client), client: e.client })));
  const names = [...new Set(servers.map(s => s.name))].sort(cmp);
  for (const name of names) {
    const group = servers.filter(s => s.name === name);
    const definitions = new Set(group.map(x => JSON.stringify({ command: x.config.command, args: x.config.args, url: x.config.url })));
    if (definitions.size > 1) {
      const fields = ['command', 'args', 'url'].filter(field => new Set(group.map(server => JSON.stringify(server.config[field]))).size > 1);
      const locations = group.flatMap(server => fields.filter(field => server.config[field] !== undefined).map(field => extensionFieldLocation(server, field)));
      const [primary = group[0].location, ...related] = [...new Map(locations.map(location => [JSON.stringify(location), location])).values()];
      out.push(finding('mcp.cross-client-drift', 'warn', primary, `MCP server "${name}" has different commands or endpoints across clients/sources.`, 'The same server name does not imply the same process or remote service.', 'Align the transport definitions intentionally, then inspect each client’s effective server.', undefined, related));
    }
  }
  const topKeys = ['permissions', 'hooks', 'env', 'model', 'mcpServers', 'claudeMdExcludes', 'enabledPlugins'];
  const claude = clients.find(client => client.client === 'claude');
  for (const s of ctx.sources.filter(s => s.kind === 'settings' && claude && sourceInScope(claude, s))) {
    for (const key of Object.keys(s.data)) {
      const correct = topKeys.find(k => k.toLowerCase() === key.toLowerCase() && k !== key);
      if (correct) out.push(finding('config.field-case', 'warn', locate(s, key), `Unknown case-sensitive field "${key}".`, `The documented field is "${correct}".`, `Rename it to ${correct}.`, 'claude'));
    }
    if (s.data.permissions?.allowed !== undefined) out.push(finding('config.unknown-field', 'warn', locate(s, 'permissions.allowed'), 'Unknown permission field "allowed".', 'The documented permission list is named allow.', 'Rename allowed to allow.', 'claude'));
    if (s.data.mcpServers) out.push(finding('config.unsupported-capability', 'warn', locate(s, 'mcpServers'), 'Claude settings.json does not configure MCP servers.', 'Claude MCP servers belong in .mcp.json or ~/.claude.json.', 'Move the server definition to the appropriate MCP configuration.', 'claude'));
  }
  for (const s of ctx.sources.filter(s => s.kind === 'mcp' && !s.invalid)) {
    const applicable = clients.some(client => client.decisions.some(decision => decision.sourceId === s.id && decision.status !== 'ignored'));
    if (applicable && path.basename(s.path) !== '.claude.json' && s.data.mcpServers === undefined && s.owners.some(owner => selected.has(owner) && ['claude', 'copilot', 'cursor'].includes(owner))) out.push(finding('mcp.root-key', 'error', locate(s), 'MCP configuration has no mcpServers object.', 'The client does not read this top-level shape (for example, VS Code uses a different servers key).', 'Use the client’s mcpServers schema.'));
  }
  return out;
}
