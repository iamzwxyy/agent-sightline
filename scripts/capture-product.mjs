import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { serveStatic } from './static-server.mjs';
const site = await serveStatic('website/dist');
const browser = await chromium.launch();
mkdirSync('website/public/images', { recursive: true });
mkdirSync('artifacts', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  await page.goto(site.url + '/demo/#view=effective&client=codex');
  await page.locator('.byte-limit-marker').waitFor();
  await page.screenshot({ path: 'website/public/images/instructions.png' });
  await page.screenshot({ path: 'docs/assets/inspector.png' });
  await page.locator('#compare-tab').click();
  await page.screenshot({ path: 'website/public/images/compare.png' });
  await page.locator('#findings-tab').click();
  await page.locator('#findings-list .finding').filter({ hasText: 'Imported instruction file does not exist' }).first().click();
  await page.screenshot({ path: 'website/public/images/finding.png' });
  await page.goto(site.url);
  await page.locator('#demo-sources button').first().waitFor();
  await page.locator('.brand-mark').first().screenshot({ path: 'website/public/favicon.png', omitBackground: true });
  await page.screenshot({ path: 'artifacts/website-desktop.png' });
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.screenshot({ path: 'website/public/social.png' });
  console.log('Captured product sources, findings, comparison and website identity from the working interfaces.');
} finally { await browser.close(); await site.close(); }
