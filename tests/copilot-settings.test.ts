import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { scan } from '../packages/core/index.js';
import { workspace } from './helpers.js';

test('Copilot repository and local JSONC settings preserve directional merges and origins', async t => {
  const w = await workspace({
    '.github/copilot/settings.json': JSON.stringify({ model: 'repository-model', disabledSkills: ['repository', 'same'], deniedUrls: ['repo.example'], respectGitignore: false, enabledPlugins: { shared: false, repo: true }, extraKnownMarketplaces: { shared: { source: { source: 'directory', path: 'repository' } }, repository: { source: { source: 'directory', path: 'repository-only' }, autoUpdate: true } } }, null, 2),
    '.github/copilot/settings.local.json': '{// local override\n"model":"local-model","disabledSkills":["local","same"],"includeCoAuthoredBy":false,}',
    'src/.github/copilot/settings.json': '{"model":"ignored-nested-model"}',
    'src/refund.ts': '',
  }, { '.copilot/settings.json': JSON.stringify({ model: 'personal-model', disabledSkills: ['personal'], deniedUrls: ['user.example'], respectGitignore: true, enabledPlugins: { shared: true, personal: true }, extraKnownMarketplaces: { shared: { source: { source: 'directory', path: 'personal' }, autoUpdate: true }, retained: { source: { source: 'directory', path: 'retained' } } } }) });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, clients: ['copilot'], target: 'src/refund.ts', trust: 'trusted' });
  const settings = report.clients[0].settings;
  const active = (key: string) => settings.find(setting => setting.key === key && setting.status === 'active');
  assert.equal(active('model')?.value, 'local-model');
  assert.equal(active('model')?.location.line, 2);
  assert.equal(active('model')?.location.path, path.join(w.repo, '.github/copilot/settings.local.json'));
  assert.deepEqual(active('model')?.overrides.map(location => location.path), [path.join(w.home, '.copilot/settings.json'), path.join(w.repo, '.github/copilot/settings.json')]);
  assert.deepEqual(active('disabledSkills')?.value, ['personal', 'repository', 'same', 'local']);
  assert.deepEqual(active('deniedUrls')?.value, ['user.example', 'repo.example']);
  assert.equal(active('respectGitignore')?.value, true);
  assert.equal(active('includeCoAuthoredBy')?.value, false);
  assert.equal(active('enabledPlugins.shared')?.value, false);
  assert.equal(active('enabledPlugins.personal')?.location.path, path.join(w.home, '.copilot/settings.json'));
  assert.equal(active('extraKnownMarketplaces.shared.source.path')?.value, 'repository');
  assert.equal(active('extraKnownMarketplaces.shared.autoUpdate'), undefined);
  assert.equal(active('extraKnownMarketplaces.retained.source.path')?.value, 'retained');
  assert.ok(settings.some(setting => setting.key === 'extraKnownMarketplaces.repository.autoUpdate' && setting.status === 'ignored'));
  assert.ok(report.clients[0].decisions.some(decision => decision.path === path.join(w.repo, 'src/.github/copilot/settings.json') && decision.status === 'ignored'));
  assert.ok(!report.findings.some(finding => finding.severity === 'error'));
});

test('Copilot model overrides retain conditional, explicit and persisted trust states', async t => {
  const w = await workspace({ '.github/copilot/settings.json': '{"model":"repository-model","effortLevel":"high","contextTier":"long_context"}' }, { '.copilot/settings.json': '{"model":"personal-model"}' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const unknown = await scan({ ...w, clients: ['copilot'] });
  assert.equal(unknown.clients[0].settings.find(setting => setting.key === 'model' && setting.status === 'active')?.value, 'personal-model');
  assert.ok(unknown.clients[0].settings.some(setting => setting.key === 'model' && setting.value === 'repository-model' && setting.status === 'conditional'));
  await writeFile(path.join(w.home, '.copilot/config.json'), JSON.stringify({ trustedFolders: [w.repo], sessionHistory: ['private-account-history-sentinel'] }));
  const remembered = await scan({ ...w, clients: ['copilot'] });
  assert.equal(remembered.clients[0].settings.find(setting => setting.key === 'model' && setting.status === 'active')?.value, 'repository-model');
  assert.ok(!JSON.stringify(remembered).includes('private-account-history-sentinel'));
  const untrusted = await scan({ ...w, clients: ['copilot'], trust: 'untrusted' });
  assert.equal(untrusted.clients[0].settings.find(setting => setting.key === 'model' && setting.status === 'active')?.value, 'personal-model');
  assert.ok(untrusted.clients[0].settings.some(setting => setting.key === 'model' && setting.status === 'ignored'));
});

test('Copilot rejects malformed setting subtrees while retaining valid siblings and lower layers', async t => {
  const w = await workspace({ '.github/copilot/settings.json': '{\n"model":42,\n"disabledSkills":["valid",42],\n"enabledPlugins":{"bad":"yes"},\n"disableAllHooks":true,\n"theme":"dim",\n"$schema":"https://example.test/schema"\n}' }, { '.copilot/settings.json': '{"model":"personal-model","disabledSkills":["personal"]}' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, clients: ['copilot'], trust: 'trusted' });
  const settings = report.clients[0].settings;
  assert.equal(settings.find(setting => setting.key === 'model' && setting.status === 'active')?.value, 'personal-model');
  assert.deepEqual(settings.find(setting => setting.key === 'disabledSkills' && setting.status === 'active')?.value, ['personal']);
  assert.equal(settings.find(setting => setting.key === 'disableAllHooks' && setting.status === 'active')?.value, true);
  assert.equal(settings.find(setting => setting.key === 'theme')?.status, 'ignored');
  const malformed = report.findings.filter(finding => finding.ruleId === 'copilot.setting-type');
  assert.deepEqual(malformed.map(finding => finding.location.line), [2, 3, 4]);
  assert.equal(malformed.find(finding => finding.location.line === 3)?.location.key, 'disabledSkills.1');
  assert.equal(malformed.find(finding => finding.location.line === 4)?.location.key, 'enabledPlugins.bad');
  assert.equal(report.findings.find(finding => finding.ruleId === 'copilot.setting-scope')?.location.line, 6);
  assert.ok(!report.findings.some(finding => finding.location.key === '$schema'));
});

test('Copilot disabled settings suppress extension startup findings and match skill names without case', async t => {
  const skill = '---\nname: Deploy\ndescription: Deployment fixture\n---\n';
  const w = await workspace({
    '.github/copilot/settings.json': '{"disabledMcpServers":["disabled"],"disabledSkills":["deploy"],"disableAllHooks":true}',
    '.mcp.json': '{"mcpServers":{"disabled":{"command":"missing-disabled-copilot-command"},"enabled":{"command":"missing-enabled-copilot-command"}}}',
    '.github/hooks/test.json': '{"version":1,"hooks":{"sessionStart":[{"type":"command","bash":"missing-disabled-hook","powershell":"missing-disabled-hook"}]}}',
    '.github/skills/deploy/SKILL.md': skill,
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, clients: ['copilot'], user: false, trust: 'trusted' });
  const extensions = report.clients[0].extensions;
  assert.equal(extensions.find(extension => extension.name === 'disabled')?.status, 'ignored');
  assert.equal(extensions.find(extension => extension.name === 'Deploy')?.status, 'ignored');
  assert.equal(extensions.find(extension => extension.kind === 'hook')?.status, 'ignored');
  assert.ok(report.clients[0].decisions.some(decision => decision.kind === 'skill' && decision.status === 'ignored' && decision.reason.includes('disabledSkills')));
  assert.equal(report.findings.filter(finding => finding.ruleId === 'mcp.command-missing').length, 1);
  assert.ok(!report.findings.some(finding => finding.ruleId === 'hook.command-missing'));
});

test('Copilot respectGitignore retains its true default and can preserve a personal opt-out', async t => {
  const w = await workspace({ '.github/copilot/settings.json': '{"respectGitignore":false}' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, clients: ['copilot'], user: false });
  assert.equal(report.clients[0].settings.find(setting => setting.key === 'respectGitignore' && setting.status === 'active')?.value, true);
  await mkdir(path.join(w.home, '.copilot'));
  await writeFile(path.join(w.home, '.copilot/settings.json'), '{"respectGitignore":false}');
  const personal = await scan({ ...w, clients: ['copilot'] });
  assert.equal(personal.clients[0].settings.find(setting => setting.key === 'respectGitignore' && setting.status === 'active')?.value, false);
  await writeFile(path.join(w.repo, '.github/copilot/settings.json'), '{"respectGitignore":true}');
  const tightened = await scan({ ...w, clients: ['copilot'] });
  assert.equal(tightened.clients[0].settings.find(setting => setting.key === 'respectGitignore' && setting.status === 'active')?.value, true);
});

test('Copilot loads the shared Claude subset while each client keeps its JSON syntax rules', async t => {
  const content = '{// accepted by Copilot\n"disableAllHooks":true,\n"model":"claude-only-model",\n"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"missing-shared-hook"}]}]},\n"env":{"NORMAL":"shared-jsonc-private-sentinel"},\n}';
  const w = await workspace({ '.claude/settings.json': content }, { '.copilot/settings.json': '{"model":"personal-copilot-model"}' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const copilot = await scan({ ...w, clients: ['copilot'] });
  assert.ok(!copilot.findings.some(finding => finding.ruleId === 'parse.json'));
  assert.equal(copilot.clients[0].settings.find(setting => setting.key === 'model' && setting.status === 'active')?.value, 'personal-copilot-model');
  assert.ok(copilot.clients[0].settings.some(setting => setting.key === 'model' && setting.status === 'ignored' && setting.location.path === path.join(w.repo, '.claude/settings.json')));
  assert.equal(copilot.clients[0].extensions.find(extension => extension.kind === 'hook')?.status, 'ignored');
  assert.ok(!JSON.stringify(copilot).includes('shared-jsonc-private-sentinel'));
  const both = await scan({ ...w, clients: ['claude', 'copilot'] });
  assert.ok(both.findings.filter(finding => finding.ruleId === 'parse.json').every(finding => finding.client === 'claude'));
  assert.ok(both.clients[0].decisions.some(decision => decision.status === 'invalid' && decision.path === path.join(w.repo, '.claude/settings.json')));
  assert.equal(both.clients[1].extensions.find(extension => extension.kind === 'hook')?.status, 'ignored');
  assert.ok(!JSON.stringify(both).includes('shared-jsonc-private-sentinel'));
});

test('Copilot same-scope shared conflicts remain conditional and a local override resolves them', async t => {
  const w = await workspace({
    '.claude/settings.json': '{"disableAllHooks":true,"enabledPlugins":{"fixture":true}}',
    '.github/copilot/settings.json': '{"disableAllHooks":false,"enabledPlugins":{"fixture":false}}',
    '.github/hooks/test.json': '{"version":1,"hooks":{"sessionStart":[{"command":"echo fixture"}]}}',
  }, { '.copilot/settings.json': '{"disableAllHooks":true}' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const unknown = await scan({ ...w, clients: ['copilot'] });
  assert.equal(unknown.findings.filter(finding => finding.ruleId === 'copilot.shared-setting-order').length, 2);
  assert.equal(unknown.clients[0].settings.filter(setting => setting.key === 'disableAllHooks' && setting.status === 'conditional').length, 2);
  assert.ok(!unknown.clients[0].settings.some(setting => setting.key === 'disableAllHooks' && setting.status === 'active'));
  assert.equal(unknown.clients[0].extensions.find(extension => extension.kind === 'hook')?.status, 'conditional');
  await writeFile(path.join(w.repo, '.github/copilot/settings.local.json'), '{"disableAllHooks":true,"enabledPlugins":{"fixture":true}}');
  const resolved = await scan({ ...w, clients: ['copilot'] });
  assert.equal(resolved.clients[0].settings.find(setting => setting.key === 'disableAllHooks' && setting.status === 'active')?.value, true);
  assert.equal(resolved.clients[0].settings.find(setting => setting.key === 'disableAllHooks' && setting.status === 'active')?.overrides.length, 3);
  assert.equal(resolved.clients[0].settings.filter(setting => setting.key === 'disableAllHooks' && setting.status === 'conditional').length, 0);
  assert.equal(resolved.clients[0].extensions.find(extension => extension.kind === 'hook')?.status, 'ignored');
  assert.ok(!resolved.findings.some(finding => finding.ruleId === 'copilot.shared-setting-order'));
});

test('Copilot inline hooks retain source lines, direct executables and repository-root working directories', async t => {
  const w = await workspace({
    '.github/copilot/settings.json': '{\n"hooks":{"sessionStart":[\n{"exec":"missing-inline-direct-hook","args":[],"cwd":"scripts"},\n{"command":"echo fallback"},\n{"type":"http","url":"https://example.test/hook"},\n{"type":"prompt","prompt":"Only a fresh interactive session"}\n]}}',
    'scripts/fixture.txt': '', 'src/refund.ts': '',
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, clients: ['copilot'], user: false, target: 'src/refund.ts' });
  assert.equal(report.clients[0].extensions.filter(extension => extension.kind === 'hook').length, 4);
  assert.equal(report.findings.find(finding => finding.ruleId === 'hook.command-missing')?.location.line, 3);
  assert.ok(!report.findings.some(finding => finding.ruleId === 'extension.cwd-missing' || finding.ruleId === 'hook.unsupported-type'));
  assert.equal(report.clients[0].extensions.find(extension => extension.config.type === 'prompt')?.status, 'conditional');
  assert.equal(report.clients[0].extensions.find(extension => extension.config.type === 'http')?.status, 'active');
});

test('Copilot rejects a malformed inline hook field while preserving independent hook files', async t => {
  const w = await workspace({
    '.github/copilot/settings.json': '{"hooks":{"sessionStart":[{"command":42},{"command":"missing-rejected-inline-sibling"}]}}',
    '.github/hooks/test.json': '{"version":1,"hooks":{"sessionStart":[{"command":"echo independent"}]}}',
  });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, clients: ['copilot'], user: false });
  assert.ok(report.findings.some(finding => finding.ruleId === 'copilot.setting-type' && finding.location.key === 'hooks.sessionStart.0.command'));
  assert.equal(report.clients[0].extensions.filter(extension => extension.kind === 'hook').length, 1);
  assert.ok(!report.findings.some(finding => finding.ruleId === 'hook.command-missing'));
});

test('Copilot custom discovery declarations retain incomplete coverage until a local list clears them', async t => {
  const w = await workspace({ '.github/copilot/settings.json': '{"skillDirectories":["vendor/skills"]}' });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const unresolved = await scan({ ...w, clients: ['copilot'], user: false });
  assert.equal(unresolved.discovery?.complete, false);
  assert.ok(unresolved.findings.some(finding => finding.ruleId === 'copilot.customization-locations'));
  assert.ok(!unresolved.findings.some(finding => finding.ruleId === 'copilot.setting-scope'));
  await writeFile(path.join(w.repo, '.github/copilot/settings.local.json'), '{"skillDirectories":[]}');
  const cleared = await scan({ ...w, clients: ['copilot'], user: false });
  assert.equal(cleared.discovery?.complete, true);
  assert.ok(!cleared.findings.some(finding => finding.ruleId === 'copilot.customization-locations'));
  await writeFile(path.join(w.repo, '.github/copilot/settings.local.json'), '{"skillDirectories":[42]}');
  const invalid = await scan({ ...w, clients: ['copilot'], user: false });
  assert.ok(invalid.findings.some(finding => finding.ruleId === 'copilot.setting-type' && finding.location.key === 'skillDirectories.0'));
  assert.equal(invalid.discovery?.complete, false);
});
