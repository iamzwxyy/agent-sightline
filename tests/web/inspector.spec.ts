import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { serve } from '../../packages/web/server.js';
import { workspace } from '../helpers.js';
import { trustWorkspace } from '../copilot-trust-fixture.js';
import { mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { html, portable } from '../../packages/reporter/index.js';
import type { Report, ScanOptions } from '../../packages/core/types.js';
import { scan } from '../../packages/core/index.js';
import { createServer } from 'node:http';

const sampleOptions = { repo: path.resolve('examples/broken-agent-config'), user: false, trust: 'trusted' as const, clients: ['codex', 'claude', 'copilot'] as const };

test('starting-directory selection survives targets, history, refresh and portable re-export', async ({ page }) => {
  const w = await workspace({
    'AGENTS.md': 'Root instructions.', 'src/AGENTS.md': 'Nested instructions.', 'docs/AGENTS.md': 'Docs instructions.',
    'src/file.ts': '', 'docs/file.ts': '',
  });
  const server = await serve({ ...w, target: 'src/file.ts', user: false, clients: ['codex'], trust: 'trusted' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const selectDirectory = async (directory: string) => {
    await page.locator('#session-button').click();
    await page.getByLabel('Change starting directory', { exact: true }).fill(directory);
    await page.getByRole('button', { name: 'Apply directory', exact: true }).click();
    await expect(page.locator('#scope-dialog')).not.toBeVisible();
  };
  try {
    await page.goto(server.url);
    await expect(page.locator('#session-button')).toHaveText('Starts in src');
    await page.getByRole('button', { name: 'Inspect Codex instructions', exact: true }).click();
    await selectDirectory('.');
    await expect(page.locator('#sources')).not.toContainText('src/AGENTS.md');
    await expect(page.locator('#session-button')).toHaveText('Starts in .');
    await page.getByRole('button', { name: 'Compare clients', exact: true }).click();
    await selectDirectory('docs');
    await expect(page.locator('#session-button')).toHaveText('Starts in docs');
    await page.goBack();
    await expect(page.locator('#session-button')).toHaveText('Starts in .');
    await page.goForward();
    await expect(page.locator('#session-button')).toHaveText('Starts in docs');
    await page.reload();
    await expect(page.locator('#session-button')).toHaveText('Starts in docs');
    await page.locator('#session-button').click();
    await page.getByLabel('Change starting directory', { exact: true }).fill('missing');
    await page.getByRole('button', { name: 'Apply directory', exact: true }).click();
    await expect(page.locator('#session-error')).toContainText('existing starting directory');
    await expect(page.locator('#session-current')).toHaveText('docs');
    await page.getByRole('button', { name: 'Use target directory', exact: true }).click();
    await expect(page.locator('#scope-dialog')).not.toBeVisible();
    await expect(page.locator('#session-button')).toHaveText('Starts in src');
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await selectDirectory('.');
      await page.locator('#target').fill('docs/file.ts');
      await page.locator('#inspect').click();
      await expect(page.locator('#scan-status')).toHaveText('Scan complete');
      await expect(page.locator('#session-button')).toHaveText('Starts in .');
      await page.getByRole('button', { name: 'Refresh scan', exact: true }).click();
      await expect(page.locator('#refresh-summary')).toContainText('Refresh complete.');
      await page.locator('#session-button').click();
      await expect(page.locator('#session-mode')).toHaveText('Kept when you select another target.');
      await page.screenshot({ path: test.info().outputPath(`starting-directory-${viewport.width}.png`), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole('button', { name: 'Close scan details', exact: true }).click();
      const downloading = page.waitForEvent('download');
      await page.locator('#export').click();
      const file = test.info().outputPath(`starting-directory-${viewport.width}.html`);
      await (await downloading).saveAs(file);
      const exported = await readFile(file, 'utf8');
      expect(exported).not.toContain(w.repo);
      expect(exported).not.toContain(w.home);
      const captured = JSON.parse(exported.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/)![1]);
      expect(captured.inputs.sessionDirectory).toBe('<repo>');
      expect(captured.target.replaceAll('\\', '/')).toBe('<repo>/docs/file.ts');
      await page.context().setOffline(true);
      await page.goto(pathToFileURL(file).href);
      await expect(page.locator('#session-button')).toHaveText('Starts in .');
      await page.locator('#session-button').click();
      await expect(page.locator('#session-form')).not.toBeVisible();
      await expect(page.locator('#session-current')).toHaveText('.');
      await page.getByRole('button', { name: 'Close scan details', exact: true }).click();
      const reexporting = page.waitForEvent('download');
      await page.locator('#export').click();
      const reexported = await readFile((await (await reexporting).path())!, 'utf8');
      expect(JSON.parse(reexported.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/)![1])).toEqual(captured);
      await page.context().setOffline(false);
      await page.goto(server.url);
    }
    expect(errors).toEqual([]);
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('starting-directory rescans keep request paths when displayed paths are redacted', async ({ page }) => {
  const w = await workspace({ 'src/file.ts': '', 'src/AGENTS.md': 'Nested instructions.' });
  await writeFile(path.join(w.repo, '.mcp.json'), JSON.stringify({ mcpServers: { fixture: { command: 'node', env: { DIRECTORY: path.join(w.repo, 'src'), TARGET: 'src/file.ts' } } } }));
  const server = await serve({ ...w, user: false, clients: ['codex', 'claude'], trust: 'trusted' });
  try {
    await page.goto(server.url + '?target=src/file.ts&session=src');
    await expect(page.locator('#session-button')).toContainText('[REDACTED]');
    for (let attempt = 0; attempt < 2; attempt++) {
      const scanning = page.waitForResponse(response => new URL(response.url()).pathname === '/api/scan');
      await page.getByRole('button', { name: 'Refresh scan', exact: true }).click();
      const response = await scanning;
      expect(response.status()).toBe(200);
      expect(new URL(response.url()).searchParams.get('session')).toBe('src');
      expect(new URL(response.url()).searchParams.get('target')).toBe('src/file.ts');
      await expect(page.locator('#scan-status')).toHaveText('Scan complete');
      await page.reload();
    }
  } finally { await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('Inspect preserves an unchanged redacted target from server defaults and explicit URLs', async ({ page }) => {
  const w = await workspace({
    'src/file.ts': '', 'src/AGENTS.md': 'Nested instructions.',
    '.mcp.json': '{"mcpServers":{"fixture":{"command":"node","env":{"TARGET":"src/file.ts"}}}}',
  });
  const server = await serve({ ...w, target: 'src/file.ts', user: false, clients: ['codex', 'claude'], trust: 'trusted' });
  const inspect = async (action: () => Promise<unknown>, target: string | null) => {
    const scanning = page.waitForResponse(response => new URL(response.url()).pathname === '/api/scan');
    await action();
    const response = await scanning;
    expect(response.status()).toBe(200);
    expect(new URL(response.url()).searchParams.get('target')).toBe(target);
    const captured = (await response.json()).report;
    expect(captured.clients.find((client: any) => client.client === 'codex').instructions).toBe('Nested instructions.');
    expect(captured.sessionDirectory).toBe(path.join(w.repo, 'src'));
    await expect(page.locator('#scan-status')).toHaveText('Scan complete');
  };
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      for (const query of ['', '?target=src/file.ts']) {
        await page.context().setOffline(false);
        await page.goto(server.url + query);
        await expect(page.locator('#target')).toHaveValue('[REDACTED]');
        await inspect(() => page.locator('#inspect').click(), query ? 'src/file.ts' : null);
        await page.locator('#target').focus();
        await inspect(() => page.locator('#target').press('Enter'), query ? 'src/file.ts' : null);
        const downloading = page.waitForEvent('download');
        await page.locator('#export').click();
        const file = test.info().outputPath(`unchanged-target-${viewport.width}-${Boolean(query)}.html`);
        await (await downloading).saveAs(file);
        const exported = await readFile(file, 'utf8');
        expect(exported).not.toContain('src/file.ts');
        expect(exported).not.toContain(w.repo);
        const captured = JSON.parse(exported.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/)![1]);
        expect(captured.target.replaceAll('\\', '/')).toBe('<repo>/[REDACTED]');
        expect(captured.sessionDirectory.replaceAll('\\', '/')).toBe('<repo>/src');
        await page.context().setOffline(true);
        await page.goto(pathToFileURL(file).href);
        await expect(page.locator('#target')).toHaveValue('[REDACTED]');
        const reexporting = page.waitForEvent('download');
        await page.locator('#export').click();
        const reexported = await readFile((await (await reexporting).path())!, 'utf8');
        expect(JSON.parse(reexported.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/)![1])).toEqual(captured);
      }
    }
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('Inspect preserves unchanged target spellings including whitespace, relative aliases and backslashes', async ({ page }) => {
  const w = await workspace({ 'AGENTS.md': 'Root instructions.', 'src/AGENTS.md': 'Nested instructions.', 'src/file.ts': '' });
  const options: ScanOptions = { ...w, user: false, clients: ['codex', 'claude'], trust: 'trusted' };
  const server = await serve(options);
  try {
    for (const target of ['src/ file.ts ', 'src/../src/file.ts', 'src\\file.ts']) {
      const baseline = JSON.parse(JSON.stringify(await scan({ ...options, target })));
      await page.goto(server.url + '?' + new URLSearchParams({ target }));
      const scanning = page.waitForResponse(response => new URL(response.url()).pathname === '/api/scan');
      await page.locator('#inspect').click();
      const response = await scanning;
      expect(response.status()).toBe(200);
      expect(new URL(response.url()).searchParams.get('target')).toBe(target);
      expect((await response.json()).report).toEqual(baseline);
    }
  } finally { await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('Codex rescans preserve a redacted profile from server defaults and explicit URLs', async ({ page }) => {
  const firstProfile = 'private-review-fixture';
  const secondProfile = 'private-audit-fixture';
  const w = await workspace({ '.mcp.json': JSON.stringify({ mcpServers: { fixture: { command: 'node', env: { FIRST: firstProfile, SECOND: secondProfile } } } }) }, {
    '.codex/config.toml': 'model="base-model"',
    [`.codex/${firstProfile}.config.toml`]: 'model="first-model"',
    [`.codex/${secondProfile}.config.toml`]: 'model="second-model"',
  });
  const server = await serve({ ...w, clients: ['codex', 'claude'], codexProfile: firstProfile });
  const rescan = async (action: () => Promise<unknown>, profile: string | null, model: string) => {
    const scanning = page.waitForResponse(response => new URL(response.url()).pathname === '/api/scan');
    await action();
    const response = await scanning;
    expect(response.status()).toBe(200);
    expect(new URL(response.url()).searchParams.get('profile')).toBe(profile);
    const captured = (await response.json()).report;
    expect(captured.clients.find((client: any) => client.client === 'codex').settings.find((setting: any) => setting.key === 'model' && setting.status === 'active').value).toBe(model);
    await expect(page.locator('#scan-status')).toHaveText('Scan complete');
  };
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      for (const query of ['', '?profile=' + firstProfile]) {
        await page.context().setOffline(false);
        await page.goto(server.url + query + '#view=configuration');
        const originalProfile = query ? firstProfile : null;
        await expect(page.locator('#codex-profile')).toHaveValue('[REDACTED]');
        await rescan(() => page.locator('#refresh').click(), originalProfile, 'first-model');
        await rescan(() => page.locator('#profile-form button').click(), originalProfile, 'first-model');
        await rescan(() => page.locator('#codex-profile').press('Enter'), originalProfile, 'first-model');
        await rescan(() => page.locator('#inspect').click(), originalProfile, 'first-model');
        if (viewport.width === 390) await page.locator('#mobile-menu').click();
        await page.locator('#effective-tab').click();
        if (viewport.width === 390) await page.locator('#mobile-menu').click();
        await page.locator('#configuration-tab').click();
        await page.locator('#codex-profile').fill(secondProfile);
        await rescan(() => page.locator('#profile-form button').click(), secondProfile, 'second-model');
        await expect(page.locator('#setting-list')).toContainText('second-model');
        await page.reload();
        await expect(page.locator('#codex-profile')).toHaveValue('[REDACTED]');
        await expect(page.locator('#setting-list')).toContainText('second-model');
        expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
        await page.screenshot({ path: test.info().outputPath(`redacted-profile-controls-${viewport.width}.png`), fullPage: true });
        await page.goBack();
        await page.goBack();
        await expect(page.locator('#setting-list')).toContainText('first-model');
        await expect(page.locator('#scan-status')).toHaveText('Scan complete');
        await page.goForward();
        await page.goForward();
        await expect(page.locator('#setting-list')).toContainText('second-model');
        await expect(page.locator('#scan-status')).toHaveText('Scan complete');
        const rejected = page.waitForResponse(response => new URL(response.url()).pathname === '/api/scan');
        await page.locator('#codex-profile').fill('invalid/profile');
        await page.locator('#profile-form button').click();
        expect((await rejected).status()).toBe(400);
        await expect(page.locator('#error')).toContainText('Profile names use letters');
        const downloading = page.waitForEvent('download');
        await page.locator('#export').click();
        const file = test.info().outputPath(`redacted-profile-${viewport.width}-${Boolean(query)}.html`);
        await (await downloading).saveAs(file);
        const exported = await readFile(file, 'utf8');
        for (const value of [firstProfile, secondProfile, w.repo, w.home]) expect(exported).not.toContain(value);
        const captured = JSON.parse(exported.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/)![1]);
        expect(captured.inputs.codexProfile).toBe('[REDACTED]');
        await page.locator('#codex-profile').fill('');
        await rescan(() => page.locator('#profile-form button').click(), '', 'base-model');
        await rescan(() => page.locator('#refresh').click(), '', 'base-model');
        await page.reload();
        await expect(page.locator('#codex-profile')).toHaveValue('');
        await expect(page.locator('#setting-list')).toContainText('base-model');
        await page.context().setOffline(true);
        await page.goto(pathToFileURL(file).href);
        await expect(page.locator('#setting-list')).toContainText('second-model');
        const reexporting = page.waitForEvent('download');
        await page.locator('#export').click();
        const reexported = await readFile((await (await reexporting).path())!, 'utf8');
        expect(JSON.parse(reexported.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/)![1])).toEqual(captured);
      }
    }
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('workspace trust remains selected when private text matches the trust name', async ({ page }) => {
  const w = await workspace({
    'AGENTS.md': 'Project instructions.\ntrusted\nauto\nuntrusted',
    '.mcp.json': '{"mcpServers":{"fixture":{"command":"node","env":{"A":"trusted","B":"auto","C":"untrusted"}}}}',
  });
  const server = await serve({ ...w, user: false, clients: ['codex', 'claude'], trust: 'trusted' });
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.context().setOffline(false);
      await page.setViewportSize(viewport);
      await page.goto(server.url);
      await expect(page.locator('#trust')).toHaveValue('trusted');
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
      const scanning = page.waitForResponse(response => new URL(response.url()).pathname === '/api/scan');
      await page.locator('#refresh').click();
      const response = await scanning;
      expect(new URL(response.url()).searchParams.get('trust')).toBe(null);
      const initialReport = (await response.json()).report;
      expect(initialReport.inputs.trust).toBe('trusted');
      const loaded = 'Project instructions.\n[REDACTED]\n[REDACTED]\n[REDACTED]';
      expect(initialReport.clients.find((client: any) => client.client === 'codex').instructions).toBe(loaded);
      if (viewport.width === 390) await page.locator('#mobile-menu').click();
      await page.locator('#configuration-tab').click();
      for (const trust of ['auto', 'trusted', 'untrusted']) {
        const changing = page.waitForResponse(response => new URL(response.url()).pathname === '/api/scan');
        await page.locator('#trust').selectOption(trust);
        const response = await changing;
        expect(response.status()).toBe(200);
        expect(new URL(response.url()).searchParams.get('trust')).toBe(trust);
        const report = (await response.json()).report;
        expect(report.inputs.trust).toBe(trust);
        expect(report.clients.find((client: any) => client.client === 'codex').instructions).toBe(trust === 'trusted' ? loaded : '');
        await expect(page.locator('#scan-status')).toHaveText('Scan complete');
        await expect(page.locator('#trust')).toHaveValue(trust);
      }
      await page.reload();
      await expect(page.locator('#trust')).toHaveValue('untrusted');
      await page.goBack();
      await expect(page.locator('#trust')).toHaveValue('trusted');
      await page.goForward();
      await expect(page.locator('#trust')).toHaveValue('untrusted');
      await page.screenshot({ path: test.info().outputPath(`redacted-trust-${viewport.width}.png`), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const downloading = page.waitForEvent('download');
      await page.locator('#export').click();
      const file = test.info().outputPath(`redacted-trust-${viewport.width}.html`);
      await (await downloading).saveAs(file);
      const captured = JSON.parse((await readFile(file, 'utf8')).match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/)![1]);
      expect(captured.inputs.trust).toBe('untrusted');
      expect(captured.sources.find((source: any) => source.relativePath === 'AGENTS.md').preview).toBe(loaded);
      await page.context().setOffline(true);
      await page.goto(pathToFileURL(file).href);
      await expect(page.locator('#trust')).toHaveValue('untrusted');
      await expect(page.locator('#trust-control')).not.toBeVisible();
      await page.locator('#session-button').click();
      await expect(page.locator('#assumptions')).toContainText('Workspace trust assumption is untrusted.');
      await page.screenshot({ path: test.info().outputPath(`offline-trust-scope-${viewport.width}.png`), fullPage: true });
      await page.getByRole('button', { name: 'Close scan details', exact: true }).click();
      const reexporting = page.waitForEvent('download');
      await page.locator('#export').click();
      const reexported = await readFile((await (await reexporting).path())!, 'utf8');
      expect(JSON.parse(reexported.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/)![1])).toEqual(captured);
    }
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('line comparison locates a changed instruction and retains context and source navigation online and offline', async ({ page }) => {
  const w = await workspace({
    'AGENTS.md': '# Project\nRun npm test.\nKeep changes focused.',
    'CLAUDE.md': '# Project\nRun pnpm test.\nKeep changes focused.',
  });
  const server = await serve({ ...w, user: false, clients: ['codex', 'claude'], trust: 'trusted' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.context().setOffline(false);
      await page.goto(server.url + '#view=compare');
      await expect(page.locator('#line-comparison-summary')).toContainText('1 line removed · 1 line added · 2 displayed lines align');
      await expect(page.locator('.comparison-line.removed .comparison-line-text')).toHaveText('Run npm test.');
      await expect(page.locator('.comparison-line.added .comparison-line-text')).toHaveText('Run pnpm test.');
      await expect(page.locator('.comparison-line.removed .comparison-line-number').first()).toHaveText('2');
      await expect(page.locator('.comparison-line.added .comparison-line-number').last()).toHaveText('2');
      await page.locator('#show-unchanged-lines').check();
      await expect(page.locator('.comparison-line')).toHaveCount(4);
      await expect(page.locator('.comparison-line.unchanged')).toHaveCount(2);
      await page.getByRole('button', { name: 'Inspect Codex sources', exact: true }).click();
      await expect(page.locator('#source-title')).toHaveText('AGENTS.md');
      await page.goBack();
      await expect(page.locator('#show-unchanged-lines')).toBeChecked();
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: /Export report/ }).click();
      const file = test.info().outputPath(`line-comparison-${viewport.width}.html`);
      await (await downloading).saveAs(file);
      const exported = await readFile(file, 'utf8');
      expect(exported).toContain('BSD 3-Clause License');
      expect(exported).toContain('Kevin Decker');
      await page.context().setOffline(true);
      await page.goto(pathToFileURL(file).href);
      await expect(page.locator('.comparison-line')).toHaveCount(4);
      await page.reload();
      await expect(page.locator('.comparison-line')).toHaveCount(4);
      await page.screenshot({ path: test.info().outputPath(`line-comparison-${viewport.width}.png`), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    expect(errors).toEqual([]);
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('line comparison pair selection survives history, refresh and offline re-export and follows selected clients', async ({ page }) => {
  const w = await workspace({ 'AGENTS.md': 'Shared.\nCodex line.', 'CLAUDE.md': 'Shared.\nClaude line.', 'GEMINI.md': 'Shared.\nGemini line.' });
  const server = await serve({ ...w, user: false, clients: ['codex', 'claude', 'gemini'], trust: 'trusted' });
  const exportReport = async (name: string) => {
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath(name);
    await (await downloading).saveAs(file);
    return pathToFileURL(file).href;
  };
  try {
    await page.goto(server.url + '#view=compare');
    await page.getByRole('combobox', { name: 'Right text', exact: true }).selectOption('gemini');
    await page.getByRole('combobox', { name: 'Left text', exact: true }).selectOption('claude');
    await expect(page.locator('#line-comparison-summary')).toContainText('removed');
    await page.reload();
    await expect(page.locator('#line-left')).toHaveValue('claude');
    await expect(page.locator('#line-right')).toHaveValue('gemini');
    await page.locator('#refresh').click();
    await expect(page.locator('#scan-status')).toHaveText('Scan complete');
    await expect(page.locator('#line-left')).toHaveValue('claude');
    const file = await exportReport('selected-line-comparison.html');
    await page.context().setOffline(true);
    await page.goto(file);
    await expect(page.locator('#line-left')).toHaveValue('claude');
    await expect(page.locator('#line-right')).toHaveValue('gemini');
    await page.getByRole('combobox', { name: 'Left text', exact: true }).selectOption('gemini');
    await expect(page.locator('#line-right')).toHaveValue('claude');
    await page.goBack();
    await expect(page.locator('#line-left')).toHaveValue('claude');
    await expect(page.locator('#line-right')).toHaveValue('gemini');
    await page.locator('#show-unchanged-lines').check();
    const second = await exportReport('reshared-line-comparison.html');
    await page.goto(second);
    await expect(page.locator('#line-left')).toHaveValue('claude');
    await expect(page.locator('#line-right')).toHaveValue('gemini');
    await expect(page.locator('#show-unchanged-lines')).toBeChecked();
    await page.locator('#compare-clients').getByRole('button', { name: 'Claude Code', exact: true }).click();
    await expect(page.locator('#line-left')).toHaveValue('codex');
    await expect(page.locator('#line-right')).toHaveValue('gemini');
    await page.locator('#compare-clients').getByRole('button', { name: 'Codex', exact: true }).click();
    await expect(page.locator('#line-comparison-result')).toContainText('Choose two clients');
    await expect(page.locator('#line-left')).toBeDisabled();
    await expect(page.locator('#line-right')).toBeDisabled();
    await page.locator('#compare-clients').getByRole('button', { name: 'Claude Code', exact: true }).click();
    await expect(page.locator('#line-left')).toHaveValue('gemini');
    await expect(page.locator('#line-right')).toHaveValue('claude');
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('line comparison reconstructs full displayed text for repeats, whitespace, line endings, empty and legacy reports', async ({ page }) => {
  const report = await scan({ repo: path.resolve('examples/broken-agent-config'), user: false, trust: 'trusted', clients: ['codex', 'claude'] });
  delete report.instructionDiff;
  const cases = [
    { left: 'One.\nTwo.\nOne.\nEnd.', right: 'One.\nOne.\nTwo.\nEnd.' },
    { left: 'Start.\r\n  Indent.\r\nKeep trailing space. \r\nEnd.', right: 'Start.\nIndent.\nKeep trailing space.\nEnd.' },
    { left: 'Final newline.\n', right: 'Final newline.' },
    { left: '', right: 'Only right.\n\n' },
    { left: 'Only left.', right: '' },
    { left: '', right: '' },
    { left: 'password=private-left-value\nSafe.', right: 'password=private-right-value\nSafe.' },
    { left: '<script>window.untrusted = true</script>\n日本語の指示。', right: '<script>window.untrusted = false</script>\n日本語の指示。' },
  ];
  for (const [index, scenario] of cases.entries()) {
    const current = structuredClone(report);
    current.clients[0].instructions = scenario.left;
    current.clients[1].instructions = scenario.right;
    const file = test.info().outputPath(`line-cases-${index}.html`);
    await writeFile(file, html(current));
    await page.goto(pathToFileURL(file).href + '#view=compare&unchanged=show');
    await expect(page.locator('#line-comparison-summary')).not.toHaveText('Comparing effective text…');
    const reconstructed = await page.locator('.comparison-line').evaluateAll(rows => {
      let left = '', right = '';
      for (const row of rows) {
        const code = row.querySelector('.comparison-line-text')!;
        const text = (code.firstChild?.textContent ?? '') + (code.querySelector('.line-ending-note') ? '' : '\n');
        if (!row.classList.contains('added')) left += text;
        if (!row.classList.contains('removed')) right += text;
      }
      return { left, right };
    });
    const displayed = portable(current).clients;
    expect(reconstructed).toEqual({ left: displayed[0].instructions.replaceAll('\r\n', '\n'), right: displayed[1].instructions.replaceAll('\r\n', '\n') });
    for (const value of ['private-left-value', 'private-right-value']) expect(await readFile(file, 'utf8')).not.toContain(value);
    if (index === 0) {
      await expect(page.locator('.line-comparison-legend .removed')).toHaveText('− Codex');
      await expect(page.locator('.line-comparison-legend .added')).toHaveText('+ Claude Code');
      await expect(page.locator('#line-comparison-summary')).toContainText('1 line removed · 1 line added');
    }
    expect(await page.evaluate(() => (window as any).untrusted)).toBeUndefined();
  }
});

test('line comparison rejects stale results and paginates complete replacements after its calculation budget', async ({ page }) => {
  const w = await workspace({ 'AGENTS.md': 'Codex.', 'CLAUDE.md': 'Claude.', 'GEMINI.md': Array.from({ length: 450 }, (_, index) => `Gemini ${index}.`).join('\n') });
  const server = await serve({ ...w, user: false, clients: ['codex', 'claude', 'gemini'], trust: 'trusted' });
  try {
    await page.goto(server.url + '#view=compare');
    await expect(page.locator('#line-comparison-summary')).toContainText('removed');
    await page.evaluate(() => {
      (window as any).pendingLineComparisons = [];
      (window as any).Diff.diffLines = (_left: string, _right: string, options: any) => (window as any).pendingLineComparisons.push(options.callback);
    });
    await page.getByRole('combobox', { name: 'Right text', exact: true }).selectOption('gemini');
    await page.getByRole('combobox', { name: 'Left text', exact: true }).selectOption('claude');
    await page.evaluate(() => (window as any).pendingLineComparisons[0]([{ removed: true, count: 1, value: 'STALE_RESULT' }]));
    await expect(page.locator('#line-comparison-summary')).toHaveText('Comparing effective text…');
    await expect(page.locator('#line-comparison-result')).not.toContainText('STALE_RESULT');
    await page.evaluate(() => (window as any).pendingLineComparisons[1](undefined));
    await expect(page.locator('#line-comparison-result')).toContainText('Complete text replacements');
    await expect(page.locator('.comparison-line')).toHaveCount(200);
    await page.getByRole('button', { name: 'Show 200 more lines', exact: true }).click();
    await expect(page.locator('.comparison-line')).toHaveCount(400);
    await expect(page.locator('.comparison-line').nth(200)).toBeFocused();
    await expect(page.locator('#line-left')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('#line-right')).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => (window as any).pendingLineComparisons.length)).toBe(2);
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('expanded-line-comparison.html');
    await (await downloading).saveAs(file);
    await page.context().setOffline(true);
    await page.goto(pathToFileURL(file).href);
    await expect(page.locator('.comparison-line')).toHaveCount(400);
    await expect(page.locator('#line-left')).toHaveValue('claude');
    await expect(page.locator('#line-right')).toHaveValue('gemini');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.comparison-line').nth(200).focus();
    await expect(page.locator('#line-left')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('#line-right')).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('comparison context survives reload, refresh, export and offline re-export on desktop and phone', async ({ page }) => {
  const w = await workspace({
    'AGENTS.md': 'SHARED_GUIDANCE\n\nCODEX_GUIDANCE',
    'CLAUDE.md': 'CLAUDE_GUIDANCE',
    '.github/copilot-instructions.md': 'COPILOT_GUIDANCE',
    'GEMINI.md': 'SHARED_GUIDANCE\n\nGEMINI_GUIDANCE',
  });
  const server = await serve({ ...w, user: false, trust: 'trusted', clients: ['codex', 'claude', 'copilot', 'gemini'] });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const expectComparison = async (clients: string[], content: string, differences: boolean) => {
    await expect(page.locator('#compare')).toBeVisible();
    await expect(page.locator('#compare-clients button[aria-pressed="true"]')).toHaveText(clients);
    await expect(page.locator('#content-filter')).toHaveValue(content);
    await expect(page.locator('#differences-only')).toBeChecked({ checked: differences });
  };
  const exportReport = async (filename: string) => {
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath(filename);
    await (await downloading).saveAs(file);
    return pathToFileURL(file).href;
  };
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.context().setOffline(false);
      await page.goto(server.url + '#view=compare');
      const choices = page.locator('#compare-clients');
      await choices.getByRole('button', { name: 'Claude Code', exact: true }).click();
      await choices.getByRole('button', { name: 'GitHub Copilot', exact: true }).click();
      await choices.getByRole('button', { name: 'Gemini CLI', exact: true }).click();
      await page.locator('#content-filter').selectOption('shared');
      await page.locator('#differences-only').uncheck();
      await expectComparison(['Codex', 'Gemini CLI'], 'shared', false);
      await expect(page.locator('#comparison-blocks .instruction-block')).toHaveCount(1);
      await page.reload();
      await expectComparison(['Codex', 'Gemini CLI'], 'shared', false);
      await page.locator('#refresh').click();
      await expect(page.locator('#scan-status')).toHaveText('Scan complete');
      await expectComparison(['Codex', 'Gemini CLI'], 'shared', false);
      const first = await exportReport(`comparison-context-${viewport.width}.html`);
      await page.context().setOffline(true);
      await page.goto(first);
      await expectComparison(['Codex', 'Gemini CLI'], 'shared', false);
      await expect(page.locator('#comparison-blocks .instruction-block')).toHaveCount(1);
      await page.screenshot({ path: test.info().outputPath(`comparison-context-${viewport.width}.png`), fullPage: true });
      await page.locator('#compare-clients').getByRole('button', { name: 'Codex', exact: true }).click();
      await page.locator('#content-filter').selectOption('different');
      await page.locator('#differences-only').check();
      const second = await exportReport(`comparison-context-reshared-${viewport.width}.html`);
      await page.goto(second);
      await expectComparison(['Gemini CLI'], 'different', true);
      await page.reload();
      await expectComparison(['Gemini CLI'], 'different', true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    expect(errors).toEqual([]);
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('comparison history restores each selection and filter and source navigation returns to its comparison', async ({ page }) => {
  const w = await workspace({ 'AGENTS.md': 'CODEX_GUIDANCE', 'CLAUDE.md': 'CLAUDE_GUIDANCE', 'GEMINI.md': 'GEMINI_GUIDANCE' });
  const server = await serve({ ...w, user: false, trust: 'trusted', clients: ['codex', 'claude', 'gemini'] });
  try {
    await page.goto(server.url + '#view=compare');
    const choices = page.locator('#compare-clients');
    const claude = choices.getByRole('button', { name: 'Claude Code', exact: true });
    await claude.focus();
    await page.keyboard.press('Enter');
    await expect(claude).toBeFocused();
    await expect(claude).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#content-filter').selectOption('different');
    await page.locator('#differences-only').uncheck();
    await page.locator('#comparison-text .comparison-document').first().getByRole('button', { name: /Trace this instruction chain/ }).click();
    await expect(page.locator('#effective-title')).toHaveText('Codex’s instructions');
    await page.goBack();
    await expect(page.locator('#compare')).toBeVisible();
    await expect(page.locator('#compare-clients button[aria-pressed="true"]')).toHaveText(['Codex', 'Gemini CLI']);
    await expect(page.locator('#content-filter')).toHaveValue('different');
    await expect(page.locator('#differences-only')).not.toBeChecked();
    await page.goBack();
    await expect(page.locator('#differences-only')).toBeChecked();
    await expect(page.locator('#content-filter')).toHaveValue('different');
    await page.goBack();
    await expect(page.locator('#content-filter')).toHaveValue('all');
    await expect(claude).toHaveAttribute('aria-pressed', 'false');
    await page.goBack();
    await expect(claude).toHaveAttribute('aria-pressed', 'true');
    await page.goForward();
    await expect(claude).toHaveAttribute('aria-pressed', 'false');
  } finally { await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('comparison paragraph expansion persists and invalid links recover to available clients and default filters', async ({ page }) => {
  const instructions = Array.from({ length: 205 }, (_, index) => `Instruction paragraph ${index + 1}.`).join('\n\n');
  const w = await workspace({ 'AGENTS.md': instructions, 'CLAUDE.md': instructions });
  const server = await serve({ ...w, user: false, trust: 'trusted', clients: ['codex', 'claude'] });
  try {
    await page.goto(server.url + '#view=compare');
    await expect(page.locator('#comparison-blocks .instruction-block')).toHaveCount(100);
    await page.getByRole('button', { name: 'Show 100 more paragraphs', exact: true }).click();
    await expect(page.locator('#comparison-blocks .instruction-block')).toHaveCount(200);
    await page.reload();
    await expect(page.locator('#comparison-blocks .instruction-block')).toHaveCount(200);
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('comparison-expanded-paragraphs.html');
    await (await downloading).saveAs(file);
    await page.context().setOffline(true);
    await page.goto(pathToFileURL(file).href);
    await expect(page.locator('#comparison-blocks .instruction-block')).toHaveCount(200);
    await page.getByRole('button', { name: 'Show 5 more paragraphs', exact: true }).click();
    await expect(page.locator('#comparison-blocks .instruction-block')).toHaveCount(205);
    await page.goBack();
    await expect(page.locator('#comparison-blocks .instruction-block')).toHaveCount(200);
    await page.context().setOffline(false);
    await page.goto(server.url + '#view=compare&clients=unavailable,codex,codex&content=unsupported&differences=invalid&paragraphs=-100');
    await expect(page.locator('#compare-clients button[aria-pressed="true"]')).toHaveText(['Codex']);
    await expect(page.locator('#content-filter')).toHaveValue('all');
    await expect(page.locator('#differences-only')).toBeChecked();
    await expect(page.locator('#comparison-blocks .instruction-block')).toHaveCount(100);
    await page.goto(server.url + '#view=compare&clients=unavailable&paragraphs=Infinity');
    await expect(page.locator('#compare-clients button[aria-pressed="true"]')).toHaveText(['Codex', 'Claude Code']);
    await expect(page.locator('#comparison-blocks .instruction-block')).toHaveCount(100);
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('extension comparison exposes every active and conditional definition and status-only differences', async ({ page }) => {
  const userConfig = '[mcp_servers.fixture]\ncommand=' + JSON.stringify(process.execPath) + '\nargs=["user.js"]';
  const w = await workspace({ 'AGENTS.md': 'PROJECT', '.codex/config.toml': '[mcp_servers.fixture]\nargs=["project.js"]' }, {
    '.codex/config.toml': userConfig,
    '.copilot/mcp-config.json': JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: ['user.js'] } } }),
  });
  const server = await serve({ ...w, clients: ['codex', 'copilot'] });
  try {
    await page.goto(server.url + '#view=compare');
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('comparison-extension-candidates.html');
    await (await pending).saveAs(file);
    for (const url of [server.url, pathToFileURL(file).href]) {
      await page.context().setOffline(url.startsWith('file:'));
      for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        await page.goto(url + '#view=compare');
        const row = page.locator('#comparison-extensions tbody tr').filter({ hasText: 'fixture' });
        const cell = row.locator('td').nth(1);
        await expect(cell.getByRole('button')).toHaveCount(2);
        await cell.getByRole('button', { name: /^Conditional / }).click();
        await expect(page.locator('#detail-dialog')).toContainText('project.js');
        await page.keyboard.press('Escape');
        await cell.getByRole('button', { name: /^Loaded / }).click();
        await expect(page.locator('#detail-dialog')).toContainText('user.js');
        await expect(page.locator('#detail-dialog')).not.toContainText('project.js');
        await page.keyboard.press('Escape');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
    await page.context().setOffline(false);
    await page.goto(server.url + '#view=compare');
    await page.locator('#trust').selectOption('trusted');
    await expect(page.locator('#scan-status')).toHaveText('Scan complete');
    const cell = page.locator('#comparison-extensions tbody tr').filter({ hasText: 'fixture' }).locator('td').nth(1);
    await expect(cell.getByRole('button')).toHaveCount(1);
    await cell.getByRole('button', { name: /^Loaded / }).click();
    await expect(page.locator('#detail-dialog')).toContainText('project.js');
    await page.keyboard.press('Escape');
    await writeFile(path.join(w.home, '.codex/config.toml'), '# User server removed');
    await writeFile(path.join(w.repo, '.codex/config.toml'), userConfig);
    await page.locator('#trust').selectOption('auto');
    await expect(page.locator('#scan-status')).toHaveText('Scan complete');
    const row = page.locator('#comparison-extensions tbody tr').filter({ hasText: 'fixture' });
    await expect(row.locator('td').nth(1).getByRole('button', { name: /^Conditional / })).toBeVisible();
    await expect(row.locator('td').nth(2).getByRole('button', { name: /^Loaded / })).toBeVisible();
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('extension comparison preserves permission names containing a pipe', async ({ page }) => {
  const rule = 'Bash(echo hi | cat)';
  const w = await workspace({
    'AGENTS.md': 'PROJECT', 'CLAUDE.md': 'CLAUDE', '.claude/settings.json': JSON.stringify({ permissions: { allow: [rule] } }),
  });
  const server = await serve({ ...w, clients: ['codex', 'claude'], user: false, trust: 'trusted' });
  try {
    await page.goto(server.url + '#view=compare');
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('comparison-permission-name.html');
    await (await pending).saveAs(file);
    for (const url of [server.url, pathToFileURL(file).href]) {
      await page.context().setOffline(url.startsWith('file:'));
      await page.goto(url + '#view=compare');
      const row = page.locator('#comparison-extensions tbody tr').filter({ hasText: rule });
      await expect(row).toHaveCount(1);
      await row.locator('td').nth(2).getByRole('button', { name: 'Loaded allow', exact: true }).click();
      await expect(page.locator('#detail-dialog')).toContainText(rule);
    }
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('instruction coverage includes structured imports and their client-specific roles', async ({ page }) => {
  const secret = 'comparison-private-import-value';
  const w = await workspace({
    'CLAUDE.md': 'CLAUDE_BASE',
    'GEMINI.md': 'BEGIN\n@./.claude/settings.json\n@./.gemini/settings.json\nEND',
    '.claude/settings.json': JSON.stringify({ model: 'fixture-model', env: { NORMAL: secret } }),
    '.gemini/settings.json': '{"model":{"name":"fixture-gemini-model"}}',
  });
  const server = await serve({ ...w, clients: ['claude', 'gemini'], user: false, trust: 'trusted' });
  try {
    await page.goto(server.url + '#view=compare');
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('comparison-structured-imports.html');
    await (await pending).saveAs(file);
    for (const url of [server.url, pathToFileURL(file).href]) {
      await page.context().setOffline(url.startsWith('file:'));
      for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        await page.goto(url + '#view=compare');
        const claudeSettings = page.locator('#comparison-matrix tbody tr').filter({ hasText: '.claude/settings.json' });
        await expect(claudeSettings).toHaveCount(1);
        await claudeSettings.locator('td').nth(1).getByRole('button', { name: 'Settings', exact: true }).click();
        await expect(page.locator('#effective-title')).toHaveText('Claude Code’s instructions');
        await expect(page.locator('#source-title')).toHaveText('.claude/settings.json');
        await expect(page.locator('#settings')).toContainText('fixture-model');
        await page.goto(url + '#view=compare');
        await claudeSettings.locator('td').nth(2).getByRole('button', { name: 'Loaded', exact: true }).click();
        await expect(page.locator('#effective-title')).toHaveText('Gemini CLI’s instructions');
        await expect(page.locator('#source-title')).toHaveText('.claude/settings.json');
        await expect(page.locator('#why')).toContainText('Imported from GEMINI.md:2');
        await page.goto(url + '#view=compare');
        const geminiSettings = page.locator('#comparison-matrix tbody tr').filter({ hasText: '.gemini/settings.json' });
        await geminiSettings.locator('td').nth(2).getByRole('button', { name: 'Loaded', exact: true }).click();
        await expect(page.locator('#why')).toContainText('Imported from GEMINI.md:3');
        expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('occurrence')).toBe('2');
        expect(await page.content()).not.toContain(secret);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('instruction coverage retains mixed contribution states and exact occurrences', async ({ page }) => {
  const w = await workspace({
    'CLAUDE.md': 'CLAUDE_BASE', 'GEMINI.md': 'PROJECT', '.gemini/settings.json': '{"context":{"importFormat":"flat"}}',
  }, { '.gemini/GEMINI.md': 'GLOBAL\n@./shared.md\nAFTER', '.gemini/shared.md': 'SHARED' });
  const options = { ...w, clients: ['claude', 'gemini'] as const };
  const report = await scan(options);
  const contributions = report.clients.find(client => client.client === 'gemini')!.decisions.filter(source => source.path === path.join(w.home, '.gemini/GEMINI.md'));
  expect(contributions.map(source => source.status)).toEqual(['active', 'active', 'conditional']);
  const ordered = [...contributions].sort((left, right) => (left.order ?? Infinity) - (right.order ?? Infinity));
  const conditionalOccurrence = ordered.indexOf(contributions[2]) + 1;
  const laterOccurrence = ordered.indexOf(contributions[1]) + 1;
  const server = await serve(options);
  try {
    await page.goto(server.url + '#view=compare');
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('comparison-mixed-contributions.html');
    await (await pending).saveAs(file);
    for (const url of [server.url, pathToFileURL(file).href]) {
      await page.context().setOffline(url.startsWith('file:'));
      for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        await page.goto(url + '#view=compare');
        await expect(page.locator('#comparison-text .comparison-document').filter({ hasText: 'Gemini CLI' }).locator('.comparison-document-meta')).toContainText('2 sources loaded');
        const row = page.locator('#comparison-matrix tbody tr').filter({ hasText: '.gemini/GEMINI.md' });
        const cell = row.locator('td').nth(2);
        await expect(cell).toContainText('2 contributions');
        expect((await row.locator('.source-path').boundingBox())!.width).toBeLessThanOrEqual(320);
        await cell.getByRole('button', { name: 'Conditional', exact: true }).click();
        await expect(page.locator('#source-status')).toHaveText('Conditional');
        expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('occurrence')).toBe(String(conditionalOccurrence));
        await page.goto(url + '#view=compare');
        await cell.getByRole('button', { name: 'Loaded 2 contributions', exact: true }).click();
        await expect(page.locator('#detail-dialog')).toBeVisible();
        expect(await page.locator('#detail-dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
        expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
        await page.screenshot({ path: test.info().outputPath(`comparison-contributions-${url.startsWith('file:') ? 'offline' : 'live'}-${viewport.width}.png`) });
        await page.getByRole('button', { name: new RegExp(`Occurrence ${laterOccurrence}\\b`) }).click();
        await expect(page.locator('#detail-dialog')).not.toBeVisible();
        await expect(page.locator('#source-status')).toHaveText('Loaded');
        await expect(page.locator('#source-title')).toBeFocused();
        await expect(page.locator('.code-line.highlight .line-number')).toHaveText(String(contributions[1].line));
        expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('occurrence')).toBe(String(laterOccurrence));
      }
    }
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('instruction differences include later repeated contributions in current and legacy reports', async ({ page }) => {
  const w = await workspace({
    'AGENTS.md': 'SHARED', 'GEMINI.md': '@./AGENTS.md', '.gemini/settings.json': '{"context":{"fileName":"AGENTS.md"}}',
  });
  const options = { ...w, clients: ['claude', 'gemini'] as const, user: false, trust: 'trusted' as const };
  const report = await scan(options);
  delete report.instructionDiff;
  const file = test.info().outputPath('comparison-legacy-contributions.html');
  await writeFile(file, html(report));
  const server = await serve(options);
  try {
    for (const url of [server.url, pathToFileURL(file).href]) {
      await page.context().setOffline(url.startsWith('file:'));
      await page.goto(url + '#view=compare');
      const row = page.locator('#comparison-matrix tbody tr').filter({ hasText: 'AGENTS.md' });
      await expect(row).toHaveCount(1);
      await expect(page.locator('#differences-only')).toBeChecked();
      await row.locator('td').nth(2).getByRole('button', { name: 'Loaded 2 contributions', exact: true }).click();
      await page.getByRole('button', { name: /Occurrence 2/ }).click();
      await expect(page.locator('#source-title')).toHaveText('AGENTS.md');
      await expect(page.locator('#why')).toContainText('Imported from GEMINI.md:1');
      expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('occurrence')).toBe('2');
    }
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('first scans explain conditional instruction loading through trust changes and offline export', async ({ page }) => {
  const w = await workspace({
    'AGENTS.md': 'PROJECT_INSTRUCTION', '.codex/config.toml': 'model="fixture-model"',
  }, { '.codex/AGENTS.md': 'GLOBAL_INSTRUCTION' });
  const server = await serve({ ...w, clients: ['codex'] });
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await writeFile(path.join(w.repo, 'AGENTS.md'), 'PROJECT_INSTRUCTION');
      await page.setViewportSize(viewport);
      await page.goto(server.url);
      await expect(page.locator('#overview-heading')).toHaveText('No configuration issues found.');
      await expect(page.locator('#client-overview')).toContainText('1 loaded instruction source');
      await expect(page.locator('#client-overview')).toContainText('1 conditional');
      const inspect = page.getByRole('button', { name: 'Inspect conditional loading', exact: true });
      await expect(inspect).toBeVisible();
      await expect(inspect).toBeInViewport();
      expect((await inspect.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
      await page.screenshot({ path: test.info().outputPath(`first-loading-overview-${viewport.width}.png`), fullPage: true });
      await inspect.click();
      await expect(page.locator('#source-title')).toHaveText('AGENTS.md');
      await expect(page.locator('#source-title')).toBeFocused();
      await expect(page.locator('#source-status')).toHaveText('Conditional');
      await expect(page.locator('#why')).toContainText('Project trust is unknown');
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: /Export report/ }).click();
      const file = test.info().outputPath(`first-loading-${viewport.width}.html`);
      await (await pending).saveAs(file);
      await page.context().setOffline(true);
      await page.goto(pathToFileURL(file).href + '#view=overview');
      await page.getByRole('button', { name: 'Inspect conditional loading', exact: true }).click();
      await expect(page.locator('#source-title')).toHaveText('AGENTS.md');
      await expect(page.locator('#source-status')).toHaveText('Conditional');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.context().setOffline(false);
      await page.goto(server.url);
      await page.locator('#trust').selectOption('trusted');
      await expect(page.locator('#scan-status')).toHaveText('Scan complete');
      await expect(page.locator('#client-overview')).toContainText('2 loaded instruction sources');
      await expect(page.locator('#trust-notice')).toBeHidden();
      await page.locator('#trust').selectOption('untrusted');
      await expect(page.locator('#scan-status')).toHaveText('Scan complete');
      await expect(page.locator('#client-overview')).toContainText('1 loaded instruction source');
      await expect(page.locator('#trust-notice')).toBeHidden();
      expect(await readFile(path.join(w.repo, 'AGENTS.md'), 'utf8')).toBe('PROJECT_INSTRUCTION');
      await rm(path.join(w.repo, 'AGENTS.md'));
      await page.locator('#trust').selectOption('auto');
      await expect(page.locator('#scan-status')).toHaveText('Scan complete');
      await page.getByRole('button', { name: 'Inspect conditional loading', exact: true }).click();
      await expect(page.locator('#source-title')).toHaveText('.codex/config.toml');
      await expect(page.locator('#source-status')).toHaveText('Conditional');
    }
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('conditional loading opens the correct repeated Gemini source occurrence', async ({ page }) => {
  const w = await workspace({
    'GEMINI.md': 'PROJECT', '.gemini/settings.json': '{"context":{"importFormat":"flat"}}',
  }, { '.gemini/GEMINI.md': 'GLOBAL\n@./shared.md\nMIDDLE\n@./shared.md\nEND', '.gemini/shared.md': 'SHARED' });
  const options = { ...w, clients: ['gemini'] as const };
  const report = await scan(options);
  const entries = [...report.clients[0].decisions].sort((left, right) => (left.order ?? Infinity) - (right.order ?? Infinity));
  const conditional = entries.find(source => source.status === 'conditional' && source.kind === 'instructions')!;
  const occurrence = entries.filter(source => source.path === conditional.path).indexOf(conditional) + 1;
  expect(occurrence).toBeGreaterThan(1);
  const server = await serve(options);
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.goto(server.url);
      await expect(page.locator('#client-overview')).toContainText('2 loaded instruction sources');
      await page.getByRole('button', { name: 'Inspect conditional loading', exact: true }).click();
      await expect(page.locator('#source-status')).toHaveText('Conditional');
      expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('occurrence')).toBe(String(occurrence));
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: /Export report/ }).click();
      const file = test.info().outputPath(`conditional-occurrence-${viewport.width}.html`);
      await (await pending).saveAs(file);
      await page.context().setOffline(true);
      await page.goto(pathToFileURL(file).href + '#view=overview');
      await page.getByRole('button', { name: 'Inspect conditional loading', exact: true }).click();
      await expect(page.locator('#source-status')).toHaveText('Conditional');
      expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('occurrence')).toBe(String(occurrence));
      await page.context().setOffline(false);
    }
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('first-scan loading counts preserve distinct private source identities online and offline', async ({ page }) => {
  const w = await workspace({
    '.claude/rules/first-label.md': 'First guidance.', '.claude/rules/second-label.md': 'Second guidance.',
    '.mcp.json': JSON.stringify({ mcpServers: { fixture: { command: process.execPath, env: { FIRST: 'first-label', SECOND: 'second-label' } } } }),
  });
  const server = await serve({ ...w, clients: ['claude'], user: false, trust: 'trusted' });
  try {
    await page.goto(server.url);
    await expect(page.locator('#client-overview')).toContainText('2 loaded instruction sources');
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('first-loading-private-paths.html');
    await (await pending).saveAs(file);
    for (const value of ['first-label', 'second-label']) expect(await readFile(file, 'utf8')).not.toContain(value);
    await page.context().setOffline(true);
    await page.goto(pathToFileURL(file).href);
    await expect(page.locator('#client-overview')).toContainText('2 loaded instruction sources');
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('relative Gemini homes follow the selected session through target changes, refresh and offline export', async ({ page }) => {
  const secret = 'browser-relative-gemini-home-private';
  const settings = JSON.stringify({ security: { folderTrust: { enabled: false } }, mcpServers: { fixture: { command: process.execPath, env: { NORMAL: secret } } } });
  const w = await workspace({
    'GEMINI.md': 'PROJECT_INSTRUCTION', 'src/file.ts': '',
    'context-home/.gemini/settings.json': settings,
    'context-home/.gemini/GEMINI.md': 'ROOT_HOME_INSTRUCTION\n' + secret,
    'src/context-home/.gemini/settings.json': settings,
    'src/context-home/.gemini/GEMINI.md': 'NESTED_HOME_INSTRUCTION\n' + secret,
  });
  const options = { repo: w.repo, clients: ['gemini'] as const, env: { PATH: process.env.PATH, GEMINI_CLI_HOME: './context-home' } };
  const server = await serve(options);
  try {
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: {
      writeText: async (text: string) => { (window as any).copiedInstructions = text; },
    }, configurable: true }));
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await writeFile(path.join(w.repo, 'src/context-home/.gemini/GEMINI.md'), 'NESTED_HOME_INSTRUCTION\n' + secret);
      await page.goto(server.url + '#view=effective&client=gemini&text=effective');
      await expect(page.locator('#effective-document .effective-text')).toContainText('ROOT_HOME_INSTRUCTION');
      await page.locator('#target').fill('src/file.ts');
      await page.locator('#inspect').click();
      await expect(page.locator('#effective-document .effective-text')).toContainText('NESTED_HOME_INSTRUCTION');
      await expect(page.locator('#effective-document .effective-text')).not.toContainText('ROOT_HOME_INSTRUCTION');
      await writeFile(path.join(w.repo, 'src/context-home/.gemini/GEMINI.md'), 'REFRESHED_HOME_INSTRUCTION\n' + secret);
      await page.getByRole('button', { name: 'Refresh scan', exact: true }).click();
      await expect(page.locator('#effective-document .effective-text')).toContainText('REFRESHED_HOME_INSTRUCTION');
      const text = await page.locator('#effective-document .effective-text').textContent();
      expect(text).not.toContain(secret);
      await page.getByRole('button', { name: 'Copy effective text', exact: true }).click();
      expect(await page.evaluate(() => (window as any).copiedInstructions)).toBe(text);
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: /Export report/ }).click();
      const file = test.info().outputPath(`gemini-relative-home-${viewport.width}.html`);
      await (await pending).saveAs(file);
      const exported = await readFile(file, 'utf8');
      expect(exported).not.toContain(secret);
      expect(exported).not.toContain(JSON.stringify(w.root).slice(1, -1));
      const portableText = portable(await scan({ ...options, target: 'src/file.ts' })).clients[0].instructions;
      await page.context().setOffline(true);
      await page.goto(pathToFileURL(file).href);
      expect(await page.locator('#effective-document .effective-text').textContent()).toBe(portableText);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`gemini-relative-home-${viewport.width}.png`) });
      await page.context().setOffline(false);
    }
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true, maxRetries: 5 }); }
});

test('Gemini private trust aliases stay concealed in source views, refresh and offline reports', async ({ page }) => {
  const w = await workspace({ 'GEMINI.md': 'PROJECT_INSTRUCTION', 'CLAUDE.md': 'CLAUDE_INSTRUCTION' });
  const directory = path.join(w.repo, 'private-state');
  await mkdir(directory);
  await symlink(directory, path.join(w.repo, '.claude'), process.platform === 'win32' ? 'junction' : 'dir');
  const filename = path.join(directory, 'settings.local.json');
  const marker = 'UNRELATED_BROWSER_GEMINI_PROJECT';
  const saveTrust = (level: string) => writeFile(filename, JSON.stringify({ [marker]: 'DO_NOT_TRUST', [w.repo]: level }));
  await saveTrust('TRUST_FOLDER');
  const server = await serve({ ...w, clients: ['claude', 'gemini'], env: { PATH: process.env.PATH, GEMINI_CLI_TRUSTED_FOLDERS_PATH: filename } });
  const selection = '#view=effective&client=claude&source=.claude/settings.local.json';
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await saveTrust('TRUST_FOLDER');
      await page.goto(server.url + selection);
      await page.reload();
      for (const level of ['TRUST_FOLDER', 'DO_NOT_TRUST']) {
        await saveTrust(level);
        const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/scan');
        await page.getByRole('button', { name: 'Refresh scan', exact: true }).click();
        const { report } = await (await refreshed).json();
        await expect(page.locator('#scan-status')).toHaveText('Scan complete');
        await expect(page.locator('#source-title')).toHaveText('.claude/settings.local.json');
        expect(await page.locator('body').textContent()).not.toContain(marker);
        expect(JSON.stringify(report)).not.toContain(marker);
        expect(report.sources.find((source: any) => source.relativePath === '.claude/settings.local.json').preview).toBeUndefined();
        expect(report.clients.find((client: any) => client.client === 'gemini').instructions.includes('PROJECT_INSTRUCTION')).toBe(level === 'TRUST_FOLDER');
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name: /Export report/ }).click();
        const file = test.info().outputPath(`gemini-private-alias-${level}-${viewport.width}.html`);
        await (await pending).saveAs(file);
        const exported = await readFile(file, 'utf8');
        expect(exported).not.toContain(marker);
        expect(exported).not.toContain(JSON.stringify(w.root).slice(1, -1));
        await page.context().setOffline(true);
        await page.goto(pathToFileURL(file).href);
        await expect(page.locator('#source-title')).toHaveText('.claude/settings.local.json');
        expect(await page.locator('body').textContent()).not.toContain(marker);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: test.info().outputPath(`gemini-private-alias-${level}-${viewport.width}.png`) });
        await page.context().setOffline(false);
        await page.goto(server.url + selection);
      }
    }
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true, maxRetries: 5 }); }
});

test('Gemini saved workspace trust refreshes custom context, clipboard and private portable reports', async ({ page }) => {
  const w = await workspace({
    'GEMINI.md': 'DEFAULT_PROJECT_INSTRUCTION',
    'TEAM.md': 'PROJECT_INSTRUCTION\n@./shared.md',
    'shared.md': '---\nenv:\n  NORMAL: browser-gemini-trust-private\n---\nIMPORTED_INSTRUCTION',
    '.gemini/settings.json': JSON.stringify({ context: { fileName: 'TEAM.md' } }),
  }, {
    '.gemini/PERSONAL.md': 'GLOBAL_INSTRUCTION',
    '.gemini/TEAM.md': 'GLOBAL_TEAM_INSTRUCTION',
    '.gemini/settings.json': JSON.stringify({ context: { fileName: 'PERSONAL.md' } }),
  });
  const trustFile = path.join(w.home, '.gemini/trustedFolders.json');
  const saveTrust = (level?: string) => writeFile(trustFile, JSON.stringify({
    [path.join(w.root, 'UNRELATED_GEMINI_PRIVATE_PROJECT')]: 'DO_NOT_TRUST',
    ...(level ? { [w.repo]: level } : {}),
  }));
  await saveTrust();
  const server = await serve({ ...w, clients: ['gemini'] });
  const location = '#view=effective&client=gemini&source=GEMINI.md';
  try {
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: {
      writeText: async (text: string) => { (window as any).copiedInstructions = text; },
    }, configurable: true }));
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await saveTrust();
      await page.goto(server.url + location);
      await page.reload();
      for (const state of ['pending', 'approved', 'rejected']) {
        if (state !== 'pending') {
          await saveTrust(state === 'approved' ? 'TRUST_FOLDER' : 'DO_NOT_TRUST');
          await page.getByRole('button', { name: 'Refresh scan', exact: true }).click();
          await expect(page.locator('#scan-status')).toHaveText('Scan complete');
        }
        const status = state === 'approved' ? 'Loaded' : state === 'rejected' ? 'Not loaded' : 'Conditional';
        await expect(page.locator('#source-title')).toHaveText('GEMINI.md');
        await expect(page.locator('#source-status')).toHaveText(status);
        await expect(page.locator('#why')).toContainText(state === 'pending' ? 'after workspace approval' : state === 'approved' ? 'context' : 'rejects this workspace');
        await page.getByRole('button', { name: 'Read effective text', exact: true }).click();
        const text = await page.locator('#effective-document .effective-text').textContent();
        expect(text?.match(/[A-Z_]+_INSTRUCTION/g)).toEqual(state === 'approved'
          ? ['GLOBAL_TEAM_INSTRUCTION', 'DEFAULT_PROJECT_INSTRUCTION', 'PROJECT_INSTRUCTION', 'IMPORTED_INSTRUCTION']
          : ['GLOBAL_INSTRUCTION']);
        const portableText = portable(await scan({ ...w, clients: ['gemini'] })).clients[0].instructions;
        await page.getByRole('button', { name: 'Copy effective text', exact: true }).click();
        expect(await page.evaluate(() => (window as any).copiedInstructions)).toBe(text);
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name: /Export report/ }).click();
        const file = test.info().outputPath(`gemini-trust-${state}-${viewport.width}.html`);
        await (await pending).saveAs(file);
        const exported = await readFile(file, 'utf8');
        for (const privateText of ['browser-gemini-trust-private', 'UNRELATED_GEMINI_PRIVATE_PROJECT', JSON.stringify(w.root).slice(1, -1)]) expect(exported).not.toContain(privateText);
        await page.context().setOffline(true);
        await page.goto(pathToFileURL(file).href);
        expect(await page.locator('#effective-document .effective-text').textContent()).toBe(portableText);
        await page.getByRole('button', { name: 'Trace sources', exact: true }).click();
        await expect(page.locator('#source-title')).toHaveText('GEMINI.md');
        await expect(page.locator('#source-status')).toHaveText(status);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: test.info().outputPath(`gemini-trust-${state}-${viewport.width}.png`) });
        await page.context().setOffline(false);
        await page.goto(server.url + location);
      }
    }
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true, maxRetries: 5 }); }
});

for (const format of ['tree', 'flat']) test(`Gemini ${format} imports retain source inspection, effective text and portable export`, async ({ page }) => {
  const shared = (body: string) => '---\nenv:\n  NORMAL: browser-gemini-import-private\n  FLAG: true\n---\n' + body + '\n';
  const w = await workspace({
    'GEMINI.md': 'FIRST_INSTRUCTION\n\nBefore @./shared.md After\n\nLAST_INSTRUCTION',
    'shared.md': shared('IMPORTED_INSTRUCTION'),
    '.gemini/settings.json': JSON.stringify({ context: { importFormat: format } }),
  });
  const server = await serve({ ...w, user: false, clients: ['gemini'], trust: 'trusted' });
  try {
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: {
      writeText: async (text: string) => { (window as any).copiedInstructions = text; },
    }, configurable: true }));
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await writeFile(path.join(w.repo, 'shared.md'), shared('IMPORTED_INSTRUCTION'));
      await page.goto(server.url + '#view=effective&client=gemini&source=shared.md');
      // A fragment-only navigation retains the previous inspection after fixture edits.
      await page.reload();
      await expect(page.locator('#source-title')).toHaveText('shared.md');
      await expect(page.locator('#source-status')).toHaveText('Loaded');
      await expect(page.locator('#why')).toContainText('Imported from GEMINI.md:3');
      await page.getByRole('button', { name: 'Read effective text', exact: true }).click();
      const text = await page.locator('#effective-document .effective-text').textContent();
      expect(text).not.toContain('browser-gemini-import-private');
      expect(text).not.toContain('FLAG: true');
      expect(text?.match(/[A-Z_]+_INSTRUCTION/g)).toEqual(format === 'tree'
        ? ['FIRST_INSTRUCTION', 'IMPORTED_INSTRUCTION', 'LAST_INSTRUCTION']
        : ['FIRST_INSTRUCTION', 'LAST_INSTRUCTION', 'IMPORTED_INSTRUCTION']);
      await page.getByRole('button', { name: 'Copy effective text', exact: true }).click();
      expect(await page.evaluate(() => (window as any).copiedInstructions)).toBe(text);
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: /Export report/ }).click();
      const file = test.info().outputPath(`gemini-${format}-${viewport.width}.html`);
      await (await pending).saveAs(file);
      const exported = await readFile(file, 'utf8');
      expect(exported).not.toContain('browser-gemini-import-private');
      expect(exported).not.toContain(JSON.stringify(w.root).slice(1, -1));
      await page.context().setOffline(true);
      await page.goto(pathToFileURL(file).href);
      await expect(page.locator('#effective-document .effective-text')).toContainText('IMPORTED_INSTRUCTION');
      await page.getByRole('button', { name: 'Trace sources', exact: true }).click();
      await expect(page.locator('#source-title')).toHaveText('shared.md');
      await page.getByRole('button', { name: 'Imported from GEMINI.md:3', exact: true }).click();
      await expect(page.locator('.code-line.highlight')).toContainText('Before @./shared.md After');
      await page.context().setOffline(false);
      await page.goto(server.url + '#view=effective&client=gemini&text=effective');
      await writeFile(path.join(w.repo, 'shared.md'), shared('REFRESHED_INSTRUCTION'));
      await page.getByRole('button', { name: 'Refresh scan', exact: true }).click();
      await expect(page.locator('#scan-status')).toHaveText('Scan complete');
      await expect(page.locator('#effective-document .effective-text')).toContainText('REFRESHED_INSTRUCTION');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`gemini-${format}-${viewport.width}.png`) });
    }
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true, maxRetries: 5 }); }
});

test('Codex Unicode instruction selection survives copying, refresh and portable export', async ({ page }) => {
  const w = await workspace({ 'AGENTS.md': '\uFEFF', 'src/AGENTS.md': 'UNLOADED_NESTED', 'src/a.ts': '' }, {
    '.codex/config.toml': 'project_doc_max_bytes=3\n',
    '.codex/AGENTS.md': 'ORDINARY_GLOBAL',
    '.codex/AGENTS.override.md': '\uFEFF',
  });
  const server = await serve({ ...w, clients: ['codex'], trust: 'trusted', target: 'src/a.ts' });
  const expected = '\uFEFF\n\n--- project-doc ---\n\n\uFEFF';
  try {
    await page.goto(server.url + '#view=effective&client=codex&text=effective');
    const text = page.locator('#effective-document .effective-text');
    expect(await text.textContent()).toBe(expected);
    const report = JSON.parse(await page.locator('#report-data').textContent() ?? 'null');
    expect(report.clients[0].instructionBytes).toBe(Buffer.byteLength(expected));
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => { (window as any).copiedInstructions = text; } }, configurable: true }));
    await page.getByRole('button', { name: 'Copy effective text', exact: true }).click();
    expect(await page.evaluate(() => (window as any).copiedInstructions)).toBe(expected);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('codex-unicode-instructions.html');
    await (await pending).saveAs(file);
    await page.context().setOffline(true);
    await page.goto(pathToFileURL(file).href);
    expect(await text.textContent()).toBe(expected);
    await page.context().setOffline(false);
    await page.goto(server.url + '#view=effective&client=codex&text=effective');
    await writeFile(path.join(w.home, '.codex/AGENTS.override.md'), '\u0085');
    await page.getByRole('button', { name: 'Refresh scan', exact: true }).click();
    await expect(page.locator('#scan-status')).toHaveText('Scan complete');
    expect(await text.textContent()).toBe('ORDINARY_GLOBAL\n\n--- project-doc ---\n\n\uFEFF');
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('Claude instruction approval and source order survive refresh, copying and portable export', async ({ page }) => {
  const w = await workspace({
    'CLAUDE.md': 'ROOT_INSTRUCTION\n@docs/policy.md\n',
    'docs/policy.md': 'IMPORTED_INSTRUCTION\n',
    '.claude/rules/a.md': 'PROJECT_RULE_INSTRUCTION\n',
    'src/CLAUDE.local.md': 'LOCAL_INSTRUCTION\n',
    'src/file.ts': '',
  }, {
    '.claude/CLAUDE.md': 'USER_INSTRUCTION\n',
    '.claude/rules/global.md': 'USER_RULE_INSTRUCTION\n',
  });
  const project = process.platform === 'win32' ? w.repo.replaceAll('\\', '/') : await realpath(w.repo);
  const saveApproval = async (approved?: boolean) => writeFile(path.join(w.home, '.claude.json'), JSON.stringify({
    projects: { [project]: approved === undefined ? {} : { hasClaudeMdExternalIncludesApproved: approved } },
    account: { email: 'browser-private-claude-state@example.test' },
  }));
  await saveApproval();
  const server = await serve({ ...w, clients: ['claude'], trust: 'trusted', target: 'src/file.ts' });
  const location = '#view=effective&client=claude&source=docs/policy.md';
  try {
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: {
      writeText: async (text: string) => { (window as any).copiedInstructions = text; },
    }, configurable: true }));
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await saveApproval();
      await page.goto(server.url + location);
      await page.reload();
      for (const state of ['pending', 'approved', 'rejected']) {
        if (state !== 'pending') {
          await saveApproval(state === 'approved');
          await page.getByRole('button', { name: 'Refresh scan', exact: true }).click();
          await expect(page.locator('#scan-status')).toHaveText('Scan complete');
        }
        const status = state === 'approved' ? 'Loaded' : state === 'rejected' ? 'Not loaded' : 'Conditional';
        await expect(page.locator('#source-title')).toHaveText('docs/policy.md');
        await expect(page.locator('#source-status')).toHaveText(status);
        await expect(page.locator('#why')).toContainText('Imported from CLAUDE.md:2');
        const sizeLabel = state === 'pending' ? 'Size if loaded' : 'Loaded size';
        await expect(page.locator('#why .detail-meta > div').filter({ has: page.getByText(sizeLabel, { exact: true }) }).locator('dd')).toHaveText(state === 'rejected' ? '0 bytes' : '21 bytes');
        if (state === 'pending') await expect(page.locator('#why')).toContainText('Position if loaded');
        if (state === 'pending') await expect(page.locator('#why')).toContainText('separate external-import approval');
        if (state === 'rejected') await expect(page.locator('#why')).toContainText('Saved project state rejects imports');
        await page.getByRole('button', { name: 'Read effective text', exact: true }).click();
        const text = await page.locator('#effective-document .effective-text').textContent();
        expect(text?.match(/[A-Z_]+_INSTRUCTION/g)).toEqual([
          'USER_INSTRUCTION', 'USER_RULE_INSTRUCTION', 'ROOT_INSTRUCTION',
          ...(state === 'approved' ? ['IMPORTED_INSTRUCTION'] : []), 'PROJECT_RULE_INSTRUCTION', 'LOCAL_INSTRUCTION',
        ]);
        await page.getByRole('button', { name: 'Copy effective text', exact: true }).click();
        expect(await page.evaluate(() => (window as any).copiedInstructions)).toBe(text);
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name: /Export report/ }).click();
        const file = test.info().outputPath(`claude-instructions-${state}-${viewport.width}.html`);
        await (await pending).saveAs(file);
        const exported = await readFile(file, 'utf8');
        expect(exported).not.toContain('browser-private-claude-state@example.test');
        expect(exported).not.toContain(JSON.stringify(w.home).slice(1, -1));
        await page.context().setOffline(true);
        await page.goto(pathToFileURL(file).href);
        expect(await page.locator('#effective-document .effective-text').textContent()).toBe(text);
        await page.getByRole('button', { name: 'Trace sources', exact: true }).click();
        await expect(page.locator('#source-status')).toHaveText(status);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: test.info().outputPath(`claude-instructions-${state}-${viewport.width}.png`) });
        await page.context().setOffline(false);
        await page.goto(server.url + location);
      }
    }
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('refresh outcomes show current errors and warnings above source inspection on desktop and phone', async ({ page }) => {
  const w = await workspace({ 'CLAUDE.md': 'Project instructions.' });
  const server = await serve({ ...w, user: false, clients: ['claude'], trust: 'trusted' });
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await writeFile(path.join(w.repo, '.mcp.json'), '{');
      await mkdir(path.join(w.repo, '.claude'), { recursive: true });
      await writeFile(path.join(w.repo, '.claude/settings.json'), '{"mcpServers":{}}');
      await page.setViewportSize(viewport);
      await page.goto(server.url + '#view=effective&client=claude&source=CLAUDE.md&line=1');
      await page.getByRole('button', { name: 'Refresh scan', exact: true }).click();
      const summary = page.locator('#refresh-summary');
      await expect(summary).toContainText('Refresh complete. 1 error and 1 warning.');
      await expect(summary).toBeInViewport({ ratio: 1 });
      await expect(page.locator('.code-line.highlight')).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: test.info().outputPath(`refresh-outcomes-${viewport.width}.png`) });
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
      await summary.getByRole('button', { name: 'Review findings', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('#findings')).toBeVisible();
      await expect(page.locator('#severity')).toHaveValue('actionable');
      await expect(page.locator('#findings-list .finding')).toHaveCount(2);
      await writeFile(path.join(w.repo, '.mcp.json'), '{"mcpServers":{}}');
      await page.getByRole('button', { name: 'Refresh scan', exact: true }).click();
      await expect(summary).toContainText('Refresh complete. 0 errors and 1 warning.');
      await writeFile(path.join(w.repo, '.claude/settings.json'), '{}');
      await page.getByRole('button', { name: 'Refresh scan', exact: true }).click();
      await expect(summary).toHaveText('Refresh complete. No errors or warnings found.');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: /Export report/ }).click();
      const file = test.info().outputPath(`refresh-outcome-${viewport.width}.html`);
      await (await pending).saveAs(file);
      await page.context().setOffline(true);
      await page.goto(pathToFileURL(file).href);
      await expect(page.locator('#refresh-summary')).toBeEmpty();
      await expect(page.locator('#findings-list .finding')).toHaveCount(0);
      await page.context().setOffline(false);
    }
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('mixed Windows path separators preserve alias decisions through export and offline re-export', async ({ page }) => {
  const w = await workspace({ '.agents/skills/shared/SKILL.md': '---\nname: shared-links\ndescription: Windows path fixture.\n---\nInvoke this body explicitly.\n' });
  try {
    const report = await scan({ ...w, user: false, clients: ['codex'], trust: 'trusted' });
    const original = report.clients[0].decisions.find(source => source.kind === 'skill')!;
    const source = report.sources.find(source => source.id === original.sourceId)!;
    const repository = 'C:\\sightline-fixture\\repo';
    const projectPath = repository + '\\.agents\\skills\\shared\\SKILL.md';
    const userPath = 'C:\\sightline-fixture\\home\\.codex\\skills\\shared\\SKILL.md';
    report.repository = repository;
    report.target = repository;
    report.sessionDirectory = repository;
    report.sources = [{ ...source, id: 'user-skill', path: userPath }, { ...source, id: 'project-skill', path: projectPath }];
    report.clients[0].decisions = [
      { ...original, sourceId: 'user-skill', path: userPath, scope: 'user', status: 'active', order: 1 },
      { ...original, sourceId: 'project-skill', path: projectPath, status: 'ignored', order: null, loadedBytes: 0, reason: 'Canonical alias fixture.' },
    ];
    report.pathMappings = [{ path: userPath, replacement: '<repo>/.agents/skills/shared/SKILL.md' }];
    const live = test.info().outputPath('windows-alias-live.html');
    await writeFile(live, html(report, { live: true, portable: false }));
    const exportReport = async (filename: string) => {
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: /Export report/ }).click();
      const file = test.info().outputPath(filename);
      await (await pending).saveAs(file);
      return pathToFileURL(file).href;
    };
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.goto(pathToFileURL(live).href + '#view=effective&client=codex&source=.agents%2Fskills%2Fshared%2FSKILL.md&line=2');
      await expect(page.locator('#source-status')).toHaveText('Not loaded');
      const portable = await exportReport(`windows-alias-${viewport.width}.html`);
      await page.context().setOffline(true);
      await page.goto(portable);
      await expect(page.locator('#source-status')).toHaveText('Not loaded');
      await expect(page.locator('#why')).toContainText('Canonical alias fixture.');
      expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('occurrence')).toBe('2');
      await expect(page.locator('.code-line.highlight')).toContainText('name: shared-links');
      await page.reload();
      await expect(page.locator('#source-status')).toHaveText('Not loaded');
      const reshared = await exportReport(`windows-alias-reshared-${viewport.width}.html`);
      await page.goto(reshared);
      await expect(page.locator('#source-status')).toHaveText('Not loaded');
      await page.goto(reshared + '#view=effective&client=codex&source=.agents%2Fskills%2Fshared%2FSKILL.md&occurrence=1');
      await expect(page.locator('#source-status')).toHaveText('Loaded');
      await page.context().setOffline(false);
    }
  } finally { await page.context().setOffline(false); await rm(w.root, { recursive: true, force: true }); }
});

test('linked Codex skills retain disabled metadata and distinct alias decisions in live and portable inspections', async ({ page }) => {
  const skill = (name: string) => `---\nname: ${name}\ndescription: Linked skill fixture.\n---\nInvoke this skill body explicitly.\n`;
  const w = await workspace({ 'AGENTS.md': 'Project instructions.', '.agents/skills/shared/SKILL.md': skill('shared-links') });
  const catalog = path.join(w.root, 'skill-catalog');
  await mkdir(catalog);
  await writeFile(path.join(catalog, 'SKILL.md'), skill('review-links'));
  await writeFile(path.join(catalog, 'AGENTS.md'), 'UNRELATED_SKILL_PRIVATE_FILE');
  const userSkills = path.join(w.home, '.codex/skills');
  await mkdir(userSkills, { recursive: true });
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  await symlink(catalog, path.join(userSkills, 'review'), linkType);
  await symlink(path.join(w.repo, '.agents/skills/shared'), path.join(userSkills, 'shared'), linkType);
  const canonicalFile = await realpath(path.join(catalog, 'SKILL.md'));
  await writeFile(path.join(w.home, '.codex/config.toml'), `[[skills.config]]\npath=${JSON.stringify(canonicalFile)}\nenabled=false\n`);
  const server = await serve({ ...w, clients: ['codex'], trust: 'trusted' });
  const exportReport = async (filename: string) => {
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath(filename);
    await (await downloading).saveAs(file);
    const content = await readFile(file, 'utf8');
    for (const value of [w.repo, await realpath(w.repo), w.home, await realpath(w.home), canonicalFile]) expect(content).not.toContain(JSON.stringify(value).slice(1, -1));
    expect(content).not.toContain('UNRELATED_SKILL_PRIVATE_FILE');
    return pathToFileURL(file).href;
  };
  try {
    await page.goto(server.url + '#view=extensions');
    await page.getByRole('button', { name: 'Skills', exact: true }).click();
    await expect(page.locator('.extension-row')).toHaveCount(2);
    const review = page.locator('.extension-row').filter({ hasText: 'review-links' });
    await expect(review).toContainText('Not loaded');
    await review.click();
    await page.getByRole('button', { name: /Inspect source/ }).click();
    await expect(page.locator('#source-title')).toContainText('.codex/skills/review/SKILL.md');
    await expect(page.locator('#source-status')).toHaveText('Not loaded');
    const first = await exportReport('linked-disabled-skill.html');
    await page.context().setOffline(true);
    await page.goto(first);
    await expect(page.locator('#source-title')).toHaveText('~/.codex/skills/review/SKILL.md');
    await expect(page.locator('#source-status')).toHaveText('Not loaded');
    await expect(page.locator('#instructions')).toContainText('Invoke this skill body explicitly.');
    await page.context().setOffline(false);
    await page.goto(server.url + '#view=effective&client=codex&source=.agents%2Fskills%2Fshared%2FSKILL.md');
    await expect(page.locator('#source-status')).toHaveText('Not loaded');
    await expect(page.locator('#why')).toContainText('same canonical Codex skill');
    const second = await exportReport('linked-alias-decision.html');
    await page.context().setOffline(true);
    await page.goto(second);
    await expect(page.locator('#source-status')).toHaveText('Not loaded');
    await expect(page.locator('#why')).toContainText('same canonical Codex skill');
    expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('occurrence')).toBe('2');
    const third = await exportReport('reshared-alias-decision.html');
    await page.goto(third);
    await expect(page.locator('#source-status')).toHaveText('Not loaded');
    expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('occurrence')).toBe('2');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#source-title')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('exported reports open at the inspected line and retain changed locations through offline re-export', async ({ page }) => {
  const settings = ['{', '"hooks":{"UserPromptSubmit":[', ...Array(180).fill(''), '{"hooks":[{"type":"command","command":"missing-shared-report-hook"}]}', ']}}'].join('\n');
  const w = await workspace({
    'AGENTS.md': 'Codex instructions.',
    'CLAUDE.md': '@one.md\n@two.md\n',
    'one.md': '# One\n@shared.md\n',
    'two.md': '# Two\n\n@shared.md\n',
    'shared.md': 'Shared instructions.',
    '.claude/settings.json': settings,
  });
  const server = await serve({ ...w, user: false, clients: ['codex', 'claude'], trust: 'trusted' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const exportReport = async (filename: string) => {
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath(filename);
    await (await downloading).saveAs(file);
    return pathToFileURL(file).href;
  };
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.context().setOffline(false);
      await page.goto(server.url + '#view=findings');
      await page.locator('#findings-list .finding').filter({ hasText: 'Hook command was not found or is not executable.' }).click();
      await page.getByRole('button', { name: /Inspect source/ }).click();
      await expect(page.locator('.code-line.highlight')).toContainText('missing-shared-report-hook');
      const initialLine = new URLSearchParams(new URL(page.url()).hash.slice(1)).get('line');
      const first = await exportReport(`inspected-line-${viewport.width}.html`);
      await page.context().setOffline(true);
      await page.goto(first);
      await expect(page.locator('#effective')).toBeVisible();
      await expect(page.locator('#effective-title')).toHaveText('Claude Code’s instructions');
      await expect(page.locator('#source-title')).toHaveText('.claude/settings.json');
      await expect(page.locator('.code-line.highlight')).toContainText('missing-shared-report-hook');
      await expect(page.locator('.code-line.highlight')).toBeInViewport({ ratio: 1 });
      expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('line')).toBe(initialLine);
      await page.reload();
      await expect(page.locator('.code-line.highlight')).toBeInViewport({ ratio: 1 });
      await page.getByRole('button', { name: 'All discovered', exact: true }).click();
      await page.locator('#sources .source').filter({ hasText: 'Imported from two.md:3' }).click();
      await expect(page.locator('#source-status')).toHaveText('Not loaded');
      const second = await exportReport(`reexported-occurrence-${viewport.width}.html`);
      await page.goto(second);
      await expect(page.locator('#source-title')).toHaveText('shared.md');
      await expect(page.locator('#source-status')).toHaveText('Not loaded');
      await expect(page.locator('#why')).toContainText('Imported from two.md:3');
      expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('occurrence')).toBe('2');
      await expect(page.locator('meta[name="sightline-view"]')).toHaveCount(1);
      await page.goto(second + '#view=effective&client=codex&source=AGENTS.md');
      await expect(page.locator('#effective-title')).toHaveText('Codex’s instructions');
      await expect(page.locator('#source-title')).toHaveText('AGENTS.md');
      const third = await exportReport(`reexported-client-${viewport.width}.html`);
      await page.goto(third);
      await expect(page.locator('#effective-title')).toHaveText('Codex’s instructions');
      await expect(page.locator('#source-title')).toHaveText('AGENTS.md');
      await expect(page.locator('meta[name="sightline-view"]')).toHaveCount(1);
      await page.getByRole('button', { name: 'Read effective text', exact: true }).click();
      const fourth = await exportReport(`reexported-effective-text-${viewport.width}.html`);
      await page.goto(fourth);
      await expect(page.locator('#effective-document')).toBeVisible();
      await expect(page.locator('#effective-document')).toContainText('Codex instructions.');
      await page.goto(fourth + '#view=overview');
      await expect(page.locator('#overview')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    expect(errors).toEqual([]);
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('exported locations use portable user paths and reopen each selected view', async ({ page }) => {
  const w = await workspace({ 'CLAUDE.md': 'Project instructions.' }, { '.claude/CLAUDE.md': 'Personal instructions.' });
  const server = await serve({ ...w, clients: ['claude'], trust: 'trusted' });
  const exportReport = async (filename: string) => {
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath(filename);
    await (await downloading).saveAs(file);
    return pathToFileURL(file).href;
  };
  try {
    await page.goto(server.url);
    const personalPath = await page.locator('#report-data').evaluate(element => (JSON.parse(element.textContent!) as Report).sources.find(source => source.scope === 'user' && source.kind === 'instructions')!.path);
    const hash = new URLSearchParams({ view: 'effective', client: 'claude', source: personalPath.replaceAll('\\', '/') });
    await page.goto(server.url + '#' + hash);
    await expect(page.locator('#source-title')).toContainText('.claude/CLAUDE.md');
    const file = await exportReport('portable-personal-location.html');
    await page.context().setOffline(true);
    await page.goto(file);
    await expect(page.locator('#source-title')).toHaveText('~/.claude/CLAUDE.md');
    await expect(page.locator('#instructions')).toContainText('Personal instructions.');
    expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('source')).toBe('~/.claude/CLAUDE.md');
    const metadata = await page.locator('meta[name="sightline-view"]').getAttribute('content');
    expect(new URLSearchParams(metadata!.slice(1)).get('source')).toBe('~/.claude/CLAUDE.md');
    for (const view of ['configuration', 'compare', 'extensions', 'findings', 'overview']) {
      await page.locator(`#${view}-tab`).click();
      const next = await exportReport(`portable-view-${view}.html`);
      await page.goto(next);
      await expect(page.locator(`#${view}`)).toBeVisible();
      await expect(page.locator(`#${view}-tab`)).toHaveAttribute('aria-current', 'page');
      const exported = await readFile(new URL(next), 'utf8');
      for (const value of [w.repo, await realpath(w.repo), w.home, await realpath(w.home)]) expect(exported).not.toContain(JSON.stringify(value).slice(1, -1));
    }
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('source search matches paths and captured import origins and retains matching history queries live and offline', async ({ page }) => {
  const w = await workspace({
    'CLAUDE.md': '# Root\n@alpha.md\n@beta.md\n',
    'alpha.md': '# Alpha\n@policies/shared.md\n',
    'beta.md': '# Beta\n\n@policies/shared.md\n',
    'policies/shared.md': 'Shared instructions.',
    'AGENTS.md': 'Codex instructions.',
  });
  const server = await serve({ ...w, user: false, clients: ['claude'], trust: 'trusted' });
  try {
    await page.goto(server.url);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('source-provenance-search.html');
    await (await pending).saveAs(file);
    for (const url of [server.url, pathToFileURL(file).href]) {
      await page.context().setOffline(url.startsWith('file:'));
      for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        await page.goto('about:blank');
        await page.goto(url + '#view=effective&client=claude');
        await page.getByRole('button', { name: 'All discovered', exact: true }).click();
        const rows = page.locator('#sources .source');
        const query = '  SHARED   beta.md:3  ';
        await page.locator('#source-search').fill(query);
        await expect(rows).toHaveCount(1);
        await expect(rows.first()).toContainText('shared.md');
        await expect(rows.first()).toContainText('Imported from beta.md:3');
        await rows.first().click();
        await expect(page.locator('#source-search')).toHaveValue(query);
        await expect(page.locator('#source-status')).toHaveText('Not loaded');
        expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('occurrence')).toBe('2');
        if (viewport.width === 390) await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
        await page.locator('#findings-tab').click();
        await page.goBack();
        await expect(page.locator('#source-search')).toHaveValue(query);
        await expect(rows).toHaveCount(1);
        await expect(rows.first()).toHaveAttribute('aria-pressed', 'true');
        await page.locator('#source-search').fill('shared alpha.md');
        await expect(rows).toHaveCount(1);
        await expect(rows.first()).toContainText('Imported from alpha.md:2');
        await rows.first().click();
        await expect(page.locator('#source-status')).toHaveText('Loaded');
        await page.goBack();
        await expect(page.locator('#source-status')).toHaveText('Not loaded');
        await expect(page.locator('#source-search')).toHaveValue('');
        const absolute = await page.locator('#report-data').evaluate(element => JSON.parse(element.textContent!).sources.find((source: { path: string }) => source.path.endsWith('/policies/shared.md') || source.path.endsWith('\\policies\\shared.md')).path as string);
        await page.locator('#source-search').fill(absolute);
        await expect(rows).toHaveCount(2);
        await page.locator('#source-search').fill(absolute.replaceAll('/', '\\'));
        await expect(rows).toHaveCount(2);
        await page.locator('#source-search').fill('Imported from beta.md:3');
        await expect(rows).toHaveCount(1);
        await expect(rows.first()).toContainText('shared.md');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (url === server.url && viewport.width === 1440) {
          await rows.first().click();
          await page.locator('#findings-tab').click();
          await writeFile(path.join(w.repo, 'beta.md'), '# Beta\n\n\n@policies/shared.md\n');
          await page.locator('#target').fill('policies/shared.md');
          await page.getByRole('button', { name: 'Inspect', exact: true }).click();
          await expect(page.locator('#scan-status')).toContainText('Scan complete');
          await expect(page.locator('#target')).toHaveValue('policies/shared.md');
          await writeFile(path.join(w.repo, 'beta.md'), '# Beta\n\n@policies/shared.md\n');
          await page.goBack();
          await expect(page.locator('#target')).toHaveValue('.');
          await expect(rows).toHaveCount(1);
          await expect(rows.first()).toContainText('Imported from beta.md:3');
          await expect(page.locator('#source-search')).toHaveValue('Imported from beta.md:3');
          await expect(rows.first()).toHaveAttribute('aria-pressed', 'true');
        }
      }
    }
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('source search explains scope exclusions and recovers from empty matches with keyboard actions live and offline', async ({ page }) => {
  const w = await workspace({
    'CLAUDE.md': '# Root\n@alpha.md\n@beta.md\n',
    'alpha.md': '@shared.md\n',
    'beta.md': '@shared.md\n',
    'shared.md': 'Shared instructions.',
  });
  const server = await serve({ ...w, user: false, clients: ['claude'], trust: 'trusted' });
  try {
    await page.goto(server.url);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('source-search-recovery.html');
    await (await pending).saveAs(file);
    for (const url of [server.url, pathToFileURL(file).href]) {
      await page.context().setOffline(url.startsWith('file:'));
      await page.goto('about:blank');
      await page.goto(url + '#view=effective&client=claude');
      await page.locator('#source-search').fill('shared beta.md');
      await expect(page.locator('#sources')).toContainText('Matches outside In scope');
      await expect(page.locator('#source-search-status')).toContainText('Showing 0 of 5 sources.');
      await page.getByRole('button', { name: 'Show all discovered', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('button', { name: 'All discovered', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#sources .source')).toHaveCount(1);
      await expect(page.locator('#sources .source')).toBeFocused();
      await expect(page.locator('#source-search-status')).toContainText('Showing 1 of 5 sources.');
      await page.keyboard.press('Enter');
      await expect(page.locator('#source-status')).toHaveText('Not loaded');
      await page.locator('#source-search').fill('no such configuration');
      await expect(page.locator('#sources')).toContainText('No matching sources');
      await expect(page.locator('#source-search-status')).toContainText('Showing 0 of 5 sources.');
      await page.getByRole('button', { name: 'Clear search', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('#source-search')).toHaveValue('');
      await expect(page.locator('#source-search')).toBeFocused();
      await expect(page.locator('#sources .source')).toHaveCount(5);
      await expect(page.locator('#source-search-status')).toContainText('Showing 5 of 5 sources.');
    }
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('reloading after keyboard source-list traversal keeps the linked source line visible live and offline', async ({ page }) => {
  const imports = Array.from({ length: 45 }, (_, index) => `import-${index}.md`);
  const settings = ['{', '"hooks":{"UserPromptSubmit":[', ...Array(350).fill(''), '{"hooks":[{"type":"command","command":"missing-reload-focus-hook"}]}', ']}}'].join('\n');
  const w = await workspace({
    'CLAUDE.md': imports.map(filename => '@' + filename).join('\n'),
    '.claude/settings.json': settings,
    ...Object.fromEntries(imports.map(filename => [filename, 'Imported instruction.'])),
  });
  const server = await serve({ ...w, user: false, clients: ['claude'], trust: 'trusted' });
  try {
    await page.goto(server.url);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('keyboard-reload-source.html');
    await (await pending).saveAs(file);
    for (const url of [server.url, pathToFileURL(file).href]) {
      await page.context().setOffline(url.startsWith('file:'));
      for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
        await test.step(`${url === server.url ? 'live' : 'portable'} ${viewport.width}`, async () => {
          await page.setViewportSize(viewport);
          await page.goto('about:blank');
          await page.goto(url + '#view=findings');
          await page.locator('#findings-list .finding').filter({ hasText: 'Hook command was not found or is not executable.' }).click();
          await page.getByRole('button', { name: /Inspect source/ }).click();
          const highlighted = page.locator('.code-line.highlight');
          await expect(highlighted).toContainText('missing-reload-focus-hook');
          await expect(highlighted).toBeInViewport({ ratio: 1 });
          const hash = new URL(page.url()).hash;
          await page.keyboard.press('Shift+Tab');
          await expect(page.locator('#sources .source.selected')).toBeFocused();
          await page.keyboard.press('End');
          await expect(page.locator('#sources .source').last()).toBeFocused();
          await page.keyboard.press('Tab');
          await expect(page.locator('#copy-source')).toBeFocused();
          await page.reload();
          await expect(highlighted).toContainText('missing-reload-focus-hook');
          await expect(highlighted).toBeInViewport({ ratio: 1 });
          expect(new URL(page.url()).hash).toBe(hash);
        });
      }
    }
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('keyboard source inspection focuses its named heading and returns to the selected source live and offline', async ({ page }) => {
  const settings = ['{', '"hooks":{"UserPromptSubmit":[', ...Array(130).fill(''), '{"hooks":[{"type":"command","command":"missing-keyboard-hook"}]}', ']}}'].join('\n');
  const w = await workspace({ 'AGENTS.md': 'Codex instructions.', 'CLAUDE.md': 'Claude instructions.', '.claude/settings.json': settings });
  const server = await serve({ ...w, user: false, clients: ['codex', 'claude'], trust: 'trusted' });
  try {
    await page.goto(server.url);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('keyboard-source-focus.html');
    await (await pending).saveAs(file);
    for (const url of [server.url, pathToFileURL(file).href]) {
      await page.context().setOffline(url.startsWith('file:'));
      for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        await page.goto('about:blank');
        await page.goto(url + '#view=findings');
        const finding = page.locator('#findings-list .finding').filter({ hasText: 'Hook command was not found or is not executable.' });
        await finding.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#detail-dialog')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(finding).toBeFocused();
        await page.keyboard.press('Enter');
        await page.getByRole('button', { name: /Inspect source/ }).focus();
        await page.keyboard.press('Enter');
        const title = page.getByRole('heading', { name: '.claude/settings.json', level: 2, exact: true });
        await expect(title).toBeFocused();
        await expect(title).toHaveAccessibleDescription('Loaded');
        await expect(title).toBeInViewport({ ratio: 1 });
        await expect(page.locator('.code-line.highlight')).toContainText('missing-keyboard-hook');
        await expect(page.locator('.code-line.highlight')).toBeInViewport({ ratio: 1 });
        await page.keyboard.press('Shift+Tab');
        await expect(page.locator('#sources .source.selected')).toBeFocused();
        await expect(page.locator('#sources .source.selected')).toBeInViewport({ ratio: 1 });
        await expect(page.locator('#sources .source[tabindex="0"]')).toHaveCount(1);
        await page.keyboard.press('Home');
        await expect(page.locator('#sources .source').first()).toBeFocused();
        await page.keyboard.press('End');
        await expect(page.locator('#sources .source').last()).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page.locator('#sources .source.selected')).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(page.locator('#copy-source')).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(page.locator('#sources .source.selected')).toBeFocused();
      }
    }
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('source lists have one keyboard entry and retain a filtered entry when selection is excluded', async ({ page }) => {
  const w = await workspace({ 'CLAUDE.md': 'Root instructions.\n@one.md\n@two.md\n', 'one.md': 'First import.', 'two.md': 'Second import.' });
  const server = await serve({ ...w, user: false, clients: ['claude'], trust: 'trusted' });
  try {
    await page.goto(server.url);
    await page.locator('#effective-tab').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#effective-title')).toBeFocused();
    await expect(page.locator('#sources .source[tabindex="0"]')).toHaveCount(1);
    await page.locator('#sources .source.selected').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#sources .source').nth(1)).toBeFocused();
    await expect(page.locator('#sources .source[tabindex="0"]')).toHaveCount(1);
    await page.keyboard.press('Tab');
    await expect(page.locator('#copy-source')).toBeFocused();
    await page.locator('#source-search').fill('two.md');
    await expect(page.locator('#sources .source.selected')).toHaveCount(0);
    await expect(page.locator('#sources .source[tabindex="0"]')).toHaveCount(1);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.locator('#sources .source').first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#sources .source.selected')).toBeFocused();
    await expect(page.locator('#source-title')).toHaveText('two.md');
    await page.locator('#source-search').fill('unmatched-source');
    await expect(page.locator('#sources .source')).toHaveCount(0);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Clear search', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#copy-source')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Enter');
    await expect(page.locator('#source-search')).toBeFocused();
    await expect(page.locator('#source-search')).toHaveValue('');
    await expect(page.locator('#sources .source')).toHaveCount(3);
  } finally { await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('mobile navigation contains keyboard focus and closes into its destination and native dialogs live and offline', async ({ page }) => {
  const w = await workspace({ 'AGENTS.md': 'Codex instructions.', 'CLAUDE.md': 'Claude instructions.' });
  const server = await serve({ ...w, user: false, clients: ['codex', 'claude'], trust: 'trusted' });
  try {
    await page.goto(server.url);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('keyboard-mobile-navigation.html');
    await (await pending).saveAs(file);
    for (const url of [server.url, pathToFileURL(file).href]) {
      await page.context().setOffline(url.startsWith('file:'));
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('about:blank');
      await page.goto(url);
      const menu = page.locator('#mobile-menu');
      await page.keyboard.press('Tab');
      await expect(page.locator('.skip-link')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(menu).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator('#overview-tab')).toBeFocused();
      await page.locator('.sidebar .brand').focus();
      await page.keyboard.press('Shift+Tab');
      await expect(page.locator('#scope-button')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.locator('.sidebar .brand')).toBeFocused();
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(menu).toBeFocused();
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Close navigation', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(menu).toBeFocused();
      await page.keyboard.press('Enter');
      await page.locator('#configuration-tab').focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('#configuration h1')).toBeFocused();
      await expect(menu).toHaveAttribute('aria-expanded', 'false');
      await page.keyboard.press('Tab');
      await expect(page.locator('#setting-search')).toBeFocused();
      await menu.focus();
      await page.keyboard.press('Enter');
      await page.locator('#scope-button').focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('#scope-dialog')).toBeVisible();
      await expect(menu).toHaveAttribute('aria-expanded', 'false');
      await page.keyboard.press('Escape');
      await expect(menu).toBeFocused();
      await page.keyboard.press('Enter');
      await page.keyboard.press('?');
      await expect(page.locator('#help-dialog')).toBeVisible();
      await expect(menu).toHaveAttribute('aria-expanded', 'false');
      await page.keyboard.press('Escape');
      await expect(menu).toBeFocused();
      await page.keyboard.press('Enter');
      await page.keyboard.press('ControlOrMeta+k');
      await expect(menu).toHaveAttribute('aria-expanded', 'false');
      if (url === server.url) {
        await expect(page.locator('#target')).toBeFocused();
        await page.keyboard.press('Escape');
      } else await expect(menu).toBeFocused();
      await menu.focus();
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Close navigation', exact: true }).focus();
      await page.setViewportSize({ width: 1440, height: 1000 });
      await expect(page.locator('#configuration-tab')).toBeFocused();
      await expect(menu).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('#navigation-scrim')).toBeHidden();
      await page.locator('#target').focus();
      await expect(page.locator('#target')).toBeFocused();
      await page.locator('#configuration-tab').focus();
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(menu).toBeFocused();
    }
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('effective-text source jumps and history reveal destinations hidden by a source search live and offline', async ({ page }) => {
  const w = await workspace({
    'AGENTS.md': 'Codex instructions.\n',
    'CLAUDE.md': 'Claude instructions.\n@shared.md\n@repeat.md\n',
    'repeat.md': '@shared.md\n',
    'shared.md': 'Shared instructions.\n',
  });
  const server = await serve({ ...w, user: false, clients: ['codex', 'claude'], trust: 'trusted' });
  try {
    await page.goto(server.url);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('source-search-navigation.html');
    await (await pending).saveAs(file);
    for (const url of [server.url, pathToFileURL(file).href]) {
      await page.context().setOffline(url.startsWith('file:'));
      for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        await page.goto('about:blank');
        await page.goto(url + '#view=effective&client=claude');
        await page.locator('#source-search').fill('CLAUDE.md');
        await page.getByRole('button', { name: 'Read effective text', exact: true }).click();
        await page.locator('#effective-document .source-origin').filter({ hasText: 'shared.md' }).click();
        await expect(page.locator('#source-title')).toHaveText('shared.md');
        await expect(page.locator('#source-search')).toHaveValue('');
        await expect(page.locator('#sources .source[aria-pressed="true"]')).toHaveCount(1);
        await page.locator('#source-search').fill('shared.md');
        await page.locator('#sources .source').filter({ hasText: 'Imported from repeat.md:1' }).click();
        await expect(page.locator('#source-status')).toHaveText('Not loaded');
        await expect(page.locator('#source-search')).toHaveValue('shared.md');
        await page.locator('#source-search').fill('CLAUDE.md');
        await page.locator('#sources .source').filter({ has: page.getByText('CLAUDE.md', { exact: true }) }).click();
        await expect(page.locator('#source-title')).toHaveText('CLAUDE.md');
        await expect(page.locator('#source-search')).toHaveValue('CLAUDE.md');
        await page.goBack();
        await expect(page.locator('#source-title')).toHaveText('shared.md');
        await expect(page.locator('#source-status')).toHaveText('Not loaded');
        await expect(page.locator('#source-search')).toHaveValue('');
        await expect(page.locator('#sources .source[aria-pressed="true"]')).toHaveCount(1);
        expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('occurrence')).toBe('2');
        await page.goForward();
        await expect(page.locator('#source-title')).toHaveText('CLAUDE.md');
        await page.locator('#source-search').fill('.md');
        await page.locator('#sources .source').filter({ hasText: 'Imported from repeat.md:1' }).click();
        await page.goBack();
        await expect(page.locator('#source-title')).toHaveText('CLAUDE.md');
        await expect(page.locator('#source-search')).toHaveValue('.md');
        await page.goForward();
        await expect(page.locator('#source-status')).toHaveText('Not loaded');
        await expect(page.locator('#source-search')).toHaveValue('.md');
        await page.locator('#source-search').fill('unmatched-source');
        await expect(page.locator('#sources')).toContainText('No matching sources');
        if (url === server.url) {
          await page.getByRole('button', { name: 'Refresh scan', exact: true }).click();
          await expect(page.locator('#scan-status')).toContainText('Scan complete');
          await expect(page.locator('#source-search')).toHaveValue('unmatched-source');
        }
        await page.getByRole('button', { name: 'Read effective text', exact: true }).click();
        await page.locator('#effective-document .source-origin').filter({ hasText: 'shared.md' }).click();
        await expect(page.locator('#source-search')).toHaveValue('');
        await expect(page.locator('#source-title')).toHaveText('shared.md');
        await expect(page.locator('#sources .source[aria-pressed="true"]')).toHaveCount(1);
        await page.reload();
        await expect(page.locator('#sources .source[aria-pressed="true"]')).toHaveCount(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('comparison origins and client entry points clear stale source searches live and offline', async ({ page }) => {
  const w = await workspace({ 'AGENTS.md': 'Codex instructions.\n', 'CLAUDE.md': 'Claude instructions.\n' });
  const server = await serve({ ...w, user: false, clients: ['codex', 'claude'], trust: 'trusted' });
  const openNavigation = async () => {
    const toggle = page.getByRole('button', { name: 'Toggle navigation', exact: true });
    if (await toggle.isVisible()) await toggle.click();
  };
  try {
    await page.goto(server.url);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('client-source-navigation.html');
    await (await pending).saveAs(file);
    for (const url of [server.url, pathToFileURL(file).href]) {
      await page.context().setOffline(url.startsWith('file:'));
      for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        await page.goto('about:blank');
        await page.goto(url + '#view=effective&client=claude');
        await page.locator('#source-search').fill('CLAUDE.md');
        await openNavigation();
        await page.locator('#compare-tab').click();
        const row = page.locator('#comparison-matrix tbody tr').filter({ hasText: 'AGENTS.md' });
        await row.getByRole('button', { name: 'AGENTS.md', exact: true }).click();
        await expect(page.locator('#source-title')).toHaveText('AGENTS.md');
        await expect(page.locator('#source-search')).toHaveValue('');
        await expect(page.locator('#sources .source[aria-pressed="true"]')).toHaveCount(1);
        await page.locator('#source-search').fill('CLAUDE.md');
        await openNavigation();
        await page.locator('#compare-tab').click();
        await row.locator('td').nth(2).getByRole('button').click();
        await expect(page.locator('#effective-title')).toHaveText('Claude Code’s instructions');
        await expect(page.locator('#source-title')).toHaveText('AGENTS.md');
        await expect(page.locator('#source-status')).toHaveText('Not loaded');
        await expect(page.locator('#source-search')).toHaveValue('');
        await expect(page.locator('#sources .source[aria-pressed="true"]')).toHaveCount(1);
        await page.locator('#source-search').fill('unmatched-source');
        await openNavigation();
        await page.locator('#compare-tab').click();
        await page.locator('#comparison-text .comparison-document').first().getByRole('button', { name: /Trace this instruction chain/ }).click();
        await expect(page.locator('#source-search')).toHaveValue('');
        await expect(page.locator('#source-title')).toHaveText('AGENTS.md');
        await page.locator('#source-search').fill('unmatched-source');
        await openNavigation();
        await page.getByRole('button', { name: 'Inspect Claude Code instructions', exact: true }).click();
        await expect(page.locator('#source-search')).toHaveValue('');
        await expect(page.locator('#source-title')).toHaveText('CLAUDE.md');
        await page.locator('#source-search').fill('unmatched-source');
        await openNavigation();
        await page.locator('#overview-tab').click();
        await page.locator('#client-overview .client-card').filter({ hasText: 'Claude Code' }).click();
        await expect(page.locator('#source-search')).toHaveValue('');
        await expect(page.locator('#source-title')).toHaveText('CLAUDE.md');
        await expect(page.locator('#sources .source[aria-pressed="true"]')).toHaveCount(1);
        await page.locator('#source-search').fill('unmatched-source');
        await openNavigation();
        await page.locator('#overview-tab').click();
        await page.getByRole('button', { name: /Sources discovered/ }).click();
        await expect(page.locator('#source-search')).toHaveValue('');
        await expect(page.locator('#source-count')).toHaveText('2');
      }
    }
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('source selection stays inside its list through deep links, history and refresh live and offline', async ({ page }) => {
  const filenames = Array.from({ length: 45 }, (_, index) => `sources/item-${String(index).padStart(2, '0')}.md`);
  const last = filenames.at(-1)!;
  const w = await workspace({
    'CLAUDE.md': filenames.map(filename => '@' + filename).join('\n') + '\n@repeat.md\n',
    'repeat.md': '@' + last + '\n',
    ...Object.fromEntries(filenames.map(filename => [filename, '# ' + filename + '\n' + Array(120).fill('Keep the source location visible.').join('\n')])),
  });
  const server = await serve({ ...w, user: false, clients: ['claude'], trust: 'trusted' });
  try {
    await page.goto(server.url);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('source-list-position.html');
    await (await pending).saveAs(file);
    const selected = page.locator('#sources .source.selected');
    const selectionInsideList = () => selected.evaluate(element => {
      const list = document.getElementById('sources')!;
      const panel = list.parentElement!;
      const viewport = list.scrollHeight > list.clientHeight ? list : panel;
      const bounds = viewport.getBoundingClientRect();
      const row = element.getBoundingClientRect();
      const top = bounds.top + viewport.clientTop;
      return row.top >= top - 1 && row.top + Math.min(row.height, viewport.clientHeight) <= top + viewport.clientHeight + 1;
    });
    for (const url of [server.url, pathToFileURL(file).href]) {
      await page.context().setOffline(url.startsWith('file:'));
      for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(viewport);
        const route = '#view=effective&client=claude&source=' + encodeURIComponent(last) + '&occurrence=2';
        await page.goto('about:blank');
        await page.goto(url + route);
        await expect(selected).toHaveCount(1);
        await expect(page.locator('#source-status')).toHaveText('Not loaded');
        await expect.poll(selectionInsideList).toBe(true);
        await expect(selected).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#sources .source[aria-pressed="true"]')).toHaveCount(1);
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
        await expect(page.locator('#source-search')).toBeVisible();
        await page.reload();
        await expect.poll(selectionInsideList).toBe(true);
        await selected.evaluate(element => (element as HTMLButtonElement).focus({ preventScroll: true }));
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('Enter');
        await expect(selected).toBeFocused();
        await expect(selected).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(selectionInsideList).toBe(true);
        await page.goBack();
        await expect(page.locator('#source-status')).toHaveText('Not loaded');
        await expect.poll(selectionInsideList).toBe(true);
        await page.goto(url + '#view=effective&client=claude&source=' + encodeURIComponent(filenames[20]));
        await expect.poll(selectionInsideList).toBe(true);
        await page.setViewportSize(viewport.width === 1440 ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
        await expect.poll(selectionInsideList).toBe(true);
        await page.setViewportSize(viewport);
        await expect.poll(selectionInsideList).toBe(true);
        await page.goBack();
        await expect(page.locator('#source-status')).toHaveText('Not loaded');
        await expect.poll(selectionInsideList).toBe(true);
        await page.goto(url + '#view=effective&client=claude&source=' + encodeURIComponent(filenames[0]));
        await expect(selected.locator('.source-name')).toHaveText('item-00.md');
        await expect.poll(selectionInsideList).toBe(true);
        await page.goBack();
        await expect(page.locator('#source-status')).toHaveText('Not loaded');
        await expect.poll(selectionInsideList).toBe(true);
        await page.goto(url + '#view=effective&client=claude&source=' + encodeURIComponent(last) + '&line=100');
        await expect(page.locator('.code-line.highlight .line-number')).toHaveText('100');
        await expect(page.locator('.code-line.highlight')).toBeInViewport({ ratio: 1 });
        await expect.poll(selectionInsideList).toBe(true);
        await page.locator('#source-search').focus();
        await page.locator('#source-search').fill('item-00');
        await expect(page.locator('#sources .source')).toHaveCount(1);
        await page.locator('#source-search').clear();
        await expect(page.locator('#source-search')).toBeFocused();
        await expect(page.locator('#source-search')).toBeInViewport({ ratio: 1 });
        if (url === server.url) {
          await page.getByRole('button', { name: 'Refresh scan', exact: true }).click();
          await expect(page.locator('#scan-status')).toContainText('Scan complete');
          await expect.poll(selectionInsideList).toBe(true);
          await expect(page.locator('.code-line.highlight')).toBeInViewport({ ratio: 1 });
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('repeated source decisions keep their own status, import origin and browser location live and offline', async ({ page }) => {
  const w = await workspace({
    'AGENTS.md': 'Codex instruction.',
    'CLAUDE.md': '# Root\n@branch-a.md\n@branch-b.md\n@branch-c.md\n',
    'branch-a.md': '# A\n@shared.md\n',
    'branch-b.md': '# B\n\n@shared.md\n',
    'branch-c.md': '# C\n\n\n@shared.md\n',
    'shared.md': '# Shared policy\nKeep this instruction once.\n',
  });
  const server = await serve({ ...w, user: false, clients: ['claude', 'codex'], trust: 'trusted' });
  try {
    await page.goto(server.url);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('repeated-source-decisions.html');
    await (await pending).saveAs(file);
    for (const url of [server.url, pathToFileURL(file).href]) {
      await page.context().setOffline(url.startsWith('file:'));
      await page.goto(url + '#view=effective&client=claude');
      await page.getByRole('button', { name: 'All discovered', exact: true }).click();
      const rows = page.locator('#sources .source').filter({ has: page.locator('.source-name', { hasText: 'shared.md' }) });
      await expect(rows).toHaveCount(3);
      await rows.nth(1).click();
      await expect(page.locator('#sources .source.selected')).toHaveCount(1);
      await expect(rows.nth(1)).toHaveClass(/selected/);
      await expect(rows.nth(1)).toBeFocused();
      await expect(page.locator('#source-status')).toHaveText('Not loaded');
      await expect(page.locator('#why .detail-meta > div').filter({ has: page.getByText('Loaded size', { exact: true }) }).locator('dd')).toHaveText('0 bytes');
      await expect(page.locator('#why')).toContainText('Already discovered through the same canonical instruction source.');
      await expect(page.locator('#why')).toContainText('Imported from branch-b.md:3');
      expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('occurrence')).toBe('2');
      await page.reload();
      await expect(rows.nth(1)).toHaveClass(/selected/);
      await expect(page.locator('#source-status')).toHaveText('Not loaded');
      await page.locator('#why').getByRole('button', { name: 'Imported from branch-b.md:3', exact: true }).click();
      await expect(page.locator('#source-title')).toHaveText('branch-b.md');
      await expect(page.locator('.code-line.highlight .line-number')).toHaveText('3');
      await expect(page.locator('.code-line.highlight')).toContainText('@shared.md');
      await page.goBack();
      await expect(rows.nth(1)).toHaveClass(/selected/);
      await expect(page.locator('#why')).toContainText('Imported from branch-b.md:3');
      await rows.nth(2).click();
      await expect(page.locator('#sources .source.selected')).toHaveCount(1);
      await expect(page.locator('#why')).toContainText('Imported from branch-c.md:4');
      expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('occurrence')).toBe('3');
      await page.goBack();
      await expect(rows.nth(1)).toHaveClass(/selected/);
      await rows.nth(1).focus();
      await page.keyboard.press('ArrowDown');
      await expect(rows.nth(2)).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(rows.nth(2)).toHaveClass(/selected/);
      await expect(rows.nth(2)).toBeFocused();
      await page.goBack();
      await expect(rows.nth(1)).toHaveClass(/selected/);
      await page.getByRole('button', { name: 'Inspect Codex instructions', exact: true }).click();
      await expect(page.locator('#source-title')).toHaveText('AGENTS.md');
      await page.getByRole('button', { name: 'Inspect Claude Code instructions', exact: true }).click();
      await expect(page.locator('#source-title')).toHaveText('CLAUDE.md');
      await page.goBack();
      await page.goBack();
      await expect(rows.nth(1)).toHaveClass(/selected/);
      if (url === server.url) {
        await page.getByRole('button', { name: 'Refresh scan', exact: true }).click();
        await expect(page.locator('#scan-status')).toContainText('Scan complete');
        await expect(rows.nth(1)).toHaveClass(/selected/);
        await writeFile(path.join(w.repo, 'branch-b.md'), '# B\n');
        await page.getByRole('button', { name: 'Refresh scan', exact: true }).click();
        await expect(page.locator('#scan-status')).toContainText('Scan complete');
        await expect(rows).toHaveCount(2);
        await expect(rows.nth(1)).toHaveClass(/selected/);
        await expect(page.locator('#why')).toContainText('Imported from branch-c.md:4');
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(url + '#view=effective&client=claude&source=shared.md&occurrence=2');
      await expect(page.locator('#source-status')).toHaveText('Not loaded');
      await expect(rows.nth(1).locator('.source-import')).toBeVisible();
      await expect(rows.nth(1).locator('.source-import')).toHaveText(url === server.url ? 'Imported from branch-c.md:4' : 'Imported from branch-b.md:3');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('legacy source links and effective-text origins select the intended contribution', async ({ page }) => {
  const w = await workspace({ 'CLAUDE.md': 'First contribution.\nSecond line.\n' });
  try {
    const report = await scan({ ...w, user: false, clients: ['claude'], trust: 'trusted' });
    const client = report.clients[0];
    const original = client.decisions.find(source => source.status === 'active' && source.kind === 'instructions')!;
    const second = {
      ...original,
      order: 2,
      status: 'truncated' as const,
      content: 'First co',
      loadedBytes: 8,
      estimatedTokens: 2,
      reason: 'Legacy report truncated contribution.',
      importedFrom: { path: path.join(w.repo, 'unavailable-parent.md'), line: 1, column: 1 },
    };
    client.decisions.push(second);
    client.instructions += '\n\n' + second.content;
    client.instructionBytes = Buffer.byteLength(client.instructions);
    client.estimatedTokens = Math.ceil(client.instructionBytes / 4);
    delete report.instructionDiff;
    const file = test.info().outputPath('legacy-source-contributions.html');
    await writeFile(file, html(report));
    const url = pathToFileURL(file).href;
    await page.goto(url + '#view=effective&client=claude&source=CLAUDE.md&occurrence=2');
    await expect(page.locator('#source-status')).toHaveText('Truncated');
    await expect(page.locator('#why .detail-meta > div').filter({ has: page.getByText('Loaded size', { exact: true }) }).locator('dd')).toHaveText('8 bytes');
    await expect(page.locator('#why')).toContainText('Legacy report truncated contribution.');
    await expect(page.locator('#why')).toContainText('Imported from unavailable-parent.md:1');
    await expect(page.locator('#why').getByRole('button', { name: 'Imported from unavailable-parent.md:1', exact: true })).toHaveCount(0);
    await expect(page.locator('#sources .source.selected')).toHaveCount(1);
    await page.locator('#source-search').fill('claude.md unavailable-parent.md:1');
    await expect(page.locator('#sources .source')).toHaveCount(1);
    await expect(page.locator('#sources .source')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#source-search').fill('unmatched-source');
    await page.getByRole('button', { name: 'Read effective text', exact: true }).click();
    await page.locator('#effective-document').getByRole('button', { name: '2 · CLAUDE.md', exact: true }).click();
    await expect(page.locator('#source-search')).toHaveValue('');
    await expect(page.locator('#source-status')).toHaveText('Truncated');
    expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('occurrence')).toBe('2');
    await page.reload();
    await expect(page.locator('#source-status')).toHaveText('Truncated');
    for (const occurrence of ['', '&occurrence=0', '&occurrence=-1', '&occurrence=2.5', '&occurrence=unknown', '&occurrence=9007199254740992', '&occurrence=999']) {
      await page.goto(url + '#view=effective&client=claude&source=CLAUDE.md' + occurrence);
      await expect(page.locator('#source-status')).toHaveText('Loaded');
      await expect(page.locator('#sources .source.selected')).toHaveCount(1);
    }
  } finally { await rm(w.root, { recursive: true, force: true }); }
});

test('source jumps reveal long-file lines and retain them through reload and history live and offline', async ({ page }) => {
  const lines = [
    '{', '  "hooks": {', '    "UserPromptSubmit": [',
    ...Array(350).fill(''),
    '      { "hooks": [{ "type": "command", "command": "missing-line-jump-first" }] },',
    ...Array(100).fill(''),
    '      { "hooks": [{ "type": "command", "command": "missing-line-jump-second" }] }',
    '    ]', '  },',
    '  "permissions": {"deny": ' + JSON.stringify(Array.from({ length: 100 }, (_, index) => `Read(src/folder-${index}/**)`)) + '}',
    '}',
  ];
  const firstLine = lines.findIndex(line => line.includes('missing-line-jump-first')) + 1;
  const secondLine = lines.findIndex(line => line.includes('missing-line-jump-second')) + 1;
  const longName = 'long-source-context-'.repeat(8) + '.md';
  const longPath = '.claude/rules/nested-source-context/' + longName;
  const w = await workspace({ '.claude/settings.json': lines.join('\n'), 'CLAUDE.md': Array(500).fill('Project instruction.').join('\n'), [longPath]: 'Nested rule instruction.' });
  const server = await serve({ ...w, user: false, clients: ['claude'], trust: 'trusted' });
  try {
    await page.goto(server.url);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('long-source-lines.html');
    await (await pending).saveAs(file);
    for (const url of [server.url, pathToFileURL(file).href]) {
      await page.context().setOffline(url.startsWith('file:'));
      for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        await page.goto(url + '#view=findings');
        const findings = page.locator('#findings-list .finding').filter({ hasText: 'Hook command was not found or is not executable.' });
        await expect(findings).toHaveCount(2);
        await findings.first().click();
        await page.getByRole('button', { name: /Inspect source/ }).click();
        const highlighted = page.locator('.code-line.highlight');
        await expect(highlighted).toContainText('missing-line-jump-first');
        await expect(highlighted).toBeInViewport({ ratio: 1 });
        await expect(page.locator('#workspace-header')).toBeInViewport({ ratio: 1 });
        await expect(page.locator('.file-tab')).toBeInViewport({ ratio: 1 });
        if (viewport.width === 1440) {
          await expect(page.locator('.source-panel')).toBeInViewport({ ratio: 1 });
          await expect(page.locator('.why-panel')).toBeInViewport({ ratio: 1 });
        }
        const header = await page.locator('.file-tab').boundingBox();
        const line = await highlighted.boundingBox();
        expect(line!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
        expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('line')).toBe(String(firstLine));
        if (viewport.width === 390) await page.getByRole('button', { name: 'Toggle navigation' }).click();
        await page.locator('#extensions-tab').click();
        await expect(page.getByRole('heading', { name: 'Extensions', exact: true })).toBeInViewport({ ratio: 1 });
        await page.goBack();
        await expect(highlighted.locator('.line-number')).toHaveText(String(firstLine));
        await expect(highlighted).toBeInViewport({ ratio: 1 });
        await page.reload();
        await expect(highlighted.locator('.line-number')).toHaveText(String(firstLine));
        await expect(highlighted).toBeInViewport({ ratio: 1 });
        if (viewport.width === 390) await page.getByRole('button', { name: 'Toggle navigation' }).click();
        await page.locator('#findings-tab').click();
        await findings.last().click();
        await page.getByRole('button', { name: /Inspect source/ }).click();
        await expect(highlighted).toContainText('missing-line-jump-second');
        await expect(highlighted).toBeInViewport({ ratio: 1 });
        expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('line')).toBe(String(secondLine));
        await page.goBack();
        await expect(page.locator('#findings')).toBeVisible();
        await page.goBack();
        await expect(highlighted.locator('.line-number')).toHaveText(String(firstLine));
        await expect(highlighted).toBeInViewport({ ratio: 1 });
        await page.goForward();
        await page.goForward();
        await expect(highlighted.locator('.line-number')).toHaveText(String(secondLine));
        await expect(highlighted).toBeInViewport({ ratio: 1 });
        await page.getByRole('button', { name: 'Read effective text', exact: true }).click();
        await page.locator('#effective-document').getByRole('button', { name: /CLAUDE.md/ }).click();
        await expect(page.locator('#source-title')).toHaveText('CLAUDE.md');
        await expect(highlighted).toHaveCount(0);
        expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).has('line')).toBe(false);
        await page.locator('#sources .source').filter({ hasText: longName }).click();
        await expect(page.locator('#source-title')).toHaveText(longPath);
        await expect(page.locator('#source-title')).toHaveAttribute('title', longPath);
        await expect(page.locator('.file-tab')).toBeInViewport({ ratio: 1 });
        expect((await page.locator('.file-tab').boundingBox())!.height).toBeLessThanOrEqual(64);
      }
    }
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('source line links survive refresh and discard unavailable sources and invalid line numbers', async ({ page }) => {
  const w = await workspace({ 'CLAUDE.md': 'First line.\nSecond line.\nThird line.', '.claude/settings.json': '{\n"model":"fixture-model"\n}' });
  const server = await serve({ ...w, user: false, clients: ['claude'], trust: 'trusted' });
  try {
    const route = '#view=effective&client=claude&source=.claude%2Fsettings.json&line=2';
    await page.goto(server.url + route);
    const highlighted = page.locator('.code-line.highlight');
    await expect(highlighted).toContainText('fixture-model');
    await page.getByRole('button', { name: 'Refresh scan', exact: true }).click();
    await expect(page.locator('#scan-status')).toContainText('Scan complete');
    await expect(highlighted).toContainText('fixture-model');
    await expect(highlighted).toBeInViewport({ ratio: 1 });
    await rm(path.join(w.repo, '.claude/settings.json'));
    await page.getByRole('button', { name: 'Refresh scan', exact: true }).click();
    await expect(page.locator('#scan-status')).toContainText('Scan complete');
    await expect(page.locator('#source-title')).toHaveText('CLAUDE.md');
    await expect(highlighted).toHaveCount(0);
    for (const line of ['0', '-1', '2.5', 'unknown', '9007199254740992', '99999999']) {
      await page.goto(server.url + '#view=effective&client=claude&source=CLAUDE.md&line=' + line);
      await expect(page.locator('#source-title')).toHaveText('CLAUDE.md');
      await expect(highlighted).toHaveCount(0);
    }
    await page.goto(server.url + '#view=effective&client=claude&source=missing.md&line=2');
    await expect(page.locator('#source-title')).toHaveText('CLAUDE.md');
    await expect(highlighted).toHaveCount(0);
    await rm(path.join(w.repo, 'CLAUDE.md'));
    await page.getByRole('button', { name: 'Refresh scan', exact: true }).click();
    await expect(page.locator('#scan-status')).toContainText('Scan complete');
    await expect(page.locator('#source-title')).toHaveText('Select a source');
    await expect(page.locator('#source-status')).toBeEmpty();
    await expect(page.locator('.source-information')).toBeHidden();
    await expect(page.locator('#instructions')).toContainText('No configuration discovered');
    await page.locator('#source-search').fill('anything');
    await expect(page.locator('#sources')).toContainText('No configuration discovered');
    await expect(page.locator('#source-search-status')).toHaveText('Showing 0 of 0 sources.');
    await expect(page.getByRole('button', { name: 'Clear search', exact: true })).toHaveCount(0);
  } finally { await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('saved trust aliases and malformed-state correction update live and portable workspace states', async ({ page }) => {
  const w = await trustWorkspace();
  const stateFile = path.join(w.home, '.copilot/config.json');
  await writeFile(stateFile, JSON.stringify({ trustedFolders: [w.otherAlias], internalValue: 'browser-private-trust-state' }));
  const server = await serve({ ...w, repo: w.alias, clients: ['copilot'] });
  try {
    for (const valid of [true, false]) {
      if (!valid) await writeFile(stateFile, JSON.stringify({ trustedFolders: [w.otherAlias], trusted_folders: [42], internalValue: 'browser-private-trust-state' }, null, 2));
      await page.context().setOffline(false);
      await page.goto(server.url);
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: /Export report/ }).click();
      const file = test.info().outputPath('saved-trust-' + valid + '.html');
      await (await pending).saveAs(file);
      const exported = await readFile(file, 'utf8');
      for (const value of ['browser-private-trust-state', w.home, await realpath(w.home), w.otherAlias]) expect(exported).not.toContain(JSON.stringify(value).slice(1, -1));
      for (const url of [server.url, pathToFileURL(file).href]) {
        await page.context().setOffline(url.startsWith('file:'));
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(url);
        expect(await page.locator('#report-data').textContent()).not.toContain('browser-private-trust-state');
        await page.locator('#extensions-tab').click();
        await expect(page.locator('.extension-row').filter({ hasText: 'fixture' }).locator(valid ? '.status.active' : '.status.conditional')).toHaveCount(1);
        await page.locator('#configuration-tab').click();
        await expect(page.locator('#setting-list')).toContainText(valid ? 'repository-trust-model' : 'personal-trust-model');
        if (!valid) {
          await page.locator('#findings-tab').click();
          await page.locator('#findings-list .finding').filter({ hasText: 'Saved Copilot folder trust' }).click();
          await page.getByRole('button', { name: /Inspect source/ }).click();
          await expect(page.locator('#source-title')).toContainText('config.json');
          await expect(page.locator('#instructions')).toContainText('No source preview available');
        }
        await page.setViewportSize({ width: 390, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      }
    }
    await page.context().setOffline(false);
    await writeFile(stateFile, JSON.stringify({ trusted_folders: [], trustedFolders: [w.otherAlias] }));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(server.url);
    await page.locator('#extensions-tab').click();
    await expect(page.locator('.extension-row').filter({ hasText: 'fixture' }).locator('.status.active')).toHaveCount(1);
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('overlapping personal configuration keeps state private and user inclusion correct live and offline', async ({ page }) => {
  const w = await workspace({}, {
    '.copilot/config.json': '{}',
    '.copilot/settings.json': '{"disabled_mcp_servers":["personal"]}',
    '.copilot/mcp-config.json': '// Personal server\n{"mcpServers":{"personal":{"command":"node"}},}',
    '.mcp.json': '{"mcpServers":{"workspace":{"command":"node"}}}',
  });
  await writeFile(path.join(w.home, '.copilot/config.json'), '// Private state\n' + JSON.stringify({ trustedFolders: [w.home], internalValue: 'browser-overlap-private-state' }));
  try {
    for (const user of [true, false]) {
      const server = await serve({ ...w, repo: w.home, clients: ['copilot'], user });
      try {
        await page.context().setOffline(false);
        await page.goto(server.url);
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name: /Export report/ }).click();
        const file = test.info().outputPath('personal-overlap-' + user + '.html');
        await (await pending).saveAs(file);
        const exported = await readFile(file, 'utf8');
        for (const value of ['browser-overlap-private-state', w.home, await realpath(w.home)]) expect(exported).not.toContain(JSON.stringify(value).slice(1, -1));
        for (const url of [server.url, pathToFileURL(file).href]) {
          await page.context().setOffline(url.startsWith('file:'));
          await page.setViewportSize({ width: 1440, height: 1000 });
          await page.goto(url);
          const data = await page.locator('#report-data').textContent();
          expect(data).not.toContain('browser-overlap-private-state');
          const report = JSON.parse(data!);
          expect(report.sources.find((source: any) => source.relativePath === '.copilot/config.json').preview).toBeUndefined();
          expect(report.findings.some((finding: any) => finding.ruleId === 'parse.json')).toBe(false);
          await page.locator('#extensions-tab').click();
          await expect(page.locator('.extension-row').filter({ hasText: 'workspace' }).locator(user ? '.status.active' : '.status.conditional')).toHaveCount(1);
          await expect(page.locator('.extension-row').filter({ hasText: 'personal' })).toHaveCount(user ? 1 : 0);
          if (user) await expect(page.locator('.extension-row').filter({ hasText: 'personal' }).locator('.status.ignored')).toHaveCount(1);
          await page.setViewportSize({ width: 390, height: 844 });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        }
      } finally { await page.context().setOffline(false); await server.close(); }
    }
  } finally { await rm(w.root, { recursive: true, force: true }); }
});

test('case-variant private mappings stay concealed through refresh and offline re-export', async ({ page }) => {
  const secrets = ['browser-case-env-private-value', 'browser-case-header-private-value', '987654321', '0x3ade68b1', '2031-04-05'];
  const instructions = 'Safe introduction.\n\n' + secrets.join('\n') + '\n\nSafe ending.';
  const w = await workspace({
    'AGENTS.md': instructions,
    'CLAUDE.md': instructions,
    '.claude/settings.json': JSON.stringify({ Env: { NORMAL: secrets[0], PIN: 987654321, FLAG: false, EMPTY: null }, model: 'public-model-label' }, null, 2),
    '.mcp.json': JSON.stringify({ mcpServers: { fixture: { command: 'node', Headers: { Custom: secrets[1] } } } }),
    'sibling/.codex/config.toml': '[mcp_servers.fixture.env]\nPIN=0x3ade68b1\nDATE=2031-04-05\nBROKEN=[\n',
  });
  const server = await serve({ ...w, user: false, trust: 'trusted', clients: ['codex', 'claude'] });
  const selection = '#view=effective&client=claude&source=.claude/settings.json';
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.context().setOffline(false);
      await page.setViewportSize(viewport);
      await page.goto(server.url + selection);
      const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/scan');
      await page.getByRole('button', { name: 'Refresh scan', exact: true }).click();
      const { report } = await (await refreshed).json();
      expect(report.findings.some((finding: any) => finding.ruleId === 'config.field-case')).toBe(true);
      for (const value of secrets) expect(JSON.stringify(report)).not.toContain(value);
      await expect(page.locator('#scan-status')).toHaveText('Scan complete');
      await expect(page.locator('#source-title')).toHaveText('.claude/settings.json');
      await expect(page.locator('#instructions')).toContainText('"Env"');
      await expect(page.locator('#instructions')).toContainText('[REDACTED]');
      await expect(page.locator('#instructions')).toContainText('public-model-label');
      for (const generation of ['exported', 'reshared']) {
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name: /Export report/ }).click();
        const file = test.info().outputPath(`case-mapping-${generation}-${viewport.width}.html`);
        await (await pending).saveAs(file);
        const exported = await readFile(file, 'utf8');
        for (const value of [...secrets, w.repo, await realpath(w.repo), w.home, await realpath(w.home)]) expect(exported).not.toContain(JSON.stringify(value).slice(1, -1));
        await page.context().setOffline(true);
        await page.goto(pathToFileURL(file).href);
        await expect(page.locator('#source-title')).toHaveText('.claude/settings.json');
        await expect(page.locator('#instructions')).toContainText('[REDACTED]');
        await page.getByRole('button', { name: 'Read effective text', exact: true }).click();
        await expect(page.locator('#effective-document')).toContainText('Safe introduction.');
        await expect(page.locator('#effective-document')).toContainText('[REDACTED]');
        if (viewport.width === 390) await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
        await page.locator('#compare-tab').click();
        await expect(page.locator('#comparison-blocks')).toContainText('Safe ending.');
        await expect(page.locator('#comparison-blocks')).toContainText('[REDACTED]');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.goto(pathToFileURL(file).href + selection);
      }
    }
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true, maxRetries: 5 }); }
});

test('malformed sibling TOML masks copied private text in live and offline reports', async ({ page }) => {
  const secret = 'browser-malformed-toml-private-value';
  const w = await workspace({
    'AGENTS.md': 'Safe introduction.\n\n' + secret + '\n\nSafe ending.',
    'CLAUDE.md': 'Safe introduction.\n\n' + secret + '\n\nSafe ending.',
    'sibling/.codex/config.toml': '[mcp_servers.fixture.env]\nNORMAL="browser-malformed-toml-private-\\u0076alue"\nBROKEN=[\n',
  });
  const server = await serve({ ...w, user: false, trust: 'trusted', clients: ['codex', 'claude'] });
  try {
    await page.goto(server.url);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('malformed-toml-privacy.html');
    await (await pending).saveAs(file);
    const exported = await readFile(file, 'utf8');
    for (const value of [secret, w.repo, await realpath(w.repo), w.home, await realpath(w.home)]) expect(exported).not.toContain(JSON.stringify(value).slice(1, -1));
    for (const url of [server.url, pathToFileURL(file).href]) {
      await page.context().setOffline(url.startsWith('file:'));
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(url);
      const data = await page.locator('#report-data').textContent();
      expect(data).not.toContain('browser-malformed-toml-private-');
      const report = JSON.parse(data!);
      expect(report.sources.some((source: any) => source.relativePath === 'sibling/.codex/config.toml' && source.invalid && source.preview === undefined)).toBe(true);
      expect(report.findings.some((finding: any) => finding.ruleId === 'parse.toml')).toBe(false);
      await page.getByRole('button', { name: 'Inspect Codex instructions', exact: true }).click();
      await page.getByRole('button', { name: 'Read effective text', exact: true }).click();
      await expect(page.locator('#effective-document')).toContainText('Safe introduction.');
      await expect(page.locator('#effective-document')).toContainText('[REDACTED]');
      await page.locator('#compare-tab').click();
      await expect(page.locator('#comparison-blocks')).toContainText('Safe ending.');
      await expect(page.locator('#comparison-blocks')).toContainText('[REDACTED]');
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('target changes recompute syntax findings and preserve outside-scope sources in portable reports', async ({ page }) => {
  const w = await workspace({ '.codex/config.toml': 'model="root-model"\n', 'app/index.ts': '', 'sibling/index.ts': '', 'sibling/.codex/config.toml': 'model=[\n' });
  const server = await serve({ ...w, clients: ['codex'], user: false, trust: 'trusted', target: 'app/index.ts' });
  try {
    await page.goto(server.url);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const rootFile = test.info().outputPath('scoped-clean-target.html');
    await (await download).saveAs(rootFile);
    const rootHtml = await readFile(rootFile, 'utf8');
    const snapshot = JSON.parse(rootHtml.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/)![1]);
    expect(snapshot.sources.some((source: any) => source.relativePath === 'sibling/.codex/config.toml' && source.invalid)).toBe(true);
    expect(snapshot.findings.some((finding: any) => finding.ruleId.startsWith('parse.'))).toBe(false);
    for (const value of [w.repo, await realpath(w.repo), w.home, await realpath(w.home)]) expect(rootHtml).not.toContain(JSON.stringify(value).slice(1, -1));
    for (const url of [server.url, pathToFileURL(rootFile).href]) {
      await page.context().setOffline(url.startsWith('file:'));
      await page.goto(url);
      await page.locator('#findings-tab').click();
      await page.locator('#severity').selectOption('error');
      await expect(page.locator('#findings-list .finding')).toHaveCount(0);
    }
    await page.context().setOffline(false);
    await page.goto(server.url);
    await page.locator('#target').fill('sibling/index.ts');
    await page.locator('#inspect').click();
    await expect(page.locator('#footer-target')).toHaveText('sibling/index.ts');
    await page.locator('#findings-tab').click();
    await page.locator('#severity').selectOption('error');
    await expect(page.locator('#findings-list .finding')).toHaveCount(1);
    const brokenDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const brokenFile = test.info().outputPath('scoped-broken-target.html');
    await (await brokenDownload).saveAs(brokenFile);
    await page.context().setOffline(true);
    await page.goto(pathToFileURL(brokenFile).href);
    await page.locator('#findings-tab').click();
    await page.locator('#severity').selectOption('error');
    await expect(page.locator('#findings-list .finding')).toHaveCount(1);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.context().setOffline(false);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(server.url);
    await page.locator('#target').fill('app/index.ts');
    await page.locator('#inspect').click();
    await expect(page.locator('#footer-target')).toHaveText('app/index.ts');
    await page.locator('#findings-tab').click();
    await page.locator('#severity').selectOption('error');
    await expect(page.locator('#findings-list .finding')).toHaveCount(0);
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('Copilot personal JSONC retains workspace trust and private source navigation live and offline', async ({ page }) => {
  const personal = '// Personal MCP configuration\n{\n"mcpServers": {\n"personal": {\n"command": "missing-browser-jsonc-command",\n"env": {"NORMAL":"browser-jsonc-private-\\u0076alue"},\n},\n},\n}';
  const w = await workspace({ '.mcp.json': JSON.stringify({ mcpServers: { project: { command: process.execPath } } }) }, { '.copilot/config.json': '{}', '.copilot/mcp-config.json': personal });
  await writeFile(path.join(w.home, '.copilot/config.json'), '// Persisted workspace trust\n' + JSON.stringify({ trustedFolders: [w.repo], internalValue: 'browser-jsonc-internal-private' }, null, 2).replace(/\n}$/, ',\n}'));
  const server = await serve({ ...w, clients: ['copilot'] });
  try {
    await page.goto(server.url);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('copilot-personal-jsonc.html');
    await (await pending).saveAs(file);
    const exported = await readFile(file, 'utf8');
    for (const value of [w.home, await realpath(w.home), w.repo, await realpath(w.repo), 'browser-jsonc-private-', 'browser-jsonc-internal-private']) expect(exported).not.toContain(JSON.stringify(value).slice(1, -1));
    for (const url of [server.url, pathToFileURL(file).href]) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.context().setOffline(url.startsWith('file:'));
      await page.goto(url);
      await page.locator('#extensions-tab').click();
      await expect(page.locator('.extension-row .status.active')).toHaveCount(2);
      await page.locator('.extension-row').filter({ hasText: 'personal' }).click();
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.locator('#detail-dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.locator('.extension-origins').getByRole('button', { name: /^command ·/ }).click();
      await expect(page.locator('.code-line.highlight')).toContainText('missing-browser-jsonc-command');
      await expect(page.locator('.code-line.highlight .line-number')).toHaveText('5');
      await expect(page.locator('.code-view')).toContainText('// Personal MCP configuration');
      await expect(page.locator('.code-view')).toContainText('[REDACTED]');
    }
    await page.context().setOffline(false);
    await writeFile(path.join(w.home, '.copilot/config.json'), '{}');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(server.url);
    await page.locator('#extensions-tab').click();
    await expect(page.locator('.extension-row').filter({ hasText: 'project' }).locator('.status.conditional')).toHaveCount(1);
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('blocked Claude MCP retains field definitions and original policy lines live and offline', async ({ page }) => {
  const w = await workspace({ '.mcp.json': JSON.stringify({ mcpServers: { fixture: { command: 'missing-policy-blocked-browser-command' } } }) }, { '.claude/settings.json': '{\n"deniedMcpServers": [\n42,\n{"serverName": "fixture"}\n]\n}' });
  const server = await serve({ ...w, clients: ['claude'], trust: 'trusted' });
  try {
    await page.goto(server.url);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('blocked-claude-mcp.html');
    await (await download).saveAs(file);
    const exported = await readFile(file, 'utf8');
    for (const root of [w.repo, await realpath(w.repo), w.home, await realpath(w.home)]) expect(exported).not.toContain(JSON.stringify(root).slice(1, -1));
    for (const url of [server.url, pathToFileURL(file).href]) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.context().setOffline(url.startsWith('file:'));
      await page.goto(url);
      await page.locator('#extensions-tab').click();
      await expect(page.locator('.extension-row .status.ignored')).toHaveCount(1);
      await page.locator('.extension-row').click();
      await expect(page.getByRole('heading', { name: 'Field definitions and policy', exact: true })).toBeVisible();
      await expect(page.locator('.extension-origins').getByRole('button', { name: /^command ·/ })).toBeVisible();
      await page.screenshot({ path: test.info().outputPath('claude-mcp-policy-desktop.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.locator('#detail-dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath('claude-mcp-policy-phone.png') });
      await page.locator('.extension-origins').getByRole('button', { name: /^deniedMcpServers ·/ }).click();
      await expect(page.locator('.code-line.highlight')).toContainText('"serverName": "fixture"');
      await expect(page.locator('.code-line.highlight .line-number')).toHaveText('4');
    }
    await page.context().setOffline(false);
    await writeFile(path.join(w.home, '.claude/settings.json'), '{}');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(server.url);
    await page.locator('#extensions-tab').click();
    await expect(page.locator('.extension-row .status.active')).toHaveCount(1);
    await page.locator('#findings-tab').click();
    await expect(page.locator('#findings-list')).toContainText('was not found or is not executable');
  } finally { await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('disabled Claude hooks retain their controlling setting in live and offline reports', async ({ page }) => {
  const w = await workspace({ '.claude/settings.json': JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'missing-disabled-claude-browser-hook' }] }] } }) }, { '.claude/settings.json': '{\n"disableAllHooks": true\n}' });
  const server = await serve({ ...w, clients: ['claude'], trust: 'trusted' });
  try {
    await page.goto(server.url);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('disabled-claude-hook.html');
    await (await download).saveAs(file);
    const exported = await readFile(file, 'utf8');
    for (const root of [w.repo, await realpath(w.repo), w.home, await realpath(w.home)]) expect(exported).not.toContain(JSON.stringify(root).slice(1, -1));
    for (const url of [server.url, pathToFileURL(file).href]) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.context().setOffline(url.startsWith('file:'));
      await page.goto(url);
      await page.locator('#extensions-tab').click();
      await expect(page.locator('.extension-row .status.ignored')).toHaveCount(1);
      await page.locator('.extension-row').click();
      await expect(page.getByRole('heading', { name: 'Controlling setting', exact: true })).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.locator('#detail-dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.locator('.extension-origins').getByRole('button', { name: /^disableAllHooks ·/ }).click();
      await expect(page.locator('.code-line.highlight')).toContainText('"disableAllHooks": true');
      await expect(page.locator('.code-line.highlight .line-number')).toHaveText('2');
    }
    await page.context().setOffline(false);
    await writeFile(path.join(w.home, '.claude/settings.json'), '{"disableAllHooks": false}');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(server.url);
    await page.locator('#extensions-tab').click();
    await expect(page.locator('.extension-row .status.active')).toHaveCount(1);
    await page.locator('#findings-tab').click();
    await expect(page.locator('#findings-list')).toContainText('Hook command was not found');
  } finally { await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('multi-line private paragraphs stay masked in live and portable comparisons', async ({ page }) => {
  const value = 'private-browser-first\r\n\r\nprivate-browser-last';
  const w = await workspace({
    'AGENTS.md': 'Safe introduction.\n\n' + value + '\n\nSafe ending.',
    'CLAUDE.md': 'Safe introduction.\n\n' + value.replace(/\r\n/g, '\n') + '\n\nSafe ending.',
    '.mcp.json': JSON.stringify({ mcpServers: { fixture: { command: 'node', env: { NORMAL: value } } } }),
  });
  const server = await serve({ ...w, user: false, trust: 'trusted', clients: ['codex', 'claude'] });
  try {
    await page.goto(server.url);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('private-paragraphs.html');
    await (await download).saveAs(file);
    const exported = await readFile(file, 'utf8');
    for (const sentinel of ['private-browser-first', 'private-browser-last']) expect(exported).not.toContain(sentinel);
    for (const url of [server.url, pathToFileURL(file).href]) {
      await page.context().setOffline(url.startsWith('file:'));
      await page.goto(url);
      const data = await page.locator('#report-data').textContent();
      expect(data).not.toContain('private-browser-first');
      expect(data).not.toContain('private-browser-last');
      await page.locator('#compare-tab').click();
      await expect(page.locator('#comparison-blocks')).toContainText('Safe introduction.');
      const masked = page.locator('.instruction-block').filter({ has: page.locator('pre', { hasText: /^\[REDACTED\]$/ }) });
      await expect(masked).toHaveCount(2);
      await masked.first().locator('.instruction-block-origin').filter({ hasText: 'Codex' }).click();
      await expect(page.locator('.code-line.highlight .line-number')).toHaveText('3');
      await expect(page.locator('.code-line.highlight')).toContainText('[REDACTED]');
    }
  } finally { await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('paragraph comparison follows exact recipients and source lines online and offline', async ({ page }) => {
  const shared = 'Run the checks.\nKeep changes focused.';
  const w = await workspace({
    'AGENTS.md': 'Codex introduction.\n\n' + shared + '\n\nCodex ending.',
    'CLAUDE.md': shared + '\n\nClaude ending.\n\n<script>window.paragraphExecuted = true</script>',
  });
  const server = await serve({ ...w, user: false, trust: 'trusted', clients: ['codex', 'claude'] });
  try {
    await page.goto(server.url);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('paragraph-comparison.html');
    await (await download).saveAs(file);
    for (const url of [server.url, pathToFileURL(file).href]) {
      await page.context().setOffline(url.startsWith('file:'));
      await page.goto(url);
      await page.locator('#compare-tab').click();
      await expect(page.locator('.instruction-block')).toHaveCount(5);
      await page.getByLabel('Instruction content filter').selectOption('shared');
      await expect(page.locator('.instruction-block')).toHaveCount(1);
      await expect(page.locator('.instruction-block pre')).toHaveText(shared);
      const sources = page.locator('.instruction-block-origin');
      await expect(sources.filter({ hasText: 'Codex' })).toContainText('lines 3–4');
      await expect(sources.filter({ hasText: 'Claude Code' })).toContainText('lines 1–2');
      await sources.filter({ hasText: 'Codex' }).click();
      await expect(page.locator('#source-title')).toHaveText('AGENTS.md');
      await expect(page.locator('.code-line.highlight .line-number')).toHaveText('3');
      await page.locator('#compare-tab').click();
      await page.getByLabel('Instruction content filter').selectOption('different');
      await expect(page.locator('.instruction-block')).toHaveCount(4);
      await expect(page.locator('#comparison-blocks')).toContainText('<script>window.paragraphExecuted');
      expect(await page.evaluate(() => 'paragraphExecuted' in window)).toBe(false);
      await page.getByLabel('Instruction content filter').selectOption('all');
      await page.locator('#compare-clients button').filter({ hasText: 'Claude Code' }).click();
      await expect(page.locator('.instruction-block')).toHaveCount(3);
      await page.locator('#compare-clients button').filter({ hasText: 'Claude Code' }).click();
      await expect(page.locator('.instruction-block')).toHaveCount(5);
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await page.context().setOffline(false);
    await writeFile(path.join(w.repo, 'CLAUDE.md'), 'Updated Claude-only instructions.');
    await page.goto(server.url);
    await page.locator('#compare-tab').click();
    await page.getByLabel('Instruction content filter').selectOption('shared');
    await expect(page.locator('.instruction-block')).toHaveCount(0);
    await expect(page.locator('#comparison-blocks')).toContainText('No matching instruction paragraphs');
  } finally { await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('paragraph comparison bounds initial rows and keeps legacy snapshots inspectable', async ({ page }) => {
  const w = await workspace({ 'AGENTS.md': Array.from({ length: 125 }, (_, index) => `Instruction ${index + 1}.`).join('\n\n') });
  try {
    const report = await scan({ ...w, user: false, trust: 'trusted', clients: ['codex', 'claude'] });
    const file = test.info().outputPath('many-paragraphs.html');
    await writeFile(file, html(report));
    await page.goto(pathToFileURL(file).href);
    await page.locator('#compare-tab').click();
    await expect(page.locator('.instruction-block')).toHaveCount(100);
    await page.getByRole('button', { name: 'Show 25 more paragraphs', exact: true }).click();
    await expect(page.locator('.instruction-block')).toHaveCount(125);
    await expect(page.locator('.instruction-block pre').nth(100)).toBeFocused();
    await expect(page.locator('#comparison-content-summary')).toContainText('Showing 125 of 125');
    delete report.instructionDiff;
    const legacyFile = test.info().outputPath('legacy-comparison.html');
    await writeFile(legacyFile, html(report));
    await page.goto(pathToFileURL(legacyFile).href);
    await page.locator('#compare-tab').click();
    await expect(page.locator('#comparison-content')).toBeHidden();
    await expect(page.locator('#comparison-text')).toContainText('Instruction 125.');
    await expect(page.locator('#comparison-matrix')).toBeVisible();
  } finally { await rm(w.root, { recursive: true, force: true }); }
});

test('permission masking follows the overriding rule in live and portable reports and responds to correction', async ({ page }) => {
  const w = await workspace({
    '.claude/settings.json': '{\n"permissions":{"ask":[\n"Bash"\n]}\n}',
    '.claude/settings.local.json': '{"permissions":{"allow":["Read"]}}',
  }, { '.claude/settings.json': '{\n"permissions":{"allow":[\n"Bash(npm test)"\n]}\n}' });
  const server = await serve({ ...w, clients: ['claude'] });
  try {
    await page.goto(server.url);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('permission-precedence.html');
    await (await download).saveAs(file);
    const content = await readFile(file, 'utf8');
    for (const root of [w.repo, await realpath(w.repo), w.home, await realpath(w.home)]) expect(content).not.toContain(JSON.stringify(root).slice(1, -1));
    for (const url of [server.url, pathToFileURL(file).href]) {
      await page.context().setOffline(url.startsWith('file:'));
      await page.goto(url);
      await page.locator('#findings-tab').click();
      await page.locator('#findings-list .finding').filter({ hasText: 'Ask overrides allow' }).click();
      await page.getByRole('button', { name: /Inspect source/ }).click();
      await expect(page.locator('.code-line.highlight')).toContainText('Bash(npm test)');
      await expect(page.locator('.code-line.highlight .line-number')).toHaveText('3');
      await page.locator('#extensions-tab').click();
      await expect(page.locator('.extension-row').filter({ hasText: 'Read' }).locator('.status.conditional')).toHaveCount(1);
      const shadowed = page.locator('.extension-row').filter({ hasText: 'Bash(npm test)' });
      await expect(shadowed.locator('.status.shadowed')).toHaveCount(1);
      await shadowed.click();
      await expect(page.getByRole('heading', { name: 'Overriding rules', exact: true })).toBeVisible();
      await page.locator('.extension-origins').getByRole('button', { name: /^permissions.ask.0 ·/ }).click();
      await expect(page.locator('#source-title')).toHaveText('.claude/settings.json');
      await expect(page.locator('.code-line.highlight')).toContainText('"Bash"');
      await expect(page.locator('.code-line.highlight .line-number')).toHaveText('3');
    }
    await page.context().setOffline(false);
    await page.goto(server.url);
    await page.locator('#trust').selectOption('trusted');
    await expect(page.locator('#scan-status')).toHaveText('Scan complete');
    await page.locator('#extensions-tab').click();
    await expect(page.locator('.extension-row').filter({ hasText: 'Read' }).locator('.status.active')).toHaveCount(1);
    await writeFile(path.join(w.repo, '.claude/settings.json'), '{"permissions":{"ask":[]}}');
    await page.getByRole('button', { name: 'Refresh scan', exact: true }).click();
    await expect(page.locator('#scan-status')).toHaveText('Scan complete');
    await expect(page.locator('.extension-row').filter({ hasText: 'Bash(npm test)' }).locator('.status.active')).toHaveCount(1);
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('Copilot excluded skill directories retain their explanation, fallback and setting source offline', async ({ page }) => {
  const w = await workspace({
    '.github/skills/shared/SKILL.md': '---\nname: shared\ndescription: Excluded project skill.\n---\nInstructions.\n',
    '.agents/skills/shared/SKILL.md': '---\nname: shared\ndescription: Available fallback skill.\n---\nInstructions.\n',
  }, { '.copilot/settings.json': '{}' });
  const repository = process.platform === 'win32' ? w.repo : await realpath(w.repo);
  await writeFile(path.join(w.home, '.copilot/settings.json'), '{\n"ignored_skills_locations":' + JSON.stringify([path.join(repository, '.github/skills')]) + '\n}');
  const server = await serve({ ...w, clients: ['copilot'] });
  try {
    await page.goto(server.url);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('copilot-skill-exclusions.html');
    await (await download).saveAs(file);
    const content = await readFile(file, 'utf8');
    expect(content).not.toContain(await realpath(w.repo));
    expect(content).not.toContain(w.home);
    for (const url of [server.url, pathToFileURL(file).href]) {
      await page.goto(url);
      await page.locator('#extensions-tab').click();
      const excluded = page.locator('.extension-row').filter({ hasText: 'Excluded project skill.' });
      const fallback = page.locator('.extension-row').filter({ hasText: 'Available fallback skill.' });
      await expect(excluded.locator('.status.ignored')).toHaveCount(1);
      await expect(fallback.locator('.status.active')).toHaveCount(1);
      await excluded.click();
      await expect(page.locator('#detail-dialog')).toContainText('excluded by the effective Copilot ignoredSkillsLocations setting');
      await expect(page.getByRole('heading', { name: 'Availability setting', exact: true })).toBeVisible();
      await page.locator('.extension-origins').getByRole('button', { name: /^ignoredSkillsLocations ·/ }).click();
      await expect(page.locator('.code-line.highlight')).toContainText('"ignored_skills_locations"');
      await expect(page.locator('.code-line.highlight .line-number')).toHaveText('2');
      await page.locator('#extensions-tab').click();
      await excluded.click();
      await page.getByRole('button', { name: /Inspect source/ }).click();
      await expect(page.locator('#source-title')).toHaveText('.github/skills/shared/SKILL.md');
      await expect(page.locator('.code-line.highlight')).toContainText('name: shared');
      expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('line')).toBe('2');
      await page.locator('#configuration-tab').click();
      await page.getByLabel('Search settings').fill('ignoredSkillsLocations');
      await page.locator('#setting-list tbody tr').getByRole('button', { name: 'ignoredSkillsLocations', exact: true }).click();
      await page.getByRole('button', { name: /Inspect source/ }).click();
      await expect(page.locator('.code-line.highlight')).toContainText('"ignored_skills_locations"');
      await expect(page.locator('.code-line.highlight .line-number')).toHaveText('2');
    }
    await writeFile(path.join(w.home, '.copilot/settings.json'), '{"ignoredSkillsLocations":[]}');
    await page.goto(server.url);
    await page.locator('#extensions-tab').click();
    await expect(page.locator('.extension-row').filter({ hasText: 'Excluded project skill.' }).locator('.status.active')).toHaveCount(1);
    await expect(page.locator('.extension-row').filter({ hasText: 'Available fallback skill.' }).locator('.status.shadowed')).toHaveCount(1);
  } finally { await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('all client marks render locally and survive an offline portable export', async ({ page }) => {
  const w = await workspace({ 'AGENTS.md': 'Shared instructions.', 'GEMINI.md': 'Gemini instructions.' });
  const server = await serve({ ...w, user: false });
  try {
    await page.goto(server.url);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('client-marks.html');
    await (await download).saveAs(file);
    for (const url of [server.url, pathToFileURL(file).href]) {
      if (url.startsWith('file:')) await page.context().setOffline(true);
      await page.goto(url);
      const marks = page.locator('#clients .client-avatar');
      await expect(marks).toHaveCount(6);
      expect(await marks.allTextContents()).toEqual(['', '', '', '', '', '']);
      const rendered = await marks.evaluateAll(async elements => Promise.all(elements.map(element => new Promise<boolean>(resolve => {
        const source = getComputedStyle(element).backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
        const image = new Image();
        image.onload = () => resolve(image.naturalWidth > 0);
        image.onerror = () => resolve(false);
        image.src = source ?? '';
      }))));
      expect(rendered).toEqual([true, true, true, true, true, true]);
    }
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('Copilot canonical settings open their original personal aliases in live and portable views', async ({ page }) => {
  const w = await workspace({ '.mcp.json': '{"mcpServers":{"fixture":{"command":"missing-disabled-browser-alias"}}}' }, { '.copilot/settings.json': '{\n"disabledMcpServers":["earlier"],\n"disabled_mcp_servers":["fixture"],\n"disable_all_hooks":true,\n"colorMode":"dim"\n}' });
  const server = await serve({ ...w, clients: ['copilot'], trust: 'trusted' });
  try {
    await page.goto(server.url);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('copilot-personal-aliases.html');
    await (await download).saveAs(file);
    const content = await readFile(file, 'utf8');
    expect(content).not.toContain(w.home);
    expect(content).not.toContain(await realpath(w.repo));
    for (const url of [server.url, pathToFileURL(file).href]) {
      await page.goto(url);
      await page.locator('#configuration-tab').click();
      await page.getByLabel('Search settings').fill('disabledMcpServers');
      const rows = page.locator('#setting-list tbody tr');
      await expect(rows).toHaveCount(1);
      await expect(rows).toContainText('fixture');
      await page.getByLabel('Search settings').fill('disabled_mcp_servers');
      await expect(rows).toHaveCount(1);
      await rows.getByRole('button', { name: 'disabledMcpServers', exact: true }).click();
      await expect(page.locator('.setting-origins')).toContainText('Earlier definitions');
      await expect(page.locator('.setting-origins')).toContainText('settings.json · line 2');
      await page.getByRole('button', { name: /Inspect source/ }).click();
      await expect(page.locator('.code-line.highlight')).toContainText('"disabled_mcp_servers"');
      await page.locator('#extensions-tab').click();
      await expect(page.locator('.extension-row .status.ignored')).toHaveCount(1);
    }
    await page.screenshot({ path: test.info().outputPath('copilot-personal-aliases.png') });
  } finally { await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('Copilot layered settings navigate to their sources and retain disabled extensions in portable reports', async ({ page }) => {
  const w = await workspace({
    '.github/copilot/settings.json': '{\n"model":"repository-model",\n"disabledMcpServers":["disabled"],\n"disableAllHooks":true\n}',
    '.github/copilot/settings.local.json': '{// local override\n"model":"local-model",}',
    '.mcp.json': '{"mcpServers":{"disabled":{"command":"missing-disabled-browser-fixture"}}}',
    '.github/hooks/test.json': '{"version":1,"hooks":{"sessionStart":[{"command":"missing-disabled-hook-fixture"}]}}',
    'src/refund.ts': '',
  }, { '.copilot/settings.json': '{"model":"personal-model","disabledMcpServers":["personal"]}' });
  const server = await serve({ ...w, clients: ['copilot'], target: 'src/refund.ts' });
  try {
    await page.goto(server.url);
    await page.locator('#configuration-tab').click();
    await page.getByLabel('Search settings').fill('model');
    const rows = page.locator('#setting-list tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: 'personal-model' })).toContainText('Loaded');
    await expect(rows.filter({ hasText: 'local-model' })).toContainText('Conditional');
    await page.locator('#trust').selectOption('trusted');
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText('local-model');
    await rows.getByRole('button', { name: 'model', exact: true }).click();
    await expect(page.locator('.setting-origins')).toContainText('Earlier definitions');
    await expect(page.locator('.setting-origins')).toContainText('.github/copilot/settings.json');
    await page.screenshot({ path: test.info().outputPath('copilot-settings.png') });
    await page.getByRole('button', { name: /Inspect source/ }).click();
    await expect(page.locator('#source-title')).toHaveText('.github/copilot/settings.local.json');
    await expect(page.locator('.code-line.highlight')).toContainText('local-model');
    await page.locator('#extensions-tab').click();
    await expect(page.locator('.extension-row .status.ignored')).toHaveCount(2);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('copilot-layered-settings.html');
    await (await download).saveAs(file);
    const content = await readFile(file, 'utf8');
    expect(content).not.toContain(w.home);
    expect(content).not.toContain(await realpath(w.repo));
    await page.goto(pathToFileURL(file).href);
    await page.locator('#configuration-tab').click();
    await page.getByLabel('Search settings').fill('model');
    await expect(rows).toHaveCount(1);
    await rows.getByRole('button', { name: /settings.local.json:2$/ }).click();
    await expect(page.locator('.code-line.highlight')).toContainText('local-model');
    await page.locator('#extensions-tab').click();
    await expect(page.locator('.extension-row .status.ignored')).toHaveCount(2);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally { await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('shared JSONC settings keep Claude syntax findings scoped while Copilot hooks stay inspectable', async ({ page }) => {
  const w = await workspace({ '.claude/settings.json': '{// Copilot accepts JSONC\n"hooks":{"SessionStart":[{"hooks":[{"command":"missing-shared-browser-hook"}]}]},\n}' });
  const server = await serve({ ...w, user: false, clients: ['claude', 'copilot'] });
  try {
    await page.goto(server.url);
    await page.locator('#findings-tab').click();
    await page.locator('#finding-client').selectOption('copilot');
    await expect(page.locator('#findings-list')).toContainText('Hook command was not found');
    await expect(page.locator('#findings-list')).not.toContainText('Invalid comment');
    await page.locator('#findings-list .finding').filter({ hasText: 'Hook command was not found' }).click();
    await page.getByRole('button', { name: /Inspect source/ }).click();
    await expect(page.locator('#effective-title')).toHaveText('GitHub Copilot’s instructions');
    await expect(page.locator('.code-line.highlight')).toContainText('missing-shared-browser-hook');
    await page.locator('#extensions-tab').click();
    await page.locator('#extension-client').selectOption('copilot');
    await expect(page.locator('.extension-row')).toContainText('missing-shared-browser-hook');
    await page.locator('.extension-row').click();
    await expect(page.locator('#detail-dialog')).toContainText('.claude/settings.json');
    const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(accessibility.violations).toEqual([]);
  } finally { await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('streamed reports keep controls unavailable until their handlers are ready', async ({ page }) => {
  const report = await scan({ ...sampleOptions, clients: [...sampleOptions.clients], target: 'src/payments/refund.ts' });
  for (const live of [false, true]) {
    const document = html(report, { live });
    const scriptStart = document.lastIndexOf('<script>');
    expect(scriptStart).toBeGreaterThan(0);
    let release = () => {};
    const server = createServer((request, response) => {
      if (request.url !== '/') { response.writeHead(204); response.end(); return; }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.write(document.slice(0, scriptStart));
      release = () => { if (!response.writableEnded) response.end(document.slice(scriptStart)); };
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      expect(address && typeof address === 'object').toBeTruthy();
      const port = typeof address === 'object' && address ? address.port : 0;
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'commit' });
      await expect(page.locator('#compare-tab')).toBeVisible();
      await expect(page.locator('#compare-tab')).toBeDisabled();
      await expect(page.locator('#target')).toBeDisabled();
      await expect(page.locator('#scan-status')).toContainText('Loading report');
      expect(await page.locator('button,input,select,textarea').evaluateAll(controls => controls.every(control => (control as HTMLInputElement).disabled))).toBe(true);
      const firstClick = page.locator('#compare-tab').click();
      release();
      await firstClick;
      await expect(page.locator('#comparison-matrix')).toContainText('AGENTS.override.md');
      await expect(page.locator('#compare-tab')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('[data-startup-disabled]')).toHaveCount(0);
      await expect(page.locator('#target')).toHaveJSProperty('readOnly', !live);
    } finally {
      release();
      const closed = new Promise<void>(resolve => server.close(() => resolve()));
      server.closeAllConnections(); await closed;
    }
  }
});

test('snapshot initialization preserves disabled copy controls and read-only targets', async ({ page }) => {
  const w = await workspace();
  try {
    const report = await scan({ ...w, user: false, clients: ['codex'], trust: 'trusted' });
    const file = test.info().outputPath('empty-initialized-report.html');
    await writeFile(file, html(report));
    await page.goto(pathToFileURL(file).href + '#view=effective&client=codex');
    await expect(page.locator('#copy-source')).toBeDisabled();
    await expect(page.locator('#copy-effective')).toBeDisabled();
    await expect(page.locator('#target')).toBeEnabled();
    await expect(page.locator('#target')).toHaveJSProperty('readOnly', true);
    await expect(page.locator('#inspect')).toBeHidden();
    await expect(page.locator('#refresh')).toBeHidden();
  } finally { await rm(w.root, { recursive: true, force: true }); }
});

test('Claude transport diagnosis follows source correction, refresh and explicit trust', async ({ page }) => {
  const servers = { remote: { url: 'https://example.test/mcp' }, local: { command: process.execPath } };
  const w = await workspace({ '.mcp.json': JSON.stringify({ mcpServers: servers }, null, 2), '.claude/settings.json': '{"enableAllProjectMcpServers":true}' });
  const server = await serve({ ...w, user: false, clients: ['claude'] });
  try {
    await page.goto(server.url);
    await page.locator('#findings-tab').click();
    await page.locator('#findings-list .finding').filter({ hasText: 'needs an explicit type' }).click();
    await page.getByRole('button', { name: /Inspect source/ }).click();
    await expect(page.locator('.code-line.highlight')).toContainText('"url": "https://example.test/mcp"');
    await writeFile(path.join(w.repo, '.mcp.json'), JSON.stringify({ mcpServers: { ...servers, remote: { type: 'http', ...servers.remote } } }, null, 2));
    await page.getByRole('button', { name: 'Refresh scan', exact: true }).click();
    await expect(page.locator('#scan-status')).toHaveText('Scan complete');
    await page.locator('#extensions-tab').click();
    await expect(page.locator('.extension-row .status.conditional')).toHaveCount(2);
    await page.locator('#trust').selectOption('trusted');
    await expect(page.locator('#scan-status')).toHaveText('Scan complete');
    await expect(page.locator('.extension-row .status.active')).toHaveCount(2);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('corrected-claude-transport.html');
    await (await pending).saveAs(file);
    await page.goto(pathToFileURL(file).href);
    await page.locator('#extensions-tab').click();
    await expect(page.locator('.extension-row .status.active')).toHaveCount(2);
    await expect(page.locator('.extension-row').filter({ hasText: 'remote' }).locator('.extension-command')).toHaveText('https://example.test/mcp');
  } finally { await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('Claude local MCP state survives private source inspection, copying, refresh and portable reports', async ({ page }) => {
  const w = await workspace({
    'src/file.ts': '',
    '.mcp.json': JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: ['--project'] } } }),
  });
  const project = process.platform === 'win32' ? w.repo.replaceAll('\\', '/') : await realpath(w.repo);
  const saveLocal = async (enabled: boolean) => writeFile(path.join(w.home, '.claude.json'), JSON.stringify({
    mcpServers: { fixture: { command: process.execPath, args: ['--user'] } },
    projects: { [project]: { mcpServers: enabled ? { fixture: {
      command: process.execPath, args: ['--local'], env: { LOCAL_SECRET: 'browser-local-mcp-private-value' },
    } } : {} } },
    account: { email: 'browser-local-mcp-private@example.test' },
  }, null, 2));
  await saveLocal(true);
  const server = await serve({ ...w, clients: ['claude'], target: 'src/file.ts' });
  try {
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: {
      writeText: async (text: string) => { (window as any).copiedDefinition = text; },
    }, configurable: true }));
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await saveLocal(true);
      await page.goto(server.url + '#view=extensions');
      await page.reload();
      await expect(page.locator('.extension-row .status.active')).toHaveCount(1);
      await expect(page.locator('.extension-row .status.shadowed')).toHaveCount(2);
      await page.locator('.extension-row').filter({ has: page.locator('.status.active') }).click();
      await expect(page.locator('#detail-dialog')).toContainText('Local MCP server configured for this project');
      await expect(page.locator('#detail-dialog')).toContainText('--local');
      await expect(page.locator('.extension-origins').getByRole('button', { name: /^command ·/ })).toContainText('~/.claude.json:');
      await page.getByRole('button', { name: 'Copy definition', exact: true }).click();
      const copied = JSON.parse(await page.evaluate(() => (window as any).copiedDefinition));
      expect(copied.args).toEqual(['--local']);
      expect(copied.env.LOCAL_SECRET).toBe('[REDACTED]');
      await expect(page.getByRole('button', { name: 'Close details', exact: true })).toBeInViewport();
      expect(await page.locator('#detail-dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`claude-local-mcp-${viewport.width}.png`) });
      await page.getByRole('button', { name: 'Close details', exact: true }).click();
      await page.locator('.extension-row').filter({ has: page.locator('.status.shadowed') }).first().click();
      await expect(page.getByRole('heading', { name: 'fixture', exact: true })).toBeInViewport();
      await page.getByRole('button', { name: 'Close details', exact: true }).click();

      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: /Export report/ }).click();
      const file = test.info().outputPath(`claude-local-mcp-${viewport.width}.html`);
      await (await pending).saveAs(file);
      const content = await readFile(file, 'utf8');
      for (const value of [w.repo, await realpath(w.repo), w.home, await realpath(w.home), 'browser-local-mcp-private-value', 'browser-local-mcp-private@example.test']) {
        expect(content).not.toContain(JSON.stringify(value).slice(1, -1));
      }
      await page.context().setOffline(true);
      await page.goto(pathToFileURL(file).href);
      await expect(page.locator('.extension-row .status.active')).toHaveCount(1);
      await expect(page.locator('.extension-row .status.shadowed')).toHaveCount(2);
      await page.locator('.extension-row').filter({ has: page.locator('.status.active') }).click();
      await expect(page.locator('#detail-dialog')).toContainText('--local');
      await page.locator('.extension-origins').getByRole('button', { name: /^command ·/ }).click();
      await expect(page.locator('#source-title')).toContainText('.claude.json');
      await expect(page.locator('.code-view')).toHaveAttribute('aria-label', 'Parsed configuration');
      await expect(page.locator('.code-view')).toContainText('--local');
      await expect(page.locator('.code-view')).not.toContainText('browser-local-mcp-private@example.test');
      await expect(page.locator('.code-view')).not.toContainText('browser-local-mcp-private-value');
      await expect(page.locator('.code-line.highlight')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      await page.context().setOffline(false);
      await page.goto(server.url + '#view=extensions');
      await saveLocal(false);
      await page.getByRole('button', { name: 'Refresh scan', exact: true }).click();
      await expect(page.locator('#scan-status')).toHaveText('Scan complete');
      await expect(page.locator('.extension-row')).toHaveCount(2);
      await expect(page.locator('.extension-row .status.active')).toHaveCount(1);
      await saveLocal(true);
      await page.getByRole('button', { name: 'Refresh scan', exact: true }).click();
      await expect(page.locator('#scan-status')).toHaveText('Scan complete');
      await expect(page.locator('.extension-row .status.shadowed')).toHaveCount(2);
    }
  } finally { await page.context().setOffline(false); await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('Claude ignored MCP fields remain marked and inspectable in live and portable reports', async ({ page }) => {
  const w = await workspace({ '.mcp.json': JSON.stringify({ mcpServers: {
    remote: { type: 'http', url: 'https://example.test/mcp', command: 'ignored-browser-command', env: { UNUSED: 'browser-ignored-private-sentinel' } },
    local: { command: process.execPath, cwd: 'missing-browser-directory', url: 'https://example.test/ignored' },
    pending: { type: 'http', url: '' },
  } }, null, 2) });
  const server = await serve({ ...w, user: false, clients: ['claude'], trust: 'trusted' });
  try {
    await page.goto(server.url);
    for (const offline of [false, true]) {
      if (offline) {
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name: /Export report/ }).click();
        const file = test.info().outputPath('claude-ignored-fields.html');
        await (await pending).saveAs(file);
        expect(await readFile(file, 'utf8')).not.toContain('browser-ignored-private-sentinel');
        await page.goto(pathToFileURL(file).href);
      }
      await page.locator('#extensions-tab').click();
      const remote = page.locator('.extension-row').filter({ hasText: 'remote' });
      await expect(remote.locator('.extension-command')).toHaveText('https://example.test/mcp');
      await remote.click();
      await expect(page.locator('#detail-dialog')).toContainText('Declared configuration');
      await expect(page.locator('.extension-origins')).toContainText('command (ignored)');
      await expect(page.locator('.extension-origins')).toContainText('env.UNUSED (ignored)');
      if (!offline) await page.screenshot({ path: test.info().outputPath('claude-ignored-fields.png') });
      await page.locator('.extension-origins').getByRole('button', { name: /^command \(ignored\)/ }).click();
      await expect(page.locator('.code-line.highlight')).toContainText('ignored-browser-command');
      await page.locator('#findings-tab').click();
      await page.locator('#findings-list .finding').filter({ hasText: '"local" ignores the field "cwd"' }).click();
      await page.getByRole('button', { name: /Inspect source/ }).click();
      await expect(page.locator('.code-line.highlight')).toContainText('missing-browser-directory');
      await page.locator('#extensions-tab').click();
      await page.locator('.extension-row').filter({ hasText: 'pending' }).click();
      await expect(page.getByRole('heading', { name: 'Field definitions', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
    await page.locator('#extensions-tab').click();
    await page.locator('.extension-row').filter({ hasText: 'remote' }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: test.info().outputPath('claude-ignored-fields-phone.png') });
  } finally { await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('merged MCP field definitions navigate across user and project sources online and offline', async ({ page }) => {
  const w = await workspace({ '.codex/config.toml': '[mcp_servers.fixture]\nargs=["project-argument"]\n' }, {
    '.codex/config.toml': '[mcp_servers.fixture]\ncommand="missing-browser-source-fixture"\ncwd="missing-workdir"\n[mcp_servers.fixture.env]\nAPI_TOKEN="browser-private-origin-sentinel"\n',
  });
  const server = await serve({ ...w, clients: ['codex'], trust: 'trusted' });
  try {
    await page.goto(server.url);
    for (const offline of [false, true]) {
      if (offline) {
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name: /Export report/ }).click();
        const file = test.info().outputPath('merged-mcp-sources.html');
        await (await pending).saveAs(file);
        const content = await readFile(file, 'utf8');
        expect(content).not.toContain('browser-private-origin-sentinel');
        expect(content).not.toContain(JSON.stringify(w.home).slice(1, -1));
        await page.goto(pathToFileURL(file).href);
      }
      for (const [field, expected] of [['command', 'missing-browser-source-fixture'], ['args.0', 'project-argument']]) {
        await page.locator('#extensions-tab').click();
        await page.locator('.extension-row').filter({ hasText: 'fixture' }).filter({ has: page.locator('.status.active') }).click();
        await expect(page.locator('.extension-origins')).toContainText('env.API_TOKEN');
        await expect(page.locator('.extension-origins')).toContainText('~/.codex/config.toml:2');
        await expect(page.locator('#detail-dialog')).not.toContainText('browser-private-origin-sentinel');
        if (!offline && field === 'command') await page.screenshot({ path: test.info().outputPath('merged-mcp-definitions.png') });
        await page.locator('.extension-origins').getByRole('button', { name: new RegExp('^' + field.replaceAll('.', '\\.') + ' ·') }).click();
        await expect(page.locator('.code-line.highlight')).toContainText(expected);
        await expect(page.locator('.code-line.highlight .line-number')).toHaveText('2');
      }
      await page.locator('#findings-tab').click();
      await page.locator('#findings-list .finding').filter({ hasText: 'MCP command for "fixture"' }).click();
      await page.getByRole('button', { name: /Inspect source/ }).click();
      await expect(page.locator('.code-line.highlight')).toContainText('missing-browser-source-fixture');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
    await page.locator('#extensions-tab').click();
    await page.locator('.extension-row').filter({ has: page.locator('.status.active') }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: test.info().outputPath('merged-mcp-phone.png') });
  } finally { await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('unknown trust retains the merged MCP candidate and legacy snapshots open extension details', async ({ page }) => {
  const w = await workspace({ '.codex/config.toml': '[mcp_servers.fixture]\nargs=["project-argument"]\n' }, {
    '.codex/config.toml': `[mcp_servers.fixture]\ncommand=${JSON.stringify(process.execPath)}\n`,
  });
  const server = await serve({ ...w, clients: ['codex'] });
  try {
    await page.goto(server.url);
    const report = JSON.parse(await page.locator('#report-data').textContent() ?? 'null') as Report;
    expect(report.findings.some(finding => finding.ruleId === 'mcp.transport')).toBe(false);
    await page.locator('#extensions-tab').click();
    await page.locator('.extension-row').filter({ has: page.locator('.status', { hasText: 'Conditional' }) }).click();
    await expect(page.locator('#detail-dialog')).toContainText('project-argument');
    await page.locator('.extension-origins').getByRole('button', { name: /^command ·/ }).click();
    await expect(page.locator('.code-line.highlight')).toContainText('command=');
    for (const client of report.clients) for (const extension of client.extensions) delete extension.origins;
    const file = test.info().outputPath('legacy-mcp-origins.html');
    await writeFile(file, html(report));
    await page.goto(pathToFileURL(file).href);
    await page.locator('#extensions-tab').click();
    await page.locator('.extension-row').first().click();
    await expect(page.locator('#detail-dialog')).toContainText('fixture');
    await expect(page.locator('.extension-origins')).toHaveCount(0);
    await page.getByRole('button', { name: /Inspect source/ }).click();
    await expect(page.locator('#source-title')).toContainText('config.toml');
  } finally { await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('encoded private values stay hidden while live and portable previews retain source-line navigation', async ({ page }) => {
  const toml = '[mcp_servers.fixture]\ncommand="node"\n[mcp_servers.fixture.env]\nNORMAL="""\nbrowser-multiline-confidential-first\nbrowser-multiline-confidential-last"""\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype="command"\ncommand="missing-preview-hook-fixture"\n';
  const json = JSON.stringify({ mcpServers: { fixture: { command: 'node', env: { NORMAL: 'browser-escaped-confidential-"value' } } } }, null, 2);
  const w = await workspace({ '.codex/config.toml': toml, '.mcp.json': json, 'CLAUDE.md': 'Visible project instructions.' });
  const server = await serve({ ...w, user: false, clients: ['codex', 'claude'], trust: 'trusted' });
  try {
    await page.goto(server.url);
    for (const offline of [false, true]) {
      if (offline) {
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name: /Export report/ }).click();
        const file = test.info().outputPath('encoded-private-preview.html');
        await (await pending).saveAs(file);
        const exported = await readFile(file, 'utf8');
        expect(exported).not.toContain('browser-multiline-confidential-');
        expect(exported).not.toContain('browser-escaped-confidential-');
        await page.goto(pathToFileURL(file).href);
      }
      const serialized = await page.locator('#report-data').textContent() ?? '';
      expect(serialized).not.toContain('browser-multiline-confidential-');
      expect(serialized).not.toContain('browser-escaped-confidential-');
      expect(serialized).not.toContain('valueRanges');
      const report = JSON.parse(serialized);
      const preview = report.sources.find((source: any) => source.relativePath === '.codex/config.toml').preview;
      expect(preview.split('\n')).toHaveLength(toml.split('\n').length);
      expect(JSON.parse(report.sources.find((source: any) => source.relativePath === '.mcp.json').preview).mcpServers.fixture.env.NORMAL).toBe('[REDACTED]');
      await page.locator('#findings-tab').click();
      await page.locator('#findings-list .finding').filter({ hasText: 'Hook command was not found or is not executable.' }).click();
      await page.getByRole('button', { name: /Inspect source/ }).click();
      await expect(page.locator('.code-line.highlight')).toContainText('missing-preview-hook-fixture');
      await expect(page.locator('.code-line.highlight .line-number')).toHaveText('10');
      await expect(page.locator('#instructions')).toContainText('[REDACTED]');
      if (!offline) await page.screenshot({ path: test.info().outputPath('encoded-private-source.png') });
    }
  } finally { await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('Codex TOML hook findings navigate to the platform command line online and offline', async ({ page }) => {
  const w = await workspace({ '.codex/config.toml': [
    '[[hooks.Stop]]', '[[hooks.Stop.hooks]]', 'type="command"', 'command="missing-posix-hook-fixture"', 'command_windows="missing-windows-hook-fixture"',
    '[[hooks.Stop.hooks]]', 'type="prompt"',
    '[[hooks.PreModelRequest]]', '[[hooks.PreModelRequest.hooks]]', 'type="mcp_tool"', 'server="fixture"', 'tool="inspect"',
  ].join('\n') });
  const server = await serve({ ...w, user: false, clients: ['codex'], trust: 'trusted' });
  try {
    await page.goto(server.url);
    for (const offline of [false, true]) {
      if (offline) {
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name: /Export report/ }).click();
        const file = test.info().outputPath('codex-platform-hooks.html');
        await (await pending).saveAs(file);
        await page.goto(pathToFileURL(file).href);
      }
      await page.locator('#findings-tab').click();
      await page.locator('#findings-list .finding').filter({ hasText: 'Hook command was not found or is not executable.' }).click();
      await page.getByRole('button', { name: /Inspect source/ }).click();
      await expect(page.locator('#source-title')).toHaveText('.codex/config.toml');
      await expect(page.locator('.code-line.highlight')).toContainText(process.platform === 'win32' ? 'command_windows="missing-windows-hook-fixture"' : 'command="missing-posix-hook-fixture"');
      const report = JSON.parse(await page.locator('#report-data').textContent() ?? 'null');
      expect(report.clients[0].extensions.find((hook: any) => hook.config.type === 'mcp_tool').status).toBe('conditional');
      expect(report.clients[0].extensions.find((hook: any) => hook.config.type === 'prompt').status).toBe('ignored');
      expect(report.findings.some((finding: any) => finding.ruleId === 'hook.unknown-event' || finding.ruleId === 'hook.unsupported-type')).toBe(false);
      if (!offline) await page.screenshot({ path: test.info().outputPath('codex-platform-hook-source.png') });
    }
  } finally { await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('private environment literals preserve inspector navigation and syntax-invalid previews stay private online and offline', async ({ page }) => {
  const w = await workspace({
    'AGENTS.md': 'codex active 1',
    '.mcp.json': JSON.stringify({ mcpServers: { fixture: { command: 'node', env: { CLIENT: 'codex', STATUS: 'active', NUMBER: '1', RULE: 'parse.duplicate-key', SEVERITY: 'error', FIELD: 'clients' } } } }),
    '.claude/settings.local.json': '{\n "env": {\n "NORMAL": "discarded-preview-sentinel",\n "NORMAL": "later-value"\n }\n}',
  });
  const server = await serve({ ...w, user: false, clients: ['codex', 'claude'], trust: 'trusted' });
  try {
    await page.goto(server.url);
    for (const offline of [false, true]) {
      if (offline) {
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name: /Export report/ }).click();
        const file = test.info().outputPath('private-environment.html');
        await (await pending).saveAs(file);
        expect(await readFile(file, 'utf8')).not.toContain('discarded-preview-sentinel');
        await page.goto(pathToFileURL(file).href);
      }
      const report = JSON.parse(await page.locator('#report-data').textContent() ?? 'null');
      expect(report.schemaVersion).toBe('1.0');
      expect(report.clients.map((client: any) => client.client)).toEqual(['codex', 'claude']);
      await page.getByRole('button', { name: 'Inspect Codex instructions', exact: true }).click();
      await page.getByRole('button', { name: 'Read effective text', exact: true }).click();
      await expect(page.locator('#effective-document .effective-text')).toHaveText('[REDACTED] [REDACTED] [REDACTED]');
      await page.locator('#findings-tab').click();
      await page.locator('#severity').selectOption('error');
      await page.locator('#findings-list .finding').filter({ hasText: 'Duplicate key "NORMAL".' }).click();
      await expect(page.locator('#detail-dialog')).toContainText('line 4, column 2');
      await page.getByRole('button', { name: /Inspect source/ }).click();
      await expect(page.locator('#source-status')).toHaveText('Invalid');
      await expect(page.locator('#instructions')).toContainText('Correct the syntax at the reported location and rescan to view a redacted preview.');
      await expect(page.getByRole('button', { name: 'Copy source content', exact: true })).toBeDisabled();
      if (!offline) await page.screenshot({ path: test.info().outputPath('private-syntax-preview.png') });
    }
  } finally { await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('selected Codex diagnostics keep hook review state and foreign syntax errors in their own roles', async ({ page }) => {
  const w = await workspace({ 'AGENTS.md': 'Repository instructions.', '.claude/settings.local.json': '{ broken JSON' }, {
    '.codex/config.toml': '[hooks.state.fixture]\nenabled=false\ntrusted_hash="reviewed-fixture-hash"\n',
    '.codex/hooks.json': JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node' }] }] } }),
  });
  const reviewId = path.join(w.home, '.codex/retired-hooks.json') + ':pre_tool_use:0:0';
  await writeFile(path.join(w.home, '.codex/config.toml'), `[hooks.state.${JSON.stringify(reviewId)}]\nenabled=false\ntrusted_hash="reviewed-fixture-hash"\n`);
  const server = await serve({ ...w, clients: ['codex'], trust: 'trusted' });
  try {
    await page.goto(server.url);
    await expect(page.locator('#overview-heading')).toHaveText('No configuration issues found.');
    await page.getByRole('button', { name: 'Inspect Codex instructions', exact: true }).click();
    await page.getByRole('button', { name: 'All discovered', exact: true }).click();
    await page.locator('#sources .source').filter({ hasText: 'settings.local.json' }).click();
    await expect(page.locator('#source-status')).toHaveText('Not loaded');
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const file = test.info().outputPath('selected-client.html');
    await (await pending).saveAs(file);
    expect(await readFile(file, 'utf8')).not.toContain(JSON.stringify(w.home).slice(1, -1));
    await page.goto(pathToFileURL(file).href);
    const report = JSON.parse(await page.locator('#report-data').textContent() ?? 'null');
    expect(report.findings.some((finding: any) => finding.ruleId.startsWith('parse.') || finding.ruleId === 'hook.type' || finding.ruleId === 'hook.dual-source')).toBe(false);
    expect(report.sources.find((source: any) => source.relativePath === '.claude/settings.local.json').invalid).toBe(true);
    expect(report.clients[0].extensions.filter((extension: any) => extension.kind === 'hook')).toHaveLength(1);
    const review = report.clients[0].settings.find((setting: any) => setting.key.startsWith('hooks.state.') && setting.key.endsWith('.enabled'));
    expect(review.key).toContain('hooks.state.~');
    expect(review.location.line).toBe(2);
  } finally { await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('related finding locations navigate to the owning client and exact source line online and offline', async ({ page }) => {
  const w = await workspace({
    '.codex/config.toml': '[mcp_servers.db]\ncommand="missing-codex-server"\n',
    '.mcp.json': JSON.stringify({ mcpServers: { db: { command: 'missing-claude-server' } } }, null, 2),
  });
  const server = await serve({ ...w, user: false, clients: ['codex', 'claude'], trust: 'trusted' });
  try {
    await page.goto(server.url);
    for (const offline of [false, true]) {
      if (offline) {
        const pending = page.waitForEvent('download');
        await page.getByRole('button', { name: /Export report/ }).click();
        const file = test.info().outputPath('related-sources.html');
        await (await pending).saveAs(file);
        await page.goto(pathToFileURL(file).href);
      }
      await page.locator('#findings-tab').click();
      await page.locator('#findings-list .finding').filter({ hasText: 'different commands or endpoints' }).click();
      if (!offline) await page.screenshot({ path: test.info().outputPath('related-finding.png') });
      await page.locator('.related-list').getByRole('button', { name: /\.mcp.json · line/ }).click();
      await expect(page.locator('#effective-title')).toHaveText('Claude Code’s instructions');
      await expect(page.locator('#source-title')).toHaveText('.mcp.json');
      await expect(page.locator('.code-line.highlight')).toContainText('"command": "missing-claude-server"');
      await expect(page.getByRole('button', { name: 'Copy source path', exact: true })).toBeVisible();
    }
  } finally { await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('unreadable source findings keep their location without navigating to a different file', async ({ page }) => {
  const w = await workspace({ 'CLAUDE.md': 'Available project instructions.' });
  await symlink(w.home, path.join(w.repo, '.mcp.json'), process.platform === 'win32' ? 'junction' : 'dir');
  const server = await serve({ ...w, user: false, clients: ['claude'] });
  try {
    await page.goto(server.url);
    await page.locator('#findings-tab').click();
    await page.locator('#findings-list .finding').filter({ hasText: 'Symlink points outside' }).click();
    await expect(page.locator('#detail-dialog')).toContainText('.mcp.json');
    await expect(page.getByRole('button', { name: /Inspect source/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Copy location', exact: true })).toBeVisible();
  } finally { await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

test('report exports replace verified path aliases and custom home paths through refresh and offline navigation', async ({ page }) => {
  const w = await workspace({ 'CLAUDE.md': 'Project instructions.', 'src/a.ts': '' }, { '.claude/CLAUDE.md': 'Personal instructions.' });
  const repo = await realpath(w.repo);
  const home = await realpath(w.home);
  const alias = path.join(await realpath(w.root), 'workspace-alias');
  await symlink(repo, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(path.join(repo, '.mcp.json'), JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: [path.join(alias, 'server.mjs')], cwd: alias } } }, null, 2));
  const server = await serve({ repo, home, env: w.env, clients: ['claude'], trust: 'trusted', target: 'src/a.ts' });
  try {
    await page.goto(server.url);
    await expect(page.locator('#scan-status')).toHaveText('Scan complete');
    for (const refresh of [false, true]) {
      if (refresh) {
        await page.getByRole('button', { name: 'Refresh scan', exact: true }).click();
        await expect(page.locator('#scan-status')).toHaveText('Scan complete');
      }
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: /Export report/ }).click();
      const file = test.info().outputPath(`portable-paths-${refresh}.html`);
      await (await pending).saveAs(file);
      const html = await readFile(file, 'utf8');
      for (const directory of [repo, w.repo, home, w.home, alias]) expect(html).not.toContain(JSON.stringify(directory).slice(1, -1));
      if (refresh) {
        await page.goto(pathToFileURL(file).href);
        const report = JSON.parse(await page.locator('#report-data').textContent() ?? 'null');
        expect(report.repository).toBe('<repo>');
        expect(report.pathMappings).toBeUndefined();
        expect(report.clients[0].extensions.find((extension: any) => extension.name === 'fixture').config.cwd).toBe('<repo>');
        const source = report.sources.find((source: any) => source.relativePath === '.mcp.json');
        expect(JSON.parse(source.preview).mcpServers.fixture.cwd).toBe('<repo>');
        await page.getByRole('button', { name: 'Inspect Claude Code instructions', exact: true }).click();
        await page.getByRole('button', { name: 'Read effective text', exact: true }).click();
        await expect(page.locator('#effective-document')).toContainText('Personal instructions.');
        await expect(page.locator('#effective-document')).toContainText('Project instructions.');
      }
    }
  } finally { await server.close(); await rm(w.root, { recursive: true, force: true }); }
});

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
    await expect(page.locator('.code-line.highlight')).toContainText('"cwd": "[REDACTED]"');
    await expect(page.locator('.code-line.highlight .line-number')).toHaveText('9');
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
    await page.getByRole('button', { name: 'Refresh scan', exact: true }).click();
    await expect(page.locator('#refresh-summary')).toHaveText('Refresh complete. No errors or warnings found.');
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
    await expect(page.locator('#refresh-summary')).toBeEmpty();
    exportedReports.push(await exportCurrentReport());
    releaseResponse.resolve();
    await expect(page.locator('#scan-status')).toHaveText('Scan complete');
    await expect(page.locator('#effective-document')).toContainText('Instructions after editing.');
    exportedReports.push(await exportCurrentReport());
    await page.locator('#target').fill('../outside');
    await page.locator('#inspect').click();
    await expect(page.locator('#scan-status')).toHaveText('Scan failed');
    await expect(page.locator('#refresh-summary')).toBeEmpty();
    exportedReports.push(await exportCurrentReport());
    const reports = exportedReports.map(html => JSON.parse(html.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/)![1]));
    expect(reports.map(report => report.clients[0].instructions)).toEqual(['Instructions before editing.', 'Instructions after editing.', 'Instructions after editing.']);
    for (const html of exportedReports) {
      expect(html).not.toContain(w.repo);
      expect(html).not.toContain(w.home);
      expect(html).toContain('data-live="false"');
    }
    await page.context().setOffline(true);
    for (const [index, content] of exportedReports.entries()) {
      const file = test.info().outputPath(`exported-scan-location-${index}.html`);
      await writeFile(file, content);
      await page.goto(pathToFileURL(file).href);
      await expect(page.locator('#effective-document')).toBeVisible();
      await expect(page.locator('#effective-document')).toContainText(index === 0 ? 'Instructions before editing.' : 'Instructions after editing.');
      await expect(page.locator('#target')).toHaveValue('.');
      const destination = new URLSearchParams(new URL(page.url()).hash.slice(1));
      expect(destination.get('client')).toBe('claude');
      expect(destination.get('source')).toBe('CLAUDE.md');
      expect(destination.get('text')).toBe('effective');
    }
  } finally {
    await page.context().setOffline(false);
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
    await expect(page.locator('#refresh-summary')).toContainText('Discovery incomplete.');
    await expect(page.locator('#refresh-summary')).toContainText('in inspected sources.');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#refresh-summary')).toBeInViewport({ ratio: 1 });
    await page.locator('#refresh-summary').getByRole('button', { name: 'Review scan scope', exact: true }).click();
    await expect(page.locator('#scope-dialog')).toContainText('budget of 0');
    await page.keyboard.press('Escape');
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export report/ }).click();
    const filename = test.info().outputPath('partial-report.html');
    await (await pending).saveAs(filename);
    await page.goto(pathToFileURL(filename).href);
    await expect(page.locator('#refresh-summary')).toBeEmpty();
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

test('touch controls remain reachable after long-source jumps and short-screen navigation can scroll', async ({ browser, browserName }) => {
  test.skip(browserName === 'firefox', 'Mobile context emulation is available in Chromium and WebKit.');
  const w = await workspace({
    'AGENTS.md': 'Project instruction.',
    '.claude/settings.json': '{\n' + '\n'.repeat(350) + '"hooks":{"UserPromptSubmit":[{"hooks":[{"type":"command","command":"missing-persistent-header-hook"}]}]}\n}',
    'src/selected.ts': '',
  });
  const server = await serve({ ...w, clients: ['codex', 'claude'], trust: 'trusted' });
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
      await phone.setViewportSize(viewport);
      await phone.goto(server.url + '#view=findings');
      await phone.locator('#findings-list .finding').filter({ hasText: 'Hook command was not found or is not executable.' }).tap();
      await phone.getByRole('button', { name: /Inspect source/ }).tap();
      const highlighted = phone.locator('.code-line.highlight');
      await expect(highlighted).toBeInViewport({ ratio: 1 });
      await expect(phone.locator('#workspace-header')).toBeInViewport({ ratio: 1 });
      await expect(phone.locator('.file-tab')).toBeInViewport({ ratio: 1 });
      await expect(phone.locator('#target')).toBeInViewport({ ratio: 1 });
      const header = await phone.locator('.file-tab').boundingBox();
      const line = await highlighted.boundingBox();
      expect(line!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
      for (const control of ['#export', '#target', '#inspect', '#trust', '#codex-profile', '#copy-source']) {
        const bounds = await phone.locator(control).boundingBox();
        expect(bounds!.height).toBeGreaterThanOrEqual(44);
      }
      await phone.locator('#target').fill('../outside');
      await phone.locator('#inspect').tap();
      await expect(phone.locator('#error')).toBeInViewport({ ratio: 1 });
      await expect(phone.locator('#error')).toContainText('Cannot inspect target');
      await phone.locator('#target').fill('selected');
      const choice = phone.getByRole('option').filter({ hasText: 'src/selected.ts' });
      await expect(choice).toBeInViewport({ ratio: 1 });
      const targetBounds = await choice.boundingBox();
      await phone.touchscreen.tap(targetBounds!.x + targetBounds!.width / 2, targetBounds!.y + targetBounds!.height / 2);
      await expect(phone.locator('#footer-target')).toHaveText('src/selected.ts');
      await expect(phone.locator('#error')).toBeHidden();
      if (viewport.width <= 760) {
        const menu = phone.getByRole('button', { name: 'Toggle navigation' });
        await expect(menu).toBeInViewport({ ratio: 1 });
        const bounds = await menu.boundingBox();
        expect(bounds!.width).toBeGreaterThanOrEqual(44);
        await phone.touchscreen.tap(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
        await expect(phone.locator('.sidebar')).toBeInViewport({ ratio: 1 });
      }
      expect(await phone.locator('.sidebar').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await phone.locator('#scope-button').scrollIntoViewIfNeeded();
      await expect(phone.locator('#scope-button')).toBeInViewport({ ratio: 1 });
      await phone.locator('#scope-button').tap();
      await expect(phone.locator('#scope-dialog')).toBeVisible();
      await phone.getByRole('button', { name: 'Close scan details', exact: true }).tap();
      expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  } finally { await phone.close(); await server.close(); await rm(w.root, { recursive: true, force: true }); }
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
    await expect(page.locator('#detail-dialog')).toContainText('Earlier definitions');
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
    await rows.first().getByRole('button', { name: /config.toml:1$/ }).click();
    await expect(page.locator('.code-line.highlight')).toContainText('user-model');
    await page.goBack();
    await expect(page.locator('#configuration')).toBeVisible();
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
    await page.locator('#compare-tab').click();
    await expect(page.locator('#comparison-matrix')).toContainText('No instruction sources discovered');
    await page.locator('#differences-only').uncheck();
    await expect(page.locator('#comparison-matrix')).toContainText('No instruction sources discovered');
    await page.locator('#overview-tab').click();
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
    await expect(page.locator('#detail-dialog')).toContainText('Earlier definitions');
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
