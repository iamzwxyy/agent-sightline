import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
mkdirSync('docs/assets', { recursive: true });
const stdout = execFileSync(process.execPath, ['dist/cli/index.js', 'demo', '--clients', 'codex,claude,copilot', '--severity', 'warn'], { encoding: 'utf8' });
const excerpt = stdout.split(path.resolve('examples/broken-agent-config')).join('examples/broken-agent-config').split('\n').slice(0, 47).join('\n');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1050, height: 1060 }, deviceScaleFactor: 1 });
  await page.setContent('<html><body style="margin:0;background:#101317;color:#e5eaf1;padding:28px;font:13px/1.6 monospace"><div style="margin-bottom:22px;color:#8bdbbe">$ agent-sightline demo --clients codex,claude,copilot --severity warn</div><pre style="white-space:pre-wrap;margin:0"></pre></body></html>');
  await page.locator('pre').evaluate((el, text) => { el.textContent = text; }, excerpt);
  await page.screenshot({ path: 'docs/assets/terminal.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    execFileSync(process.execPath, ['dist/cli/index.js', 'explain', 'src/payments/refund.ts', '--repo', 'examples/broken-agent-config', '--clients', 'codex,claude,copilot', '--no-user', '--trust', 'trusted', '--format', 'html', '--output', 'docs/example-report.html']);
    await page.goto(pathToFileURL(path.resolve('docs/example-report.html')).href + '#view=effective&client=codex'); await page.locator('#sources .source-dot.truncated').waitFor();
    await page.locator('.source').filter({ hasText: 'AGENTS.override.md' }).click(); await page.screenshot({ path: 'docs/assets/inspector.png' });
} finally { await browser.close(); }
console.log('Captured actual demo output and local inspector screenshots.');
