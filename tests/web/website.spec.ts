import { test, expect } from '@playwright/test';
import { serveStatic } from '../../scripts/static-server.mjs';
import { VERSION } from '../../packages/core/version.js';
import type { Report } from '../../packages/core/types.js';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

test('homepage and guide copy the published one-command repository inspection', async ({ page }) => {
  const server = await serveStatic('website/dist');
  const command = `npx --yes https://github.com/iamzwxyy/agent-sightline/releases/download/v${VERSION}/agent-sightline-${VERSION}.tgz ui`;
  try {
    const readmeFiles = ['README.md', 'README.zh-CN.md', 'README.ja.md'];
    const readmes = await Promise.all(readmeFiles.map(filename => readFile(filename, 'utf8')));
    for (const readme of readmes) {
      expect(readme).toContain(command);
      expect(readme).toContain(command.replace('npx --yes', 'npm install -g').replace(/ ui$/, ''));
      expect(readme).toContain(`npm install -g --offline ./agent-sightline-${VERSION}.tgz`);
      for (const filename of readmeFiles) expect(readme).toContain(`](${filename})`);
    }
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

test('opening the demo retains the preview client and source on desktop and phone', async ({ page }) => {
  const server = await serveStatic('website/dist');
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      for (const [name, client] of [['Codex', 'codex'], ['Claude Code', 'claude'], ['Copilot', 'copilot']]) {
        await page.goto(server.url);
        expect(await page.locator('.client-strip > span').innerText()).toMatch(/One repository\.\s+Every perspective\./);
        await expect(page.locator('#demo-sources button').first()).toBeAttached();
        await page.getByRole('button', { name, exact: true }).click();
        const source = page.getByRole('link', { name: 'Open full inspector', exact: true });
        const selection = new URLSearchParams(new URL((await source.getAttribute('href'))!, server.url).hash.slice(1));
        await page.getByRole('link', { name: /Explore the demo/ }).click();
        await expect(page.locator('#effective')).toBeVisible();
        await expect(page.locator('#clients .selected')).toContainText(name);
        await expect(page.locator('#source-title')).toHaveText(selection.get('source')!);
        expect(new URL(page.url()).hash).toContain('client=' + client);
      }
    }
  } finally { await server.close(); }
});

test('demo entry retains a client selected while the preview report is unavailable', async ({ page }) => {
  const server = await serveStatic('website/dist');
  try {
    await page.route('**/demo-report.json', route => route.abort());
    await page.goto(server.url);
    await page.getByRole('button', { name: 'Claude Code', exact: true }).click();
    await page.getByRole('link', { name: /Explore the demo/ }).click();
    await expect(page.locator('#effective')).toBeVisible();
    await expect(page.locator('#clients .selected')).toContainText('Claude Code');
    expect(new URL(page.url()).hash).toContain('client=claude');
  } finally { await server.close(); }
});

test('homepage preserves keyboard selection and opens the selected source in the inspector', async ({ page }) => {
  const server = await serveStatic('website/dist');
  try {
    await page.goto(server.url);
    await expect(page.locator('#demo-sources button').first()).toBeVisible();
    const tabs = page.getByRole('tablist', { name: 'Example client' });
    const codex = tabs.getByRole('tab', { name: 'Codex', exact: true });
    await codex.focus();
    await page.keyboard.press('End');
    const copilot = tabs.getByRole('tab', { name: 'Copilot', exact: true });
    await expect(copilot).toBeFocused();
    await expect(copilot).toHaveAttribute('tabindex', '0');
    await expect(codex).toHaveAttribute('tabindex', '-1');
    await expect(page.getByRole('tabpanel', { name: 'Copilot', exact: true })).toBeVisible();

    const source = page.locator('#demo-sources button').nth(1);
    const filename = await source.locator('.source-label').textContent();
    await source.focus();
    await page.keyboard.press('Enter');
    await expect(source).toBeFocused();
    await expect(source).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#demo-file')).toHaveText(filename!);
    const inspect = page.getByRole('link', { name: 'Open full inspector', exact: true });
    const destination = new URL((await inspect.getAttribute('href'))!, server.url);
    const selection = new URLSearchParams(destination.hash.slice(1));
    expect(selection.get('view')).toBe('effective');
    expect(selection.get('client')).toBe('copilot');
    expect(selection.get('source')).toBeTruthy();
    await expect(page.getByRole('link', { name: 'Open the full interactive demo', exact: true })).toHaveAttribute('href', destination.pathname + destination.hash);
    await inspect.click();
    await expect(page.locator('#effective')).toBeVisible();
    await expect(page.locator('#source-title')).toHaveText(selection.get('source')!);
    await expect(page.locator('#clients .selected')).toContainText('GitHub Copilot');
    for (const name of ['Codex', 'Claude Code']) {
      await page.goto(server.url);
      await page.getByRole('tab', { name, exact: true }).click();
      const ignored = page.locator('#demo-sources button').last();
      await ignored.click();
      await expect(ignored).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#demo-status')).toHaveText('Not loaded');
      const inspect = page.getByRole('link', { name: 'Open full inspector', exact: true });
      const selection = new URLSearchParams(new URL((await inspect.getAttribute('href'))!, server.url).hash.slice(1));
      await inspect.click();
      await expect(page.locator('#source-title')).toHaveText(selection.get('source')!);
      await expect(page.locator('#source-status')).toHaveText('Not loaded');
    }

    await page.goto(server.url);
    const workflows = page.getByRole('tablist', { name: 'Explore the workflow' });
    await workflows.getByRole('tab').first().focus();
    await page.keyboard.press('End');
    const comparison = workflows.getByRole('tab').last();
    await expect(comparison).toBeFocused();
    await expect(comparison).toHaveAttribute('tabindex', '0');
    await expect(workflows.getByRole('tab').first()).toHaveAttribute('tabindex', '-1');
    await expect(page.getByRole('tabpanel', { name: /Compare perspectives/ })).toBeVisible();
  } finally { await server.close(); }
});

test('homepage and guide provide selected command text when clipboard access fails', async ({ page }) => {
  const server = await serveStatic('website/dist');
  try {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: {
        writeText: async () => { throw new Error('Clipboard permission denied'); },
      } });
    });
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      for (const route of ['/#download', '/guide.html#install']) {
        await page.goto(server.url + route);
        const trigger = page.getByRole('button', { name: 'Copy one-command inspection', exact: true });
        await trigger.click();
        const dialog = page.getByRole('dialog', { name: 'Copy this command', exact: true });
        await expect(dialog).toBeVisible();
        const command = dialog.getByRole('textbox', { name: 'Command to copy', exact: true });
        await expect(command).toBeFocused();
        await expect(command).toHaveValue((await trigger.getAttribute('data-copy'))!);
        expect(await command.evaluate((field: HTMLTextAreaElement) => field.selectionStart === 0 && field.selectionEnd === field.value.length)).toBe(true);
        expect(await dialog.evaluate(element => { const bounds = element.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight; })).toBe(true);
        if (viewport.width === 390) await dialog.getByRole('button', { name: 'Close copy command', exact: true }).click();
        else await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
      }
    }
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
    const report: Report = JSON.parse(await readFile('website/dist/demo-report.json', 'utf8'));
    const selected = report.clients.find(client => client.client === 'codex')!.decisions.find(source => source.status === 'truncated')!;
    const page = await context.newPage();
    await page.goto(server.url);
    await expect(page.getByRole('heading', { name: /Know what your agent/ })).toBeVisible();
    await expect(page.locator('#hero-source')).toHaveText(selected.path.split(/[\\/]/).pop()!);
    await expect(page.locator('#hero-verdict')).toHaveText(`${selected.loadedBytes} of ${selected.bytes} bytes reach Codex`);
    const link = page.getByRole('link', { name: /Explore the demo/ });
    const selection = new URLSearchParams(new URL((await link.getAttribute('href'))!, server.url).hash.slice(1));
    expect(selection.get('view')).toBe('effective');
    expect(selection.get('client')).toBe('codex');
    expect(selection.get('source')).toBe(selected.path.replaceAll('\\', '/').slice(report.repository.replaceAll('\\', '/').length + 1));
    expect(selection.get('line')).toBe(String(selected.line));
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
