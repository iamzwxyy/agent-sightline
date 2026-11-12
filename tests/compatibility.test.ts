import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { rm, symlink, writeFile } from 'node:fs/promises';
import { scan } from '../packages/core/index.js';
import { workspace } from './helpers.js';
test('Codex rejects unknown and wrong-type fields via pinned schema', async t => {
  const w = await workspace({ '.codex/config.toml': 'project_doc_max_bytes=-1\nmisspelled_field=true' }); t.after(() => rm(w.root, { recursive: true, force: true }));
  const r = await scan({ ...w, clients: ['codex'], trust: 'trusted' }); assert.ok(r.findings.some(f => f.ruleId === 'config.schema')); assert.ok(r.clients[0].decisions.some(d => d.kind === 'settings' && d.status === 'invalid'));
});
test('Codex server tables deep merge and retain command/argument provenance', async t => {
  const w = await workspace({ '.codex/config.toml': '[mcp_servers.db]\nargs=["project"]\n[mcp_servers.db.env]\nPROJECT="private-project"' }, { '.codex/config.toml': '[mcp_servers.db]\ncommand="node"\nargs=["user"]\n[mcp_servers.db.env]\nUSER="private-user"' }); t.after(() => rm(w.root, { recursive: true, force: true }));
  const r = await scan({ ...w, clients: ['codex'], trust: 'trusted' }); const x = r.clients[0].extensions.find(x => x.kind === 'mcp' && x.status === 'active')!;
  assert.equal(x.config.command, 'node'); assert.deepEqual(x.config.args, ['project']); assert.deepEqual(Object.keys(x.config.env).sort(), ['PROJECT', 'USER']); assert.ok(r.findings.some(f => f.ruleId === 'mcp.redefined'));
  assert.ok(r.clients[0].settings.find(s => s.key === 'mcp_servers.db.command' && s.status === 'active')!.location.path.startsWith(w.home));
});
test('skill priorities distinguish Codex coexistence, Claude personal and Copilot project', async t => {
  const skill = (desc: string) => `---\nname: deploy\ndescription: ${desc}\n---\nBody is only invoked explicitly.\n`;
  const w = await workspace({ '.agents/skills/deploy/SKILL.md': skill('repo-codex'), '.claude/skills/deploy/SKILL.md': skill('repo-claude'), '.github/skills/deploy/SKILL.md': skill('repo-copilot') }, { '.agents/skills/deploy/SKILL.md': skill('user-codex'), '.claude/skills/deploy/SKILL.md': skill('user-claude'), '.copilot/skills/deploy/SKILL.md': skill('user-copilot') }); t.after(() => rm(w.root, { recursive: true, force: true }));
  const r = await scan({ ...w, clients: ['codex', 'claude', 'copilot'], trust: 'trusted' });
  assert.equal(r.clients[0].extensions.filter(x => x.kind === 'skill' && x.status === 'active').length, 2);
  assert.equal(r.clients[1].extensions.find(x => x.kind === 'skill' && x.status === 'active')!.config.description, 'user-claude');
  assert.equal(r.clients[2].extensions.find(x => x.kind === 'skill' && x.status === 'active')!.config.description, 'repo-copilot');
  assert.ok(r.clients.every(e => !e.instructions.includes('Body is only'))); assert.ok(r.findings.some(f => f.ruleId === 'skill.name-conflict'));
});
test('invalid Copilot MCP sibling does not hide a valid sibling', async t => {
  const w = await workspace({ '.mcp.json': '{"mcpServers":{"bad":3,"good":{"command":"node"}}}' }); t.after(() => rm(w.root, { recursive: true, force: true }));
  const r = await scan({ ...w, clients: ['copilot'], trust: 'trusted' }); assert.ok(r.clients[0].extensions.some(x => x.name === 'good' && x.status === 'active')); assert.ok(r.clients[0].extensions.some(x => x.name === 'bad' && x.status === 'invalid'));
});
test('Claude exclusions and raw JSON imports preserve client instruction semantics', async t => {
  const w = await workspace({ 'CLAUDE.md': '@raw.json\n', 'raw.json': '{not valid JSON but valid instruction text}', '.claude/rules/no.md': 'excluded-rule', '.claude/settings.json': '{"claudeMdExcludes":["**/.claude/rules/**"]}' }); t.after(() => rm(w.root, { recursive: true, force: true }));
  const r = await scan({ ...w, clients: ['claude'] }); assert.ok(r.clients[0].instructions.includes('not valid JSON')); assert.ok(!r.clients[0].instructions.includes('excluded-rule')); assert.ok(!r.findings.some(f => f.ruleId.startsWith('parse.')));
});
test('user instruction imports stay inside documented config root', async t => {
  const w = await workspace({}, { '.claude/CLAUDE.md': '@../private.md\n', 'private.md': 'DO_NOT_READ_USER_PRIVATE' }); t.after(() => rm(w.root, { recursive: true, force: true }));
  const r = await scan({ ...w, clients: ['claude'] }); assert.ok(!JSON.stringify(r).includes('DO_NOT_READ_USER_PRIVATE')); assert.ok(r.findings.some(f => f.ruleId === 'include.outside-scope'));
});
test('repeated canonical imports are diagnosed and loaded once', { skip: process.platform === 'win32' }, async t => {
  const w = await workspace({ 'CLAUDE.md': '@policy.md\n@alias.md', 'policy.md': 'canonical policy body' }); t.after(() => rm(w.root, { recursive: true, force: true }));
  await symlink(path.join(w.repo, 'policy.md'), path.join(w.repo, 'alias.md')); const r = await scan({ ...w, clients: ['claude'] }); assert.equal(r.clients[0].instructions.split('canonical policy body').length, 2); assert.ok(r.findings.some(f => f.ruleId === 'include.duplicate'));
});
test('Codex global/project separator and bytes reflect versioned source', async t => {
  const w = await workspace({ 'AGENTS.md': 'project' }, { '.codex/AGENTS.md': 'global' }); t.after(() => rm(w.root, { recursive: true, force: true }));
  const r = await scan({ ...w, clients: ['codex'], trust: 'trusted' }); assert.equal(r.clients[0].instructions, 'global\n\n--- project-doc ---\n\nproject');
  await writeFile(path.join(w.repo, 'AGENTS.override.md'), ''); const empty = await scan({ ...w, clients: ['codex'], trust: 'trusted' }); assert.equal(empty.clients[0].instructions, 'global');
});
