import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { scan } from '../dist/core/index.js';
import { html, portable } from '../dist/reporter/index.js';
const originalSite = 'https://agent-sightline.williamtse700.chatgpt.site';
const { values } = parseArgs({ options: { 'site-url': { type: 'string', default: originalSite }, 'released-package': { type: 'boolean', default: false } } });
const siteUrl = new URL(values['site-url']);
if (!['https:', 'http:'].includes(siteUrl.protocol) || siteUrl.search || siteUrl.hash) throw new Error('Use an HTTP(S) website URL without a query or fragment.');
const basePath = siteUrl.pathname.replace(/\/?$/, '/');
siteUrl.pathname = basePath;
const configuredSite = siteUrl.href.replace(/\/$/, '');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const filename = `${pkg.name}-${pkg.version}.tgz`;
const releases = JSON.parse(readFileSync('website/releases.json', 'utf8'));
if (values['released-package'] && !releases.some(release => release.filename === filename)) throw new Error(`Record the published ${filename} and its SHA-256 in website/releases.json before deploying.`);
const destination = path.resolve('website/dist');
rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
cpSync('website/public', destination, { recursive: true });
cpSync(new URL('../dist/web/assets/clients', import.meta.url), path.join(destination, 'icons'), { recursive: true });
for (const name of ['index.html', 'guide.html', 'robots.txt', 'sitemap.xml']) {
  const file = path.join(destination, name);
  let content = readFileSync(file, 'utf8').replaceAll('{{VERSION}}', pkg.version).replaceAll(originalSite, configuredSite);
  if (name.endsWith('.html')) content = content.replace(/\b(href|src)="\/(?!\/)/g, (_match, attribute) => `${attribute}="${basePath}`);
  writeFileSync(file, content);
}
const report = await scan({ repo: path.resolve('examples/broken-agent-config'), target: 'src/payments/refund.ts', user: false, trust: 'trusted', clients: ['codex', 'claude', 'copilot'] });
const publicReport = portable(report);
mkdirSync(path.join(destination, 'demo'), { recursive: true });
writeFileSync(path.join(destination, 'demo/index.html'), html(report));
writeFileSync(path.join(destination, 'demo-report.json'), JSON.stringify(publicReport));
cpSync('LICENSE', path.join(destination, 'license.txt'));
mkdirSync(path.join(destination, 'downloads'), { recursive: true });
if (!values['released-package']) cpSync(filename, path.join(destination, 'downloads', filename));
const digest = data => createHash('sha256').update(data).digest('hex');
for (const release of releases) {
  if (release.filename === filename && !values['released-package']) continue;
  let data = existsSync(release.filename) ? readFileSync(release.filename) : null;
  if (!data || digest(data) !== release.sha256) {
    const response = await globalThis.fetch(release.url);
    if (!response.ok) throw new Error(`Cannot download released package ${release.filename} (HTTP ${response.status}).`);
    data = Buffer.from(await response.arrayBuffer());
  }
  if (digest(data) !== release.sha256) throw new Error(`Released package integrity mismatch for ${release.filename}.`);
  writeFileSync(path.join(destination, 'downloads', release.filename), data);
}
const manifest = JSON.parse(readFileSync('website/.openai/hosting.json', 'utf8'));
if (manifest.static.directory !== 'dist') throw new Error('Website must publish dist.');
console.log('Built the website, real report demo and local package download.');
