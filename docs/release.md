# Release procedure

Local release candidate:

```sh
npm ci
npm run check
npm run test:web
npm pack
npm install -g ./agent-sightline-0.1.0.tgz
agent-sightline demo
```

`npm ci` uses the committed lockfile. Build uses pinned TypeScript and copies static assets plus a version-pinned schema. `npm run smoke` packs to a temporary directory, performs a real isolated installation, executes the installed resolver/version, and writes an installed HTML report. It does not install globally.

Before public release: host the reviewed source repository; enable private vulnerability reporting; run the Linux/macOS/Windows workflow and retain its results; recheck the package/name availability; configure npm trusted publishing for this repository and the `npm-release` environment. Create a `v0.1.0` tag only after those gates. The release workflow verifies the tag, waits for the OS matrix, and publishes with provenance.

No public repository, npm ownership or trusted publisher is assumed by this checkout. A local tarball is installable before public publication. Registry install commands should be promoted only after the package is actually published.

Reproducibility: `npm run build` creates deterministic compiler/static-asset output. Tarballs embed npm package metadata; compare file content hashes, not installation cache timestamps. The generated example HTML uses portable paths and no report timestamp.
