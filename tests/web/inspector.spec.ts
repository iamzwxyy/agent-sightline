import { test, expect } from '@playwright/test';
import path from 'node:path';
import { serve } from '../../packages/web/server.js';

test('target explanation, source provenance, comparison, filters and portable export', async ({ page }) => {
  const server = await serve({ repo: path.resolve('examples/broken-agent-config'), user: false, trust: 'trusted', clients: ['codex', 'claude', 'copilot', 'cursor'] });
  try {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(server.url); await expect(page.getByRole('heading', { name: 'Configuration, in focus.' })).toBeVisible();
    await page.getByLabel('Target file or directory').fill('src/payments/refund.ts'); await page.getByRole('button', { name: 'Inspect target' }).click();
    await expect(page.locator('#target')).toHaveValue('src/payments/refund.ts');
    await page.locator('.source').filter({ hasText: 'AGENTS.override.md' }).click(); await expect(page.locator('#why')).toContainText('byte budget');
    await page.getByRole('button', { name: 'Compare clients' }).click(); await expect(page.locator('#compare')).toContainText('Extensions by client');
    await page.getByRole('button', { name: /^Findings/ }).click(); await page.locator('#severity').selectOption('error'); await expect(page.locator('.finding').first()).toBeVisible();
    await page.locator('#finding-client').selectOption('claude'); await expect(page.locator('#findings-list')).toContainText('Imported instruction file does not exist');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export HTML' }).click()]);
    const file = test.info().outputPath('report.html'); await download.saveAs(file);
    await page.goto('file://' + file); await expect(page.getByRole('heading', { name: 'Configuration, in focus.' })).toBeVisible(); await expect(page.locator('#inspect')).toBeDisabled();
    expect(errors).toEqual([]);
  } finally { await server.close(); }
});
test('small viewport keeps controls and findings accessible', async ({ page }) => {
  const server = await serve({ repo: path.resolve('examples/broken-agent-config'), user: false, clients: ['claude'] });
  try { await page.setViewportSize({ width: 390, height: 844 }); await page.goto(server.url); await page.getByRole('button', { name: /^Findings/ }).click(); await expect(page.locator('#severity')).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy(); } finally { await server.close(); }
});
