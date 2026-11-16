import type { Context, Effective, Location, Source } from '../core/types.js';
import { locate, plainObject } from '../core/utils.js';
import { effectiveValue, flatten } from './common.js';
import { claudeMcpEnvironments } from './claude-mcp.js';
import models from './claude-models.json' with { type: 'json' };

// Model identities, provider spellings and context defaults in the 2.1.322
// distribution. Native scripted requests verify these values without a model call.
// https://www.npmjs.com/package/@anthropic-ai/claude-code/v/2.1.322
const aliases = new Set(['opus', 'sonnet', 'haiku']);
const enabled = (value: string | undefined) => ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '');
const withoutContext = (value: string) => value.replace(/\[1m\]/ig, '').trim();
const modelInfo = (value: string) => models.find(model => model.id === value.toLowerCase() || model.aliases.some(alias => alias.toLowerCase() === value.toLowerCase()));

export function applyClaudeModelSettings(effective: Effective, layers: Source[]): void {
  const declarations = layers.filter(source => !source.invalid && Object.hasOwn(source.data, 'modelPicker'));
  const eligible = declarations.filter(source => source.scope === 'user' || source.scope === 'system');
  const owner = eligible.at(-1);
  const earlier: Location[] = [];
  for (const source of declarations) {
    const status = !eligible.includes(source) ? 'ignored' : source === owner ? 'active' : 'shadowed';
    const reason = !eligible.includes(source) ? 'Model picker declarations apply from personal or managed settings.'
      : source === owner ? 'The complete declaration from the highest eligible settings source applies.'
      : 'A higher settings source replaces this complete declaration.';
    for (const [key, value] of flatten({ modelPicker: source.data.modelPicker })) effective.settings.push({
      key, value, status, location: locate(source, key), reason,
      overrides: status === 'active' ? [...earlier] : [],
    });
    if (eligible.includes(source)) earlier.push(locate(source, 'modelPicker'));
  }
}

export function claudeMemoryLimit(effective: Effective, ctx: Context, layers: Source[]): { limit?: number; locations: Location[] } {
  const valid = layers.filter(source => !source.invalid);
  const env = claudeMcpEnvironments(ctx, valid).live;
  const configured = env.ANTHROPIC_MODEL || effectiveValue(effective, 'model');
  const locations = effective.settings.filter(setting => setting.status === 'active' && (
    setting.key === 'model' || /^env\.(ANTHROPIC_(MODEL|DEFAULT_(OPUS|SONNET|HAIKU)_MODEL)|CLAUDE_CODE_(MAX_CONTEXT_TOKENS|DISABLE_1M_CONTEXT|DISABLE_LEGACY_MODEL_REMAP)|DISABLE_COMPACT)$/.test(setting.key)
  )).map(setting => setting.location);
  if (typeof configured !== 'string' || !configured.trim()) return { locations };
  let selected = configured.trim();
  let longContext = /\[1m\]/i.test(selected) && !enabled(env.CLAUDE_CODE_DISABLE_1M_CONTEXT);
  let identity = withoutContext(selected);
  const alias = identity.toLowerCase();
  if (aliases.has(alias)) {
    const pinned = env['ANTHROPIC_DEFAULT_' + alias.toUpperCase() + '_MODEL'];
    if (!pinned) return { locations };
    selected = pinned;
    longContext ||= /\[1m\]/i.test(selected) && !enabled(env.CLAUDE_CODE_DISABLE_1M_CONTEXT);
    identity = withoutContext(selected);
  }
  if (['best', 'opusplan', 'inherit', 'default', 'fable'].includes(identity.toLowerCase())) return { locations };
  const overrides: Record<string, unknown> = {};
  for (const source of valid.filter(source => source.data.modelOverrides !== undefined)) {
    if (!plainObject(source.data.modelOverrides)) return { locations };
    Object.assign(overrides, source.data.modelOverrides);
    locations.push(locate(source, 'modelOverrides'));
  }
  const mapped = Object.entries(overrides).find(([, value]) => value === identity);
  if (mapped) identity = mapped[0];
  const picker = valid.findLast(source => ['user', 'system'].includes(source.scope) && source.data.modelPicker !== undefined);
  if (picker && !modelInfo(identity)) {
    const options = picker.data.modelPicker?.options;
    if (!Array.isArray(options)) return { locations };
    const index = options.findIndex(option => plainObject(option) && typeof option.model === 'string' && withoutContext(option.model) === withoutContext(selected));
    const behavior = options[index]?.behavesAs;
    if (typeof behavior === 'string') {
      identity = withoutContext(behavior);
      locations.push(locate(picker, `modelPicker.options.${index}.behavesAs`));
    }
  }
  const model = modelInfo(identity);
  if (model && ['claude-opus-4-0', 'claude-opus-4-1'].includes(model.id) && !enabled(env.CLAUDE_CODE_DISABLE_LEGACY_MODEL_REMAP)) return { locations };
  if (valid.some(source => source.scope === 'system' && source.data.availableModels !== undefined)) return { locations };
  const override = Number.parseInt(env.CLAUDE_CODE_MAX_CONTEXT_TOKENS ?? '', 10);
  const explicitWindow = Number.isFinite(override) && override > 0 ? override : undefined;
  const forcedWindow = explicitWindow !== undefined && enabled(env.DISABLE_COMPACT);
  let window = model?.contextWindow;
  if (enabled(env.CLAUDE_CODE_DISABLE_1M_CONTEXT) && window !== undefined) window = Math.min(window, 200000);
  const providerMapping = overrides[withoutContext(selected)];
  const customWindow = !withoutContext(selected).toLowerCase().startsWith('claude-') || typeof providerMapping === 'string' && providerMapping !== withoutContext(selected);
  if (explicitWindow !== undefined && !model && customWindow) window = explicitWindow;
  if (longContext) window = Math.max(window ?? 0, 1000000);
  if (forcedWindow) window = explicitWindow;
  if (window === undefined) return { locations };
  const charactersPerToken = model?.charactersPerToken ?? (['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'].includes(identity.toLowerCase().replace(/-\d{8}$/, '')) ? 4 : 3);
  return { limit: Math.max(40000, Math.floor(window * 0.05 * charactersPerToken)), locations };
}
