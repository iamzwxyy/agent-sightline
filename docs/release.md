# Release procedure

Local release candidate:

```sh
npm ci
npm run check
npm run test:web
npm pack
npm install -g ./agent-sightline-0.3.1.tgz
agent-sightline demo
```

`npm ci` uses the committed lockfile. Build uses pinned TypeScript and copies static assets plus a version-pinned schema. `npm run smoke` packs to a temporary directory, performs a real isolated offline installation with an empty npm cache, executes the installed resolver/version, and writes an installed HTML report. The package bundles its production dependency tree and dependency license files. The smoke test installs into a temporary prefix.

The public website distributes the tested tarball and the source repository is public. For the first npm publication, log in with the account that will own `agent-sightline` and publish the verified GitHub Release tarball with `npm publish ./agent-sightline-0.3.1.tgz --access public`. The initial package publication enables configuration of npm trusted publishing for this repository and the `npm-release` environment.

The tag-triggered release workflow verifies the tag, waits for the OS matrix, and publishes new versions with provenance through the configured trusted publisher. It reports when the first authenticated publication is still required. An already-published version is detected and skipped, allowing verification of the initial tag and safe workflow retries. Promote registry install commands after confirming that the package is published.

The website build keeps historical downloads listed in `website/releases.json`. Each entry uses the GitHub release asset URL and its recorded SHA-256 digest. Add the previous public package when advancing the website to a new version.

Reproducibility: `npm run build` creates deterministic compiler/static-asset output. Tarballs embed npm package metadata; compare file content hashes, not installation cache timestamps. The generated example HTML uses portable paths and no report timestamp.

The GitHub Pages website is built by the `Publish website` workflow from the default branch. It serves the project path `/agent-sightline/` and checks every distributed package against `website/releases.json`. Record the current public release asset as well as older downloads. The deployment command uses `--released-package` to distribute the exact GitHub asset.

After uploading a release asset, publish the website with

```sh
gh workflow run pages.yml --ref main
```

Website source changes on `main` also trigger publication. The `--site-url` build option sets navigation paths, canonical metadata and sitemap locations for the selected host. Root-hosted local builds use the default URL.
