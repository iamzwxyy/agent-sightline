import path from 'node:path';
import { lstat, readFile } from 'node:fs/promises';
import { Ajv } from 'ajv';
import type { AdapterMetadata, Context, Source, Status } from '../core/types.js';
import { readUserTree } from '../core/discovery.js';
import { bytes, finding, locate } from '../core/utils.js';
import { adapter, addInstruction, base, decision, effectiveValue, finish, flatten, hooks, mcp, settings, skills, truncated } from './common.js';

export const codexMetadata: AdapterMetadata = {
  id: 'codex', name: 'OpenAI Codex CLI', maturity: 'verified', ruleVersion: '0.167.2', verifiedOn: '2026-11-12',
  evidence: ['https://github.com/openai/codex/blob/rust-v0.167.2/codex-rs/core/src/agents_md.rs', 'https://github.com/openai/codex/blob/rust-v0.167.2/codex-rs/codex-home/src/instructions/mod.rs', 'https://developers.openai.com/codex/config-basic', 'https://developers.openai.com/codex/config-advanced#profiles', 'https://github.com/openai/codex/blob/rust-v0.167.2/codex-rs/config/src/loader/mod.rs', 'https://developers.openai.com/codex/skills', 'https://learn.chatgpt.com/docs/hooks'],
  limitations: ['Static single-directory session with explicit profile files. Other CLI overrides and managed/cloud requirements are not inferred.', 'Global instructions are separate from the project byte budget in 0.167.2; project empty overrides shadow the ordinary file.', 'Hook definition trust is reported as conditional. Bundled/plugin components and starlark exec-policy evaluation are not inspected.'],
};
let validator: ReturnType<Ajv['compile']> | undefined;
async function discover(ctx: Context): Promise<Source[]> {
  if (ctx.options.user !== false) {
    for (const n of ['config.toml', 'AGENTS.override.md', 'AGENTS.md', 'hooks.json']) await ctx.read(path.join(ctx.codexHome, n), 'codex', n.endsWith('.toml') ? 'settings' : n === 'hooks.json' ? 'hooks' : 'instructions', 'user');
    if (ctx.options.codexProfile) await ctx.read(path.join(ctx.codexHome, `${ctx.options.codexProfile}.config.toml`), 'codex', 'settings', 'user');
    await readUserTree(ctx, path.join(ctx.home, '.agents/skills'), 'codex', 'skill', 'SKILL.md');
    await readUserTree(ctx, path.join(ctx.codexHome, 'skills'), 'codex', 'skill', 'SKILL.md');
  }
  if (ctx.options.system && process.platform !== 'win32') { await ctx.read('/etc/codex/config.toml', 'codex', 'settings', 'system'); await ctx.read('/etc/codex/hooks.json', 'codex', 'hooks', 'system'); }
  return ctx.sources.filter(s => s.owners.includes('codex'));
}
export const codex = adapter(codexMetadata, discover, async ctx => {
  const e = await base(codexMetadata, ctx);
  if (!validator) {
    const schema = JSON.parse(await readFile(new URL('./schemas/codex.json', import.meta.url), 'utf8'));
    const ajv = new Ajv({ strict: false, allErrors: true });
    for (const format of ['uint', 'uint8', 'uint16', 'uint32', 'uint64', 'int32', 'int64']) ajv.addFormat(format, { type: 'number', validate: (v: number) => Number.isInteger(v) && (format.startsWith('uint') ? v >= 0 && (format === 'uint8' ? v <= 255 : format === 'uint16' ? v <= 65535 : format === 'uint32' ? v <= 4294967295 : true) : format === 'int32' ? v >= -2147483648 && v <= 2147483647 : true) });
    ajv.addFormat('double', { type: 'number', validate: Number.isFinite });
    validator = ajv.compile(schema);
  }
  const validate = validator;
  const user = ctx.sources.find(s => s.path === path.join(ctx.codexHome, 'config.toml'));
  const profilePath = ctx.options.codexProfile ? path.join(ctx.codexHome, `${ctx.options.codexProfile}.config.toml`) : undefined;
  const profile = ctx.sources.find(s => s.path === profilePath);
  if (profilePath && !profile) e.findings.push(finding('codex.profile-missing', 'warn', { path: profilePath, line: 1, column: 1 }, 'Selected Codex profile file was not loaded.', 'Codex uses an empty layer when the selected profile file is absent. No profile overrides can be proven here.', 'Create the named .config.toml file in CODEX_HOME or correct --profile.', 'codex'));
  // These top-level keys are removed by the pinned loader before project merging.
  const projectDenied = new Set(['openai_base_url', 'chatgpt_base_url', 'apps_mcp_product_sku', 'responses_api_metadata', 'model_provider', 'model_providers', 'notify', 'profile', 'profiles', 'experimental_realtime_webrtc_call_base_url', 'experimental_realtime_ws_base_url', 'otel']);
  const applyLayer = (s: Source, active: Status): void => {
    const project = s.scope !== 'user' && s.scope !== 'system';
    const data = { ...s.data };
    if (project) {
      for (const key of projectDenied) if (Object.hasOwn(data, key)) {
        if (active !== 'ignored') e.findings.push(finding('codex.project-setting-ignored', 'warn', locate(s, key), `Codex ignores project-local setting "${key}".`, 'The version-pinned loader removes this machine-local setting before project configuration is merged.', 'Move this setting to user configuration or a selected user profile file.', 'codex'));
        for (const [name, value] of flatten({ [key]: data[key] })) e.settings.push({ key: name, value, status: 'ignored', location: locate(s, name), reason: 'Codex removes this setting from project-local layers.', overrides: [] });
        delete data[key];
      }
    } else {
      if (data.profile !== undefined) {
        e.findings.push(finding('codex.legacy-profile', 'error', locate(s, 'profile'), 'The legacy Codex profile selector prevents startup.', 'Codex 0.167.2 rejects the top-level profile selector.', 'Move profile settings to <name>.config.toml, remove the profile selector and select the file with --profile <name>.', 'codex'));
        s.invalid = true;
        if (s === user && profile) profile.invalid = true;
      }
      if (data.profiles && Object.keys(data.profiles).length) {
        const conflict = s === user && ctx.options.codexProfile && Object.hasOwn(data.profiles, ctx.options.codexProfile);
        e.findings.push(finding('codex.legacy-profiles', conflict ? 'error' : 'warn', locate(s, conflict ? `profiles.${ctx.options.codexProfile}` : 'profiles'), conflict ? 'The selected Codex profile still has a legacy table.' : 'Legacy Codex profile tables are unused.', conflict ? 'Codex refuses --profile when the base user config contains a matching legacy table.' : 'Named profiles now use separate TOML files. These tables do not provide active settings.', 'Move each legacy table into <name>.config.toml and remove it from config.toml.', 'codex'));
        if (conflict) {
          s.invalid = true;
          if (profile) profile.invalid = true;
        }
      }
    }
    if (!s.invalid && active !== 'ignored' && !validate(data)) for (const error of validate.errors ?? []) {
      const key = error.instancePath.replace(/^\//, '').replace(/\//g, '.') || String(error.params.additionalProperty ?? '');
      e.findings.push(finding('config.schema', 'error', locate(s, key), `Codex configuration fails schema validation (${error.keyword}).`, 'The version-pinned official schema rejects this setting or value type.', 'Check this key against docs/research/codex.md and the official configuration reference.', 'codex'));
      s.invalid = true;
    }
    // Unselected legacy definitions never become effective setting rows.
    delete data.profiles;
    settings(e, s, active, false, data);
    mcp(e, s, data.mcp_servers, 'mcp_servers', active, true);
    if (effectiveValue(e, 'features.hooks', true) !== false) hooks(e, s, data.hooks, active);
    if (data.instructions !== undefined) e.findings.push(finding('config.reserved-field', 'warn', locate(s, 'instructions'), 'Codex instructions is reserved and does not replace AGENTS.md.', 'The configuration reference marks instructions as reserved for future use.', 'Use AGENTS.md or model_instructions_file as documented.', 'codex'));
    if (data.experimental_instructions_file !== undefined) e.findings.push(finding('config.deprecated-field', 'warn', locate(s, 'experimental_instructions_file'), 'experimental_instructions_file is deprecated.', 'The setting was renamed.', 'Rename it to model_instructions_file.', 'codex'));
  };
  const userLayers = [ctx.sources.find(s => s.path === '/etc/codex/config.toml'), user, profile].filter((s): s is Source => !!s);
  for (const s of userLayers) applyLayer(s, 'active');
  let trust: 'trusted' | 'untrusted' | 'unknown' = ctx.options.trust === 'trusted' || ctx.options.trust === 'untrusted' ? ctx.options.trust : 'unknown';
  if (trust === 'unknown') for (const d of [...ctx.dirs].reverse()) {
    const configuredTrust = effectiveValue(e, `projects.${d}.trust_level`);
    if (configuredTrust === 'trusted' || configuredTrust === 'untrusted') {
      trust = configuredTrust;
      break;
    }
  }
  const status: Status = trust === 'trusted' ? 'active' : trust === 'untrusted' ? 'ignored' : 'conditional';
  let markers = effectiveValue(e, 'project_root_markers', ['.git']);
  if (!Array.isArray(markers)) markers = ['.git'];
  let rootIndex = -1;
  for (let i = ctx.dirs.length - 1; i >= 0 && rootIndex < 0; i--) for (const marker of markers) {
    if (typeof marker !== 'string' || marker.includes('/') || marker.includes('\\')) continue;
    try { await lstat(path.join(ctx.dirs[i], marker)); rootIndex = i; break; } catch { /* missing marker */ }
  }
  const dirs = rootIndex < 0 ? [ctx.directory] : ctx.dirs.slice(rootIndex);
  const layers = [...userLayers, ...ctx.dirs.map(d => ctx.sources.find(s => s.path === path.join(d, '.codex/config.toml'))).filter((s): s is Source => !!s)];
  for (const s of layers.slice(userLayers.length)) applyLayer(s, status);
  for (const s of ctx.sources.filter(s => s.kind === 'hooks' && s.owners.includes('codex'))) {
    if (s.scope !== 'user' && s.scope !== 'system' && !ctx.dirs.some(d => s.path === path.join(d, '.codex/hooks.json'))) continue;
    const st = s.scope === 'user' || s.scope === 'system' ? 'active' : status;
    decision(e, s, st, 'Hooks discovered alongside an active config layer.');
    if (effectiveValue(e, 'features.hooks', true) !== false) hooks(e, s, s.data.hooks, st);
    const inline = layers.find(x => path.dirname(x.path) === path.dirname(s.path) && x.data.hooks);
    if (inline) e.findings.push(finding('hook.dual-source', 'warn', locate(s), 'Both hooks.json and inline hooks are present in one layer.', 'Codex merges both and warns at startup.', 'Prefer one representation per layer.', 'codex', [locate(inline, 'hooks')]));
  }
  if (ctx.options.user !== false) {
    const globals = ['AGENTS.override.md', 'AGENTS.md'].map(n => ctx.sources.find(s => s.path === path.join(ctx.codexHome, n))).filter((x): x is Source => !!x);
    const chosen = globals.find(s => s.text.trim());
    for (const s of globals) if (s === chosen) addInstruction(e, s, 'First non-empty global instruction file; separate from project byte budget.', s.text.trim()); else decision(e, s, 'shadowed', 'A non-empty global override wins, or this global source is empty.');
  }
  if (ctx.options.codexProfile) e.notes.push(`Selected Codex profile: ${ctx.options.codexProfile}. User defaults load first, the selected profile follows, then applicable project layers.`);
  const max = effectiveValue(e, 'project_doc_max_bytes', 32768);
  let projectSeen = false;
  const addProject: typeof addInstruction = (eff, s, why, text = s.text, st = 'active') => {
    if (text.trim() && !projectSeen) { if (eff.instructions) eff.instructions += '\n\n--- project-doc ---'; projectSeen = true; }
    addInstruction(eff, s, why, text, st);
  };
  let remaining = typeof max === 'number' && max >= 0 ? max : 32768;
  const fallbacks = effectiveValue(e, 'project_doc_fallback_filenames', []);
  const names = ['AGENTS.override.md', 'AGENTS.md'];
  for (const n of Array.isArray(fallbacks) ? fallbacks : []) {
    if (typeof n !== 'string' || !n || n === '.' || n === '..' || /[/\0]/.test(n) || process.platform === 'win32' && /[\\:]/.test(n)) { e.findings.push(finding('codex.invalid-fallback', 'warn', user ? locate(user, 'project_doc_fallback_filenames') : { path: ctx.repo, line: 1, column: 1 }, 'Fallback entry is not a bare filename.', 'Codex discards fallback entries with path syntax.', 'Use filenames without path separators.', 'codex')); continue; }
    if (!names.includes(n)) names.push(n);
  }
  for (const dir of dirs) {
    const candidates: Source[] = [];
    for (const name of names) { const s = await ctx.read(path.join(dir, name), 'codex', 'instructions'); if (s) candidates.push(s); }
    const chosen = candidates[0];
    for (const s of candidates) {
      if (s !== chosen) { decision(e, s, 'shadowed', `Codex selects ${path.basename(chosen.path)} before ${path.basename(s.path)} in this directory.`); e.findings.push(finding('codex.override', 'info', locate(s), `${path.basename(chosen.path)} shadows ${path.basename(s.path)}.`, 'Codex selects the first existing regular file per directory, even when the project override is empty.', 'Edit the selected file or remove the override.', 'codex', [locate(chosen)])); continue; }
      if (status !== 'active') { decision(e, s, status, trust === 'untrusted' ? 'Project AGENTS.md is skipped in an explicitly untrusted project in 0.167.2.' : 'Project trust is unknown; use --trust trusted to model a trusted session.', s.text); continue; }
      if (!remaining) { decision(e, s, 'truncated', 'Earlier project sources exhausted project_doc_max_bytes.'); e.findings.push(finding('instructions.budget-exhausted', 'warn', locate(s), 'Instruction source receives no remaining byte budget.', 'Earlier sources exhausted the project instruction limit.', 'Shorten earlier sources or raise project_doc_max_bytes.', 'codex')); continue; }
      if (s.bytes > remaining) {
        truncated(e, s, remaining);
        // Rust String::from_utf8_lossy preserves a replacement character at a split code point.
        const text = Buffer.from(s.text).subarray(0, remaining).toString('utf8');
        addProject(e, s, 'Read prefix at the remaining project byte budget.', text, 'truncated'); e.decisions.at(-1)!.loadedBytes = remaining;
        if (text.trim()) remaining = 0;
      } else { addProject(e, s, 'Selected project instruction in root-to-session order.', s.text); if (s.text.trim()) remaining -= s.bytes; }
    }
  }
  const roots = [...ctx.dirs.map(d => path.join(d, '.agents/skills')), ...(ctx.options.user !== false ? [path.join(ctx.home, '.agents/skills'), path.join(ctx.codexHome, 'skills')] : [])];
  await skills(e, ctx, roots, 'coexist');
  e.notes.push(`Project trust: ${trust}. Project instruction byte limit: ${max}. Global instructions do not consume this budget.`, 'Markdown instructions are accumulated; Sightline does not infer which natural-language statement the model will obey.', 'Codex 0.167.2 source, rather than older documentation summaries, determines empty override and untrusted-project behavior.');
  if (rootIndex < 0) e.notes.push('No configured project-root marker found inside the inspection boundary; Codex checks only the session directory.');
  e.instructionBytes = bytes(e.instructions); return finish(e, ctx);
});
