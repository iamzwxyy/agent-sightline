# v0.1.0 validation

The first-use and configuration-inspection revision was verified at commit `72bc20be804dbb866bc51140ffc507fa39ec6a12` on 2026-11-12. The audit, reproducibility and performance measurements below were recorded during the initial implementation verification at `e8661e86640f3242f2e3c1aa5ec291593fcd51f1`.

## Executed locally

* Lint and strict TypeScript checks passed.
* 42 parser/resolver/compatibility/golden/CLI/privacy/report/server/probe tests passed locally. New regressions cover ordinary application and Cargo configuration, subproject scope, malformed sources ignored by unrelated clients, actual unsupported agent filenames and newly created target suggestions. Hosted CI verifies the implementation on Node 22.
* Eight Chromium browser tests passed, covering finding-to-source navigation, source provenance, side-by-side effective text, setting precedence and replaced origins, browser navigation history, target/trust persistence, fresh page reloads, empty-repository onboarding, portable HTML, mobile navigation, extensions, the website walkthrough, guide and download.
* Automated axe WCAG A/AA checks reported zero violations across the homepage, guide and seven inspector views, including effective text and settings. Desktop and mobile screenshots were visually inspected.
* Real tarball installation in an isolated prefix passed, including installed CLI, effective Codex content, reporter assets, version and bundled demo. The installed `demo --ui --no-open` command started successfully and served the browser assets with personal configuration excluded.
* One-command npm exec with the local tarball successfully ran the bundled demo and version.
* Production dependency audit (`npm audit --omit=dev`) reported zero vulnerabilities. A full development dependency audit reports moderate advisories in the current TypeScript ESLint dependency tree; these tools are not runtime package dependencies.
* Consecutive builds produced identical dist file-content hashes. The compiler/schema/browser assets are deterministic; the final tarball includes updated release documentation.
* A 10,000-file synthetic repository scanned in 232 ms using a fresh Node 22.23.5 process on macOS arm64 (Node 26 measurements: 178–189 ms). Filesystem had just been populated; this is not a general cold-disk performance guarantee.

## Hosted OS matrix

The implementation run [Verify 43182346305](https://github.com/iamzwxyy/agent-sightline/actions/runs/43182346305) passed on Linux, macOS and Windows with Node 22. The run includes npm ci, lint, typecheck, tests, build, real package installation, production audit, all eight browser tests, packing and artifact upload.

Windows skips three POSIX-only symlink/permission fixtures. Platform-neutral path tests and Windows adapter golden fixtures run there.

The matrix exposed a Windows path-root mismatch affecting Claude/Cursor rules, plus CRLF/CSP browser asset hashing. Both were corrected. A local browser run against a deliberately CRLF-encoded script confirmed the hash/interaction fix. The browser test also now waits for target resolution before selecting a source.

## Publication state

The product website was deployed through Sites at https://agent-sightline.williamtse700.chatgpt.site and made public at the owner's explicit request. Anonymous HTTP requests to the homepage, interactive `/demo/`, guide, sitemap and package download returned 200. The downloaded package matched the local package's SHA-256 hash.

The source repository https://github.com/iamzwxyy/agent-sightline is public and uses `main` as its default branch. A fresh-cache `npx` execution from the public tarball URL ran the bundled sample, reported 15 distinct diagnostic rule IDs and excluded personal configuration.

Public npm-registry publication is pending account authentication. The website's package URL provides a working online installation route. Official-rule fixtures record static compatibility contracts.
