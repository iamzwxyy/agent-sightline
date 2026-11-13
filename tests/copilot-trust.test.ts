import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { scan } from '../packages/core/index.js';
import { html, json, terminal } from '../packages/reporter/index.js';
import { trustCases, trustWorkspace } from './copilot-trust-fixture.js';

test('Copilot saved trust follows canonical directory boundaries, aliases and complete list validation', async t => {
  const w = await trustWorkspace();
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  const stateFile = path.join(w.home, '.copilot/config.json');
  for (const fixture of trustCases) {
    const text = JSON.stringify({ ...fixture.state(w), internalValue: 'private-trust-state-sentinel' }, null, 2);
    await writeFile(stateFile, text);
    const report = await scan({ ...w, repo: fixture.cwd ? w[fixture.cwd] : w.alias, clients: ['copilot'] });
    assert.equal(report.clients[0].extensions.find(extension => extension.name === 'fixture')?.status, fixture.trusted ? 'active' : 'conditional', fixture.name);
    assert.equal(report.clients[0].settings.find(setting => setting.key === 'model' && setting.status === 'active')?.value, fixture.trusted ? 'repository-trust-model' : 'personal-trust-model', fixture.name);
    const invalid = report.findings.find(finding => finding.ruleId === 'copilot.trust-type');
    assert.equal(!!invalid, !!fixture.invalidKey, fixture.name);
    if (fixture.invalidKey) {
      assert.equal(invalid?.location.path, stateFile);
      assert.equal(invalid?.location.key, fixture.invalidKey);
      assert.equal(invalid?.location.line, text.split('\n').findIndex(line => line.includes('"' + fixture.invalidKey + '"')) + 1);
    }
    for (const output of [JSON.stringify(report), json(report), terminal(report, 'explain'), html(report)]) assert.ok(!output.includes('private-trust-state-sentinel'));
    await assert.rejects(readFile(path.join(fixture.cwd ? w[fixture.cwd] : w.alias, 'trust-server-started')), { code: 'ENOENT' });
  }
});

test('explicit trust and user exclusion determine whether persisted trust contributes', async t => {
  const w = await trustWorkspace();
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  const file = path.join(w.home, '.copilot/config.json');
  await writeFile(file, JSON.stringify({ trustedFolders: [w.otherAlias] }));
  const excluded = await scan({ ...w, repo: w.alias, clients: ['copilot'], user: false });
  assert.equal(excluded.clients[0].extensions.find(extension => extension.name === 'fixture')?.status, 'conditional');
  const untrusted = await scan({ ...w, repo: w.alias, clients: ['copilot'], trust: 'untrusted' });
  assert.equal(untrusted.clients[0].extensions.find(extension => extension.name === 'fixture')?.status, 'ignored');
  await writeFile(file, '{"trustedFolders":[42]}');
  const trusted = await scan({ ...w, repo: w.alias, clients: ['copilot'], trust: 'trusted' });
  assert.equal(trusted.clients[0].extensions.find(extension => extension.name === 'fixture')?.status, 'active');
  await writeFile(file, '{ broken JSON');
  const invalid = await scan({ ...w, repo: w.alias, clients: ['copilot'] });
  assert.equal(invalid.clients[0].extensions.find(extension => extension.name === 'fixture')?.status, 'conditional');
  assert.ok(invalid.findings.some(finding => finding.ruleId === 'parse.json'));
});

test('an explicit probe skips workspace processes after a symlink leaves a trusted parent', async t => {
  const w = await trustWorkspace();
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  await writeFile(path.join(w.home, '.copilot/config.json'), JSON.stringify({ trustedFolders: [w.repo] }));
  const report = await scan({ ...w, repo: w.escapedDirectory, clients: ['copilot'], probe: true });
  assert.equal(report.clients[0].extensions.find(extension => extension.name === 'fixture')?.status, 'conditional');
  assert.ok(!report.findings.some(finding => finding.ruleId.startsWith('probe.')));
  await assert.rejects(readFile(path.join(w.homeProject, 'trust-server-started')), { code: 'ENOENT' });
});
