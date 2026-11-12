import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { serve } from '../../packages/web/server.js';
import { workspace } from '../helpers.js';
import { readFile, rm, writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';

const sampleOptions = { repo: path.resolve('examples/broken-agent-config'), user: false, trust: 'trusted' as const, clients: ['codex', 'claude', 'copilot'] as const };

test('malformed extensions stay inspectable with exact source lines and portable findings', async ({ page }) => {
  const w = await workspace({
    '.mcp.json': JSON.stringify({ mcpServers: { invalid: { command: 'node', env: { PATH: 42 } }, valid: { command: process.execPath } } }, null, 2),
    '.github/hooks/test.json': JSON.stringify({ version: 1, hooks: { sessionStart: [{ type: 'command', bash: 'echo safe', powershell: 'echo safe', cwd: 42 }] } }, null, 2),
  });
  const server = await serve({ ...w, user: false, clients: ['copilot'], trust: 'trusted' });
  try {
    await page.goto(server.url);
    await expect(page.locator('#scan-status')).toHaveText('Scan complete');
    await page.locator('#findings-tab').click();
    await page.locator('#findings-list .finding').filter({ hasText: 'Hook working directory must be a string.' }).click();
    await page.getByRole('button', { name: /Inspect source/ }).click();
    await expect(page.locator('#source-title')).toContainText('.github/hooks/test.json');
    await expect(page.locator('.code-line.highlight')).toContainText('"cwd": 42');
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const filename = test.info().outputPath('malformed-extensions.html');
    await (await pending).saveAs(filename);
    await page.goto(pathToFileURL(filename).href);
    await page.locator('#findings-tab').click();
    await expect(page.locator('#findings-list')).toContainText('env must map names to strings.');
    await expect(page.locator('#findings-list')).toContainText('Hook working directory must be a string.');
    const report = JSON.parse(await page.locator('#report-data').textContent() ?? 'null');
    expect(report.clients[0].extensions.find((extension: any) => extension.name === 'valid').status).toBe('active');
    expect(report.clients[0].extensions.find((extension: any) => extension.name === 'invalid').status).toBe('invalid');
  } finally { await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('an inspector launched from a subdirectory retains its Git-root scope through refresh and reload', async ({ page }) => {
  const w = await workspace({ 'CLAUDE.md': 'Root project instructions.', 'src/payments/CLAUDE.md': 'Payment instructions.', 'src/payments/refund.ts': '', 'src/shared.ts': '' });
  const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), path.resolve('packages/cli/index.ts'), 'ui', '--no-open', '--no-user', '--client', 'claude'], { cwd: path.join(w.repo, 'src/payments'), stdio: ['ignore', 'pipe', 'pipe'] });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let output = '';
      timer = setTimeout(() => reject(new Error('Nested inspector did not start.')), 15000);
      child.once('error', reject);
      child.once('exit', () => reject(new Error('Nested inspector exited before startup.')));
      child.stdout.on('data', chunk => { output += chunk.toString(); const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) resolve(match[0]); });
    });
    clearTimeout(timer);
    await page.goto(url);
    await expect(page.locator('#target')).toHaveValue('src/payments');
    await page.getByRole('button', { name: 'Inspect Claude Code instructions', exact: true }).click();
    await page.getByRole('button', { name: 'Read effective text', exact: true }).click();
    await expect(page.locator('#effective-document')).toContainText('Root project instructions.');
    await expect(page.locator('#effective-document')).toContainText('Payment instructions.');
    const targets = await (await page.request.get(url + '/api/targets')).json();
    expect(targets.paths).toContain('src/shared.ts');
    await page.locator('#target').fill('src/shared.ts');
    await page.locator('#inspect').click();
    await expect(page.locator('#footer-target')).toHaveText('src/shared.ts');
    await expect(page.locator('#effective-document')).toContainText('Root project instructions.');
    await expect(page.locator('#effective-document')).not.toContainText('Payment instructions.');
    await page.reload();
    await expect(page.locator('#target')).toHaveValue('src/shared.ts');
    await expect(page.locator('#effective-document')).toContainText('Root project instructions.');
    await expect(page.locator('#scan-status')).toHaveText('Scan complete');
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) { const closed = once(child, 'close'); child.kill(); await closed; }
    await rm(w.root, { recursive: true, force: true });
  }
});

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
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('Clipboard permission denied.'); } }, configurable: true }));
    await page.getByRole('button', { name: 'Copy effective text', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Copy this text' })).toBeVisible();
    const copyField = page.getByRole('textbox', { name: 'Text to copy' });
    await expect(copyField).toBeFocused();
    await expect(copyField).toHaveValue(/Payment override/);
    expect(await copyField.evaluate((field: HTMLTextAreaElement) => field.selectionStart === 0 && field.selectionEnd === field.value.length)).toBeTruthy();
    await page.keyboard.press('Escape');
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

test('JSON errors at separate columns remain visible with readable messages and precise copied locations', async ({ page }) => {
  const w = await workspace({ '.claude/settings.local.json': '{ "model": ?, "model": ? }' });
  const server = await serve({ ...w, user: false, clients: ['claude'] });
  try {
    await page.goto(server.url);
    await page.locator('#findings-tab').click();
    await page.locator('#severity').selectOption('error');
    await expect(page.locator('#findings-list .finding')).toHaveCount(5);
    const missingValues = page.locator('#findings-list .finding').filter({ hasText: 'Expected a JSON value.' });
    await expect(missingValues).toHaveCount(2);
    await expect(missingValues.nth(0)).toContainText('line 1, column 13');
    await expect(missingValues.nth(1)).toContainText('line 1, column 26');
    await missingValues.nth(1).click();
    await expect(page.locator('#detail-dialog')).toContainText('line 1, column 26');
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('Clipboard permission denied.'); } }, configurable: true }));
    await page.getByRole('button', { name: 'Copy location', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Text to copy' })).toHaveValue(path.join(w.repo, '.claude/settings.local.json') + ':1:26');
  } finally { await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('export preserves the inspected configuration through disk edits and an in-flight refresh', async ({ page }) => {
  const w = await workspace({ 'CLAUDE.md': 'Instructions before editing.' });
  const server = await serve({ ...w, user: false, clients: ['claude'] });
  const responseReady = Promise.withResolvers<void>();
  const releaseResponse = Promise.withResolvers<void>();
  const exportedReports: string[] = [];
  const exportCurrentReport = async () => {
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = await (await downloading).path();
    return readFile(file!, 'utf8');
  };
  try {
    await page.goto(server.url);
    await page.getByRole('button', { name: 'Inspect Claude Code instructions', exact: true }).click();
    await page.getByRole('button', { name: 'Read effective text', exact: true }).click();
    await expect(page.locator('#effective-document')).toContainText('Instructions before editing.');
    await writeFile(path.join(w.repo, 'CLAUDE.md'), 'Instructions after editing.');
    await page.route('**/api/scan?**', async route => {
      const response = await route.fetch();
      responseReady.resolve();
      await releaseResponse.promise;
      await route.fulfill({ response });
    });
    await page.getByRole('button', { name: 'Refresh scan', exact: true }).click();
    await responseReady.promise;
    await expect(page.locator('#scan-status')).toHaveText('Inspecting…');
    exportedReports.push(await exportCurrentReport());
    releaseResponse.resolve();
    await expect(page.locator('#scan-status')).toHaveText('Scan complete');
    await expect(page.locator('#effective-document')).toContainText('Instructions after editing.');
    exportedReports.push(await exportCurrentReport());
    await page.locator('#target').fill('../outside');
    await page.locator('#inspect').click();
    await expect(page.locator('#scan-status')).toHaveText('Scan failed');
    exportedReports.push(await exportCurrentReport());
    const reports = exportedReports.map(html => JSON.parse(html.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/)![1]));
    expect(reports.map(report => report.clients[0].instructions)).toEqual(['Instructions before editing.', 'Instructions after editing.', 'Instructions after editing.']);
    for (const html of exportedReports) {
      expect(html).not.toContain(w.repo);
      expect(html).not.toContain(w.home);
      expect(html).toContain('data-live="false"');
    }
  } finally {
    releaseResponse.resolve();
    await page.unrouteAll({ behavior: 'wait' });
    await server.close();
    await rm(w.root, { recursive: true, force: true });
  }
});

test('incomplete discovery remains visible through refresh and a portable export', async ({ page }) => {
  const w = await workspace({ 'AGENTS.md': 'Known repository instructions.', 'src/a.ts': '' });
  const server = await serve({ ...w, user: false, clients: ['codex'], trust: 'trusted', maxFiles: 0 });
  try {
    await page.goto(server.url);
    await expect(page.locator('#scan-status')).toHaveText('Discovery incomplete');
    await expect(page.getByRole('heading', { name: 'Configuration discovery is incomplete.', exact: true })).toBeVisible();
    await page.locator('#target').fill('src/a.ts');
    await page.locator('#inspect').click();
    await expect(page.locator('#footer-target')).toHaveText('src/a.ts');
    await expect(page.locator('#scan-status')).toHaveText('Discovery incomplete');
    await page.locator('#scope-button').click();
    await expect(page.locator('#scope-dialog')).toContainText('budget of 0');
    await page.keyboard.press('Escape');
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const filename = test.info().outputPath('partial-report.html');
    await (await pending).saveAs(filename);
    await page.goto(pathToFileURL(filename).href);
    await expect(page.locator('#scan-status')).toHaveText('Discovery incomplete');
    await expect(page.getByRole('heading', { name: 'Configuration discovery is incomplete.', exact: true })).toBeVisible();
  } finally { await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('target suggestions, rejected target, trust assumptions and keyboard navigation', async ({ page }) => {
  const server = await serve({ ...sampleOptions, clients: [...sampleOptions.clients], target: 'src/payments/refund.ts' });
  try {
    await page.goto(server.url);
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.locator('#target')).toBeFocused();
    await expect(page.getByRole('option').filter({ hasText: 'src/payments/refund.ts' })).toBeVisible();
    await page.locator('#target').fill('../outside');
    await page.locator('#inspect').click();
    await expect(page.locator('#error')).toContainText('Choose a path inside');
    await expect(page.locator('#scan-status')).toHaveText('Scan failed');
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

test('file picker supports fuzzy keyboard selection and hidden project files', async ({ page }) => {
  const w = await workspace({ 'AGENTS.md': 'Root instruction.', 'src/payments/refund.ts': '', 'src/search/result.ts': '', '.github/workflows/ci.yml': '' });
  const server = await serve({ ...w, user: false, clients: ['codex'], trust: 'trusted' });
  try {
    await page.goto(server.url);
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('#target').fill('srcrefts');
    await expect(page.getByRole('option').filter({ hasText: 'src/payments/refund.ts' })).toBeVisible();
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('#target-options [aria-selected="true"]')).toContainText('refund.ts');
    await page.keyboard.press('Enter');
    await expect(page.locator('#footer-target')).toHaveText('src/payments/refund.ts');
    await expect(page.locator('#target-picker')).toBeHidden();
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('#target').fill('ci.yml');
    await page.getByRole('option').filter({ hasText: '.github/workflows/ci.yml' }).click();
    await expect(page.locator('#footer-target')).toHaveText('.github/workflows/ci.yml');
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('#target').fill('');
    await expect(page.getByRole('option').first()).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => node.target) }))).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.locator('#target-picker')).toBeHidden();
    await expect(page.locator('#target')).toBeFocused();

  } finally { await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('file picker supports touch selection without page overflow', async ({ browser, browserName }) => {
  test.skip(browserName === 'firefox', 'Mobile context emulation is available in Chromium and WebKit.');
  const server = await serve({ ...sampleOptions, clients: [...sampleOptions.clients] });
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    await phone.goto(server.url);
    await phone.locator('#target').tap();
    await phone.locator('#target').fill('refund');
    const choice = phone.getByRole('option').filter({ hasText: 'src/payments/refund.ts' });
    await expect(choice).toBeVisible();
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await choice.tap();
    await expect(phone.locator('#target')).toHaveValue('src/payments/refund.ts');
    await expect(phone.locator('#target-picker')).toBeHidden();
    await expect(phone.locator('#scan-status')).toHaveText('Scan complete');
  } finally { await phone.close(); await server.close(); }
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

test('Codex profile selection updates settings and persists through reload and export', async ({ page }) => {
  const w = await workspace({ 'AGENTS.md': 'Project instructions' }, {
    '.codex/config.toml': 'model = "base-model"\nsandbox_mode = "read-only"\n',
    '.codex/review.config.toml': 'model = "review-model"\nsandbox_mode = "workspace-write"\n',
  });
  const server = await serve({ ...w, clients: ['codex'], trust: 'trusted' });
  try {
    await page.goto(server.url);
    await page.locator('#configuration-tab').click();
    await page.getByLabel('Search settings').fill('model');
    await expect(page.locator('#setting-list')).toContainText('base-model');
    await page.getByLabel('Codex profile', { exact: true }).fill('review');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.locator('#setting-list')).toContainText('review-model');
    await expect(page).toHaveURL(/profile=review/);
    await page.reload();
    await expect(page.getByLabel('Codex profile', { exact: true })).toHaveValue('review');
    await page.getByLabel('Search settings').fill('model');
    await page.getByRole('button', { name: 'model', exact: true }).click();
    await expect(page.locator('#detail-dialog')).toContainText('review.config.toml · line 1');
    await expect(page.locator('#detail-dialog')).toContainText('Replaces these definitions');
    await page.keyboard.press('Escape');
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: test.info().outputPath('profile-desktop.png'), fullPage: true });
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export report/ }).click()]);
    const file = test.info().outputPath('profile-report.html');
    await download.saveAs(file);
    await page.goto(pathToFileURL(file).href);
    await expect(page.getByLabel('Codex profile', { exact: true })).toBeHidden();
    await page.locator('#configuration-tab').click();
    await page.getByLabel('Search settings').fill('model');
    await expect(page.locator('#setting-list')).toContainText('review-model');
    await page.goto(server.url + '/?profile=review#view=configuration');
    await page.getByLabel('Codex profile', { exact: true }).fill('');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.locator('#setting-list')).toContainText('base-model');
    await page.reload();
    await expect(page.getByLabel('Codex profile', { exact: true })).toHaveValue('');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByLabel('Codex profile', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  } finally {
    await server.close();
    await rm(w.root, { recursive: true, force: true });
  }
});
