import { test, expect } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { serve } from '../../packages/web/server.js';
import { workspace } from '../helpers.js';
import { rm, writeFile } from 'node:fs/promises';

const sampleOptions = { repo: path.resolve('examples/broken-agent-config'), user: false, trust: 'trusted' as const, clients: ['codex', 'claude', 'copilot'] as const };

test('finding → source line → client comparison → portable report', async ({ page }) => {
  const server = await serve({ ...sampleOptions, clients: [...sampleOptions.clients] });
  try {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.url);
    await expect(page.getByRole('heading', { name: /configuration issues found/ })).toBeVisible();
    await page.getByRole('button', { name: /Review findings/ }).click();
    await page.locator('#findings-list .finding').filter({ hasText: 'Hook command' }).click();
    await expect(page.locator('#detail-dialog')).toContainText('How to resolve it');
    await page.getByRole('button', { name: /Inspect source/ }).click();
    await expect(page.locator('#source-title')).toContainText('.claude/settings.json');
    await expect(page.locator('.code-line.highlight')).toContainText('missing-sightline-hook');
    await expect(page.locator('#why')).toContainText('Source size');
    await page.getByLabel('Target file or directory').fill('src/payments/refund.ts');
    await page.locator('#inspect').click();
    await expect(page.locator('#scan-status')).toContainText('Scan complete');
    await page.getByRole('button', { name: 'Inspect Codex instructions', exact: true }).click();
    await expect(page.locator('#source-status')).toContainText('Truncated');
    await expect(page.locator('.byte-limit-marker')).toBeVisible();
    await page.locator('#compare-tab').click();
    await expect(page.locator('#comparison-matrix')).toContainText('AGENTS.override.md');
    await expect(page.locator('#comparison-matrix .status.truncated')).toBeVisible();
    await page.getByLabel('Differences only').check();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export report/ }).click()]);
    const file = test.info().outputPath('report.html');
    await download.saveAs(file);
    await page.goto(pathToFileURL(file).href);
    await expect(page.locator('#mode-label')).toHaveText('Report snapshot');
    await expect(page.locator('#inspect')).toBeHidden();
    await page.locator('#findings-tab').click();
    await expect(page.locator('#findings-list .finding').first()).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await server.close(); }
});

test('target suggestions, rejected target, trust assumptions and keyboard navigation', async ({ page }) => {
  const server = await serve({ ...sampleOptions, clients: [...sampleOptions.clients], target: 'src/payments/refund.ts' });
  try {
    await page.goto(server.url);
    await expect(page.locator('#target-options option[value="src/payments/refund.ts"]')).toHaveCount(1);
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.locator('#target')).toBeFocused();
    await page.locator('#target').fill('../outside');
    await page.locator('#inspect').click();
    await expect(page.locator('#error')).toContainText('Choose a path inside');
    await expect(page.locator('#footer-target')).toHaveText('src/payments/refund.ts');
    await page.locator('#trust').selectOption('untrusted');
    await expect(page.locator('#error')).toBeHidden();
    await page.getByRole('button', { name: 'Inspect Codex instructions', exact: true }).click();
    await page.getByRole('button', { name: 'All discovered', exact: true }).click();
    await page.locator('.source').filter({ hasText: 'AGENTS.override.md' }).click();
    await expect(page.locator('#source-status')).toHaveText('Not loaded');
    await page.keyboard.press('/');
    await expect(page.locator('#source-search')).toBeFocused();
    await page.locator('#source-search').fill('no-such-config');
    await expect(page.locator('#sources')).toContainText('No matching sources');
    await page.locator('#source-search').fill('');
    await page.locator('.source').first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.source').nth(1)).toBeFocused();
    await page.locator('#scope-button').click();
    await expect(page.locator('#scope-dialog')).toContainText('Scan scope & rule versions');
    await page.keyboard.press('Escape');
    await expect(page.locator('#scope-dialog')).not.toBeVisible();
  } finally { await server.close(); }
});

test('mobile navigation, filters and extension details stay usable without page overflow', async ({ page }) => {
  const server = await serve({ ...sampleOptions, clients: [...sampleOptions.clients] });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(server.url);
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
    await page.locator('#findings-tab').click();
    await page.locator('#severity').selectOption('error');
    await page.locator('#finding-client').selectOption('claude');
    await expect(page.locator('#findings-list')).toContainText('Imported instruction file does not exist');
    await page.locator('#finding-search').fill('nothing-matches');
    await expect(page.locator('#findings-list')).toContainText('No findings match');
    await page.getByRole('button', { name: 'Reset filters' }).click();
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
    await page.locator('#extensions-tab').click();
    await page.getByRole('button', { name: 'MCP servers', exact: true }).click();
    await page.locator('.extension-row').first().click();
    await expect(page.locator('#detail-dialog')).toContainText('postgres');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  } finally { await server.close(); }
});

test('effective text, resolved settings and browser history preserve their provenance', async ({ page }) => {
  const w = await workspace({ 'AGENTS.md': 'Root instruction.', 'src/AGENTS.md': 'Nested instruction.', 'src/a.ts': '', '.codex/config.toml': 'model = "project-model"\n' }, { '.codex/config.toml': 'model = "user-model"\n' });
  const server = await serve({ ...w, target: 'src/a.ts', trust: 'trusted', clients: ['codex', 'copilot'] });
  try {
    await page.goto(server.url);
    await page.locator('#configuration-tab').click();
    const rows = page.locator('#setting-list tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('project-model');
    await rows.first().getByRole('button', { name: 'model', exact: true }).click();
    await expect(page.locator('#detail-dialog')).toContainText('Replaces these definitions');
    await expect(page.locator('.setting-origins')).toContainText('home');
    await page.getByRole('button', { name: /Inspect source/ }).click();
    await expect(page.locator('#source-title')).toHaveText('.codex/config.toml');
    await expect(page.locator('.code-line.highlight')).toContainText('project-model');
    await page.goBack();
    await expect(page.locator('#configuration')).toBeVisible();
    await page.getByLabel('Include overridden').check();
    await expect(rows).toHaveCount(2);
    await page.getByLabel('Search settings').fill('user-model');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Shadowed');
    await page.getByRole('button', { name: 'Inspect Codex instructions', exact: true }).click();
    await page.getByRole('button', { name: 'Read effective text', exact: true }).click();
    await expect(page.locator('#effective-document')).toContainText('Root instruction.');
    await expect(page.locator('#effective-document')).toContainText('Nested instruction.');
    await page.reload();
    await expect(page.locator('#effective-document')).toBeVisible();
    await page.locator('#effective-document').getByRole('button', { name: /src\/AGENTS.md/ }).click();
    await expect(page.locator('#source-title')).toHaveText('src/AGENTS.md');
    await expect(page.locator('#instruction-explorer')).toBeVisible();
    await page.locator('#compare-tab').click();
    await expect(page.locator('#comparison-text .comparison-document')).toHaveCount(2);
    await expect(page.locator('#comparison-text .comparison-document').first()).toContainText('Nested instruction.');
    await writeFile(path.join(w.repo, 'AGENTS.md'), 'Updated root instruction.');
    await page.reload();
    await expect(page.locator('#comparison-text .comparison-document').first()).toContainText('Updated root instruction.');
    await page.getByLabel('Target file or directory').fill('.');
    await page.locator('#inspect').click();
    await expect(page.locator('#scan-status')).toContainText('Scan complete');
    await page.reload();
    await expect(page.locator('#target')).toHaveValue('.');
    await expect(page.locator('#comparison-text .comparison-document').first()).not.toContainText('Nested instruction.');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  } finally { await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('an unconfigured repository leads to a working private-data-free sample workspace', async ({ page }) => {
  const w = await workspace({}, { '.codex/AGENTS.md': 'private-home-sentinel' });
  const server = await serve({ ...w, user: false });
  try {
    await page.goto(server.url);
    await expect(page.getByRole('heading', { name: 'Your first configuration starts here.' })).toBeVisible();
    await expect(page.locator('#priority-findings')).toContainText('No configuration to diagnose yet');
    await page.getByRole('link', { name: /Explore sample workspace/ }).click();
    await expect(page.locator('#mode-label')).toHaveText('Report snapshot');
    await expect(page.locator('#overview-heading')).toContainText('configuration issues found');
    expect(await page.content()).not.toContain('private-home-sentinel');
    expect(await page.content()).not.toContain(w.home);
    await page.locator('#configuration-tab').click();
    await expect(page.locator('#setting-list')).toContainText('project_doc_max_bytes');
    await page.locator('#effective-tab').click();
    await page.getByRole('button', { name: 'Read effective text', exact: true }).click();
    await expect(page.locator('#effective-document')).toContainText('Payment override');
  } finally { await server.close(); await rm(w.root, { recursive: true, force: true }); }
});
