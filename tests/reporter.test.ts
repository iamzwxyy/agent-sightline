import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { scan } from '../packages/core/index.js';
import { html, json, terminal } from '../packages/reporter/index.js';
import { workspace } from './helpers.js';
test('HTML is self-contained, inert against script injection, and redacted again at export', async t => {
  const w = await workspace({ 'CLAUDE.md': '</script><img src=x onerror=alert(1)>\nAPI_KEY=private-sentinel' }); t.after(() => rm(w.root, { recursive: true, force: true }));
  const r = await scan({ ...w, clients: ['claude'] });
  // Second redaction boundary also protects caller-provided report mutations.
  r.clients[0].instructions += '\npassword=second-secret';
  for (const output of [html(r), json(r), terminal(r, 'explain')]) { assert.ok(!output.includes('private-sentinel')); assert.ok(!output.includes('second-secret')); }
  const h = html(r); assert.ok(!h.includes('</script><img')); assert.ok(h.includes('\\u003c/script')); assert.ok(h.includes("default-src 'none'")); assert.ok(!h.includes('<script src=')); assert.ok(!h.includes(w.repo));
});
