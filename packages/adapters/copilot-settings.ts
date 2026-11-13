import path from 'node:path';
import { Ajv } from 'ajv';
import { isDeepStrictEqual } from 'node:util';
import type { Context, Effective, Source, Status } from '../core/types.js';
import { finding, locate, plainObject } from '../core/utils.js';
import { decision, flatten, hooks } from './common.js';
import { copilotPersonalKeys, copilotSettingLocation, normalizeCopilotSettings } from './copilot-aliases.js';

interface SettingsSource extends Source { declaredKeys?: Map<string, string> }
const settingLocation = (source: SettingsSource, key: string) => copilotSettingLocation(source, source.declaredKeys, key);

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

function omitPersonalValues(e: Effective, source: SettingsSource, data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([key, value]) => {
    const omitted = ['effortLevel', 'contextTier'].includes(key) && value === null ||
      key === 'theme' && typeof value !== 'string' ||
      key === 'colorMode' && value === null;
    if (omitted) e.settings.push({ key, value, status: 'ignored', location: settingLocation(source, key), reason: 'The native personal settings reader omits this optional value.', overrides: [] });
    return !omitted;
  }));
}

function personalSettings(e: Effective, source: Source): SettingsSource | null {
  // Optional personal selectors are omitted before the native alias pass.
  const data = omitPersonalValues(e, source, source.data);
  const personalValidator = (key: string) => ['skillDirectories', 'ignoredSkillsLocations'].includes(key) ? validateLocations : validators.get(key);
  const invalid = Object.entries(data).filter(([key, value]) => {
    const validate = personalValidator(key);
    return validate && !validate(value);
  });
  if (invalid.length) {
    const loaded = e.decisions.findLast(decision => decision.path === source.path)!;
    loaded.status = 'invalid'; loaded.reason = 'Copilot rejects this personal settings file because a declared canonical value fails validation.';
    for (const [key] of invalid) e.findings.push(finding('copilot.personal-settings-invalid', 'error', locate(source, key), `Copilot cannot load this personal settings file because "${key}" is invalid.`, 'The native personal-file loader rejects the document before applying its aliases. Sibling personal settings also lose their contribution.', 'Correct this value, then rescan the complete personal settings file.', 'copilot'));
    for (const [key, value] of Object.entries(source.data)) if (key !== '$schema') e.settings.push({ key, value, status: 'invalid', location: locate(source, key), reason: 'The personal settings document failed native loading validation.', overrides: [] });
    return null;
  }
  const normalized = normalizeCopilotSettings(data);
  normalized.data = omitPersonalValues(e, { ...source, declaredKeys: normalized.origins }, normalized.data);
  const invalidAliases = Object.entries(normalized.data).filter(([key, value]) => {
    const validate = personalValidator(key);
    return validate && !validate(value);
  });
  if (invalidAliases.length) {
    for (const [key, value] of invalidAliases) {
      const location = copilotSettingLocation(source, normalized.origins, key);
      e.settings.push({ key, value, status: 'invalid', location, reason: 'This alias makes the normalized personal document fail validation.', overrides: [] });
      e.findings.push(finding('copilot.setting-alias-type', 'error', location, `Copilot cannot normalize personal setting "${key}".`, 'The native loader retains its original unnormalized document when an aliased value fails validation. Other aliased settings also lose their contribution.', 'Correct the aliased value or replace it with a valid canonical setting.', 'copilot'));
    }
    for (const [key, value] of Object.entries(data)) {
      const canonical = Object.keys(normalizeCopilotSettings({ [key]: value }).data)[0];
      if (canonical === key) continue;
      e.settings.push({ key: canonical, value, status: 'ignored', location: locate(source, key), reason: 'Alias normalization failed for this personal file. Copilot retains the original canonical keys.', overrides: [] });
      delete data[key];
    }
    return { ...source, data };
  }
  const result = { ...source, data: normalized.data, declaredKeys: normalized.origins };
  for (const replaced of normalized.replaced) {
    for (const [key, value] of flatten({ [replaced.key]: replaced.value })) e.settings.push({
      key, value, status: 'shadowed', location: copilotSettingLocation(source, replaced.origins, key),
      reason: 'A later spelling of the same Copilot setting replaces this definition in this file.', overrides: [],
    });
    e.findings.push(finding('copilot.setting-alias-collision', 'warn', settingLocation(result, replaced.key), `Multiple spellings define Copilot setting "${replaced.key}".`, 'Copilot normalizes registered aliases in file order. The last spelling supplies this setting subtree.', 'Keep one spelling of this setting using its canonical name.', 'copilot', [copilotSettingLocation(source, replaced.origins, replaced.key)]));
  }
  return result;
}

export function copilotSettings(e: Effective, source: SettingsSource, trust: Status, shared = false, ambiguous = new Set<string>()): void {
  const repository = source.scope !== 'user';
  decision(e, source, 'active', repository ? 'Repository settings override user defaults, followed by settings.local.json. Each key retains its Copilot merge policy.' : 'Personal Copilot settings.');
  if (source.invalid) return;
  if (!repository) {
    const personal = personalSettings(e, source);
    if (!personal) return;
    source = personal;
  }
  for (const [key, declared] of Object.entries(source.data)) {
    if (key === '$schema') continue;
    if (!repository && !copilotPersonalKeys.has(key)) {
      e.settings.push({ key, value: declared, status: 'ignored', location: settingLocation(source, key), reason: 'This key is outside the pinned Copilot personal settings catalog.', overrides: [] });
      e.findings.push(finding('copilot.setting-unknown', 'warn', settingLocation(source, key), `Copilot does not recognize personal setting "${key}".`, 'The pinned native settings catalog does not include this key.', 'Check the setting name in the Copilot configuration reference.', 'copilot'));
      continue;
    }
    if (shared && !copilotSharedSettings.has(key)) {
      e.settings.push({ key, value: declared, status: 'ignored', location: settingLocation(source, key), reason: 'Copilot reads the shared cross-tool subset from Claude repository settings. This key is outside that subset.', overrides: [] });
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
        e.findings.push(finding('copilot.setting-type', 'error', settingLocation(source, [key, ...parts].join('.')), `Copilot setting "${key}" has an invalid value (${error.keyword}).`, 'This setting value fails Copilot structural validation.', 'Correct this value using the Copilot configuration reference, then rescan.', 'copilot'));
      }
      e.settings.push({ key, value: declared, status: 'invalid', location: settingLocation(source, key), reason: 'This setting subtree fails structural validation.', overrides: [] });
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

function applySetting(e: Effective, source: SettingsSource, key: string, value: unknown, status: Status, policy: 'replace' | 'union' | 'append' | 'tighten', ambiguous = false): void {
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
  const aliases = earlier.filter(setting => setting.status === 'shadowed' && setting.location.path === source.path);
  overrides.push(...aliases.map(setting => setting.location));
  const uniqueOrigins = [...new Map(overrides.map(location => [JSON.stringify(location), location])).values()];
  for (const [name, child] of flatten({ [key]: value })) e.settings.push({ key: name, value: child, status, location: settingLocation(source, name), reason, overrides: uniqueOrigins });
  if (status === 'active' && policy === 'replace' && previous.length) e.findings.push(finding('config.overridden', 'info', previous[0].location, `Setting "${key}" is overridden.`, 'A higher-priority Copilot setting replaces this value or map entry.', 'Inspect the selected definition and remove redundant values if appropriate.', 'copilot', [settingLocation(source, key)]));
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
