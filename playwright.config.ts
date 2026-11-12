import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/web', use: { headless: true, viewport: { width: 1440, height: 1000 } }, reporter: 'list', workers: 1 });
