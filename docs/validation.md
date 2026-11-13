# Release validation

## v0.3.0

Verified locally on macOS on 2026-11-13.

* Lint, strict TypeScript checks, build and empty-cache offline installation passed. The 200-case core suite completed with 199 passes and one Windows-only skip. Production dependency audit reported zero vulnerabilities.
* All forty-seven Chromium browser cases passed. The motion cases verify a compiled Three.js/WebGL2 renderer when supported, stable paused frames, resume, keyboard client selection, context-loss fallback, blur/offscreen suspension and teardown. Reduced motion removes the canvas and smooth scrolling, then restores them when the preference changes. Separate cases disable WebGL and JavaScript and complete the relevant phone, demo, guide and download journeys.
* Every client mark decodes in the local inspector and an offline portable export. Reporter checks compare embedded SVG bytes with the shared source assets. Existing privacy, source-navigation, delayed-initialization and report-export regressions remain included.
* Desktop and phone visual review covers the moving opening, client-state changes, the product example and inspector marks. Nine independent automated WCAG AA audits cover the website, guide and core inspector views, each with its own normal test timeout.
* Project-prefix hosting verifies the additional script and image paths alongside exact historical package downloads. Website JavaScript is included in the normal lint command. The opening has a self-hosted raster first frame, separate shader loading, a 1.2-million-pixel budget and a 24 fps render limit. Motion-library development dependencies remain outside the installed CLI package.
* The Codex mark comes from the community-maintained Lobe Icons library. Claude, Copilot, Gemini CLI, Cursor and OpenCode marks come from their official sites or official libraries. The asset ledger records the sources and notices.

## v0.2.13

Verified locally on macOS on 2026-11-13.

* Lint, strict TypeScript checks, build and empty-cache offline installation passed. The 199-case core suite completed with 198 passes and one Windows-only skip. Production dependency audit reported zero vulnerabilities.
* The pinned Copilot 1.0.110 personal catalog and registered alias fixture match the native configuration API. Sixteen isolated personal-file rewrites compare explicitly configured values, including file-order collisions, optional selectors, malformed canonical values and alias-normalization fallback. Existing native merge/type comparisons remain included.
* Native MCP inventory checks both disabledMcpServers and disabled_mcp_servers while verifying that the declared server remains unstarted. Repository spelling restrictions, dynamic mapping keys, original alias lines, replacement history and numeric private mapping values have dedicated regressions.
* All thirty-three Chromium browser cases passed. The added live/portable flow opens the canonical setting's original snake_case source line and retains the earlier definition. Existing accessibility, phone, delayed initialization, privacy and comparison flows remain included.
* Local Firefox launch failed before test execution because the browser could not find its temporary profile, including a retry using /private/tmp. The hosted workflow runs the Firefox suite on Linux.
* Installed-package validation covers rejected personal settings, canonical-value fallback, JSONC correction, disabled probes, legacy theme names, source history and portable source navigation. Original paths and private values remain absent from the exported report.
* Personal value schemas outside the validated subset remain partial. Malformed legacy theme values follow the native user.settings.get metadata reader, which differs from config --list for some invalid inputs.

## v0.2.12

Verified locally on macOS on 2026-11-13.

* Lint, strict TypeScript checks, build and empty-cache offline installation passed. The 193-case core suite completed with 192 passes and one Windows-only skip. Production dependency audit reported zero vulnerabilities.
* The pinned Copilot 1.0.110 configuration API matched thirteen merge scenarios and thirty-four setting-value validation cases. Native CLI inventories covered current and legacy folder-trust keys, disabled workspace MCP servers, and root/current-directory Claude-rule locations and path metadata. Trust fixtures use separate homes and repositories. MCP startup markers remain absent during inventory inspection.
* Fixtures cover JSONC repository/local settings, trusted and conditional model overrides, restricted repository keys, malformed sibling values, restriction unions, whole marketplace entries, hook appends, effective disable flags and source-specific origins. Additional customization directories retain incomplete coverage, with a local empty list clearing that contribution.
* The native Claude binary reproduces strict JSON behavior for shared settings. Copilot retains the JSONC contribution while Claude emits its own syntax findings and ignores that layer. Private values remain redacted in the shared preview and both clients' reports.
* All thirty-two Chromium browser cases passed. Added flows inspect Copilot setting history, apply trust, follow local source lines and retain disabled extensions in portable exports. Shared JSONC findings navigate through the owning client, and the hook dialog passes automated WCAG AA checks. Existing phone, comparison, privacy and delayed-initialization regressions remain included.
* Installed-package smoke verifies layered Copilot model values and their source history, JSONC local settings, combined disabled servers, conditional trust and absence of false executable errors. Archive inspection excludes all three native client dependency trees.

## v0.2.11

Verified locally on macOS on 2026-11-13.

* Lint, strict TypeScript checks, build and empty-cache offline installation passed. The 164-case core suite completed with 163 passes and one Windows-only skip. Production dependency audit reported zero vulnerabilities.
* Public v0.2.10 testing reproduced an immediate navigation action lost while the report script was still loading. A controlled HTTP stream reproduces that timing for live and portable reports. The browser regression failed before the initialization fix and passed afterward.
* All thirty Chromium browser cases passed. The streamed-report case holds the executable script, verifies disabled controls and loading feedback, releases initialization and follows the first available comparison action. Empty snapshots retain disabled copy actions, read-only targets and hidden live controls.
* Reporter fixtures verify initialization attributes in both HTML modes while preserving instruction examples containing HTML controls. Installed-package smoke checks the same initial comparison state and loading feedback.
* Existing native Codex and Claude comparisons, privacy, configuration correction, source navigation, exports, accessibility and phone-layout checks remain included.

## v0.2.10

Verified locally on macOS on 2026-11-13.

* Lint, strict TypeScript checks, build and empty-cache offline installation passed. The 163-case core suite completed with 162 passes and one Windows-only skip.
* The pinned Claude 2.1.322 binary check and twenty-eight MCP comparisons cover fifteen transport configurations, seven approval cases, four invalid higher-priority fallback cases, stdio directory behavior and an empty remote endpoint. Temporary homes isolate client state. Remote cases stay pending approval, and synthetic stdio servers answer health-check requests.
* The native comparisons reproduced remote entries without types, SDK declarations, ignored transport fields, repository/local self-approval and working-directory differences. Public scan fixtures verify the resulting diagnostics, selected transport fields, exact source lines, malformed approval types and explicit probes.
* CLI CI checks follow an invalid remote declaration through correction and explicit trust. Installed-package smoke verifies those states and Claude's ignored cwd behavior. Production archive inspection excludes both native client dependency trees. Production dependency audit reported zero vulnerabilities.
* All twenty-eight Chromium browser cases passed. New flows navigate from a transport finding to its source, refresh after correction, apply explicit trust and export the corrected snapshot. Ignored fields retain markers and source links online and offline. The remote endpoint summary, private values and phone layout have dedicated checks. The ignored-field dialog was visually inspected.
* The pinned Codex configuration comparisons and existing parser, resolver, discovery, privacy, CLI, source-navigation, comparison and export regressions remain included.

## v0.2.9

Verified locally on macOS on 2026-11-13.

* Lint, strict TypeScript checks, build and empty-cache offline installation passed. The 150-case core suite completed with 149 passes and one Windows-only skip.
* The pinned Codex 0.167.2 version check and twenty-one native configuration comparisons passed. The added scenario checks merged command, directory, arguments, required-variable lists and private environment-mapping origins against native configuration files.
* Fixtures verify nested table inheritance, replaced/empty arrays, whole-entry replacement, unknown-trust conditional chains, exact malformed-argument locations, repeated missing-variable references, field-specific cross-client drift and inherited probe working-directory locations.
* Claude project-local source keys reproduced repository-path residue in portable reports. Export regressions cover field metadata, JSON round trips, legacy reports, idempotence, private mapping values and neighboring Codex trust keys.
* All twenty-six Chromium browser cases passed. New cases follow merged command and argument fields to their separate files in live and offline views, inspect conditional candidates and open legacy extension snapshots. The field-definition dialog was visually inspected with compact user-home paths. Existing phone, accessibility, source, comparison and export checks remain included.
* CLI explanations display field origins and retain CI finding locations and exit thresholds. Installed-package smoke verifies merged field provenance and unknown-trust behavior. Production dependency audit reported zero vulnerabilities.

## v0.2.8

Verified locally on macOS on 2026-11-13.

* Lint, strict TypeScript checks, build and empty-cache offline installation passed. The 140-case core suite completed with 139 passes and one Windows-only skip. The pinned Codex version check and twenty native configuration comparisons remain included.
* Synthetic fixtures reproduced escaped environment values in JSON/TOML previews, folded YAML values and reduced source line counts after multiline redaction. Parser value ranges now drive preview redaction, followed by captured-value and credential-text redaction. These ranges and their decoded values are excluded from public reports.
* Cases cover JSON/JSONC comments and Unicode escapes, escaped quotes, TOML multiline values and continuations, YAML folded blocks and aliases, private reference defaults, LF/CRLF, numeric/boolean/null mapping values, copied credential-key aliases and earlier duplicate definitions. Parsed key-path checks preserve literal dotted keys and hook-state identifiers containing env segments.
* All twenty-four Chromium browser cases passed. The new case verifies redacted JSON previews, original TOML line counts, finding-to-command navigation and absence of private sentinels and internal ranges in both live and portable reports. The source view was visually inspected.
* Installed-package smoke and normal CLI exports verify encoded-value privacy and the exact hook line following a multiline value. Terminal rendering applies object redaction before formatting. Production dependency audit reported zero vulnerabilities. Thirteen previously published archives retained their recorded SHA-256 values.

## v0.2.7

Verified locally on macOS on 2026-11-13.

* Lint, strict TypeScript checks, build and empty-cache offline installation passed. The 134-case core suite completed with 133 passes and one Windows-only skip.
* The pinned Codex 0.167.2 version check and twenty native configuration scenarios passed. Added comparisons cover both Windows command aliases, model-request events, MCP tool handlers and parsed prompt/agent handlers. Hook comparisons verify every configured field using the API's canonical alias names, array lengths, ordering and winning files. The API also supplies runtime defaults. The harness sends initialization and configuration reads using isolated homes and temporary repositories.
* Public scan fixtures verify host-specific command selection, exact TOML field locations, string override types, required default commands, duplicate aliases, standalone MCP fields, unsupported handler types and ignored Codex cwd/env/args fields. Claude and Copilot hook regressions remain included.
* TOML provenance fixtures cover repeated parent groups, nested handler array tables, Windows alias fields, quoted state keys, CRLF, multiline basic/literal strings and multiline arrays containing header-like text.
* All twenty-three Chromium browser cases passed. The added case follows a Codex hook finding to the exact host command line in both live and portable reports, and checks MCP/ignored handler states. The source view was visually inspected.
* Installed-package smoke verifies platform command locations and handler states. Production dependency audit reported zero vulnerabilities. Twelve previously published archives retained their recorded SHA-256 values.

## v0.2.6

Verified locally on macOS on 2026-11-13.

* Lint, strict TypeScript checks, build and empty-cache offline installation passed. The 124-case core suite completed with 123 passes and one Windows-only skip. The pinned Codex version check and eighteen native configuration comparisons remain included.
* Synthetic environment values reproduced corruption of schemaVersion, client IDs, statuses, rule IDs, source hashes and version metadata. Regressions now verify their stable representation, source/decision links and private configuration payloads through the public scan API, JSON/portable reporters, CLI CI exit thresholds and the installed package.
* Duplicate JSON environment keys and invalid TOML reproduced private values in raw source previews. Syntax-invalid sources now omit previews while retaining parser locations and loading decisions. JSON recovery, duplicate definitions, invalid TOML and broken YAML frontmatter have synthetic sentinel coverage. Valid sibling previews remain available.
* All twenty-two Chromium browser cases passed. The added case checks client selection, effective content, error filtering, finding-to-source navigation, the unavailable-preview explanation and disabled source copying in both live and portable reports. Its source view was visually inspected.
* Caller-modified tool/adapter metadata and instruction content remain covered by export-time redaction. Production dependency audit reported zero vulnerabilities. Eleven previously published archives retained their recorded SHA-256 values.

## v0.2.5

Verified locally on macOS on 2026-11-13.

* Lint, strict TypeScript checks, build and empty-cache offline installation passed. The 121-case core suite completed with 120 passes and one Windows-only skip.
* A read-only Codex scan of the development workspace reproduced a hook-review state error and a parser error from a Claude-owned example. The error count changed from two to zero after the fixes. Isolated fixtures reproduce those structures.
* The pinned Codex 0.167.2 version check and eighteen native configuration scenarios passed. Added scenarios compare stored hook review values and file origins, plus both directions of user/project hook-feature precedence. Local hook-discovery fixtures cover standalone/inline combinations, state-only configuration, invalid review values and the final feature flag.
* Client selection fixtures verify syntax, case-sensitive fields, permission-field names, globs and MCP root shapes, including editor-scoped MCP files. CLI CI cases verify Codex-only success with a malformed Claude file and syntax failures for selected owners of shared MCP sources. Operational discovery findings and completeness retain their filesystem scope.
* Quoted TOML paths, escaped Windows hook identifiers and literal keys retain decoded key paths and source lines. Portable reports replace path-bearing hook-state keys. The browser export checks both path privacy and the stored value's source line.
* All twenty-one Chromium browser cases passed, including owning-client and exact-line navigation from related findings, offline exports, available actions for unreadable sources, direct setting-table provenance links, accessibility, profiles, scope and phone layouts.
* Installed-package smoke covers selected-client syntax scoping and hook-review metadata alongside the existing resolver, profile, extension, portable-path, Git-free sample, HTML and inspector checks. Production dependency audit reported zero vulnerabilities.

## v0.2.4

Verified locally on macOS on 2026-11-13.

* Lint, strict TypeScript checks, build and empty-cache offline installation passed. The 113-case core suite completed with 112 passes and one Windows-only skip.
* Regression cases reproduced alias residue and unrelated-prefix/URL replacement before the fix. They now cover verified symlink/junction aliases, missing target files, assigned command arguments, custom homes and broken user sources, Windows escaping/separators/case, quoted and backslash-containing POSIX names, flattened project keys and filesystem-root separators.
* Privacy fixtures verify account-history privacy even when history contains an absolute path alias.
* A serialized report retains its captured path context after its entire fixture filesystem is removed. Portable export removes that context, preserves private-value redaction, supports older reports and is idempotent.
* An isolated CLI process retains an oversized configured argument within a bounded heap and timeout. Invalid or inaccessible filesystem paths end alias resolution for that path.
* The normal CLI entry point reads an isolated external CODEX_HOME and replaces its paths in HTML. JSON retains absolute diagnostic paths and additive path mappings.
* All eighteen Chromium browser cases passed. The new export case checks initial and refreshed snapshots, verifies alias and custom-home replacement, parses the rewritten MCP source preview and opens the exported HTML for offline navigation. Existing accessibility, profile, comparison, source, scope and phone checks remain included.
* Production dependency audit reported zero vulnerabilities.
* Package smoke verifies alias replacement in the installed CLI's HTML, including an assigned command argument, alongside the existing offline installation, Git-free sample, development-tool exclusion, malformed-extension, profile and browser-startup checks.

## v0.2.3

Verified locally on macOS on 2026-11-13.

* Lint, strict TypeScript checks, build and empty-cache offline installation passed. The 105-case core suite completed with 104 passes and one Windows-only skip.
* A pinned Codex 0.167.2 binary-version check and fifteen configuration comparisons run as part of the core suite. They compare selected base/project scalar/MCP values and winning source files through the native app-server configuration API. Each case uses an isolated home, disabled analytics and temporary repositories. The harness sends initialization and configuration reads without model turns or MCP startup.
* The comparisons cover nested/root precedence, untrusted layers, ignored project-only fields, MCP field merging, nearest Git roots, marker-free directories, custom/disabled root markers, ancestor/intermediate trust, canonical/alias trust and conflicting alias entries. They exposed incorrect project-layer bounds and ancestor trust inheritance, which are corrected in this release.
* All seventeen Chromium browser cases passed, including source navigation, settings, profiles, portable exports, accessibility, the public demonstration and phone layouts. The standalone report and product screenshots were regenerated and visually inspected.
* Package smoke checks the installed Git-free sample's active 160-byte Codex budget and truncation finding. It rejects development tools in the archive, including the new development-only Codex binary, alongside existing CLI, malformed-extension, profile, HTML and browser-startup checks.
* Production dependency audit reported zero vulnerabilities.
* The runtime API exposes winning files. Instruction bodies, profiles and source line numbers retain version-pinned source/schema fixture coverage.

## v0.2.2

Verified locally on macOS on 2026-11-13.

* Lint, strict TypeScript checks, build and empty-cache offline installation passed. The 89-case core suite completed with 88 passes and one Windows-only skip.
* Regression fixtures cover malformed MCP collections and fields, invalid hook handlers and working directories, hook and permission collection types, adjacent valid definitions, precise permission-array locations and nested private strings in malformed environment/header containers.
* MCP environment-reference fixtures verify full-URL and path expansion, command lookup after expansion, missing-variable diagnostics, supported defaults and preservation of independent command/directory findings. Expanded endpoint values stay outside public reports.
* Claude exec-form hooks receive literal executable checks. Client-specific hook fields, MCP-tool metadata and configured Copilot hook environments have dedicated fixtures. The official structural references were reviewed on 2026-11-13.
* An explicit probe skips an invalid server definition, initializes a valid sibling and leaves the invalid server’s execution marker absent. Existing process cleanup and interruption regressions remain included.
* All seventeen Chromium browser cases passed. The new case navigates from a malformed hook finding to its exact source line and verifies invalid/valid sibling states in the portable export. Existing accessibility, source, comparison, profile, scope and phone checks remain included.
* The installed package diagnoses malformed MCP and hook fields while retaining valid servers, alongside the existing nested-directory, profile, version, HTML and browser startup checks. Production dependency audit reported zero vulnerabilities.

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
