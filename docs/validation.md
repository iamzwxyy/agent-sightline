# v0.1.0 validation

The product-experience revision was verified at commit `76c9043dc31859e9d9ebb90140d663514572a5ee` on 2026-11-12. The standalone example report was regenerated in `5017568`. The audit, reproducibility and performance measurements below were recorded during the initial implementation verification at `e8661e86640f3242f2e3c1aa5ec291593fcd51f1`.

## Executed locally

* Lint and strict TypeScript checks passed.
* 38 parser/resolver/compatibility/golden/CLI/privacy/report/server/probe tests passed locally. Hosted CI verifies the product-experience revision on Node 22.
* Six Chromium browser tests passed, covering finding-to-source navigation, source provenance, comparison, portable HTML download/reopen, target suggestions and rejected targets, trust assumptions, keyboard shortcuts, mobile navigation, extension details, the website walkthrough, installation guide and package download.
* Automated axe WCAG A/AA checks reported zero violations across the homepage, guide and five inspector views. Desktop and mobile screenshots were visually inspected.
* Real tarball installation in an isolated prefix passed: installed CLI, effective Codex content, reporter assets, version and bundled demo with at least five distinct rule IDs.
* One-command npm exec with the local tarball successfully ran the bundled demo and version.
* Production dependency audit (`npm audit --omit=dev`) reported zero vulnerabilities. A full development dependency audit reports moderate advisories in the current TypeScript ESLint dependency tree; these tools are not runtime package dependencies.
* Consecutive builds produced identical dist file-content hashes. The compiler/schema/browser assets are deterministic; the final tarball includes updated release documentation.
* A 10,000-file synthetic repository scanned in 232 ms using a fresh Node 22.23.5 process on macOS arm64 (Node 26 measurements: 178–189 ms). Filesystem had just been populated; this is not a general cold-disk performance guarantee.

## Hosted OS matrix

The product-experience run [Verify 43153869201](https://github.com/iamzwxyy/agent-sightline/actions/runs/43153869201) passed on Linux, macOS and Windows with Node 22. The repository is private. The run includes npm ci, lint, typecheck, tests, build, real package installation, production audit, all six browser tests, packing and artifact upload.

Windows skips three POSIX-only symlink/permission fixtures. Platform-neutral path tests and Windows adapter golden fixtures run there.

The matrix exposed a Windows path-root mismatch affecting Claude/Cursor rules, plus CRLF/CSP browser asset hashing. Both were corrected. A local browser run against a deliberately CRLF-encoded script confirmed the hash/interaction fix. The browser test also now waits for target resolution before selecting a source.

## Publication state

The product website was deployed successfully through Sites at https://agent-sightline.williamtse700.chatgpt.site with owner-only access. It includes the interactive `/demo/`, installation guide and downloadable v0.1.0 package. The native deployment result confirmed success for `appgdep_6af53ebb7e3c8191ac97210534006bd4`.

The local npm tarball and reviewed private source repository are available. No public npm package has been published. The release workflow is prepared and requires final name/visibility review plus npm trusted-publisher configuration. Official-rule fixtures are not a claim of authenticated live-client/model conformance.
