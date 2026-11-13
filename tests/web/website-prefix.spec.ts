import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { serveStatic } from '../../scripts/static-server.mjs';

const prefix = '/agent-sightline/';
const publicUrl = 'https://iamzwxyy.github.io/agent-sightline/';

test('project-hosted website loads assets, demo, guide and the exact released package', async ({ page }) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sightline-pages-'));
  let server: Awaited<ReturnType<typeof serveStatic>> | undefined;
  const dataGate = Promise.withResolvers<void>();
  try {
    // Keep the published package fixture independent of the development version.
    await mkdir(path.join(directory, 'website'), { recursive: true });
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'agent-sightline', version: '0.1.2' }));
    for (const name of ['website/public', 'website/.openai', 'examples/broken-agent-config', 'LICENSE']) await cp(name, path.join(directory, name), { recursive: true });
    const releases = JSON.parse(await readFile('website/releases.json', 'utf8'));
    await writeFile(path.join(directory, 'website/releases.json'), JSON.stringify(releases.filter((release: { filename: string }) => release.filename === 'agent-sightline-0.1.2.tgz')));
    execFileSync(process.execPath, [path.resolve('scripts/build-website.mjs'), '--site-url', publicUrl, '--released-package'], { cwd: directory, stdio: 'pipe' });
    server = await serveStatic(path.join(directory, 'website/dist'), 0, prefix);
    const failures: string[] = [];
    page.on('pageerror', error => failures.push(error.message));
    page.on('response', response => { if (response.status() >= 400) failures.push(response.url()); });
    await page.route('**/demo-report.json', async route => { await dataGate.promise; await route.continue(); });
    await page.goto(server.url + prefix);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', publicUrl);
    const socialHash = createHash('sha256').update(await readFile('website/public/social.png')).digest('hex');
    const socialPath = 'social.png?v=' + socialHash.slice(0, 12);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', publicUrl + socialPath);
    const preview = await page.request.get(server.url + prefix + socialPath);
    expect(preview.ok()).toBe(true);
    expect(createHash('sha256').update(await preview.body()).digest('hex')).toBe(socialHash);
    const faviconHash = createHash('sha256').update(await readFile('website/public/favicon.png')).digest('hex');
    const faviconPath = 'favicon.png?v=' + faviconHash.slice(0, 12);
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', prefix + faviconPath);
    expect((await page.request.get(server.url + prefix + faviconPath)).ok()).toBe(true);
    await expect(page.locator('#demo-status')).toHaveText('Truncated');
    await page.getByRole('tab', { name: /Claude Code/ }).click();
    dataGate.resolve();
    await expect(page.locator('#demo-file')).toHaveText('CLAUDE.md');
    await page.getByRole('tab', { name: 'Compare perspectives Find shared paragraphs and their sources.' }).click();
    await expect(page.locator('#workflow-image')).toHaveAttribute('src', prefix + 'images/compare.png');
    await expect.poll(() => page.locator('#workflow-image').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBeTruthy();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: /Download CLI package/ }).click()]);
    expect(download.suggestedFilename()).toBe('agent-sightline-0.1.2.tgz');
    expect(createHash('sha256').update(await readFile((await download.path())!)).digest('hex')).toBe('48a78fff9cbd5b432ab25ad6cc08d6a96b9c051a646bd41e284b5e3e240a3a12');
    await page.getByRole('link', { name: /Installation guide/ }).click();
    await expect(page).toHaveURL(server.url + prefix + 'guide.html#install');
    await expect(page.getByRole('heading', { name: 'Inspect a Codex profile' })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', publicUrl + 'guide.html');
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', publicUrl + 'guide.html');
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', publicUrl + socialPath);
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', prefix + faviconPath);
    await page.getByRole('link', { name: 'Interactive demo', exact: true }).click();
    await expect(page.locator('#mode-label')).toHaveText('Report snapshot');
    await page.locator('#compare-tab').click();
    await expect(page.locator('#comparison-matrix')).toContainText('AGENTS.override.md');
    const robots = await page.request.get(server.url + prefix + 'robots.txt');
    expect(await robots.text()).toContain('Sitemap: ' + publicUrl + 'sitemap.xml');
    const sitemap = await page.request.get(server.url + prefix + 'sitemap.xml');
    expect(await sitemap.text()).toContain(publicUrl + 'guide.html</loc>');
    expect(failures).toEqual([]);
  } finally {
    dataGate.resolve();
    await server?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
