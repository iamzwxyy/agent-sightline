import { appendFileSync, readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (process.env.GITHUB_REF_NAME !== `v${pkg.version}`) throw new Error('Release tag must match package.json version.');
console.log(`Release version verified: ${pkg.version}`);
const response = await globalThis.fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`);
if (response.status !== 200 && response.status !== 404) throw new Error(`Cannot verify npm publication state (HTTP ${response.status}).`);
let publish = response.status === 404;
let bootstrapRequired = false;
if (publish) {
  const existingPackage = await globalThis.fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}`);
  if (existingPackage.status !== 200 && existingPackage.status !== 404) throw new Error(`Cannot verify npm package ownership bootstrap (HTTP ${existingPackage.status}).`);
  bootstrapRequired = existingPackage.status === 404;
  publish = !bootstrapRequired;
}
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `publish=${publish}\n`);
if (bootstrapRequired) console.log('The package requires its first authenticated npm publication before trusted publishing can be configured.');
else console.log(publish ? 'New version is ready for trusted publication.' : 'Version is already published. Registry publication will be skipped.');
