import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { scan } from '../packages/core/index.js';
import { workspace } from './helpers.js';
test('explicit stdio probe initializes and lists tools without invoking one', async t => {
  const code = `import readline from 'node:readline';\nconst r=readline.createInterface({input:process.stdin}); r.on('line',l=>{ const q=JSON.parse(l);if(q.method==='initialize')console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result:{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}}));if(q.method==='tools/list')console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result:{tools:[]}}));if(q.method==='tools/call')process.exit(99);});`;
  const w = await workspace({ 'server.mjs': code, '.mcp.json': JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: ['server.mjs'] } } }) }); t.after(() => rm(w.root, { recursive: true, force: true }));
  const r = await scan({ ...w, clients: ['claude'], trust: 'trusted', probe: true }); assert.ok(r.findings.some(f => f.ruleId === 'probe.mcp-ready'));
});
