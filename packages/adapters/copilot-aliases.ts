import type { Location, Source } from '../core/types.js';
import { locate, plainObject } from '../core/utils.js';

// Registered setting shapes compared with Copilot 1.0.110 user.settings.normalize.
// Dynamic maps (plugins, environments, hook events, agent names) retain their keys.
const fields: Record<string, string[]> = {
  '': [
    'mouse', 'askUser', 'autoUpdate', 'bashEnv', 'powershellFlags',
    'autoUpdatesChannel', 'banner', 'bannerStyle', 'showTipsOnStartup', 'beep',
    'beepOnSchedule', 'notifications', 'taskbarPresence', 'keepAlive', 'includeCoAuthoredBy',
    'compactPaste', 'copyOnSelect', 'copyOnCodeBlockClick', 'commandHistoryMaxSize', 'worktreeBaseRef',
    'worktreePathTemplate', 'respectGitignore', 'proxyKerberosServicePrincipal', 'proxyUrl', 'builtInAgents',
    'memory', 'toolSearch', 'contextManagementTools', 'sessionManagementTools', 'connectors',
    'imageGeneration', 'imageGenerationWatermark', 'aiSecretDetection', 'model', 'modelProviderId',
    'autoTier', 'fusionTier', 'effortLevel', 'contextTier', 'planModel',
    'planModelProviderId', 'planEffortLevel', 'planContextTier', 'subagents', 'workflows',
    'continueOnAutoMode', 'stayInAutopilot', 'defaultMode', 'defaultPermissionMode', 'assistedApprovalInstructions',
    'renderMarkdown', 'renderHexColors', 'inlineImages', 'inlineImageLiveWindow', 'scrollbar',
    'pinnedPrompts', 'sidebar', 'remoteExport', 'statusLine', 'screenReader',
    'theme', 'allowedUrls', 'deniedUrls', 'storeTokenPlaintext', 'stream',
    'streamerMode', 'footer', 'tabs', 'updateTerminalTitle', 'terminalProgress',
    'terminalNotifications', 'mergeStrategy', 'editorMode', 'customAgents', 'ide',
    'companyAnnouncements', 'enabledFeatureFlags', 'feature_flags', 'skillDirectories', 'ignoredSkillsLocations',
    'disabledSkills', 'disabledMcpServers', 'enabledMcpServers', 'githubMcpToolsets', 'githubMcpTools',
    'enableAllGithubMcpTools', 'githubMcpInsiders', 'dynamicRetrieval', 'sandbox', 'extensions',
    'enabledPlugins', 'extraKnownMarketplaces', 'strictKnownMarketplaces', 'telemetry', 'voice',
    'ahpEnvironment', 'permissions', 'copilotUrl', 'showReasoning', 'showTimestamps',
    'showToolDurations', 'disableAllHooks', 'hooks', 'disabledHooks', 'remoteSessions',
    'experimental', 'logLevel', 'shellShortcut',
  ],
  'customAgents': [
    'defaultLocalOnly',
  ],
  'extensions': [
    'disabledExtensions',
  ],
  'footer': [
    'showAgent', 'showAiUsed', 'showBranch', 'showCiStatus', 'showCodeChanges',
    'showContextWindow', 'showCustom', 'showDirectory', 'showModelEffort', 'showPullRequest',
    'showQuota', 'showSandbox', 'showSchedules', 'showUsername', 'showYolo',
  ],
  'ide': [
    'autoConnect', 'codeProduct', 'openDiffOnEdit',
  ],
  'permissions': [
    'disableBypassPermissionsMode',
  ],
  'sandbox': [
    'addCurrentWorkingDirectory', 'allowBypass', 'allowDevToolAccess', 'auth', 'sandboxExtensions',
    'sandboxLspServers', 'sandboxMcpServers', 'userPolicy', 'credentials',
  ],
  'sandbox.userPolicy': [
    'filesystem', 'network', 'seatbelt',
  ],
  'sandbox.userPolicy.filesystem': [
    'deniedPaths', 'enumeratePaths', 'readonlyPaths', 'readwritePaths',
  ],
  'sandbox.userPolicy.network': [
    'allowLocalNetwork', 'allowOutbound', 'allowedHosts', 'blockedHosts', 'proxy',
  ],
  'sandbox.userPolicy.seatbelt': [
    'keychainAccess',
  ],
  'sandbox.credentials': [
    'envVars',
  ],
  'sidebar': [
    'accentActiveSession', 'coloredHints', 'exitClosesSession', 'hoverFocus', 'showCloseButton',
    'showHeaderButtons', 'showResumableSessions', 'ctrlCClosesSession',
  ],
  'statusLine': [
    'refreshInterval',
  ],
  'subagents': [
    'contextManagementTools', 'disabledSubagents', 'maxConcurrency', 'maxDepth',
  ],
  'telemetry': [
    'capture', 'captureContent', 'headersProvider',
  ],
  'telemetry.capture': [
    'policyDetail', 'toolArguments', 'toolOutput',
  ],
  'voice': [
    'selectedModel', 'selectedDevice',
  ],
  'workflows': [
    'defaultLimits', 'logPhaseNames', 'maxConcurrentRuns',
  ],
  'workflows.defaultLimits': [
    'maxAiCredits', 'maxConcurrentSubagents', 'maxTotalSubagents', 'timeoutSeconds',
  ],
};
export const copilotPersonalKeys = new Set(fields['']);
const aliases = new Map(Object.entries(fields).map(([parent, keys]) => [
  parent,
  new Map(keys.map(key => [key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase(), key])),
]));
aliases.get('')!.set('colorMode', 'theme').set('color_mode', 'theme').set('featureFlags', 'feature_flags');

interface ReplacedSetting { key: string; value: unknown; origins: Map<string, string> }
export interface NormalizedCopilotSettings {
  data: Record<string, unknown>;
  origins: Map<string, string>;
  replaced: ReplacedSetting[];
}

export function normalizeCopilotSettings(data: Record<string, unknown>): NormalizedCopilotSettings {
  const origins = new Map<string, string>();
  const replaced: ReplacedSetting[] = [];
  const walk = (value: Record<string, unknown>, parent = '', declaredParent = ''): Record<string, unknown> => {
    const result = new Map<string, unknown>();
    for (const [declared, child] of Object.entries(value)) {
      const name = aliases.get(parent)?.get(declared) ?? declared;
      const key = parent ? `${parent}.${name}` : name;
      const original = declaredParent ? `${declaredParent}.${declared}` : declared;
      if (result.has(name)) {
        const previous = new Map([...origins].filter(([field]) => field === key || field.startsWith(key + '.')));
        replaced.push({ key, value: result.get(name), origins: previous });
        for (const field of previous.keys()) origins.delete(field);
      }
      origins.set(key, original);
      result.set(name, plainObject(child) && aliases.has(key) ? walk(child, key, original) : child);
    }
    return Object.fromEntries(result);
  };
  return { data: walk(data), origins, replaced };
}

export function copilotSettingLocation(source: Source, origins: Map<string, string> | undefined, key: string): Location {
  let parent = key;
  while (parent) {
    const declared = origins?.get(parent);
    if (declared) return locate(source, declared + key.slice(parent.length));
    parent = parent.includes('.') ? parent.slice(0, parent.lastIndexOf('.')) : '';
  }
  return locate(source, key);
}
