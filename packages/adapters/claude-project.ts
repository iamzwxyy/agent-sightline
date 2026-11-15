import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import type { Context } from '../core/types.js';
import { findRepositoryRoot } from '../core/discovery.js';
import { slash } from '../core/utils.js';

export function claudeStatePath(ctx: Context): string {
  return path.join(!ctx.options.home && ctx.env.CLAUDE_CONFIG_DIR ? ctx.claudeHome : ctx.home, '.claude.json');
}

async function projectStateRoot(ctx: Context): Promise<string> {
  const discovered = await findRepositoryRoot(ctx.directory, ctx.options.signal);
  const canonical = await realpath(discovered);
  const root = process.platform === 'win32' ? discovered : canonical;
  const project = process.platform === 'win32' ? slash(root) : root;
  const marker = path.join(root, '.git');
  const markerInfo = await stat(marker).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  });
  if (!markerInfo?.isFile()) return project;
  if (markerInfo.size > 2 * 1024 * 1024) throw new Error('Git metadata exceeds the inspection limit.');
  const pointer = await readFile(marker, { encoding: 'utf8', signal: ctx.options.signal });
  if (!pointer.startsWith('gitdir: ')) throw new Error('Invalid Git directory pointer.');
  const target = pointer.slice(8).replace(/[\r\n]+$/, '');
  if (!target) throw new Error('Empty Git directory pointer.');
  const directory = path.resolve(root, target);
  if (!(await stat(directory)).isDirectory()) throw new Error('Git directory pointer requires a directory.');
  const commonFile = path.join(directory, 'commondir');
  let common: string;
  try {
    const info = await stat(commonFile);
    if (info.size > 2 * 1024 * 1024) throw new Error('Git metadata exceeds the inspection limit.');
    common = await readFile(commonFile, { encoding: 'utf8', signal: ctx.options.signal });
  } catch (error) {
    ctx.options.signal?.throwIfAborted();
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return project;
    throw error;
  }
  const shared = common.replace(/[\r\n]+$/, '');
  if (!shared) throw new Error('Empty shared Git directory pointer.');
  const commonDirectory = path.resolve(directory, shared);
  const projectDirectory = path.basename(commonDirectory) === '.git' ? path.dirname(commonDirectory) : commonDirectory;
  // Native Windows worktree detection retains the launch entry through short-path aliases.
  if (process.platform === 'win32' && root.toLowerCase() !== canonical.toLowerCase()) return project;
  return process.platform === 'win32' ? slash(projectDirectory) : realpath(projectDirectory);
}


export async function claudeProjectStateRoot(ctx: Context): Promise<string> {
  if (ctx.claudeProjectRoot !== undefined) return ctx.claudeProjectRoot;
  const project = await projectStateRoot(ctx);
  ctx.claudeProjectRoot = project;
  return project;
}
