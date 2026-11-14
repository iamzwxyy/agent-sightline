import { test, expect } from '@playwright/test';
import { serveStatic } from '../../scripts/static-server.mjs';
import { VERSION } from '../../packages/core/version.js';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

test('homepage and guide copy the published one-command repository inspection', async ({ page }) => {
  const server = await serveStatic('website/dist');
  const command = `npx --yes https://github.com/iamzwxyy/agent-sightline/releases/download/v${VERSION}/agent-sightline-${VERSION}.tgz ui`;
  try {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: {
        writeText: async (text: string) => { document.documentElement.dataset.copiedCommand = text; },
      } });
    });
    for (const route of ['/', '/guide.html#install']) {
      await page.goto(server.url + route);
      const copy = page.getByRole('button', { name: 'Copy one-command inspection', exact: true });
      await expect(copy).toHaveAttribute('data-copy', command);
      await expect(copy.locator('..').locator('code')).toHaveText(command);
      await copy.click();
      await expect(page.locator('html')).toHaveAttribute('data-copied-command', command);
      await expect(page.getByRole('status')).toHaveText('Copied to clipboard');
      await page.setViewportSize({ width: 390, height: 844 });
      await copy.scrollIntoViewIfNeeded();
      const bounds = await copy.boundingBox();
      expect(bounds?.width).toBeGreaterThanOrEqual(44);
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.goto(server.url + '/#download');
    const install = page.getByRole('button', { name: 'Copy install command', exact: true });
    await expect(install).toBeHidden();
    await page.getByText('Install the CLI for repeated use', { exact: true }).click();
    await expect(install).toBeVisible();
    await expect(install).toHaveAttribute('data-copy', command.replace('npx --yes', 'npm install -g').replace(/ ui$/, ''));
  } finally { await server.close(); }
});

test('opening motion follows client selection and supports pause and reduced motion', async ({ page }) => {
  const server = await serveStatic('website/dist');
  try {
    await page.goto(server.url);
    await expect(page.locator('#demo-sources button').first()).toBeVisible();
    const supported = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
    const hero = page.locator('.hero');
    if (supported) {
      await expect(hero).toHaveAttribute('data-renderer', 'webgl');
      await page.getByRole('button', { name: 'Pause animation', exact: true }).click();
      await expect(hero).toHaveAttribute('data-motion', 'paused');
      await page.waitForTimeout(850);
      const first = createHash('sha256').update(await page.locator('#context-field').screenshot()).digest('hex');
      await page.waitForTimeout(180);
      expect(createHash('sha256').update(await page.locator('#context-field').screenshot()).digest('hex')).toBe(first);
      await page.getByRole('button', { name: 'Play animation', exact: true }).click();
      await expect(hero).toHaveAttribute('data-motion', 'playing');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(hero).toHaveAttribute('data-motion', 'paused');
      await expect(page.locator('#context-field')).toHaveCount(0);
      await expect(page.locator('.hero-poster')).toBeVisible();
      await expect(page.locator('#motion-toggle')).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.classList.contains('lenis'))).toBe(false);
    }
    await page.getByRole('button', { name: 'Claude Code', exact: true }).focus();
    await expect(page.getByRole('button', { name: 'Claude Code', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(hero).toHaveAttribute('data-client', 'claude');
    await expect(page.locator('#hero-source')).toHaveText('CLAUDE.md');
    await expect(page.locator('#hero-verdict')).toHaveText('Loaded for Claude Code');
    await expect(page.getByRole('tab', { name: 'Claude Code', exact: true })).toHaveAttribute('aria-selected', 'true');
    for (const icon of await page.locator('.client-strip img').all()) {
      expect(await icon.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    }
    await expect(page.locator('.client-strip img')).toHaveCount(6);
  } finally { await server.close(); }
});

test('opening retains its content and client preview when WebGL is unavailable', async ({ page }) => {
  const server = await serveStatic('website/dist');
  try {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type: string, ...options: any[]) {
        if (['webgl', 'webgl2', 'experimental-webgl'].includes(type)) return null;
        return (original as any).call(this, type, ...options);
      };
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(server.url);
    await expect(page.locator('.hero')).toHaveAttribute('data-renderer', 'static');
    await expect(page.getByRole('heading', { name: /Know what your agent/ })).toBeVisible();
    await expect(page.locator('#motion-toggle')).toBeHidden();
    await expect(page.locator('#demo-sources button').first()).toBeAttached();
    await page.getByRole('button', { name: 'Copilot', exact: true }).click();
    await expect(page.locator('#hero-verdict')).toHaveText('Loaded for Copilot');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('link', { name: /Explore the demo/ }).click();
    await expect(page.locator('#mode-label')).toHaveText('Report snapshot');
  } finally { await server.close(); }
});

test('website connects the real client demo, workflow walkthrough, guide and downloadable package', async ({ page }) => {
  const server = await serveStatic('website/dist');
  try {
    const errors: string[] = [];
    const failedResponses: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) failedResponses.push(response.url()); });
    await page.goto(server.url);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://agent-sightline.williamtse700.chatgpt.site/');
    const socialImage = await readFile('website/public/social.png');
    const socialHash = createHash('sha256').update(socialImage).digest('hex');
    const socialPath = '/social.png?v=' + socialHash.slice(0, 12);
    const socialUrl = 'https://agent-sightline.williamtse700.chatgpt.site' + socialPath;
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', socialUrl);
    const preview = await page.request.get(server.url + socialPath);
    expect(preview.ok()).toBe(true);
    expect(preview.headers()['content-type']).toContain('image/png');
    const previewData = await preview.body();
    expect(createHash('sha256').update(previewData).digest('hex')).toBe(socialHash);
    expect([previewData.readUInt32BE(16), previewData.readUInt32BE(20)]).toEqual([1200, 630]);
    const posterHash = createHash('sha256').update(await readFile('website/public/images/context-field.jpg')).digest('hex');
    await expect(page.locator('.hero-poster')).toHaveAttribute('src', '/images/context-field.jpg?v=' + posterHash.slice(0, 12));
    const faviconHash = createHash('sha256').update(await readFile('website/public/favicon.png')).digest('hex');
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.png?v=' + faviconHash.slice(0, 12));
    const robots = await page.request.get(server.url + '/robots.txt');
    expect(robots.ok()).toBeTruthy();
    expect(await robots.text()).toContain('Sitemap: https://agent-sightline.williamtse700.chatgpt.site/sitemap.xml');
    const sitemap = await page.request.get(server.url + '/sitemap.xml');
    expect(sitemap.ok()).toBeTruthy();
    expect(sitemap.headers()['content-type']).toContain('application/xml');
    expect(await sitemap.text()).toContain('/guide.html</loc>');
    await expect(page.getByRole('heading', { name: /Know what your agent/ })).toBeVisible();
    await expect(page.locator('#demo-status')).toHaveText('Truncated');
    await page.getByRole('tab', { name: /Claude Code/ }).click();
    await expect(page.locator('#demo-file')).toHaveText('CLAUDE.md');
    await expect(page.locator('#demo-reason-title')).toContainText('Claude Code');
    await page.getByRole('tab', { name: 'Compare perspectives Find shared paragraphs and their sources.' }).click();
    await expect(page.locator('#workflow-image')).toHaveAttribute('src', '/images/compare.png');
    await expect(page.locator('#workflow-image')).toBeVisible();
    await expect.poll(() => page.locator('#workflow-image').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBeTruthy();
    await page.getByText('Does Sightline change my configuration?', { exact: false }).click();
    await expect(page.locator('.faq-list details').first()).toHaveAttribute('open', '');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: /Download CLI package/ }).click()]);
    expect(download.suggestedFilename()).toBe(`agent-sightline-${VERSION}.tgz`);
    const legacy = await page.request.get(server.url + '/downloads/agent-sightline-0.1.0.tgz');
    expect(legacy.ok()).toBeTruthy();
    expect(createHash('sha256').update(await legacy.body()).digest('hex')).toBe('0cefb329bd544f0ce0275680b51e98fb059e6c895cef5f5d592639ad01740a4f');
    await page.getByRole('link', { name: /Installation guide/ }).click();
    await expect(page.getByRole('heading', { name: 'Install Sightline', exact: true })).toBeVisible();
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', socialUrl);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', 'https://agent-sightline.williamtse700.chatgpt.site/guide.html');
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'The Sightline guide');
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
    await page.getByRole('link', { name: 'Share a report', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Share what you found' })).toBeInViewport();
    expect(errors).toEqual([]);
    expect(failedResponses).toEqual([]);
  } finally { await server.close(); }
});

test('website stays readable and navigable on a phone', async ({ page }) => {
  const server = await serveStatic('website/dist');
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(server.url);
    await page.getByRole('tab', { name: /Copilot/ }).click();
    await expect(page.locator('#demo-status')).toHaveText('Loaded');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.getByRole('link', { name: /Explore the demo/ }).click();
    await expect(page.locator('#mode-label')).toHaveText('Report snapshot');
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
    await page.locator('#compare-tab').click();
    await expect(page.locator('#comparison-matrix')).toContainText('AGENTS.override.md');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  } finally { await server.close(); }
});


test('opening uses the poster after context loss and suspends when blurred or offscreen', async ({ page }) => {
  const server = await serveStatic('website/dist');
  try {
    await page.goto(server.url);
    const supported = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
    test.skip(!supported, 'This browser has no WebGL2 renderer.');
    const hero = page.locator('.hero');
    await expect(hero).toHaveAttribute('data-renderer', 'webgl');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(hero).toHaveAttribute('data-rendering', 'suspended');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(hero).toHaveAttribute('data-rendering', 'running');
    await page.locator('#download').scrollIntoViewIfNeeded();
    await expect(hero).toHaveAttribute('data-rendering', 'suspended');
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(hero).toHaveAttribute('data-rendering', 'running');
    await page.locator('#context-field').evaluate((canvas: HTMLCanvasElement) => canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext());
    await expect(hero).toHaveAttribute('data-renderer', 'static');
    await expect(page.locator('#context-field')).toHaveCount(0);
    await expect(page.locator('#motion-toggle')).toBeHidden();
    await expect(page.locator('.hero-poster')).toBeVisible();
    await page.getByRole('button', { name: 'Claude Code', exact: true }).click();
    await expect(page.locator('#hero-verdict')).toHaveText('Loaded for Claude Code');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    expect(await page.evaluate(() => document.documentElement.classList.contains('lenis'))).toBe(false);
  } finally { await server.close(); }
});

test('reduced motion starts with a complete poster and restores motion when the preference changes', async ({ page }) => {
  const server = await serveStatic('website/dist');
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(server.url);
    await expect(page.locator('#context-field')).toHaveCount(0);
    await expect(page.locator('.hero-poster')).toBeVisible();
    await expect(page.locator('#motion-toggle')).toBeHidden();
    expect(await page.locator('.hero-poster').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.classList.contains('lenis'))).toBe(false);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const supported = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
    if (supported) await expect(page.locator('.hero')).toHaveAttribute('data-renderer', 'webgl');
    await page.getByRole('link', { name: /Explore the demo/ }).click();
    await expect(page.locator('#mode-label')).toHaveText('Report snapshot');
  } finally { await server.close(); }
});

test('opening and primary navigation remain complete with JavaScript disabled', async ({ browser }) => {
  const server = await serveStatic('website/dist');
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    await page.goto(server.url);
    await expect(page.getByRole('heading', { name: /Know what your agent/ })).toBeVisible();
    await expect(page.locator('.hero-poster')).toBeVisible();
    expect(await page.locator('.hero-poster').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await expect(page.locator('#motion-toggle')).toBeHidden();
    await page.getByRole('link', { name: 'Get Sightline', exact: true }).first().click();
    await expect(page.locator('.install-card > .command-line code')).toBeInViewport();
    await page.getByText('Install the CLI for repeated use', { exact: true }).click();
    await expect(page.locator('.install-options')).toHaveAttribute('open', '');
    await page.getByRole('link', { name: /Download CLI package/ }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('link', { name: /Download CLI package/ })).toBeInViewport();
    await page.getByRole('link', { name: /Installation guide/ }).click();
    await expect(page.getByRole('heading', { name: 'Install Sightline', exact: true })).toBeVisible();
  } finally { await context.close(); await server.close(); }
});
