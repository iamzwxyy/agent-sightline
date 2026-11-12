import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { scan } from '../packages/core/index.js';
import type { Finding, Report } from '../packages/core/types.js';
import { failed, html, json, terminal } from '../packages/reporter/index.js';
import { workspace } from './helpers.js';

const missingCommand: Finding = {
  id: 'codex-missing-command', ruleId: 'mcp.command-missing', severity: 'error', client: 'codex',
  message: 'MCP command for "db" was not found or is not executable.',
  location: { path: '/repo/.codex/config.toml', line: 3, column: 1, key: 'mcp_servers.db.command' },
  related: [], why: 'The configured executable is unavailable.', suggestion: 'Install the runtime or correct the command.',
};
function reportWithFindings(findings: Finding[] = []): Report {
  return {
    schemaVersion: '1.0', tool: { name: 'Agent Sightline', version: '0.1.2' },
    repository: '/repo', target: '/repo/src/index.ts', sessionDirectory: '/repo/src',
    assumptions: [], sources: [], clients: [], findings, diff: [],
  };
}

test('terminal groups identical client findings at the same source while preserving other source locations', () => {
  const report = reportWithFindings([
    missingCommand,
    { ...missingCommand, id: 'claude-missing-command', client: 'claude' },
    { ...missingCommand, id: 'other-source', client: 'claude', location: { path: '/repo/.mcp.json', line: 4, column: 7, key: 'mcpServers.db.command' } },
  ]);
  const original = structuredClone(report);
  const output = terminal(report);
  assert.match(output, /2 findings\nErrors 2 · Warnings 0 · Info 0/);
  assert.equal(output.match(/^ERROR /gm)?.length, 2);
  assert.ok(output.includes('[codex, claude]'));
  assert.ok(output.includes('/repo/.codex/config.toml:3:1'));
  assert.ok(output.includes('/repo/.mcp.json:4:7'));
  assert.ok(output.includes('Identical findings at the same source are grouped across clients.'));
  assert.ok(!output.includes('Showing '));
  assert.deepEqual(report, original);
  assert.equal(JSON.parse(json(report)).findings.length, 3);
  assert.ok(failed(report, 'error'));
  const explained = terminal(report, 'explain');
  assert.equal(explained.match(/^ERROR /gm)?.length, 3);
});

test('terminal preserves distinct diagnostic details at the same source', () => {
  const variants: Partial<Finding>[] = [
    { location: { ...missingCommand.location, line: 4 } },
    { location: { ...missingCommand.location, column: 12 } },
    { location: { ...missingCommand.location, key: 'mcp_servers.db.args' } },
    { severity: 'warn' },
    { why: 'A different runtime resolution failed.' },
    { suggestion: 'Correct the working directory first.' },
    { related: [{ path: '/repo/other.json', line: 8, column: 2 }] },
  ];
  for (const variant of variants) {
    const output = terminal(reportWithFindings([missingCommand, { ...missingCommand, ...variant, id: 'different-diagnostic' }]));
    assert.ok(output.includes('2 findings'), JSON.stringify(variant));
  }
});

test('terminal distinguishes its summary limit from grouping and reports severity totals for the full list', () => {
  const findings = Array.from({ length: 13 }, (_, index) => ({
    ...missingCommand, id: `finding-${index}`, location: { ...missingCommand.location, line: index + 1 },
  }));
  const output = terminal(reportWithFindings(findings));
  assert.match(output, /13 findings\nErrors 13 · Warnings 0 · Info 0/);
  assert.equal(output.match(/^ERROR /gm)?.length, 12);
  assert.ok(output.includes('Showing 12 of 13 distinct findings. Use --json or explain to inspect the rest.'));
  assert.ok(!output.includes('grouped across clients'));
});

test('terminal renders unique related source locations and gives an empty workspace a usable next step', () => {
  const location = { path: '/repo/.mcp.json', line: 4, column: 7 };
  const output = terminal(reportWithFindings([{ ...missingCommand, related: [missingCommand.location, location, location] }]));
  assert.equal(output.match(/Related \/repo\/\.mcp.json:4:7/g)?.length, 1);
  assert.ok(!output.includes('Related /repo/.codex/config.toml'));
  const empty = terminal(reportWithFindings());
  assert.ok(empty.includes('No agent configuration was discovered in this scan.'));
  assert.ok(empty.includes('agent-sightline demo'));
});

test('HTML is self-contained, inert against script injection, and redacted again at export', async t => {
  const w = await workspace({ 'CLAUDE.md': '</script><img src=x onerror=alert(1)>\nAPI_KEY=private-sentinel' }); t.after(() => rm(w.root, { recursive: true, force: true }));
  const r = await scan({ ...w, clients: ['claude'] });
  // Second redaction boundary also protects caller-provided report mutations.
  r.clients[0].instructions += '\npassword=second-secret';
  for (const output of [html(r), json(r), terminal(r, 'explain')]) { assert.ok(!output.includes('private-sentinel')); assert.ok(!output.includes('second-secret')); }
  const h = html(r); assert.ok(!h.includes('</script><img')); assert.ok(h.includes('\\u003c/script')); assert.ok(h.includes("default-src 'none'")); assert.ok(!h.includes('<script src=')); assert.ok(!h.includes(w.repo));
});
