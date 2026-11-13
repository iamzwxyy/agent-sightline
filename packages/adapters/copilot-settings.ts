import path from 'node:path';
import { Ajv } from 'ajv';
import { isDeepStrictEqual } from 'node:util';
import type { Context, Effective, Source, Status } from '../core/types.js';
import { finding, locate, plainObject } from '../core/utils.js';
import { decision, flatten, hooks } from './common.js';

// Copilot's repository fold is compared with 1.0.110's user.settings.mergeRepoValue.
// https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference
const stringList = { type: 'array', items: { type: 'string' } };
const hookFields = {
  type: { type: 'string' }, command: { type: 'string' }, bash: { type: 'string' }, powershell: { type: 'string' },
  exec: { type: 'string' }, args: stringList, cwd: { type: 'string' }, matcher: { type: 'string' },
  env: { type: 'object', additionalProperties: { type: 'string' } },
  timeoutSec: { type: 'number', exclusiveMinimum: 0 }, timeout: { type: 'number', exclusiveMinimum: 0 },
};
const commandHook = {
  type: 'object', properties: { ...hookFields, type: { const: 'command' } },
  oneOf: [
    { required: ['exec'], not: { anyOf: ['command', 'bash', 'powershell'].map(key => ({ required: [key] })) } },
    { anyOf: ['command', 'bash', 'powershell'].map(key => ({ required: [key] })), not: { required: ['exec'] } },
  ],
};
const httpHook = { type: 'object', required: ['type', 'url'], properties: { ...hookFields, type: { const: 'http' }, url: { type: 'string' }, headers: { type: 'object', additionalProperties: { type: 'string' } }, allowedEnvVars: stringList } };
const promptHook = { type: 'object', required: ['type', 'prompt'], properties: { type: { const: 'prompt' }, prompt: { type: 'string' } } };
const hookList = (prompt: boolean) => {
  const handler = {
    type: 'object',
    if: { required: ['type'], properties: { type: { const: 'http' } } }, then: httpHook,
    else: { if: { required: ['type'], properties: { type: { const: 'prompt' } } }, then: prompt ? promptHook : false, else: commandHook },
  };
  return { type: 'array', items: { type: 'object', if: { required: ['hooks'] }, then: { properties: { matcher: { type: 'string' }, hooks: { type: 'array', items: handler } } }, else: handler } };
};
const fields = {
  companyAnnouncements: { type: 'array', items: { type: 'string' } },
  contextTier: { type: 'string' },
  deniedUrls: stringList,
  disableAllHooks: { type: 'boolean' },
  disabledMcpServers: stringList,
  disabledSkills: stringList,
  effortLevel: { type: 'string' },
  enabledPlugins: { type: 'object', additionalProperties: { type: 'boolean' } },
  extraKnownMarketplaces: { type: 'object', additionalProperties: { type: 'object', required: ['source'], properties: {
    autoUpdate: { type: 'boolean' }, source: { oneOf: [
      { type: 'object', required: ['source', 'path'], properties: { source: { const: 'directory' }, path: { type: 'string' } } },
      { type: 'object', required: ['source', 'url'], properties: { source: { const: 'git' }, url: { type: 'string' }, ref: { type: 'string' } } },
      { type: 'object', required: ['source', 'repo'], properties: { source: { const: 'github' }, repo: { type: 'string' }, ref: { type: 'string' } } },
    ] },
  } } },
  hooks: { type: 'object', properties: { sessionStart: hookList(true), SessionStart: hookList(true) }, additionalProperties: hookList(false) },
  includeCoAuthoredBy: { type: 'boolean' },
  mergeStrategy: { enum: ['rebase', 'merge'] },
  model: { type: 'string' },
  respectGitignore: { type: 'boolean' },
};
const ajv = new Ajv({ allErrors: true, strict: false });
const validators = new Map(Object.entries(fields).map(([key, schema]) => [key, ajv.compile(schema)]));
const validateLocations = ajv.compile<string[]>(stringList);
const unions = new Set(['deniedUrls', 'disabledMcpServers', 'disabledSkills']);
const maps = new Set(['enabledPlugins', 'extraKnownMarketplaces', 'hooks']);
const trustedFields = new Set(['model', 'effortLevel', 'contextTier']);
const copilotSharedSettings = new Set(['companyAnnouncements', 'disableAllHooks', 'enabledPlugins', 'extraKnownMarketplaces', 'hooks']);
const customizationLocations = new Set(['skillDirectories', 'agentDirectories', 'instructionDirectories', 'hookDirectories']);

export function copilotSettings(e: Effective, source: Source, trust: Status, shared = false, ambiguous = new Set<string>()): void {
  const repository = source.scope !== 'user';
  decision(e, source, 'active', repository ? 'Repository settings override user defaults, followed by settings.local.json. Each key retains its Copilot merge policy.' : 'Personal Copilot settings.');
  if (source.invalid) return;
  for (const [key, declared] of Object.entries(source.data)) {
    if (key === '$schema') continue;
    if (shared && !copilotSharedSettings.has(key)) {
      e.settings.push({ key, value: declared, status: 'ignored', location: locate(source, key), reason: 'Copilot reads the shared cross-tool subset from Claude repository settings. This key is outside that subset.', overrides: [] });
      continue;
    }
    const locationSetting = repository ? customizationLocations.has(key) : key === 'skillDirectories';
    const validate = locationSetting ? validateLocations : validators.get(key);
    if (repository && !validate) {
      e.settings.push({ key, value: declared, status: 'ignored', location: locate(source, key), reason: 'This key is outside the documented repository-overridable settings.', overrides: [] });
      e.findings.push(finding('copilot.setting-scope', 'warn', locate(source, key), `Copilot repository settings do not override "${key}".`, 'Repository settings accept a restricted set of keys, including keys with collection-specific merge policies.', 'Use a supported repository key or place this setting in personal settings.json.', 'copilot'));
      continue;
    }
    if (validate && !validate(declared)) {
      for (const error of validate.errors ?? []) {
        if (['if', 'anyOf', 'oneOf'].includes(error.keyword)) continue;
        const parts = error.instancePath.split('/').slice(1).map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
        if (error.keyword === 'required') parts.push(String(error.params.missingProperty));
        e.findings.push(finding('copilot.setting-type', 'error', locate(source, [key, ...parts].join('.')), `Copilot setting "${key}" has an invalid value (${error.keyword}).`, 'Copilot rejects this setting subtree while retaining valid sibling settings.', 'Correct this value using the Copilot configuration reference, then rescan.', 'copilot'));
      }
      e.settings.push({ key, value: declared, status: 'invalid', location: locate(source, key), reason: 'This setting subtree fails structural validation.', overrides: [] });
      continue;
    }
    if (locationSetting && Array.isArray(declared)) {
      applySetting(e, source, key, declared, declared.length ? 'conditional' : 'active', 'replace');
      const setting = e.settings.at(-1)!;
      setting.reason = declared.length ? 'Declared customization directories require separate inspection. Their effective content remains unresolved.' : 'This layer declares an empty customization-directory list.';
      continue;
    }
    if (key === 'hooks') hooks(e, source, declared, 'active');
    const status = repository && trustedFields.has(key) ? trust : 'active';
    if (repository && maps.has(key) && plainObject(declared)) {
      for (const [name, value] of Object.entries(declared)) {
        const field = `${key}.${name}`;
        applySetting(e, source, field, value, ambiguous.has(field) ? 'conditional' : status, key === 'hooks' ? 'append' : 'replace', ambiguous.has(field));
        if (key === 'extraKnownMarketplaces') {
          const autoUpdate = e.settings.findLast(setting => setting.key === field + '.autoUpdate' && setting.location.path === source.path);
          if (autoUpdate) { autoUpdate.status = 'ignored'; autoUpdate.reason = 'Marketplace auto-update opt-ins take effect in personal or managed settings.'; }
        }
      }
    } else {
      const policy = !repository ? 'replace' : unions.has(key) ? 'union' : key === 'respectGitignore' ? 'tighten' : 'replace';
      applySetting(e, source, key, declared, ambiguous.has(key) ? 'conditional' : status, policy, ambiguous.has(key));
    }
  }
}

function applySetting(e: Effective, source: Source, key: string, value: unknown, status: Status, policy: 'replace' | 'union' | 'append' | 'tighten', ambiguous = false): void {
  const earlier = e.settings.filter(setting => setting.key === key || setting.key.startsWith(key + '.'));
  const previous = earlier.filter(setting => setting.status === 'active');
  const conditional = earlier.filter(setting => setting.status === 'conditional');
  const old = previous.find(setting => setting.key === key);
  const inherited = old && Array.isArray(old.value) ? old.value : [];
  if (policy === 'union' && Array.isArray(value)) value = [...new Set([...inherited, ...value])];
  if (policy === 'append' && Array.isArray(value)) value = [...inherited, ...value];
  if (policy === 'tighten') value = (old?.value ?? true) === true || value === true;
  let reason = {
    replace: 'Highest applicable Copilot settings layer defining this value.',
    union: 'Copilot unions repository restrictions with the earlier layer.',
    append: 'Copilot appends hook entries from each settings layer.',
    tighten: 'Repository settings can enable respectGitignore while retaining an earlier or default true value.',
  }[policy];
  if (status === 'conditional') reason = 'Repository model settings require workspace trust.';
  if (status === 'ignored') reason = 'Repository model settings are ignored in an untrusted workspace.';
  if (ambiguous) reason = 'Conflicting Copilot and Claude settings share this scope. Their same-scope file ordering is unverified.';
  if (status === 'active' || ambiguous) for (const setting of previous) {
    setting.status = 'shadowed';
    setting.reason = ambiguous ? 'Replaced by repository candidates whose file ordering is unresolved.' : policy === 'replace' ? 'Replaced by a higher-priority Copilot settings layer.' : 'Included in the combined Copilot setting.';
  }
  if (status !== 'ignored' && !ambiguous) for (const setting of conditional) {
    setting.status = 'shadowed';
    setting.reason = 'A closer settings layer supplies this value.';
  }
  const overrides = ambiguous
    ? [...previous.flatMap(setting => [...setting.overrides, setting.location]), ...conditional.flatMap(setting => setting.overrides)]
    : [...previous, ...conditional].flatMap(setting => [...setting.overrides, setting.location]);
  const uniqueOrigins = [...new Map(overrides.map(location => [JSON.stringify(location), location])).values()];
  for (const [name, child] of flatten({ [key]: value })) e.settings.push({ key: name, value: child, status, location: locate(source, name), reason, overrides: uniqueOrigins });
  if (status === 'active' && policy === 'replace' && previous.length) e.findings.push(finding('config.overridden', 'info', previous[0].location, `Setting "${key}" is overridden.`, 'A higher-priority Copilot setting replaces this value or map entry.', 'Inspect the selected definition and remove redundant values if appropriate.', 'copilot', [locate(source, key)]));
}

export function copilotRepositorySettings(e: Effective, ctx: Context, trust: Status): void {
  for (const filename of ['settings.json', 'settings.local.json']) {
    const shared = ctx.sources.find(source => source.path === path.join(ctx.repo, '.claude', filename));
    const own = ctx.sources.find(source => source.path === path.join(ctx.repo, '.github/copilot', filename));
    const ambiguous = new Set<string>();
    const equivalent = new Set<string>();
    if (shared && own && !shared.invalid && !own.invalid) for (const key of copilotSharedSettings) {
      if (key === 'hooks' || !Object.hasOwn(shared.data, key) || !Object.hasOwn(own.data, key)) continue;
      const validate = validators.get(key)!;
      if (!validate(shared.data[key]) || !validate(own.data[key])) continue;
      const sharedValue = shared.data[key];
      const ownValue = own.data[key];
      const values = maps.has(key) && plainObject(sharedValue) && plainObject(ownValue)
        ? Object.keys(sharedValue).filter(name => Object.hasOwn(ownValue, name)).map(name => ({ key: `${key}.${name}`, shared: sharedValue[name], own: ownValue[name] }))
        : [{ key, shared: sharedValue, own: ownValue }];
      for (const value of values) {
        if (key === 'extraKnownMarketplaces' && plainObject(value.shared) && plainObject(value.own)) {
          value.shared = { ...value.shared }; value.own = { ...value.own };
          delete value.shared.autoUpdate; delete value.own.autoUpdate;
        }
        if (isDeepStrictEqual(value.shared, value.own)) { equivalent.add(value.key); continue; }
        ambiguous.add(value.key);
        e.findings.push(finding('copilot.shared-setting-order', 'warn', locate(own, value.key), `Copilot and Claude settings disagree on "${value.key}" in the same scope.`, 'Both formats contribute, while their same-scope file order has no verified contract. The candidates remain conditional.', 'Keep this value in one format or give both sources the same value.', 'copilot', [locate(shared, value.key)]));
      }
    }
    if (shared) copilotSettings(e, shared, trust, true, ambiguous);
    if (own) copilotSettings(e, own, trust, false, ambiguous);
    for (const setting of e.settings) if (setting.status === 'active' && [...equivalent].some(key => setting.key === key || setting.key.startsWith(key + '.'))) setting.reason = 'Equivalent values are declared in the Copilot and Claude files in this scope. Both locations are retained without asserting their file order.';
  }
  e.findings = e.findings.filter(finding => finding.ruleId !== 'copilot.shared-setting-order' || e.settings.some(setting => setting.status === 'conditional' && (setting.key === finding.location.key || setting.key.startsWith(finding.location.key + '.'))));
  for (const setting of e.settings.filter(setting => customizationLocations.has(setting.key) && setting.status === 'conditional')) {
    if (ctx.discovery) ctx.discovery.complete = false;
    e.findings.push(finding('copilot.customization-locations', 'warn', setting.location, `Copilot ${setting.key} declares additional locations requiring inspection.`, 'This adapter resolves conventional source locations. The declared directories can contribute additional configuration.', 'Review these locations with Copilot’s customization inventory and inspect their contents separately.', 'copilot'));
  }
}
