import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, URLSearchParams } from 'node:url';
import { build } from 'esbuild';
import { scan } from '../dist/core/index.js';
import { html, portable } from '../dist/reporter/index.js';
import { localizeWebsite } from './localize-website.mjs';
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
await build({
  entryPoints: [fileURLToPath(new URL('../website/public/hero.js', import.meta.url))],
  outdir: destination,
  bundle: true,
  splitting: true,
  format: 'esm',
  minify: true,
  target: 'es2022',
  chunkNames: 'motion/[name]-[hash]',
  legalComments: 'linked',
});
rmSync(path.join(destination, 'hero-scene.js'));
const motionNotices = ['GSAP 3.15.1\nCopyright GreenSock. Distributed under the GSAP Standard License.\nhttps://gsap.com/standard-license/\n', ...['lenis', 'three'].map(name => name + '\n' + readFileSync(new URL('../node_modules/' + name + '/LICENSE', import.meta.url), 'utf8'))];
writeFileSync(path.join(destination, 'motion/licenses.txt'), motionNotices.join('\n'));
cpSync(new URL('../dist/web/assets/clients', import.meta.url), path.join(destination, 'icons'), { recursive: true });
const digest = data => createHash('sha256').update(data).digest('hex');
const socialRevision = digest(readFileSync(path.join(destination, 'social.png'))).slice(0, 12);
const faviconRevision = digest(readFileSync(path.join(destination, 'favicon.png'))).slice(0, 12);
const posterRevision = digest(readFileSync(path.join(destination, 'images/context-field.jpg'))).slice(0, 12);
const pageAssets = ['site.js', 'site.css', 'hero.js'].map(filename => ({ filename, revision: digest(readFileSync(path.join(destination, filename))).slice(0, 12) }));
const report = await scan({ repo: path.resolve('examples/broken-agent-config'), target: 'src/payments/refund.ts', user: false, trust: 'trusted', clients: ['codex', 'claude', 'copilot'] });
const publicReport = portable(report);
const openingSource = publicReport.clients.find(client => client.client === 'codex')?.decisions.find(source => ['instructions', 'rules'].includes(source.kind) && source.status === 'truncated');
if (!openingSource) throw new Error('The opening example must contain a truncated Codex instruction source.');
const openingFilename = path.posix.basename(openingSource.path.replaceAll('\\', '/'))
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const openingSelection = new URLSearchParams({
  view: 'effective', client: 'codex',
  source: path.posix.relative(publicReport.repository.replaceAll('\\', '/'), openingSource.path.replaceAll('\\', '/')),
  line: String(openingSource.line),
});
const languages = [
  { id: 'en', path: '', label: 'English', short: 'EN', choose: 'Choose language', navigation: 'Language' },
  { id: 'zh-CN', path: 'zh-CN/', label: '简体中文', short: '中文', choose: '选择语言', navigation: '语言' },
  { id: 'ja', path: 'ja/', label: '日本語', short: '日本語', choose: '言語を選択', navigation: '言語' },
];
for (const language of languages) for (const name of ['index.html', 'guide.html']) {
  const translations = language.id === 'en' ? { content: {}, runtime: {} } : JSON.parse(readFileSync(`website/locales/${language.id}.json`, 'utf8'));
  const socialFile = language.id === 'en' ? 'social.png' : `social-${language.id}.png`;
  const localizedSocialRevision = language.id === 'en' ? socialRevision : digest(readFileSync(path.join(destination, socialFile))).slice(0, 12);
  const runtimeText = (text, values) => (translations.runtime[text] ?? text).replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);
  const pagePath = name === 'index.html' ? '' : name;
  const pageUrl = configuredSite + '/' + language.path + pagePath;
  const alternatives = languages.map(item => `<link rel="alternate" hreflang="${item.id}" href="${configuredSite}/${item.path}${pagePath}">`).join('\n');
  const links = languages.map(item => `<a href="/${item.path}${pagePath}" lang="${item.id}" hreflang="${item.id}" data-language${item.id === language.id ? ' aria-current="page"' : ''}>${item.label}</a>`).join('');
  const languageMenu = `<details class="language-menu"><summary aria-label="${language.choose} (${language.label})">${language.short}<img class="ui-icon language-arrow" src="/ui/arrow-right-linear.svg" width="12" height="12" alt=""></summary><nav class="language-options" aria-label="${language.navigation}">${links}</nav></details>`;
  let content = readFileSync(path.join('website/public', name), 'utf8');
  if (language.id !== 'en') content = localizeWebsite(content, translations.content);
  content = content
    .replace('<html lang="en">', `<html lang="${language.id}">`)
    .replaceAll(`href="${originalSite}/${pagePath}"`, `href="${pageUrl}"`)
    .replaceAll(`content="${originalSite}/${pagePath}"`, `content="${pageUrl}"`)
    .replaceAll('href="/"', `href="/${language.path}"`)
    .replaceAll('href="/#', `href="/${language.path}#`)
    .replaceAll('href="/guide.html', `href="/${language.path}guide.html`)
    .replace('<a class="nav-download"', languageMenu + '<a class="nav-download"')
    .replace('</head>', `${alternatives}\n<link rel="alternate" hreflang="x-default" href="${configuredSite}/${pagePath}">\n<script id="site-translations" type="application/json">${JSON.stringify(translations.runtime).replaceAll('<', '\\u003c')}</script>\n</head>`)
    .replaceAll('{{VERSION}}', pkg.version)
    .replaceAll('{{SOCIAL_REV}}', localizedSocialRevision)
    .replaceAll('/social.png?v=', `/${socialFile}?v=`)
    .replaceAll('{{FAVICON_REV}}', faviconRevision)
    .replaceAll('{{POSTER_REV}}', posterRevision)
    .replaceAll('{{HERO_SOURCE}}', openingFilename)
    .replaceAll('{{HERO_INSPECTOR}}', '/demo/#' + openingSelection.toString().replaceAll('&', '&amp;'))
    .replaceAll('{{HERO_VERDICT}}', runtimeText('{loaded} of {total} bytes reach {client}', { loaded: openingSource.loadedBytes, total: openingSource.bytes, client: 'Codex' }))
    .replaceAll(originalSite, configuredSite);
  for (const asset of pageAssets) content = content.replaceAll(`="/${asset.filename}"`, `="/${asset.filename}?v=${asset.revision}"`);
  content = content.replace(/\b(href|src)="\/(?!\/)/g, (_match, attribute) => `${attribute}="${basePath}`);
  mkdirSync(path.join(destination, language.path), { recursive: true });
  writeFileSync(path.join(destination, language.path, name), content);
}
for (const name of ['robots.txt', 'sitemap.xml']) {
  const file = path.join(destination, name);
  writeFileSync(file, readFileSync(file, 'utf8').replaceAll(originalSite, configuredSite));
}
mkdirSync(path.join(destination, 'demo'), { recursive: true });
writeFileSync(path.join(destination, 'demo/index.html'), html(report));
writeFileSync(path.join(destination, 'demo-report.json'), JSON.stringify(publicReport));
cpSync('LICENSE', path.join(destination, 'license.txt'));
mkdirSync(path.join(destination, 'downloads'), { recursive: true });
if (!values['released-package']) cpSync(filename, path.join(destination, 'downloads', filename));
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
