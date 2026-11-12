import { appendFileSync, readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (process.env.GITHUB_REF_NAME !== `v${pkg.version}`) throw new Error('Release tag must match package.json version.');
console.log(`Release version verified: ${pkg.version}`);
const response = await globalThis.fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`);
if (response.status !== 200 && response.status !== 404) throw new Error(`Cannot verify npm publication state (HTTP ${response.status}).`);
const publish = response.status === 404;
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `publish=${publish}\n`);
console.log(publish ? 'Version is available for initial publication.' : 'Version is already published. Registry publication will be skipped.');
