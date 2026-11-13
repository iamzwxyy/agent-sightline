import { chromium } from '@playwright/test';
import { cpSync, mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { serveStatic } from './static-server.mjs';

const { values } = parseArgs({ options: { 'website-only': { type: 'boolean', default: false } } });
const site = await serveStatic('website/dist');
const browser = await chromium.launch();
mkdirSync('website/public/images', { recursive: true });
mkdirSync('artifacts', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  if (!values['website-only']) {
    await page.goto(site.url + '/demo/#view=effective&client=codex');
    await page.locator('.byte-limit-marker').waitFor();
    await page.screenshot({ path: 'website/public/images/instructions.png' });
    await page.screenshot({ path: 'docs/assets/inspector.png' });
    await page.locator('#compare-tab').click();
    await page.screenshot({ path: 'website/public/images/compare.png' });
    await page.locator('#findings-tab').click();
    await page.locator('#findings-list .finding').filter({ hasText: 'Imported instruction file does not exist' }).first().click();
    await page.screenshot({ path: 'website/public/images/finding.png' });
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(site.url);
  await page.locator('.hero[data-renderer="webgl"]').waitFor();
  await page.getByRole('button', { name: 'Pause animation', exact: true }).click();
  // Element screenshots include overlapping content, so hide the HTML overlays.
  const overlays = await page.addStyleTag({ content: '.site-header, .hero-copy, .hero-bottom, .motion-toggle { visibility: hidden !important; }' });
  await page.locator('#context-field').screenshot({ path: 'website/public/images/context-field.jpg', type: 'jpeg', quality: 88 });
  await overlays.evaluate(element => element.remove());
  cpSync('website/public/images/context-field.jpg', 'website/dist/images/context-field.jpg');
  await page.close();

  const identity = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await identity.goto(site.url);
  await identity.locator('#demo-sources button').first().waitFor();
  await identity.locator('body').evaluate(element => element.ownerDocument.fonts.ready.then(() => undefined));
  await identity.locator('.hero-poster').evaluate(image => image.decode());
  const mark = await identity.locator('.brand-mark').first().boundingBox();
  if (!mark) throw new Error('The visible website brand mark is required for favicon capture.');
  await identity.screenshot({
    path: 'website/public/favicon.png',
    clip: { x: mark.x - 6, y: mark.y - 6, width: mark.width + 12, height: mark.height + 12 },
  });
  await identity.screenshot({ path: 'artifacts/website-desktop.png' });

  // Capture the full opening at the 1200 × 630 sharing aspect ratio.
  const social = await browser.newPage({ viewport: { width: 1920, height: 1008 }, deviceScaleFactor: 0.625, reducedMotion: 'reduce' });
  await social.goto(site.url);
  await social.locator('#demo-sources button').first().waitFor();
  await social.locator('body').evaluate(element => element.ownerDocument.fonts.ready.then(() => undefined));
  await social.locator('.hero-poster').evaluate(image => image.decode());
  await social.screenshot({ path: 'website/public/social.png' });
  console.log(values['website-only'] ? 'Captured website poster, sharing image and favicon.' : 'Captured product sources, findings, comparison and website identity from the working interfaces.');
} finally { await browser.close(); await site.close(); }
