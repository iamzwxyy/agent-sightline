import path from 'node:path';
import { mkdir, realpath, symlink } from 'node:fs/promises';
import { workspace } from './helpers.js';

export async function trustWorkspace() {
  const mcp = JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: ['-e', 'require("node:fs").writeFileSync("trust-server-started","started")'] } } });
  const settings = '{"model":"repository-trust-model","effortLevel":"high"}';
  const w = await workspace({ '.mcp.json': mcp, '.github/copilot/settings.json': settings, 'child/index.ts': '' }, {
    '.copilot/config.json': '{}', '.copilot/settings.json': '{"model":"personal-trust-model"}',
    'project/.mcp.json': mcp, 'project/.github/copilot/settings.json': settings,
  });
  const alias = path.join(w.root, 'alias');
  const otherAlias = path.join(w.root, 'other-alias');
  const parentAlias = path.join(w.root, 'parent-alias');
  const homeProject = path.join(w.home, 'project');
  const escapedDirectory = path.join(w.repo, 'escape');
  const brokenAlias = path.join(w.root, 'broken');
  const sibling = w.repo + '-sibling';
  await mkdir(sibling);
  for (const [target, link] of [[w.repo, alias], [w.repo, otherAlias], [w.root, parentAlias], [homeProject, escapedDirectory], [path.join(w.root, 'missing'), brokenAlias]]) {
    await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  }
  const canonicalRepo = await realpath(w.repo);
  const relativeRepo = path.relative(process.cwd(), canonicalRepo);
  const relativeInspectorPath = path.isAbsolute(relativeRepo) ? path.join('..', 'repo') : relativeRepo;
  return { ...w, alias, otherAlias, parentAlias, homeProject, escapedDirectory, brokenAlias, sibling, canonicalRepo, canonicalParent: await realpath(w.root), relativeInspectorPath };
}

type TrustWorkspace = Awaited<ReturnType<typeof trustWorkspace>>;
interface TrustCase {
  name: string;
  state: (w: TrustWorkspace) => Record<string, unknown>;
  trusted: boolean;
  cwd?: 'homeProject' | 'escapedDirectory';
  invalidKey?: string;
}

export const trustCases: TrustCase[] = [
  { name: 'canonical folder', state: w => ({ trustedFolders: [w.canonicalRepo] }), trusted: true },
  { name: 'logical folder', state: w => ({ trustedFolders: [w.repo] }), trusted: true },
  { name: 'another directory alias', state: w => ({ trustedFolders: [w.otherAlias] }), trusted: true },
  { name: 'canonical ancestor', state: w => ({ trustedFolders: [w.canonicalParent] }), trusted: true },
  { name: 'aliased ancestor', state: w => ({ trustedFolders: [w.parentAlias] }), trusted: true },
  { name: 'trusted child excludes its parent', state: w => ({ trustedFolders: [path.join(w.repo, 'child')] }), trusted: false },
  { name: 'sibling prefix excludes this directory', state: w => ({ trustedFolders: [w.sibling] }), trusted: false },
  { name: 'unrelated folder', state: w => ({ trustedFolders: [w.home] }), trusted: false },
  { name: 'missing folder', state: w => ({ trustedFolders: [path.join(w.root, 'missing')] }), trusted: false },
  { name: 'broken directory alias', state: w => ({ trustedFolders: [w.brokenAlias] }), trusted: false },
  { name: 'symlink escape from a trusted logical parent', state: w => ({ trustedFolders: [w.repo] }), cwd: 'escapedDirectory', trusted: false },
  { name: 'relative current directory', state: () => ({ trustedFolders: ['.'] }), trusted: false },
  { name: 'relative parent', state: () => ({ trustedFolders: ['..'] }), trusted: false },
  { name: 'relative inspector path', state: w => ({ trustedFolders: [w.relativeInspectorPath] }), trusted: false },
  { name: 'tilde home', state: () => ({ trustedFolders: ['~'] }), cwd: 'homeProject', trusted: false },
  { name: 'tilde project', state: () => ({ trustedFolders: ['~/project'] }), cwd: 'homeProject', trusted: false },
  { name: 'legacy folder alias', state: w => ({ trusted_folders: [w.otherAlias] }), trusted: true },
  { name: 'later legacy key supplies trust', state: w => ({ trustedFolders: [], trusted_folders: [w.canonicalRepo] }), trusted: true },
  { name: 'later canonical key clears trust', state: w => ({ trusted_folders: [w.canonicalRepo], trustedFolders: [] }), trusted: false },
  { name: 'later legacy key clears trust', state: w => ({ trustedFolders: [w.canonicalRepo], trusted_folders: [] }), trusted: false },
  { name: 'later canonical key supplies trust', state: w => ({ trusted_folders: [], trustedFolders: [w.canonicalRepo] }), trusted: true },
  { name: 'later valid key replaces invalid legacy value', state: w => ({ trusted_folders: 42, trustedFolders: [w.canonicalRepo] }), trusted: true },
  { name: 'later invalid legacy value rejects trust', state: w => ({ trustedFolders: [w.canonicalRepo], trusted_folders: 42 }), trusted: false, invalidKey: 'trusted_folders' },
  { name: 'mixed list types reject the complete list', state: w => ({ trustedFolders: [42, null, {}, w.canonicalRepo] }), trusted: false, invalidKey: 'trustedFolders' },
  { name: 'null list rejects trust', state: () => ({ trustedFolders: null }), trusted: false, invalidKey: 'trustedFolders' },
  { name: 'unrelated state leaves valid trust eligible', state: w => ({ trustedFolders: [w.canonicalRepo], sessionHistory: 42 }), trusted: true },
  { name: 'unmatched string entries leave an absolute match eligible', state: w => ({ trustedFolders: [path.join(w.root, 'missing'), '.', w.otherAlias] }), trusted: true },
];
