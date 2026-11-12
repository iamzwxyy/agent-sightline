import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { serveStatic } from '../../scripts/static-server.mjs';

test('public pages and core inspector views meet automated WCAG AA checks', async ({ page }) => {
  const server = await serveStatic('website/dist');
  try {
    for (const route of ['/', '/guide.html', '/demo/', '/demo/#view=effective&client=codex', '/demo/#view=effective&client=codex&text=effective', '/demo/#view=configuration', '/demo/#view=compare', '/demo/#view=extensions', '/demo/#view=findings']) {
      await page.goto(server.url + route);
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(results.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) })), route).toEqual([]);
    }
  } finally { await server.close(); }
});
