import path from 'node:path';
import { serve } from '../dist/web/server.js';
import { serveStatic } from './static-server.mjs';
const site = await serveStatic('website/dist', 4173);
const inspector = await serve({ repo: path.resolve('examples/broken-agent-config'), target: 'src/payments/refund.ts', user: false, trust: 'trusted', clients: ['codex', 'claude', 'copilot'] }, 4174);
console.log('Website ' + site.url);
console.log('Inspector ' + inspector.url);
const close = async () => { await site.close(); await inspector.close(); };
process.on('SIGINT', close); process.on('SIGTERM', close);
