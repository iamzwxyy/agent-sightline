import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { rm, writeFile } from 'node:fs/promises';
import { scan } from '../packages/core/index.js';
import { html, json, terminal } from '../packages/reporter/index.js';
import { workspace } from './helpers.js';

const comments = (text: string) => '// Personal configuration\n/* Native Copilot accepts comments here. */\n' + text;
const trailingComma = (text: string) => text.replace(/\n}$/, ',\n}');

test('Copilot personal JSONC state retains persisted workspace trust and keeps internal data private', async t => {
  const w = await workspace({ '.mcp.json': JSON.stringify({ mcpServers: { fixture: { command: process.execPath } } }) }, { '.copilot/config.json': '{}' });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  const state = JSON.stringify({ trustedFolders: [w.repo], internalValue: 'copilot-jsonc-internal-private' }, null, 2);
  for (const transform of [comments, trailingComma, (text: string) => comments(trailingComma(text))]) for (const newline of ['\n', '\r\n']) {
    await writeFile(path.join(w.home, '.copilot/config.json'), transform(state).replaceAll('\n', newline));
    const report = await scan({ ...w, clients: ['copilot'] });
    assert.equal(report.clients[0].extensions.find(extension => extension.name === 'fixture')?.status, 'active');
    const source = report.sources.find(source => source.path === path.join(w.home, '.copilot/config.json'))!;
    assert.equal(source.invalid, false);
    assert.equal(source.preview, undefined);
    assert.ok(!report.findings.some(finding => finding.ruleId === 'parse.json'));
    for (const output of [json(report), html(report), terminal(report, 'explain')]) assert.ok(!output.includes('copilot-jsonc-internal-private'));
  }
  const excluded = await scan({ ...w, clients: ['copilot'], user: false });
  assert.equal(excluded.clients[0].extensions[0].status, 'conditional');
  const untrusted = await scan({ ...w, clients: ['copilot'], trust: 'untrusted' });
  assert.equal(untrusted.clients[0].extensions[0].status, 'ignored');
});

test('Copilot personal MCP JSONC preserves field origins, redacted previews and strict project syntax', async t => {
  const text = '// Personal MCP configuration\n{\n  "mcpServers": {\n    "fixture": {\n      "command": "missing-copilot-jsonc-command",\n      "env": {"NORMAL": "copilot-jsonc-private-\\u0076alue"},\n      "args": ["copilot-jsonc-private-value"],\n    },\n  },\n}';
  const w = await workspace({ '.mcp.json': text }, { '.copilot/mcp-config.json': text });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  for (const newline of ['\n', '\r\n']) {
    await writeFile(path.join(w.home, '.copilot/mcp-config.json'), text.replaceAll('\n', newline));
    const report = await scan({ ...w, clients: ['claude', 'copilot'], trust: 'trusted' });
    const personal = report.sources.find(source => source.path === path.join(w.home, '.copilot/mcp-config.json'))!;
    const project = report.sources.find(source => source.path === path.join(w.repo, '.mcp.json'))!;
    assert.equal(personal.invalid, false);
    assert.equal(project.invalid, true);
    assert.equal(personal.preview?.split('\n').length, text.split('\n').length);
    assert.ok(personal.preview?.startsWith('// Personal MCP configuration'));
    assert.ok(personal.preview?.split('\n')[4].includes('"command"'));
    const copilot = report.clients.find(client => client.client === 'copilot')!;
    assert.equal(copilot.extensions.length, 1);
    assert.equal(copilot.extensions[0].status, 'active');
    assert.equal(copilot.extensions[0].origins?.find(origin => origin.key === 'command')?.location.line, 5);
    assert.ok(report.findings.some(finding => finding.ruleId === 'mcp.command-missing' && finding.location.path === personal.path && finding.location.line === 5));
    assert.ok(!report.findings.some(finding => finding.ruleId === 'parse.json' && finding.location.path === personal.path));
    assert.ok(report.findings.some(finding => finding.ruleId === 'parse.json' && finding.location.path === project.path));
    for (const output of [json(report), html(report), terminal(report, 'explain')]) assert.ok(!output.includes('copilot-jsonc-private-'));
  }
});

test('malformed Copilot personal JSONC retains parse findings and withholds trust and MCP contributions', async t => {
  const w = await workspace({ '.mcp.json': JSON.stringify({ mcpServers: { project: { command: process.execPath } } }) }, { '.copilot/config.json': '{}', '.copilot/mcp-config.json': '{}' });
  t.after(() => rm(w.root, { recursive: true, force: true, maxRetries: 5 }));
  for (const content of ['/* Unclosed comment', '// State\n{"trustedFolders": [', '// Invalid\n{"token": "copilot-malformed-private", "broken": }']) {
    for (const name of ['config.json', 'mcp-config.json']) await writeFile(path.join(w.home, '.copilot', name), content);
    const report = await scan({ ...w, clients: ['copilot'] });
    assert.equal(report.clients[0].extensions.length, 1);
    assert.equal(report.clients[0].extensions[0].status, 'conditional');
    assert.ok(report.findings.some(finding => finding.ruleId === 'parse.json'));
    assert.ok(report.sources.filter(source => source.scope === 'user').every(source => source.invalid && source.preview === undefined));
    assert.ok(!JSON.stringify(report).includes('copilot-malformed-private'));
  }
});
