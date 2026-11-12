# Release validation

## v0.2.1

Verified locally on macOS on 2026-11-13.

* Lint, strict TypeScript checks and build passed. The 78-case core suite completed with 77 passes and one Windows-only skip.
* CLI regressions start in a nested directory, load root Codex/Claude/Copilot instructions and project settings, resolve sibling targets from the working directory and reject targets outside the inferred repository. Explicit repository boundaries and their relative target paths are covered separately.
* Discovery fixtures verify directory and worktree-file Git markers, nearest nested repositories and the working-directory fallback without a Git ancestor.
* All sixteen Chromium browser cases passed. The new case starts the actual CLI inspector in a subdirectory, inspects inherited instructions, selects a repository-relative target and reloads the resulting page. Existing source, comparison, profile, export, accessibility and phone regressions remain included.
* The server regression retains file-search and scan behavior when a configured environment value causes repository paths in the public report to be redacted.
* Empty-cache offline installation passed with an installed nested-directory explanation, selected profile, version, HTML and browser startup checks. Production dependency audit reported zero vulnerabilities. The standalone example and product screenshot were regenerated and visually inspected.

## v0.2.0

Verified locally on macOS on 2026-11-13.

* Lint, strict TypeScript checks and build passed. The 73-case core suite completed with 72 passes and one Windows-only skip.
* Discovery regressions cover accurate custom budgets, exact and zero entry limits, invalid numeric inputs, severity-filtered completeness, repository paths below 48 directory levels, personal rules below eight directory levels and per-root user file counting in flat directories.
* All fifteen Chromium browser cases passed, including incomplete-discovery status through refresh and portable export, automated WCAG AA checks, source navigation, profiles, comparison and phone layouts.
* The package includes nineteen production dependency packages with their license files. Archive inspection found no bundled TypeScript, esbuild, Playwright, ESLint or tsx packages. Production dependency audit reported zero vulnerabilities.
* A real isolated installation used offline mode and an empty npm cache. The installed CLI resolved instructions and a selected Codex profile, produced HTML, reported the release version, ran the bundled sample and served the browser inspector with paired scan/export responses.
* The standalone example and product screenshots were regenerated and visually inspected.

## v0.1.4

Verified locally on macOS on 2026-11-13.

* Lint, strict TypeScript checks, build and isolated package installation passed. The 66-case core suite completed with 65 passes and one Windows-only skip.
* All fourteen Chromium browser cases passed. The new export regression changes instructions on disk, pauses a refresh and checks exports before completion, after completion and after a rejected target. Each download retains the last successfully displayed report and portable paths.
* The scan API can return a report and its portable HTML from the same inspection. Export redaction and script-injection fixtures cover both the initial page and subsequent scan responses.
* Windows drive/home paths and POSIX directory names containing quotes or backslashes resolve to the repository placeholder in portable reports. The HTTP regression also checks the parsed exported repository field directly.
* Real package installation verifies browser startup and the paired scan/export response. The standalone example and product screenshot were regenerated and visually inspected.
* Tag verification runs through the Release workflow. Branch verification retains the Linux, macOS and Windows Node 22 matrix.

## v0.1.3

Verified locally on macOS on 2026-11-12.

* Lint, strict TypeScript checks, build and isolated package installation passed.
* The 64-case core suite completed with 63 passes and one Windows-only skip. Regressions cover source-aware terminal grouping, severity totals, summary limits, related locations, experimental-client labels, partial JSON trees and JSON/JSONC source columns. Machine-readable findings and CI thresholds retain their full records.
* All thirteen Chromium browser cases passed, including automated WCAG AA checks, same-line JSON error preservation and copied columns, source navigation, comparison, profiles, portable exports, the public demo and desktop/mobile website paths.
* The three-client terminal sample reports twelve distinct error/warning locations and retains the separate Codex and shared MCP definitions. The real terminal screenshot and standalone HTML example were regenerated and visually inspected.
* The Node 22 Linux, macOS and Windows matrix runs through the repository's Verify and Release workflows. Per-run results are available in GitHub Actions.

## v0.1.2

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

The v0.1.1 product website was deployed through Sites at https://agent-sightline.williamtse700.chatgpt.site and made public at the owner's explicit request. Anonymous HTTP requests to the homepage, interactive `/demo/`, guide, sitemap and package download returned 200. The downloaded package matched the local package's SHA-256 hash.

The source repository https://github.com/iamzwxyy/agent-sightline is public and uses `main` as its default branch. The v0.1.2 GitHub package passed anonymous SHA-256 verification and fresh-cache online execution. The installed CLI resolved the selected profile model and its source line, retained the replaced base definition, applied the project reasoning setting and ran the bundled demo with 15 distinct diagnostic rule IDs and personal configuration excluded.

Public npm-registry publication is pending account authentication. The public GitHub Release provides the verified online installation route. The v0.1.2 Sites deployment succeeded, but requests from the development network reset during TLS before HTTP. Website download availability could not be reverified on this network. Official-rule fixtures record static compatibility contracts.

## Public website on GitHub Pages

The public entry point is https://iamzwxyy.github.io/agent-sightline/. Homepage, guide, standalone demo, robots, sitemap and all three package downloads returned HTTP 200 anonymously. The downloaded v0.1.0, v0.1.1 and v0.1.2 packages matched their recorded SHA-256 digests.

A fresh npm cache installed v0.1.2 from the Pages package URL. Profile resolution selected the expected model and source line, kept the replaced base definition and applied the project reasoning setting. The bundled three-client sample produced 15 distinct rule IDs with personal configuration excluded.

The project-path browser regression covers relative fonts, images and demo JSON, guide and snapshot navigation, canonical/sitemap URLs and the exact published package. It also holds the sample JSON response until after the first client selection, verifying that the first click is retained while data loads. Chromium and WebKit passed this regression locally.

The published desktop and phone interfaces passed a live browser check, including the first client selection, guide navigation and snapshot comparison, with zero failed responses. The website revision passed the [three-platform verification workflow](https://github.com/iamzwxyy/agent-sightline/actions/runs/43242410794), and the first-selection fix was delivered by the [website publication workflow](https://github.com/iamzwxyy/agent-sightline/actions/runs/43242411039).
