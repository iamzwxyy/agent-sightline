import { test, expect } from '@playwright/test';
import { serveStatic } from '../../scripts/static-server.mjs';

test('website connects the real client demo, workflow walkthrough, guide and downloadable package', async ({ page }) => {
  const server = await serveStatic('website/dist');
  try {
    const errors: string[] = [];
    const failedResponses: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) failedResponses.push(response.url()); });
    await page.goto(server.url);
    await expect(page.getByRole('heading', { name: /Know what your agent/ })).toBeVisible();
    await expect(page.locator('#demo-status')).toHaveText('Truncated');
    await page.getByRole('tab', { name: /Claude Code/ }).click();
    await expect(page.locator('#demo-file')).toHaveText('CLAUDE.md');
    await expect(page.locator('#demo-reason-title')).toContainText('Claude Code');
    await page.getByRole('tab', { name: 'Compare perspectives Understand what each client receives.' }).click();
    await expect(page.locator('#workflow-image')).toHaveAttribute('src', '/images/compare.png');
    await expect(page.locator('#workflow-image')).toBeVisible();
    await expect.poll(() => page.locator('#workflow-image').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBeTruthy();
    await page.getByText('Does Sightline change my configuration?', { exact: false }).click();
    await expect(page.locator('.faq-list details').first()).toHaveAttribute('open', '');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: /Download CLI package/ }).click()]);
    expect(download.suggestedFilename()).toBe('agent-sightline-0.1.0.tgz');
    await page.getByRole('link', { name: /Installation guide/ }).click();
    await expect(page.getByRole('heading', { name: 'Install Sightline', exact: true })).toBeVisible();
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
