import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
export async function workspace(files: Record<string, string> = {}, homeFiles: Record<string, string> = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sightline-test-'));
  const repo = path.join(root, 'repo'); const home = path.join(root, 'home');
  await mkdir(path.join(repo, '.git'), { recursive: true }); await mkdir(home);
  for (const [base, values] of [[repo, files], [home, homeFiles]] as const) for (const [name, text] of Object.entries(values)) { const file = path.join(base, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, text); }
  return { root, repo, home, env: { PATH: process.env.PATH, PATHEXT: process.env.PATHEXT } };
}
export async function fixture(name: string) { return JSON.parse(await readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')); }
