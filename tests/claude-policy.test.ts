import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { claude } from '../packages/adapters/claude.js';
import { discoverClaudeManagedSettings } from '../packages/adapters/claude-policy.js';
import { discoverRepository, makeContext } from '../packages/core/discovery.js';
import { workspace } from './helpers.js';

async function policyFixture(t: test.TestContext, policy: Record<string, unknown>, user: Record<string, unknown> = {}, project: Record<string, unknown> = {}, extra: Record<string, string> = {}) {
  const files = Object.fromEntries(Object.entries(policy).map(([name, data]) => ['managed/' + name, typeof data === 'string' ? data : JSON.stringify(data, null, 2)]));
  const w = await workspace({ '.claude/settings.json': JSON.stringify(project, null, 2), ...extra }, { '.claude/settings.json': JSON.stringify(user, null, 2), ...files });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const ctx = await makeContext({ ...w, trust: 'trusted', clients: ['claude'] });
  await discoverRepository(ctx);
  await claude.discover(ctx);
  await discoverClaudeManagedSettings(ctx, path.join(w.home, 'managed'));
  const effective = await claude.resolveForTarget(ctx);
  effective.findings.push(...await claude.validate(ctx, effective));
  return { ...w, ctx, effective };
}

test('Claude discovers immediate nonhidden JSON policy drop-ins in deterministic order', async t => {
  const { effective, home } = await policyFixture(t, {
    'managed-settings.json': { model: 'base-model', permissions: { deny: ['Read'] } },
    'managed-settings.d/20-later.json': { model: 'later-model', permissions: { deny: ['Read', 'Edit'] } },
    'managed-settings.d/10-earlier.json': { model: 'earlier-model', permissions: { deny: ['Bash'] } },
    'managed-settings.d/.hidden.json': { model: 'hidden-model' },
    'managed-settings.d/30-wrong.JSON': { model: 'uppercase-model' },
    'managed-settings.d/40-wrong.jsonc': { model: 'jsonc-model' },
    'managed-settings.d/nested/50-nested.json': { model: 'nested-model' },
  });
  const active = (key: string) => effective.settings.find(setting => setting.key === key && setting.status === 'active')!;
  assert.equal(active('model').value, 'later-model');
  assert.deepEqual(active('permissions.deny').value, ['Read', 'Bash', 'Edit']);
  assert.equal(active('model').location.path, path.join(home, 'managed/managed-settings.d/20-later.json'));
  assert.deepEqual(effective.decisions.filter(decision => decision.scope === 'system').map(decision => path.basename(decision.path)), ['managed-settings.json', '10-earlier.json', '20-later.json']);
});

test('Claude managed permission lock excludes every ordinary rule list and retains grant metadata and policy origins', async t => {
  const { effective, ctx, repo, home } = await policyFixture(t, {
    'managed-settings.json': { allowManagedPermissionRulesOnly: true, permissions: { allow: ['Read'] } },
  }, { permissions: { allow: ['Bash'], ask: ['Read'], deny: ['Read'], additionalDirectories: ['../docs'] } }, { permissions: { allow: ['Edit'] } }, {
    '.claude/skills/fixture/SKILL.md': '---\nname: fixture\ndescription: Policy fixture.\nallowed-tools: Bash\n---\nUse the approved tool.\n',
  });
  const rules = effective.extensions.filter(extension => extension.kind === 'permission');
  assert.equal(rules.filter(rule => rule.status === 'ignored').length, 4);
  assert.equal(rules.find(rule => rule.location.path.includes('managed'))?.status, 'active');
  assert.ok(rules.filter(rule => rule.status === 'ignored').every(rule => rule.origins?.[0].location.key === 'allowManagedPermissionRulesOnly'));
  assert.deepEqual(effective.settings.find(setting => setting.key === 'permissions.allow' && setting.status === 'active')?.value, ['Read']);
  assert.deepEqual(effective.settings.find(setting => setting.key === 'permissions.additionalDirectories' && setting.status === 'active')?.value, ['../docs']);
  assert.ok(!effective.findings.some(finding => finding.ruleId.startsWith('permission.')));
  const skill = effective.extensions.find(extension => extension.kind === 'skill')!;
  assert.equal(skill.status, 'active');
  assert.equal(skill.config['allowed-tools'], undefined);
  assert.equal(ctx.sources.find(source => source.path === path.join(repo, '.claude/skills/fixture/SKILL.md'))?.data['allowed-tools'], 'Bash');
  const ignored = effective.findings.find(finding => finding.ruleId === 'claude.skill-tools-ignored')!;
  assert.equal(ignored.location.line, 4);
  assert.equal(ignored.related[0].path, path.join(home, 'managed/managed-settings.json'));
});

test('Claude managed locks accept documented coercions, fail closed and honor later false values', async t => {
  for (const [value, restricted] of [[true, true], [false, false], ['true', true], ['false', false], [42, true], [null, false]] as const) {
    const { effective } = await policyFixture(t, { 'managed-settings.json': { allowManagedPermissionRulesOnly: value } }, { permissions: { allow: ['Read'] } });
    assert.equal(effective.extensions.find(extension => extension.kind === 'permission')?.status, restricted ? 'ignored' : 'active', String(value));
  }
  const { effective } = await policyFixture(t, {
    'managed-settings.json': { allowManagedPermissionRulesOnly: true },
    'managed-settings.d/20-unlock.json': { allowManagedPermissionRulesOnly: false },
  }, { permissions: { allow: ['Read'] } });
  assert.equal(effective.extensions.find(extension => extension.kind === 'permission')?.status, 'active');
});

test('Claude ignores managed-only flags in ordinary scopes', async t => {
  const { effective } = await policyFixture(t, {}, { allowManagedPermissionRulesOnly: true, allowManagedHooksOnly: true, permissions: { allow: ['Read'] }, hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo safe' }] }] } });
  assert.ok(effective.extensions.every(extension => extension.status === 'active'));
  assert.equal(effective.findings.filter(finding => finding.ruleId === 'claude.managed-only').length, 2);
  assert.ok(effective.settings.filter(setting => setting.key.startsWith('allowManaged')).every(setting => setting.status === 'ignored'));
});

test('Claude hook disable precedence and managed hook protection retain controlling sources', async t => {
  const hook = { SessionStart: [{ hooks: [{ type: 'command', command: 'missing-disabled-policy-fixture' }] }] };
  const cases = [
    { managed: {}, user: true, project: undefined, ordinary: 'ignored', system: 'active' },
    { managed: {}, user: true, project: false, ordinary: 'active', system: 'active' },
    { managed: { disableAllHooks: false }, user: true, project: undefined, ordinary: 'active', system: 'active' },
    { managed: { disableAllHooks: true }, user: false, project: false, ordinary: 'ignored', system: 'ignored' },
    { managed: { allowManagedHooksOnly: true }, user: false, project: false, ordinary: 'ignored', system: 'active' },
    { managed: { disableAllHooks: 'true' }, user: false, project: undefined, ordinary: 'active', system: 'active' },
  ];
  for (const scenario of cases) {
    const { effective } = await policyFixture(t, { 'managed-settings.json': { ...scenario.managed, hooks: hook } }, { disableAllHooks: scenario.user, hooks: hook }, { disableAllHooks: scenario.project, hooks: hook });
    const hooks = effective.extensions.filter(extension => extension.kind === 'hook');
    for (const entry of hooks) {
      const expected = entry.location.path.includes('managed') ? scenario.system : scenario.ordinary;
      assert.equal(entry.status, expected, JSON.stringify(scenario));
      if (entry.status === 'ignored') assert.equal(entry.origins?.length, 1);
    }
    assert.equal(effective.findings.filter(finding => finding.ruleId === 'hook.command-missing').length, (scenario.ordinary === 'active' ? 2 : 0) + (scenario.system === 'active' ? 1 : 0));
  }
});

test('Claude repairs supported managed permission entries and withholds grants beside an unreadable restriction', async t => {
  const { effective } = await policyFixture(t, { 'managed-settings.json': { permissions: { allow: ['Read'], additionalDirectories: ['../docs'], deny: 42, ask: ['Edit', 7] } } });
  assert.ok(!effective.extensions.some(extension => extension.config.action === 'allow'));
  assert.equal(effective.extensions.find(extension => extension.name === 'Edit')?.status, 'active');
  assert.ok(!effective.settings.some(setting => setting.key === 'permissions.additionalDirectories' && setting.status === 'active'));
  assert.equal(effective.findings.filter(finding => finding.ruleId === 'claude.managed-grants-withheld').length, 2);
});

test('Claude empty managed files and directory-shaped drop-ins contribute no policy', async t => {
  const { effective, ctx, home } = await policyFixture(t, { 'managed-settings.json': '' });
  await mkdir(path.join(home, 'managed/managed-settings.d/directory.json'), { recursive: true });
  await discoverClaudeManagedSettings(ctx, path.join(home, 'managed'));
  assert.ok(!effective.findings.some(finding => finding.severity === 'error'));
  assert.equal(ctx.sources.filter(source => source.scope === 'system').length, 1);
});

test('Malformed Claude managed policy blocks effective contributions from otherwise valid sources', async t => {
  for (const content of ['{ broken JSON', '[]', 'null']) {
    const { effective } = await policyFixture(t, { 'managed-settings.json': content }, { permissions: { allow: ['Read'] } }, {}, { 'CLAUDE.md': 'Project instructions.' });
    assert.ok(effective.findings.some(finding => finding.ruleId === 'claude.managed-policy-invalid'));
    assert.equal(effective.instructions, '');
    assert.ok(effective.extensions.every(extension => extension.status === 'ignored'));
    assert.ok(effective.decisions.filter(decision => decision.kind === 'instructions').every(decision => decision.status === 'ignored' && decision.loadedBytes === 0));
  }
});
