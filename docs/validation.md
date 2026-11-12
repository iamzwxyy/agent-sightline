# v0.1.0 validation

Implementation commit: `e8661e86640f3242f2e3c1aa5ec291593fcd51f1`. Validation date: 2026-11-12. This record distinguishes executed checks from publication preparation.

## Executed locally

* Lint and strict TypeScript checks passed.
* 37 parser/resolver/compatibility/golden/CLI/report/server/probe tests passed on macOS arm64, Node 26.4.0. The Node 22.23.5 baseline suite also passed; hosted CI verifies the final implementation on Node 22.
* Two Chromium browser flows passed: target/source provenance, comparison, finding filters, portable HTML download/reopen, and mobile controls/layout.
* Real tarball installation in an isolated prefix passed: installed CLI, effective Codex content, reporter assets, version and bundled demo with at least five distinct rule IDs.
* One-command npm exec with the local tarball successfully ran the bundled demo and version.
* Production dependency audit (`npm audit --omit=dev`) reported zero vulnerabilities. A full development dependency audit reports moderate advisories in the current TypeScript ESLint dependency tree; these tools are not runtime package dependencies.
* Consecutive builds produced identical dist file-content hashes. The compiler/schema/browser assets are deterministic; the final tarball includes updated release documentation.
* A 10,000-file synthetic repository scanned in 232 ms using a fresh Node 22.23.5 process on macOS arm64 (Node 26 measurements: 178–189 ms). Filesystem had just been populated; this is not a general cold-disk performance guarantee.

## Hosted OS matrix

Final implementation run: [Verify 43148161468](https://github.com/iamzwxyy/agent-sightline/actions/runs/43148161468). Repository is private. Run includes npm ci, lint, typecheck, tests, build, real package installation, production audit, browser tests, packing and artifact upload on Linux/macOS/Windows with Node 22.

The final run completed successfully on all three operating systems. Each OS passed lint, typecheck, applicable unit/integration/golden/CLI/report/probe tests, build, real package installation, production audit, both browser flows, packing and artifact upload. Windows skips three POSIX-only symlink/permission fixtures; platform-neutral path tests and Windows adapter golden fixtures run there.

The matrix exposed a Windows path-root mismatch affecting Claude/Cursor rules, plus CRLF/CSP browser asset hashing. Both were corrected. A local browser run against a deliberately CRLF-encoded script confirmed the hash/interaction fix. The browser test also now waits for target resolution before selecting a source.

## Publication state

The local npm tarball and reviewed private source repository are available. No public npm package has been published. The release workflow is prepared and requires final name/visibility review plus npm trusted-publisher configuration. Official-rule fixtures are not a claim of authenticated live-client/model conformance.
