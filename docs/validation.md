# v0.1.2 validation

Codex profile selection and project-local setting restrictions were verified at commit `3e7d441c17075d988631482991c721c25844c437` on 2026-11-12. The previous target-search and probe-lifecycle revision was verified at commit `339ba6306b6c1a8d68794508a1f649c6ffeee2c4`. The initial reproducibility and scan-performance measurements below were recorded at `e8661e86640f3242f2e3c1aa5ec291593fcd51f1`.

## Executed locally

* Lint and strict TypeScript checks passed.
* The 58-case parser/resolver/compatibility/golden/CLI/privacy/report/server/probe/target-search/profile suite completed locally on macOS with 57 passes and one Windows-only skip. New regressions cover user-to-profile-to-project precedence, exact source locations, profile trust/root-marker/byte-budget inputs, ignored project-only settings, legacy profile migration, missing/malformed files, selected-source privacy and invalid CLI inputs. Existing target-search and probe cleanup regressions remain included. Hosted CI verifies the implementation on Node 22.
* Eleven Chromium and eleven WebKit browser cases passed locally. Coverage includes finding-to-source navigation, source provenance, effective-text comparison, setting precedence and replaced origins, navigation history, target/trust persistence, fresh reloads, empty-repository onboarding, portable HTML, mobile navigation, extensions, the website walkthrough, guide, download, searchable target selection, manual clipboard fallback and profile selection/clearing through reloads and portable export.
* Automated axe WCAG A/AA checks reported zero violations across the homepage, guide and inspector routes, including the open target picker and the profile controls. Desktop and mobile screenshots were visually inspected.
* Native Firefox on this Mac failed before application navigation with a profile-folder launch error. Desktop Firefox browser cases passed on Linux CI.
* Real tarball installation in an isolated prefix passed, including installed CLI, effective Codex content, reporter assets, version and bundled demo. The installed `demo --ui --no-open` command started successfully and served the browser assets with personal configuration excluded.
* One-command npm exec with the local tarball successfully ran the bundled demo and version.
* Production dependency audit (`npm audit --omit=dev`) reported zero vulnerabilities. A full development dependency audit reports moderate advisories in the current TypeScript ESLint dependency tree; these tools are not runtime package dependencies.
* Consecutive builds produced identical dist file-content hashes. The compiler/schema/browser assets are deterministic; the final tarball includes updated release documentation.
* A 10,000-file synthetic repository scanned in 232 ms using a fresh Node 22.23.5 process on macOS arm64 (Node 26 measurements: 178–189 ms). Filesystem had just been populated; this is not a general cold-disk performance guarantee.
* Querying the final path in a synthetic 10,000-file repository returned `module-99/file-99.ts` in 40 ms. The filesystem had just been populated. This measures target search on that local setup.

## Hosted OS matrix

The v0.1.2 implementation run [Verify 43231384487](https://github.com/iamzwxyy/agent-sightline/actions/runs/43231384487) passed on Linux, macOS and Windows with Node 22. The run includes npm ci, lint, typecheck, 58 core cases, build, real package installation with profile resolution, production audit, eleven Chromium browser cases, packing and artifact upload. Linux Firefox passed ten browser cases and skipped one touch-emulation case because Firefox does not support Playwright mobile-context emulation.

Windows passed 52 of 58 core cases and skipped six POSIX-only symlink, permission and signal cases. It also passed the Windows command-shim probe fixture, platform-neutral path tests and Windows adapter golden fixtures. macOS passed 57 cases with one Windows-only skip. Linux may additionally skip the unreadable-file fixture when running as root.

The v0.1.0 tag run exposed a Windows working-directory cleanup race. A probe returned after requesting process termination, before the child released its files. v0.1.1 waits for process close, stops ordinary wrapper descendants, supports Windows command shims and bounds shutdown when SIGTERM is ignored. CLI interruptions await cleanup. The earlier Windows path-root and CRLF/CSP fixes remain covered.

## Publication state

The product website was deployed through Sites at https://agent-sightline.williamtse700.chatgpt.site and made public at the owner's explicit request. Anonymous HTTP requests to the homepage, interactive `/demo/`, guide, sitemap and package download returned 200. The downloaded package matched the local package's SHA-256 hash.

The source repository https://github.com/iamzwxyy/agent-sightline is public and uses `main` as its default branch. A fresh-cache `npx` execution from the public tarball URL ran the bundled sample, reported 15 distinct diagnostic rule IDs and excluded personal configuration.

Public npm-registry publication is pending account authentication. The website's package URL provides a working online installation route. Official-rule fixtures record static compatibility contracts.
