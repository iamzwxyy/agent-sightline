import path from 'node:path';
import { readdir } from 'node:fs/promises';
import type { Context, Effective, Setting, Source } from '../core/types.js';
import { cmp, finding, locate, plainObject } from '../core/utils.js';

// File policy is one managed tier. Remote, MDM, registry and SDK policy are
// outside this filesystem inspection. The distributed CLI uses fixed roots.
export async function discoverClaudeManagedSettings(ctx: Context, directory = process.platform === 'darwin' ? '/Library/Application Support/ClaudeCode' : process.platform === 'win32' ? 'C:\\Program Files\\ClaudeCode' : '/etc/claude-code'): Promise<void> {
  await ctx.read(path.join(directory, 'managed-settings.json'), 'claude', 'settings', 'system');
  const dropins = path.join(directory, 'managed-settings.d');
  try {
    const entries = await readdir(dropins, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => cmp(a.name, b.name))) {
      ctx.options.signal?.throwIfAborted();
      if (!entry.name.startsWith('.') && entry.name.endsWith('.json') && (entry.isFile() || entry.isSymbolicLink())) await ctx.read(path.join(dropins, entry.name), 'claude', 'settings', 'system');
    }
  } catch (error) {
    ctx.options.signal?.throwIfAborted();
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      if (ctx.discovery) ctx.discovery.complete = false;
      ctx.findings.push(finding('source.unreadable', 'error', { path: dropins, line: 1, column: 1 }, 'Managed settings directory cannot be inspected.', 'A file-based policy may be incomplete.', 'Check the system policy directory and its read permissions.', 'claude'));
    }
  }
  await ctx.read(path.join(directory, 'CLAUDE.md'), 'claude', 'instructions', 'system');
}

const managedLocks = ['allowManagedPermissionRulesOnly', 'allowManagedHooksOnly'];

export function claudeSettingsSource(e: Effective, source: Source): Source {
  if (source.invalid) {
    if (source.scope === 'system') {
      let validObject = false;
      try { validObject = plainObject(JSON.parse(source.text)); } catch { /* The parser already supplies the precise syntax finding. */ }
      if (!validObject) e.findings.push(finding('claude.managed-policy-invalid', 'error', locate(source), 'Malformed managed policy prevents Claude from starting.', 'Every inspected managed file must parse as a JSON object, even when another policy file is valid.', 'Repair the named system policy file before starting Claude.', 'claude'));
    }
    return source;
  }
  const data = { ...source.data };
  for (const key of [...managedLocks, 'disableAllHooks']) {
    if (!Object.hasOwn(data, key)) continue;
    const value = data[key];
    const location = locate(source, key);
    if (managedLocks.includes(key) && source.scope !== 'system') {
      delete data[key];
      e.settings.push({ key, value, location, status: 'ignored', reason: 'This setting is accepted only in managed policy.', overrides: [] });
      e.findings.push(finding('claude.managed-only', 'warn', location, `"${key}" requires managed settings.`, 'User, project and local declarations have no effect.', 'Ask an administrator to set the policy in a managed source.', 'claude'));
    } else if (source.scope === 'system' && value === null) {
      delete data[key];
    } else if (typeof value !== 'boolean') {
      if (source.scope === 'system' && managedLocks.includes(key)) {
        data[key] = value === 'false' ? false : true;
        e.findings.push(finding('claude.managed-boolean', 'warn', location, `Managed "${key}" is read as ${data[key]}.`, value === 'true' || value === 'false' ? 'Claude coerces quoted managed Boolean locks.' : 'Claude enforces the restrictive value for an invalid managed lock.', 'Use an unquoted Boolean value.', 'claude'));
      } else {
        const invalidLayer = source.scope !== 'system';
        e.findings.push(finding('config.field-type', invalidLayer ? 'error' : 'warn', location, `"${key}" must be a Boolean.`, invalidLayer ? 'Claude rejects this settings layer because its schema is invalid.' : 'Claude drops the invalid managed hook switch and retains other managed settings.', 'Use an unquoted true or false.', 'claude'));
        if (invalidLayer) return { ...source, invalid: true };
        delete data[key];
        e.settings.push({ key, value, location, status: 'invalid', reason: 'Claude drops this non-Boolean managed setting.', overrides: [] });
      }
    }
  }
  if (source.scope === 'system' && data.permissions === null) delete data.permissions;
  if (source.scope === 'system' && plainObject(data.permissions)) {
    const permissions = { ...data.permissions };
    for (const key of Object.keys(permissions)) if (permissions[key] === null) delete permissions[key];
    const brokenRestriction = ['deny', 'ask'].find(action => permissions[action] !== undefined && !Array.isArray(permissions[action]));
    if (brokenRestriction) for (const key of ['allow', 'additionalDirectories']) {
      if (permissions[key] === undefined) continue;
      const location = locate(source, 'permissions.' + key);
      e.settings.push({ key: 'permissions.' + key, value: permissions[key], location, status: 'ignored', reason: `Managed permissions.${brokenRestriction} cannot be read, so Claude withholds these grants.`, overrides: [] });
      e.findings.push(finding('claude.managed-grants-withheld', 'warn', location, 'Managed grants are withheld until the restriction is repaired.', `permissions.${brokenRestriction} must be an array.`, 'Repair the restrictive list before relying on the grants in this file.', 'claude', [locate(source, 'permissions.' + brokenRestriction)]));
      delete permissions[key];
    }
    for (const action of ['allow', 'ask', 'deny']) {
      const rules = permissions[action];
      if (!Array.isArray(rules)) continue;
      permissions[action] = rules.filter((rule, index) => {
        if (typeof rule === 'string') return true;
        e.findings.push(finding('permission.type', 'error', locate(source, `permissions.${action}.${index}`), 'Permission rule must be a string.', 'Claude drops the invalid entry and retains other managed rules.', 'Replace the entry with a permission rule string.', 'claude'));
        return false;
      });
    }
    data.permissions = permissions;
  }
  return { ...source, data };
}

export function applyClaudePolicy(e: Effective, ctx: Context): void {
  const managed = new Set(ctx.sources.filter(source => source.scope === 'system' && source.owners.includes('claude')).map(source => source.path));
  const enabled = (key: string) => e.settings.findLast(setting => setting.key === key && setting.status === 'active' && setting.value === true);
  const permissionLock = enabled('allowManagedPermissionRulesOnly');
  const hookLock = enabled('allowManagedHooksOnly');
  const hookDisable = e.settings.findLast(setting => setting.key === 'disableAllHooks' && setting.status === 'active');
  const ignore = (entry: { status: string; reason: string }, setting: Setting) => {
    entry.status = 'ignored';
    entry.reason = `Disabled by ${setting.key} in ${setting.location.path}.`;
  };
  for (const extension of e.extensions) {
    const isManaged = managed.has(extension.location.path);
    let gate: Setting | undefined;
    if (extension.kind === 'permission' && !isManaged) gate = permissionLock;
    if (extension.kind === 'hook') {
      if (hookDisable?.value === true && (!isManaged || managed.has(hookDisable.location.path))) gate = hookDisable;
      else if (!isManaged) gate = hookLock;
    }
    if (gate && ['active', 'conditional'].includes(extension.status)) {
      ignore(extension, gate);
      extension.origins = [{ key: gate.key, location: gate.location }];
    }
    if (permissionLock && extension.kind === 'skill' && !isManaged && Object.hasOwn(extension.config, 'allowed-tools')) {
      extension.config = { ...extension.config };
      delete extension.config['allowed-tools'];
      const source = ctx.sources.find(source => source.path === extension.location.path)!;
      e.findings.push(finding('claude.skill-tools-ignored', 'info', locate(source, 'allowed-tools'), 'Skill tool pre-approval is ignored by managed policy.', 'The skill remains discoverable, while allowManagedPermissionRulesOnly removes its allowed-tools grant.', 'Use administrator-approved permission rules for the required tools.', 'claude', [permissionLock.location]));
    }
  }
  if (permissionLock) for (const setting of e.settings) {
    if (!managed.has(setting.location.path) && ['permissions.allow', 'permissions.ask', 'permissions.deny'].includes(setting.key) && ['active', 'conditional'].includes(setting.status)) ignore(setting, permissionLock);
  }
  const blocked = e.findings.find(finding => finding.ruleId === 'claude.managed-policy-invalid');
  if (blocked) {
    const reason = `Claude startup is blocked by malformed managed policy in ${blocked.location.path}.`;
    for (const entry of [...e.settings, ...e.extensions]) if (['active', 'conditional'].includes(entry.status)) { entry.status = 'ignored'; entry.reason = reason; }
    for (const entry of e.decisions) if (['active', 'conditional', 'truncated'].includes(entry.status)) {
      entry.status = 'ignored'; entry.reason = reason; entry.content = ''; entry.loadedBytes = 0; entry.estimatedTokens = 0;
    }
    e.instructions = ''; e.instructionBytes = 0; e.estimatedTokens = 0;
  }
}
