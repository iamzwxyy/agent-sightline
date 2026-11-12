import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, rmSync } from 'node:fs';
rmSync('dist', { recursive: true, force: true });
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc'], { stdio: 'inherit' });
mkdirSync('dist/adapters/schemas', { recursive: true });
cpSync('packages/adapters/schemas', 'dist/adapters/schemas', { recursive: true });
cpSync('packages/web/assets', 'dist/web/assets', { recursive: true });
chmodSync('dist/cli/index.js', 0o755);
