import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { serve } from '../../packages/web/server.js';
import { workspace } from '../helpers.js';
import { readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { html } from '../../packages/reporter/index.js';
import type { Report } from '../../packages/core/types.js';
import { scan } from '../../packages/core/index.js';
import { createServer } from 'node:http';

const sampleOptions = { repo: path.resolve('examples/broken-agent-config'), user: false, trust: 'trusted' as const, clients: ['codex', 'claude', 'copilot'] as const };

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

test('Claude ignored MCP fields remain marked and inspectable in live and portable reports', async ({ page }) => {
  const w = await workspace({ '.mcp.json': JSON.stringify({ mcpServers: {
    remote: { type: 'http', url: 'https://example.test/mcp', command: 'ignored-browser-command', env: { UNUSED: 'browser-ignored-private-sentinel' } },
    local: { command: process.execPath, cwd: 'missing-browser-directory', url: 'https://example.test/ignored' },
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
