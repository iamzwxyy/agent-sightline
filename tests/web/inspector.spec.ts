import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { serve } from '../../packages/web/server.js';
import { workspace } from '../helpers.js';
import { trustWorkspace } from '../copilot-trust-fixture.js';
import { readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { html } from '../../packages/reporter/index.js';
import type { Report } from '../../packages/core/types.js';
import { scan } from '../../packages/core/index.js';
import { createServer } from 'node:http';

const sampleOptions = { repo: path.resolve('examples/broken-agent-config'), user: false, trust: 'trusted' as const, clients: ['codex', 'claude', 'copilot'] as const };

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
      await expect(page.locator('#why')).toContainText('Already loaded through the same canonical source path.');
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
    await page.getByRole('button', { name: 'Read effective text', exact: true }).click();
    await page.locator('#effective-document').getByRole('button', { name: '2 · CLAUDE.md', exact: true }).click();
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
