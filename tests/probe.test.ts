import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { scan } from '../packages/core/index.js';
import { workspace } from './helpers.js';
test('explicit stdio probe initializes and lists tools without invoking one', async t => {
  const code = `import readline from 'node:readline';\nconst r=readline.createInterface({input:process.stdin}); r.on('line',l=>{ const q=JSON.parse(l);if(q.method==='initialize')console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result:{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}}));if(q.method==='tools/list')console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result:{tools:[]}}));if(q.method==='tools/call')process.exit(99);});`;
  const w = await workspace({ 'server.mjs': code, '.mcp.json': JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: ['server.mjs'] } } }) }); t.after(() => rm(w.root, { recursive: true, force: true }));
  const r = await scan({ ...w, clients: ['claude'], trust: 'trusted', probe: true }); assert.ok(r.findings.some(f => f.ruleId === 'probe.mcp-ready'));
});
test('Claude stdio probe expands documented environment placeholders', async t => {
  const code = `import readline from 'node:readline'; if(process.env.CHECK!=='fixture-value')process.exit(1);readline.createInterface({input:process.stdin}).on('line',l=>{const q=JSON.parse(l);if(q.id)console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result:q.id===1?{protocolVersion:'2024-11-05'}:{tools:[]}}));});`;
  const w = await workspace({ 'server.mjs': code, '.mcp.json': JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: ['server.mjs'], env: { CHECK: '${SIGHTLINE_PROBE_FLAG}' } } } }) }); t.after(() => rm(w.root, { recursive: true, force: true }));
  const r = await scan({ ...w, env: { ...w.env, SIGHTLINE_PROBE_FLAG: 'fixture-value' }, clients: ['claude'], trust: 'trusted', probe: true }); assert.ok(r.findings.some(f => f.ruleId === 'probe.mcp-ready')); assert.ok(!JSON.stringify(r).includes('fixture-value'));
});

test('a completed probe waits until its process has exited and released the working directory', async t => {
  const code = `import { writeFileSync } from 'node:fs';
import readline from 'node:readline';
writeFileSync('probe.pid', String(process.pid));
setInterval(() => {}, 1000);
process.on('SIGTERM', () => setTimeout(() => process.exit(0), 150));
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.id) console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: request.id === 1 ? { protocolVersion: '2024-11-05' } : { tools: [] } }));
});`;
  const w = await workspace({ 'server.mjs': code, '.mcp.json': JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: ['server.mjs'] } } }) });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['claude'], trust: 'trusted', probe: true });
  assert.ok(report.findings.some(finding => finding.ruleId === 'probe.mcp-ready'));
  const pid = Number(await readFile(path.join(w.repo, 'probe.pid'), 'utf8'));
  assert.throws(() => process.kill(pid, 0), 'The process must be reaped before the probe returns.');
});

test('probe cleanup terminates ordinary runtime-wrapper children', async t => {
  const server = `import { writeFileSync } from 'node:fs';
import readline from 'node:readline';
writeFileSync('server.pid', String(process.pid));
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.id) console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: request.id === 1 ? { protocolVersion: '2024-11-05' } : { tools: [] } }));
});`;
  const wrapper = `import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
writeFileSync('wrapper.pid', String(process.pid));
const server = spawn(process.execPath, ['server.mjs'], { stdio: 'inherit' });
process.on('SIGTERM', () => server.kill());
server.on('exit', () => process.exit(0));`;
  const w = await workspace({ 'server.mjs': server, 'wrapper.mjs': wrapper, '.mcp.json': JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: ['wrapper.mjs'] } } }) });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['claude'], trust: 'trusted', probe: true });
  assert.ok(report.findings.some(finding => finding.ruleId === 'probe.mcp-ready'));
  for (const file of ['wrapper.pid', 'server.pid']) {
    const pid = Number(await readFile(path.join(w.repo, file), 'utf8'));
    assert.throws(() => process.kill(pid, 0), file);
  }
});

test('probe cleanup escalates when a server ignores SIGTERM', { skip: process.platform === 'win32', timeout: 10000 }, async t => {
  const code = `import { writeFileSync } from 'node:fs';
import readline from 'node:readline';
writeFileSync('probe.pid', String(process.pid));
setInterval(() => {}, 1000);
process.on('SIGTERM', () => {});
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.id) console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: request.id === 1 ? { protocolVersion: '2024-11-05' } : { tools: [] } }));
});`;
  const w = await workspace({ 'server.mjs': code, '.mcp.json': JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: ['server.mjs'] } } }) });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['claude'], trust: 'trusted', probe: true });
  assert.ok(report.findings.some(finding => finding.ruleId === 'probe.mcp-ready'));
  const pid = Number(await readFile(path.join(w.repo, 'probe.pid'), 'utf8'));
  assert.throws(() => process.kill(pid, 0));
});

test('Windows command shims preserve literal arguments during an explicit probe', { skip: process.platform !== 'win32' }, async t => {
  const args = ['has spaces', 'literal&value', 'quoted"value', 'has(parentheses)'];
  const code = `import assert from 'node:assert/strict';
import readline from 'node:readline';
assert.deepEqual(process.argv.slice(2), ${JSON.stringify(args)});
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.id) console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: request.id === 1 ? { protocolVersion: '2024-11-05' } : { tools: [] } }));
});`;
  const shim = `@echo off\r\n"${process.execPath}" "%~dp0..\\..\\server file.mjs" %*\r\n`;
  const w = await workspace({ 'server file.mjs': code, 'node_modules/.bin/probe.cmd': shim, '.mcp.json': JSON.stringify({ mcpServers: { fixture: { command: './node_modules/.bin/probe.cmd', args } } }) });
  t.after(() => rm(w.root, { recursive: true, force: true }));
  const report = await scan({ ...w, user: false, clients: ['claude'], trust: 'trusted', probe: true });
  assert.ok(report.findings.some(finding => finding.ruleId === 'probe.mcp-ready'));
});
