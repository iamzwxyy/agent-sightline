import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { serveStatic } from '../../scripts/static-server.mjs';
import { VERSION } from '../../packages/core/version.js';

const languages = [
  { id: 'zh-CN', heading: '看清智能体 实际读取的内容。', install: '安装 Sightline', copy: '复制一键检查命令', dialog: '复制这条命令', field: '待复制的命令', close: '关闭复制窗口', loaded: '已加载', truncated: '已截断', pause: '暂停动画', play: '播放动画' },
  { id: 'ja', heading: 'エージェントが 読み込むものを知る。', install: 'Sightline をインストール', copy: '検査コマンドをコピー', dialog: 'このコマンドをコピー', field: 'コピーするコマンド', close: 'コピー画面を閉じる', loaded: '読み込み済み', truncated: '切り詰め', pause: 'アニメーションを一時停止', play: 'アニメーションを再生' },
];

test('localized pages retain complete guides, exact commands, language links and search metadata', async ({ page }) => {
  const server = await serveStatic('website/dist');
  try {
    await page.goto(server.url + '/guide.html');
    const commands = await page.locator('code').allTextContents();
    for (const language of languages) {
      await page.goto(`${server.url}/${language.id}/guide.html#reports`);
      await expect(page.locator('html')).toHaveAttribute('lang', language.id);
      expect(await page.locator('code').allTextContents()).toEqual(commands);
      await expect(page.locator('#reports')).toContainText('v0.3.47');
      await expect(page.locator('#instructions')).toContainText('Read effective text');
      await expect(page.locator('#compatibility')).toContainText('98');
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://agent-sightline.williamtse700.chatgpt.site/${language.id}/guide.html`);
      await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', `https://agent-sightline.williamtse700.chatgpt.site/${language.id}/guide.html`);
      const social = await readFile(`website/public/social-${language.id}.png`);
      const revision = createHash('sha256').update(social).digest('hex').slice(0, 12);
      const socialPath = `/social-${language.id}.png?v=${revision}`;
      await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://agent-sightline.williamtse700.chatgpt.site' + socialPath);
      const preview = await page.request.get(server.url + socialPath);
      expect(preview.ok()).toBe(true);
      expect((await preview.body()).equals(social)).toBe(true);
      expect([social.readUInt32BE(16), social.readUInt32BE(20)]).toEqual([1200, 630]);
      for (const asset of ['site.js', 'site.css']) {
        const revision = createHash('sha256').update(await readFile(`website/dist/${asset}`)).digest('hex').slice(0, 12);
        await expect(page.locator(asset.endsWith('.js') ? 'script[src*="site.js"]' : 'link[href*="site.css"]')).toHaveAttribute(asset.endsWith('.js') ? 'src' : 'href', `/${asset}?v=${revision}`);
      }
      await expect(page.locator('link[hreflang]')).toHaveCount(4);
      const switcher = page.locator('.language-menu');
      await switcher.scrollIntoViewIfNeeded();
      await switcher.locator('summary').focus();
      await page.keyboard.press('Enter');
      await expect(switcher.locator('a[aria-current]')).toHaveAttribute('lang', language.id);
      await expect(switcher.locator('a[hreflang="en"]')).toHaveAttribute('href', server.url + '/guide.html#reports');
      await switcher.getByRole('link', { name: 'English', exact: true }).click();
      await expect(page).toHaveURL(server.url + '/guide.html#reports');
      await expect(page.getByRole('heading', { name: 'Share what you found' })).toBeInViewport();
      await page.locator('.language-menu summary').click();
      await page.locator(`.language-menu a[hreflang="${language.id}"]`).click();
      await expect(page).toHaveURL(`${server.url}/${language.id}/guide.html#reports`);
      const home = page.locator('.site-header .brand');
      await home.click();
      await expect(page).toHaveURL(`${server.url}/${language.id}/`);
      await expect(page.locator('#hero-title')).toHaveAccessibleName(language.heading);
    }
  } finally { await server.close(); }
});

test('Chinese and Japanese previews localize live statuses and keep the real inspector selection', async ({ page }) => {
  test.setTimeout(60000);
  const server = await serveStatic('website/dist');
  const errors: string[] = [];
  const failed: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) failed.push(response.url()); });
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const language of languages) for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await page.goto(`${server.url}/${language.id}/`);
      await expect(page.locator('#demo-status')).toHaveText(language.truncated);
      await expect(page.locator('#hero-verdict')).toContainText('Codex');
      await expect(page.locator('.hero-poster')).toBeVisible();
      await page.getByRole('tab', { name: 'Claude Code', exact: true }).click();
      await expect(page.locator('#demo-status')).toHaveText(language.loaded);
      await expect(page.locator('#hero-verdict')).toContainText(language.loaded);
      await expect(page.locator('#demo-reason')).toHaveAttribute('lang', 'en');
      await page.locator('[data-workflow="compare"]').click();
      await expect(page.locator('#workflow-image')).toHaveAttribute('src', '/images/compare.png');
      await expect(page.locator('#workflow-caption')).not.toHaveText('Find shared paragraphs across different files and follow each client to the original source lines.');
      await page.locator('.language-menu summary').click();
      await expect(page.locator('.language-options')).toBeVisible();
      await expect(page.locator('.language-options a')).toHaveCount(3);
      for (const link of await page.locator('.language-options a').all()) await expect(link).toBeVisible();
      if (width === 390) expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
      await page.locator('.language-menu summary').click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: test.info().outputPath(`${language.id}-${width}.png`) });
      if (width !== 320) expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
      const inspect = page.locator('.demo-bottom [data-inspector-link]');
      const destination = new URL((await inspect.getAttribute('href'))!, server.url);
      expect(destination.pathname).toBe('/demo/');
      const selection = new URLSearchParams(destination.hash.slice(1));
      expect(selection.get('client')).toBe('claude');
      await inspect.click();
      await expect(page.locator('#source-title')).toHaveText(selection.get('source')!);
      await expect(page.locator('#clients .selected')).toContainText('Claude Code');
    }
    expect(errors).toEqual([]);
    expect(failed).toEqual([]);
  } finally { await server.close(); }
});

test('localized copy fallback preserves commands, selection and focus on desktop and phone', async ({ page }) => {
  const server = await serveStatic('website/dist');
  try {
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async () => { throw new Error('Fixture clipboard denial'); },
    } }));
    for (const language of languages) for (const width of [1440, 390]) for (const route of ['', 'guide.html']) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await page.goto(`${server.url}/${language.id}/${route}#${route ? 'install' : 'download'}`);
      const trigger = page.getByRole('button', { name: language.copy, exact: true });
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: language.dialog, exact: true });
      const command = dialog.getByRole('textbox', { name: language.field, exact: true });
      await expect(command).toBeFocused();
      await expect(command).toHaveValue(`npx --yes https://github.com/iamzwxyy/agent-sightline/releases/download/v${VERSION}/agent-sightline-${VERSION}.tgz ui`);
      expect(await command.evaluate((field: HTMLTextAreaElement) => field.selectionStart === 0 && field.selectionEnd === field.value.length)).toBe(true);
      await dialog.getByRole('button', { name: language.close, exact: true }).click();
      await expect(trigger).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (route) expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    }
  } finally { await server.close(); }
});

test('localized pages work without JavaScript and distribute the same package as the English page', async ({ browser }) => {
  const server = await serveStatic('website/dist');
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    for (const language of languages) {
      await page.goto(`${server.url}/${language.id}/`);
      await expect(page.locator('#hero-title')).toContainText(language.heading.slice(0, 5));
      await expect(page.locator('#hero-verdict')).not.toContainText('bytes reach');
      await expect(page.locator('#motion-toggle')).toBeHidden();
      await expect(page.locator('.hero-poster')).toBeVisible();
      await page.locator('.language-menu summary').click();
      await expect(page.locator('.language-options a[hreflang="en"]')).toBeVisible();
      await page.locator('.language-menu summary').click();
      await page.locator('.install-card a[href$="guide.html#install"]').click();
      await expect(page.getByRole('heading', { name: language.install, exact: true })).toBeVisible();
      const filename = `agent-sightline-${VERSION}.tgz`;
      const englishDownload = await context.request.get(`${server.url}/downloads/${filename}`);
      expect(englishDownload.ok()).toBe(true);
      const expectedHash = createHash('sha256').update(await englishDownload.body()).digest('hex');
      const downloading = page.waitForEvent('download');
      await page.locator(`#install a[download]`).click();
      const download = await downloading;
      expect(download.suggestedFilename()).toBe(filename);
      expect(createHash('sha256').update(await readFile((await download.path())!)).digest('hex')).toBe(expectedHash);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  } finally { await context.close(); await server.close(); }
});

test('localized motion controls retain their language after pause and resume', async ({ page }) => {
  const server = await serveStatic('website/dist');
  try {
    const supported = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
    test.skip(!supported, 'The browser has no WebGL2 renderer.');
    for (const language of languages) {
      await page.goto(`${server.url}/${language.id}/`);
      await expect(page.locator('.hero')).toHaveAttribute('data-renderer', 'webgl');
      await page.getByRole('button', { name: language.pause, exact: true }).click();
      await expect(page.getByRole('button', { name: language.play, exact: true })).toBeVisible();
      await page.getByRole('button', { name: language.play, exact: true }).click();
      await expect(page.getByRole('button', { name: language.pause, exact: true })).toBeVisible();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(page.locator('#context-field')).toHaveCount(0);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
    }
  } finally { await server.close(); }
});
