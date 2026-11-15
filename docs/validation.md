# Release validation

## v0.3.42

Verified locally on macOS ARM64 with Node 26.4.0 on 2026-11-16.

* Browser regressions failed before correction. Inspect submitted a redacted target as another valid virtual target, a redacted Codex profile caused rejected rescans, private text matching a trust name reset the displayed trust control, and resubmitting an unchanged target trimmed its filename whitespace.
* Desktop and phone journeys exercise Inspect, Enter, Apply, refresh, actual effective model/instruction values, profile clearing, invalid-profile recovery, reload and Back/Forward. Server defaults and explicitly entered selections retain their request meaning. Aliases and backslashes match complete baseline scan reports. Export and offline re-export retain redacted target/profile data and the last successful inspection after a rejected request.
* Optional inputs.trust metadata preserves the generated auto/trusted/untrusted enum across public scans and portable reports. Private copies in source text and instruction bodies remain masked. Live and offline scope details render the captured enum, including when the assumption prose is redacted. Earlier reports retain assumption-text fallback for the trust control.
* The 600-case core suite completed with 598 passes and two platform-gated skips. Lint, strict TypeScript, build and empty-cache offline installation passed. The installed CLI smoke check retains explicit trust metadata when private values use the same words. Production dependency audit reported zero vulnerabilities.
* All 113 Chromium browser cases and six focused WebKit flows passed. Live profile and trust controls passed desktop/phone WCAG AA checks. The standalone report and product captures were regenerated from the working application. The Gemini import fixture explicitly reloads its edited source between viewport runs, since fragment navigation retains the captured inspection.
* Windows CI exposed a POSIX-only private-path fixture. The redacted-target browser case now uses the native relative path in its synthetic environment value, matching the generated report path on each platform.
* The local Firefox binary exited before navigation with a profile-folder startup error, including a short temporary-path retry. Linux CI exercises Firefox.

## v0.3.41

Verified locally on macOS ARM64 with Node 26.4.0 on 2026-11-16.

* Independent starting-directory fixtures cover root, nested and sibling startup with a fixed target, default target-directory behavior, invalid and escaping paths, input metadata and portable paths. The implicit CLI UI fixture retains its selected directory after Git-root normalization.
* Forty-two native Claude instruction scenarios capture startup and post-Read requests. They compare ordered instruction markers and canonical file lists, including multiple descendant levels, startup/on-demand local-file and rule order, nested AGENTS exclusion, sibling-target behavior and personal rule bases. Native Codex startup requests and Copilot rule/MCP inventories retain a fixed nested target while changing the starting directory.
* Native Codex, Claude and Copilot comparisons cover relative and empty configuration-home overrides. Windows exposed Codex's OS-profile default-home behavior. That empty override uses pinned source and an OS-profile context assertion, with the native relative override checked in an isolated home. Public CLI checks launch from a different process directory. The custom Claude state file withholds account-state previews.
* The 599-case core suite completed with 597 passes and two platform-gated skips. Lint, strict TypeScript, build and empty-cache offline installation passed. The installed package smoke check verifies the independent starting directory for all three primary clients and its portable input metadata. Production dependency audit reported zero vulnerabilities.
* All 109 Chromium browser cases and three focused WebKit flows passed. Desktop and phone starting-directory controls passed automated WCAG AA checks and visual review. Browser journeys cover directory selection, invalid inputs, target changes, Back/Forward, reload, refresh, displayed-path redaction, standalone export and offline re-export.

* Linux, macOS and Windows verification jobs passed for the exact release source. Anonymous GitHub download matched SHA-256 `2b288d970a15738c3af50e79cb7dff6fcdc24108b9ad564ebbdba7c02da9a5e1` and its 1,579,124-byte size. The exact public archive passed empty-cache installation, installed CLI starting-directory checks, desktop/phone live selection, reload, refresh and offline export/re-export with zero page errors. The local project-path website build distributed the same bytes and passed its guide, comparison and offline-report checks. [Tagged cross-platform verification](https://github.com/iamzwxyy/agent-sightline/actions/runs/43765983987)

## v0.3.40

Verified locally on macOS ARM64 with Node 26.4.0 on 2026-11-16.

* A normal scan reproduced a numeric environment value in copied Claude instruction text. The new scalar-copy regression failed before the correction. Captured numeric and TOML date/time values now conceal their text copies and source spellings across project, sibling and user scopes.
* Fixtures cover JSON scientific notation, YAML hexadecimal values, TOML tables, inline tables, incomplete arrays, digit separators, signed/scientific/non-decimal numbers, date/time literals, Infinity/NaN and LF/CRLF. Zero and an escaped single digit require a complete placeholder for their encoded spelling. The parser/privacy/Gemini-memory checks passed all 82 cases.
* Flattened sensitive setting paths mask typed passwords, Boolean credentials and null values. Boolean/null handling uses parsed privacy context, preserving ordinary typed configuration. Matching scalar placeholders retain quotes in source previews. An existing browser fixture reuses private value 42 as a malformed hook cwd. The source now shows its quoted mask at the original line 9, with the type diagnostic and valid sibling server retained.
* The 579-case core suite completed with 577 passes and two platform-gated skips. Lint, strict TypeScript, build and empty-cache offline installation passed. The installed CLI checks numeric/date copies from malformed sibling TOML, typed sensitive settings and retained field diagnostics. Production dependency audit reported zero vulnerabilities.
* All 107 Chromium browser cases and three focused WebKit flows passed. Desktop and phone journeys cover live refresh, source inspection, effective text, comparison, standalone export and offline re-export. Automated WCAG AA checks passed.

* Linux, macOS and Windows verification passed for the exact release source. Anonymous download matched SHA-256 `0cac4caa8fd8b6d748cc0da700953c67de112afa80c080411898f16be72152d8` and its 1,566,230-byte size. The public archive passed empty-cache installation, installed-CLI numeric/date-copy privacy and retained diagnostics, desktop/phone source inspection, comparison and offline export/re-export with zero page errors. Ordinary public Boolean configuration remained JSON-parseable. [Verified release source](https://github.com/iamzwxyy/agent-sightline/actions/runs/43757012644)

## v0.3.39

Verified locally on macOS ARM64 with Node 26.4.0 on 2026-11-16.

* The normal scan reproduced plaintext under an uppercase `Env` field. Public-payload, preview/copy and malformed-TOML regressions failed before the correction. A shared privacy predicate now recognizes capitalization variants of environment and header mappings while preserving parsed keys, case-sensitive field warnings and schema validation.
* Parser fixtures cover JSON, JSONC, TOML, YAML, YML and Markdown frontmatter with escaped values, numeric values and LF/CRLF line endings. Scan fixtures cover copied instructions, YAML aliases, TOML tables, inline tables, dotted assignments and malformed TOML across project, sibling and user scopes. The focused parser/privacy suite passed all 37 cases.
* The 577-case core suite completed with 575 passes and two platform-gated skips. Lint, strict TypeScript, build and empty-cache offline installation passed. Installed-CLI smoke checks retain field diagnostics while concealing case-variant private values and malformed sibling TOML copies. Production dependency audit reported zero vulnerabilities.
* All 107 Chromium browser cases and two focused WebKit flows passed. Desktop and phone journeys cover live rescan, source inspection, effective text, comparison, standalone export and offline re-export. Automated WCAG AA checks passed.

* Tagged Linux, macOS and Windows verification jobs passed for the exact release source. A source-run Windows Copilot native subprocess exceeded its 30-second startup budget. The tagged Windows job passed on the identical source. Anonymous download matched SHA-256 `399531daeeb17c4796db024377dd31fedf925461bb3ff8f7b11e0906d382b1c0` and its 1,564,742-byte size. The public archive passed empty-cache installation, installed-CLI privacy and retained diagnostics, desktop/phone source inspection, comparison and offline export/re-export with zero page errors. [Tagged cross-platform verification](https://github.com/iamzwxyy/agent-sightline/actions/runs/43746796911)

* The source-run Windows job passed on retry. A later main-run Windows job reached the trust group's four-minute total limit after 23 sequential native scenarios, with package extraction adding several seconds per scenario. The group budget now scales with the fixture count and the 30-second native-command limit. All 27 trust scenarios passed locally, along with lint and strict TypeScript.

## v0.3.38

Verified locally on macOS ARM64 with Node 26.4.0 on 2026-11-16.

* Four new browser cases cover a real Codex/Claude one-line instruction difference, effective-text line numbers, unchanged context, source inspection and desktop/phone offline export. Pair selection and swapping survive reload, browser history, refresh and re-export, including removal and re-selection of clients.
* Eight displayed-text fixtures reconstruct the complete left and right inputs after alignment. They cover repeated and reordered lines, CRLF, indentation, trailing spaces, final newlines, empty sides, redacted values, Unicode and HTML-like text. Earlier reports without instructionDiff retain line comparison.
* Controlled asynchronous completions prove that superseded comparisons cannot overwrite the selected pair. Calculation-budget fallback shows complete replacements. Expanding to 400 rows retains focus, reloadable state and visible pair controls on desktop and phone. The shipped demo exposed moved-line labeling, and the final legend and summary describe additions and removals in the alignment.
* The 574-case core suite completed with 572 passes and two platform-gated skips. Lint, strict TypeScript, build and empty-cache offline installation passed. Production dependency audit reported zero vulnerabilities.
* All 106 Chromium browser cases and seven focused WebKit flows passed. Automated WCAG AA checks passed. Desktop and phone comparison views received visual review. The example HTML, inspector capture and website comparison image were generated from the working interfaces.
* The runtime package bundles JsDiff 9.0.0. Standalone reports embed its browser code and BSD 3-Clause notice in their CSP-hashed script and execute with networking disabled.

* Linux, macOS and Windows verification passed for the released source. Anonymous download matched SHA-256 `c8b508f45b8146af64290c9f75f3b017c0826ccd0bb7efdbcc7545d50d9b6568` and its 1,564,338-byte size. The exact public archive passed empty-cache installation, installed-CLI HTML generation and desktop/phone offline line alignment, pair selection, unchanged context and report re-export with zero page errors. Fresh-cache public execution returned 0.3.38. [Verified release source](https://github.com/iamzwxyy/agent-sightline/actions/runs/43738126087)

## v0.3.37

Verified locally on macOS ARM64 with Node 26.4.0 on 2026-11-15.

* Three new browser regressions failed before the correction. Reload lost selected comparison clients and filters, expanded paragraphs returned to their initial count, and keyboard client selection lost focus. Comparison navigation now records these choices in the inspection fragment and restores the selected control.
* Desktop and phone checks cover live refresh, browser Back/Forward, source inspection, exported HTML and offline re-export. A single selected client remains selected. Unknown clients and invalid filter or paragraph values fall back to available report data and defaults.
* The 574-case core suite completed with 572 passes and two platform-gated skips. Lint, strict TypeScript, build and empty-cache offline installation passed. Production dependency audit reported zero vulnerabilities.
* All 102 Chromium browser cases and four focused WebKit flows passed. Automated WCAG AA checks passed. The exported comparison received desktop and phone visual review. The example report and inspector capture were regenerated from the working CLI.

* Tagged Linux, macOS and Windows verification jobs passed. A source-run macOS job encountered a GitHub connection timeout while downloading the historical website fixture and was retried. Anonymous download matched SHA-256 `84d9783744ad0d167de475ec92120929a7e8ac53b53342eb4a9f54ed56a70b17` and its 1,426,571-byte size. The exact public archive passed empty-cache installation, installed-CLI HTML generation and desktop/phone offline comparison selection, filters, expanded paragraphs and re-export with zero page errors. Fresh-cache public execution returned 0.3.37. [Tagged cross-platform verification](https://github.com/iamzwxyy/agent-sightline/actions/runs/43730421035)

## v0.3.36

Verified locally on macOS ARM64 with Node 26.4.0 on 2026-11-15.

* Three browser regressions failed before the correction. Captured settings files imported as Gemini instructions were absent from source coverage. Mixed active/conditional contributions showed their first state, and a later repeated contribution could be hidden by Differences only. The matrix now indexes every instruction contribution and preserves its ordered source occurrence.
* Normal scan fixtures also reproduced concurrent active/conditional Codex MCP candidates and a valid shell-pipeline permission name. Extension comparison exposes each eligible candidate, includes loading status in differences and preserves complete kind/name identities. Trust refresh covers the selected project definition and status-only differences between matching definitions.
* The 574-case core suite completed with 572 passes and two platform-gated skips. Lint, strict TypeScript, build and empty-cache offline installation passed. Production dependency audit reported zero vulnerabilities.
* All 99 Chromium browser cases and six focused WebKit flows passed. Desktop/phone and live/offline checks cover structured instruction roles, private imported values, grouped contributions, source lines, keyboard focus and complete extension definitions. Legacy reports without instructionDiff and empty configuration retain their comparison behavior. Automated WCAG AA checks reported zero violations.
* Phone visual review reproduced a clipped long path in the new contribution dialog. The dialog now uses the existing wrapping path presentation. Comparison source columns also wrap long paths, and actions for individual contributions have a 44 px minimum height.

* Linux, macOS and Windows verification passed for the released source. Anonymous download matched SHA-256 `14f7688e449e45e18900142953637d561665ba043392a2b8f2906d267926b2b8` and its 1,425,307-byte size. The exact public archive passed empty-cache installation and desktop/phone offline structured-import, repeated-contribution, permission-name and conditional-extension comparisons with zero page errors. Fresh-cache public execution returned 0.3.36. [Verified release source](https://github.com/iamzwxyy/agent-sightline/actions/runs/43722428252)

## v0.3.35

Verified locally on macOS ARM64 with Node 26.4.0 on 2026-11-15.

* A zero-finding first scan reproduced an omitted loading condition for project AGENTS.md. The first terminal summary now exposes loaded instructions, effective bytes, conditional sources and truncation. Four reporter cases cover trust changes, repeated Gemini segments, exhausted budgets and distinct source identities after private path redaction. A normal CLI-entry regression preserves the original conditional scan and user files.
* The 574-case core suite completed with 572 passes and two platform-gated skips. Lint, strict TypeScript, build and empty-cache offline installation passed. The installed CLI checks both pending and trusted Gemini summaries, unique source counts and its client-specific next inspection command. Production dependency audit reported zero vulnerabilities.
* All 94 Chromium browser cases and three focused WebKit flows passed. Desktop and phone checks verify a first-viewport conditional-loading action, keyboard focus, source selection, trust refresh and offline report navigation. Repeated Gemini source occurrences and distinct source IDs with redacted paths retain their counts and selected decisions. Automated WCAG AA checks reported zero violations, and the phone overview received visual review.
* README terminal and inspector screenshots and the example HTML report were regenerated through the repository's capture script and reviewed.

* Linux, macOS and Windows verification passed for the released source. Anonymous download matched SHA-256 `8205ca573ad75b0d830f2c02890fd73b951910aa297ed430c54dc4cfcb74468c` and its 1,421,922-byte size. The exact public archive passed empty-cache offline installation, the normal first entry, conditional/trusted/untrusted summaries and read-only configuration checks. Its standalone report passed desktop/phone offline source navigation. Fresh-cache public execution returned 0.3.35. [Verified release source](https://github.com/iamzwxyy/agent-sightline/actions/runs/43712341993)

## v0.3.34

Verified locally on macOS ARM64 with Node 26.4.0 on 2026-11-15.

* Four directory-alias cases reproduced unrelated Gemini trust entries in raw previews, Claude settings and duplicate-key diagnostics. All four pass with captured canonical identities and source-scoped private values. Two additional native comparisons cover escaped entries imported in tree/flat context. Invalid relative keys retain unrelated Claude instructions, settings and report paths.
* The 569-case core suite completed with 567 passes and two platform-gated skips. All 76 Gemini startup/import cases passed. Lint, strict TypeScript, build and empty-cache offline installation passed. The installed CLI verifies alias discovery, selected trust, concealed previews and private JSON/HTML output. Production dependency audit reported zero vulnerabilities.
* All 91 Chromium browser cases and five focused Gemini WebKit flows passed. Desktop and phone journeys inspect an aliased trust file, refresh approval/rejection, export the selected source and reopen its portable report offline. The phone source view received visual review.

* Linux, macOS and Windows verification passed for the implementation. Anonymous download matched SHA-256 `1f1677e8a073f7cc237e1caee4c5416473f09e7a767b1417174ff44cd784d2ed` and its 1,418,860-byte size. The exact public archive passed empty-cache offline installation, aliased duplicate trust, escaped imports, selected-rule provenance and JSON/terminal/HTML privacy checks. Fresh-cache public execution returned 0.3.34. [Verified implementation](https://github.com/iamzwxyy/agent-sightline/actions/runs/43706443678)

## v0.3.33

Verified locally on macOS ARM64 with Node 26.4.0 on 2026-11-15.

* Three native comparisons reproduced missing configuration and context when GEMINI_CLI_HOME was relative. Resolved homes now follow the native session working directory. Project-root and nested sessions cover homes inside and outside the repository, including macOS canonical working-directory paths. Each case also invokes the ordinary CLI entry point.
* An additional native comparison verifies empty-home fallback. The native fixture isolates the OS home before importing the published modules and keeps project-memory lookups within its temporary home. All 69 Gemini startup/import cases passed.
* The 562-case core suite completed with 560 passes and two platform-gated skips. Lint, strict TypeScript and build passed. Empty-cache offline installation checks relative homes for root and nested targets, their applicable global context and private portable output. Production dependency audit reported zero vulnerabilities.
* All 90 Chromium browser cases passed. Four focused Gemini and all twelve website cases passed in WebKit. Desktop and phone flows select a nested target, refresh changed context, copy redacted effective text and reopen the matching report offline. The phone report received visual review.

* Windows, macOS and Linux verification passed for the released source. Anonymous download matched SHA-256 `31b65b8bbc9aca4f2e78c3a483dbe11d846a8c4f4a5e14ca3a8c9b17e68abd58` and its 1,417,269-byte size. Fresh-cache public execution resolved the relative home for a nested session launched from a separate directory. Offline installation of the exact archive also passed root/nested resolution and portable-path checks. [Verified release source](https://github.com/iamzwxyy/agent-sightline/actions/runs/43697573566)

## v0.3.32

Verified locally on macOS ARM64 with Node 26.4.0 on 2026-11-15.

* Twenty-two startup cases pin the published Gemini CLI 0.68.0 modules and cover folder approval/rejection, parent inheritance, canonical aliases, environment overrides, custom homes and trust files, JSON loading and custom context filenames. Existing import comparisons retain explicit trusted-session assumptions.
* The 558-case core suite completed with 556 passes and two platform-gated skips. Lint, strict TypeScript, build and empty-cache offline installation passed. Production dependency audit reported zero vulnerabilities.
* All 89 Chromium browser cases passed. Three focused Gemini and all twelve website cases passed in WebKit. Desktop and phone flows verify pending/approved/rejected context, refresh, copied effective text and private offline reports. Their source views received visual review.
* The installed package verifies saved Gemini trust through all three states, current user context, project custom context and the GEMINI.md fallback. HTML output conceals unrelated saved folder entries and private paths. The production archive excludes the development-only Gemini runtime.
* Homepage checks cover sourced client icons, the WebGL opening, pause, visibility changes, context loss, reduced motion and JavaScript-disabled fallback. A phone screenshot exposed joined client-strip sentences, and a responsive wording regression now covers their spacing.
* The initial Windows startup comparison exposed backslashes in generated context delimiters where the native manager uses forward slashes. Delimiters now use the native display form. Import-only comparisons also call the pinned upstream path formatter for their context labels. [Initial OS verification](https://github.com/iamzwxyy/agent-sightline/actions/runs/43690495388)

* Windows, macOS and Linux verification passed for the released source. Anonymous download matched SHA-256 `dc556746015e836c2c78b4d6609e2499175a1f3ab89870653213a013854e9d07` and its 1,416,261-byte size. Fresh-cache public execution returned 0.3.32, and empty-cache offline installation of the exact archive produced the bundled three-client demo with sixteen rule IDs and its truncated Codex source. [Verified release source](https://github.com/iamzwxyy/agent-sightline/actions/runs/43692236509)

## Homepage demo entry, 2026-11-15

* A browser regression reproduced the primary homepage demo action opening Overview after selecting a preview client. The action now opens the selected client's instruction source, with its original line. Desktop and phone checks cover Codex, Claude Code and Copilot.
* The build derives the default entry from the real bundled scan. JavaScript-disabled checks verify the matching client, source path and line. A failed preview-report request still permits opening the chosen client's instruction chain.
* All 88 Chromium browser cases and all twelve website WebKit cases passed. Lint and strict TypeScript checks passed. The project-path build passed primary-entry, source-selection, manual-copy and overflow journeys at 1440×1000, 390×844 and 667×320. Its published v0.3.31 download matched the recorded SHA-256 and 1,410,785-byte size.

## v0.3.31

Verified locally on macOS ARM64 with Node 26.4.0 on 2026-11-15.

* Forty-three Gemini import cases include thirty-one isolated executions of the published 0.68.0 processor. Comparisons cover tree and flat order, repeated references, cycles, backtick regions, native path validation, memory boundaries, aliases, separate global/ancestor state and a forty-file flat chain.
* Import segments retain source lines and columns. Literal structured imports retain instruction semantics while their configuration consumers receive structural diagnostics. JSON, JSONC, TOML, YAML, Markdown frontmatter, scalar values, escaped strings, aliases and cyclic aliases have privacy regressions. Private tree expansions also conceal earlier and nested contributions.
* The 536-case core suite completed with 534 passes and two platform-gated skips. Lint, strict TypeScript, build and empty-cache offline installation passed. All 86 Chromium browser cases and both focused Gemini WebKit cases passed. Production dependency audit reported zero vulnerabilities.
* Desktop and phone journeys inspect imported source lines, copy effective text, refresh changed imports and reopen portable reports while offline. Tree/flat screenshots received visual review. Installed CLI smoke checks verify both native formats, import provenance and portable HTML.
* A Windows-style checkout reproduced byte changes in all four pristine upstream fixture files under automatic CRLF conversion. A scoped Git attribute now retains their original bytes. The same checkout comparison then passed for all four files.
* A fresh-process synthetic scan of 10,000 files and 1,000 Skills captured 1,201 sources in 1,396 ms. Fixture creation warmed the filesystem cache.
* Initial Windows verification exposed a broken-link `stat` error where the published processor reaches `open`. Import preflight now inspects the link entry before reproducing native reads. Portable-path assertions also accept Windows separators. [Initial verification](https://github.com/iamzwxyy/agent-sightline/actions/runs/43678857496)
* Windows, macOS and Linux verification passed for the released source. Linux Firefox completed with 83 passes and three browser-gated skips. The anonymous release download matched SHA-256 `ae9e57ffa58507b6a05fee2f4e44f417e29b63598ec36d5d1964ba8b4e183f6f` and its 1,410,785-byte size, followed by a fresh empty-cache installation and desktop/phone import, privacy, clipboard, refresh and offline-report checks. [Verified release source](https://github.com/iamzwxyy/agent-sightline/actions/runs/43679582616)

## Website interaction update, 2026-11-15

* The homepage example now carries its selected client, source path and source line into the complete inspector. Checks cover all three preview clients, including sources the selected client ignores.
* Source selection retains keyboard focus after rendering. Client and workflow tabs use one tab stop, support arrow/Home/End navigation and name their associated panel.
* Homepage and guide commands open a selected, read-only command field when clipboard access fails. Desktop, phone and short landscape checks verify the close control and focus return. The guide uses the site's sourced Solar copy icon.
* All 84 Chromium browser cases and all eleven website WebKit cases passed. Existing automated WCAG AA route checks and an additional open-copy-dialog audit reported zero violations. Lint and strict TypeScript checks passed.
* The ordinary npm preview command served both root and GitHub Pages builds with their correct asset prefixes. Browser journeys at 1440×1000, 390×844 and 667×320 passed source links, manual copying, guide navigation and overflow checks for both builds.
* Both local builds served the published v0.3.30 archive with SHA-256 `54151f5458580656e54184239b3e1e584590d0ea2af16135a90d9a9372cd6a48` and a 1,401,708-byte size.

## v0.3.30

Verified locally on macOS ARM64 with Node 26.4.0 on 2026-11-15.

* Native CLI registration reproduced six missing-server cases before the correction. Eleven local-scope registrations now compare the client-generated project key, chosen MCP server, field origins and portable output with the public scan. The cases cover logical/canonical paths, nested/non-Git sessions, wider inspection boundaries, linked worktrees and separate Git directories.
* A native case also reproduced a pending lower-scope project candidate surviving a known active local definition. The corrected replacement retains all overridden origins. Four invalid local declarations compare native user-server fallback with the public report.
* SDK cases retain repository-only exclusion and report unresolvable Git metadata while preserving known user configuration. Native local-server probing, raw account-state withholding and portable re-export checks passed.
* Desktop and phone flows inspect the selected local server, copy its redacted definition, navigate to its parsed private-state projection, export an offline report and refresh after removing/restoring the local entry.
* The phone journey reproduced a close control scrolling out of view after copying a long definition. A sticky detail header keeps the close control visible, and reopening another detail starts at its heading. Focused modal, navigation and field-provenance checks passed.
* A separate-Git-directory worktree reproduced an incorrect project key. The corrected shared-identity resolver retains the separate Git directory. Two additional native instruction scenarios verify the same approval selection, bringing instruction coverage to thirty-three scenarios and thirty-seven requests.

* The 493-case core suite completed with 491 passes and two platform-gated skips. Lint, strict TypeScript, build and empty-cache offline installation passed. All 82 Chromium browser cases passed. Production dependency audit reported zero vulnerabilities.
* An installed archive passed native CLI registration in a linked worktree, default read-only inspection, the explicit doctor probe, precedence, terminal output, redacted clipboard copying, desktop/phone refresh and offline export. The retained header stayed visible after copying a long definition.
* A fresh-process synthetic scan of 10,000 files and 1,000 Skills captured 1,201 sources in 1,147 ms. Fixture creation warmed the filesystem cache.

* Windows, macOS and Linux verification passed for the released source commit. Anonymous download matched the recorded SHA-256 and 1,401,708-byte size, followed by a fresh empty-cache installation, native local MCP registration, explicit probing and desktop/phone inspection/export. [Verified release source](https://github.com/iamzwxyy/agent-sightline/actions/runs/43664154998)

* The initial main verification hit transient Windows EBUSY locks while removing the Claude worktree and Codex Skill fixtures. These cleanups and the local-MCP fixture now use the existing five-retry Node rm policy. The focused 51-case local run passed. [Initial main verification](https://github.com/iamzwxyy/agent-sightline/actions/runs/43666461917)

## v0.3.29

Verified locally on macOS ARM64 with Node 26.4.0 on 2026-11-15.

* Thirty-one isolated Claude Code 2.1.322 scenarios captured thirty-five loopback Messages API requests. The comparisons check instruction order, source-file lists and empty native permission-denial lists. Scripted Read paths retain the native launch namespace.
* Main-only and linked-only approval fixtures compare linked-worktree project selection through logical and canonical launches with the pinned client. Windows approval keys use logical paths with forward slashes, and POSIX keys use canonical paths. Git metadata is inspected only when an external import needs approval. A focused regression retains conditional approval and one warning when metadata is unreadable.

* The 477-case core suite completed with 475 passes and two platform-gated skips. Lint, strict TypeScript, build and empty-cache offline installation passed. All 81 Chromium browser cases passed. Production dependency audit reported zero vulnerabilities.
* An installed-package worktree export reproduced a main-checkout path embedded in an approval key. The correction preserves file/line provenance and passes the native worktree export assertions. A fresh offline installation passed pending, approved and rejected states through JSON, terminal output, desktop/phone inspection, refresh, clipboard copying and offline HTML snapshots.
* A fresh-process synthetic scan of 10,000 files and 1,000 Skills captured 1,201 sources in 1,269 ms. Fixture creation warmed the filesystem cache.
* Windows diagnostic comparisons exposed native denial of DOS short-path Reads and worktree identity differences between short-path and canonical launches. Read fixtures now launch in canonical directories. Dedicated short-path project/worktree cases retain native state selection checks. [Windows comparison](https://github.com/iamzwxyy/agent-sightline/actions/runs/43654342013)

* Windows, macOS and Linux verification passed for the released source commit. Linux Firefox completed with 78 passes and three browser-gated skips. Anonymous download matched the recorded SHA-256 and 1,400,178-byte size, followed by a fresh empty-cache installation and the desktop/phone worktree approval journey. [Verified release source](https://github.com/iamzwxyy/agent-sightline/actions/runs/43655388399)

* The first tag verification attempt hit 90-second aggregate timeouts in the 31-scenario memory matrix and 40-scenario MCP-policy matrix on macOS. Main now uses the existing long-matrix 240-second budget for both. The focused 73-case local rerun passed. [Tag verification history](https://github.com/iamzwxyy/agent-sightline/actions/runs/43656221942)

## v0.3.28 candidate

Verified locally on macOS ARM64 with Node 26.4.0 on 2026-11-15.

* Twenty-six isolated Claude Code 2.1.322 scenarios captured thirty loopback Messages API requests. Each checks the fixed completion, request count, ordered instruction markers and canonical source-file lists against the public scan. Four scenarios issue a Read call and verify the instruction sequence before and after opening the target.
* Initial native cases reproduced incorrect personal/project rule ordering, missing rule imports and unverified external-import admission. The corrected resolver follows per-directory shared/rules/local/AGENTS order and defers matching path-scoped bodies until after startup instructions.
* Native requests verify that scoped rules expand imports during startup discovery, including unmatched parent rules and imported rules with their own path metadata. Empty path lists load unconditionally. Canonical/logical project keys, Git/non-Git directory selection, saved approval/rejection and absent approval have comparisons. Repository-only scans retain conditional approval.
* The browser journey changes saved approval through pending, approved and rejected states, then checks source provenance, effective-text ordering, clipboard content, live refresh and portable export on desktop and phone. Conditional sizes and positions carry loading-dependent labels. Public reports passed the private account-state marker checks.
* The 471-case core suite completed with 469 passes and two platform-gated skips. Lint, strict TypeScript, build and empty-cache offline installation passed. All 81 Chromium browser cases passed. Production dependency audit reported zero vulnerabilities.
* Product instruction, comparison and finding images and the bundled example HTML were captured from the current interfaces. Desktop and phone approval-state screenshots received visual review.
* A fresh offline installation with an empty npm cache passed the compiled CLI's pending, approved and rejected import states. JSON, terminal explanations, offline phone HTML and clipboard content retained their expected instruction sequence and private-state handling.
* A fresh-process synthetic scan of 10,000 files and 1,000 Skills captured 1,201 sources in 1,158 ms. Fixture creation warmed the filesystem cache. All 44 historical published archive hashes matched the website release manifest.

* The tag verification passed Linux and macOS but failed Windows. A follow-up diagnostic run isolated a short-logical versus canonical path mismatch that denied the scripted Read, alongside approval-key selection differences. This candidate remains unpublished. [Candidate verification](https://github.com/iamzwxyy/agent-sightline/actions/runs/43650017275) [Diagnostic run](https://github.com/iamzwxyy/agent-sightline/actions/runs/43651201979)

## v0.3.27

Verified locally on macOS ARM64 with Node 22.23.5 on 2026-11-15.

* Twenty-one isolated native Codex 0.167.2 turns send their instructions to a loopback scripted Responses API. Each case checks the fixed assistant completion, one captured request, the exact AGENTS.md fragment and its decoded UTF-8 byte count against the public scan result.
* The cases cover global trimming, CRLF, root/nested overrides, fallback selection, directory candidates, literal imports, empty fragments, zero/cumulative budgets, split UTF-8, whitespace-only prefixes, explicit trust, root markers and selected profile budgets/fallback filenames. Existing native configuration and Skill inventory comparisons also passed.
* Five additional Unicode cases failed before the correction. JavaScript trim discarded BOM content and retained U+0085 NEXT LINE, which changed global override selection and project budget consumption. Sightline's Codex adapter now uses the native Unicode White_Space classification for these operations. Empty-source notices describe client-specific loading effects.
* Browser checks retain BOM instructions and byte counts through effective-text inspection, clipboard copying, refresh and portable export. Replacing the global override with U+0085 restores the ordinary global file.
* The 443-case core suite completed with 441 passes and two platform-gated skips. Lint, strict TypeScript, build and empty-cache offline installation passed. All 80 Chromium browser cases passed. The production dependency audit reported zero vulnerabilities.
* A fresh-process synthetic scan of 10,000 files and 1,000 Skills captured 1,201 sources in 1,162 ms. Fixture creation warmed the filesystem cache.
* All 43 historical published archive hashes matched their release manifest before final packaging.
* The website's static opening now takes its source name and byte counts from the bundled example scan. A disabled-JavaScript regression reproduced the stale 338-byte claim before the correction. The complete 80-case Chromium suite passed afterward, and nine focused website checks also passed with project-path hosting and a delayed report request.
* Windows, macOS and Linux release verification passed. Linux Firefox completed with 77 passes and three browser-gated skips for touch emulation and WebGL context-loss checks. Anonymous download of the published archive matched its recorded SHA-256 and 1,391,410-byte size. [Release verification](https://github.com/iamzwxyy/agent-sightline/actions/runs/43641308649)

## v0.3.26

Verified locally on macOS ARM64 with Node 22.23.5 on 2026-11-15.

* A browser journey failed before implementation because Refresh scan had no persistent current error/warning summary in source inspection. The fixed header now displays grouped actionable counts and opens the filtered findings view.
* The correction journey fixes a JSON error and a misplaced MCP declaration independently, verifying one error/one warning, zero errors/one warning and the clear result. Desktop and phone checks retain a visible source line and support keyboard activation of Review findings. Automated WCAG AA checks passed.
* Incomplete discovery displays counts for inspected sources and opens scan scope from a phone-sized layout. Pending and failed refreshes clear the previous feedback while preserving the captured report for export. Portable reports retain their inspection location and findings.
* The 421-case core suite completed with 419 passes and two platform-gated skips. Lint, strict TypeScript, build and empty-cache offline installation passed. All 79 Chromium browser cases passed. The production dependency audit reported zero vulnerabilities.
* All 42 historical published archive hashes matched their release manifest before final packaging.
* The exact packed CLI passed empty-cache offline installation and staging journeys for current counts, separate corrections, unchanged scans, failed scans, successful retries, keyboard finding navigation and portable snapshots. Desktop and phone source inspections received visual review. Existing linked-Skill, repeated-import, source-search and physical-touch journeys also passed.
* Windows, macOS and Linux release verification passed. Linux Firefox completed with 76 passes and three browser-gated skips for touch emulation and WebGL context-loss checks. Anonymous download of the published archive matched its recorded SHA-256 and size. [Release verification](https://github.com/iamzwxyy/agent-sightline/actions/runs/43633097605)

## v0.3.25

Verified locally on macOS ARM64 with Node 22.23.5 on 2026-11-15.

* A same-environment comparison with v0.3.22 reproduced four external-link warnings for installed Codex Skill directories. Linked metadata discovery increased the captured source count from 63 to 66 and the Codex Skill definition count from 42 to 45. Discovery completed with zero external-link warnings.
* Native Codex 0.167.2 skills/list comparisons cover directory links, canonical alias deduplication, user/project scope and canonical, linked and configuration-relative disable selectors. Fixtures cover directory cycles, hidden children, visible links into hidden directories, depth six/seven and ignored file symlinks.
* Discovery fixtures verify per-root matching-file, directory and entry limits. Unsupported candidates found by other adapters remain excluded. Captured candidates beyond an incomplete Codex inspection receive conditional decisions. Linked catalogs expose selected Skill metadata while neighboring instruction bodies remain unread.
* Browser regressions reproduced an ignored alias reopening as loaded after portable path replacements merged its displayed path with another decision. A synthetic Windows capture also failed locally when replacement paths used forward slashes alongside captured backslashes. Source occurrences normalize separators and restored links select the matching decision. Live export, reload, explicit fragments and offline re-export retain that decision on desktop and phone.
* The 421-case core suite completed with 419 passes and two platform-gated skips. Lint, strict TypeScript, build and empty-cache offline installation passed. All 78 Chromium browser cases passed. The production dependency audit reported zero vulnerabilities.
* A fresh-process synthetic scan of 10,000 files and 1,000 Skills captured 1,201 sources in 1,187 ms. Fixture creation warmed the filesystem cache. The same benchmark measured 1,199 ms for v0.3.22.
* All 41 historical published archive hashes matched their release manifest before final packaging.
* The unpublished v0.3.23 candidate passed Linux release verification. Its Windows native inventory fixture expected HOME and USERPROFILE to relocate the separate ~/.agents root. Native Codex uses the Windows Known Folder API for that root. The corrected Windows fixture keeps its user metadata under the isolated CODEX_HOME, with both user roots still compared on macOS and Linux. The v0.3.24 candidate then exposed the Windows portable-report separator regression and remained unpublished.
* The exact packed CLI passed staging journeys after empty-cache offline installation. Checks cover linked user metadata, canonical alias deduplication, ignored file symlinks, canonical disable selectors, configuration-relative re-enabling through Refresh scan, path privacy and separate ignored decisions through export and re-export. Desktop and phone source inspections received visual review. Existing search, source-line, repeated-import, keyboard and physical-touch journeys also passed.
* Windows, macOS and Linux release verification passed. Linux Firefox completed with 75 passes and three browser-gated skips for touch emulation and WebGL context-loss checks. Anonymous download of the published archive matched its recorded SHA-256 and size. [Release verification](https://github.com/iamzwxyy/agent-sightline/actions/runs/43628261782)

## v0.3.22

Verified locally on macOS ARM64 with Node 22.23.5 on 2026-11-14.

* Two regression journeys failed against v0.3.21. An exported source inspection reopened at Overview, and a selected personal instruction source lost its opening location.
* Exported HTML stores its initial view and source location using the existing fragment format. Tests verify clients, repeated import occurrences, linked lines, effective-text mode and all inspector views. Explicit fragments select their requested destination.
* Offline re-export replaces the captured opening location after source and client changes. Desktop and phone journeys open the file without a fragment, verify the marked line in the viewport and reload it.
* Saved user source locations use the portable capture’s path replacements. Exports during pending and failed refreshes reopen the displayed successful report in its effective-text view.
* The 413-case core suite completed with 411 passes and two platform-gated skips. Lint, strict TypeScript, build and empty-cache offline installation passed. The production dependency audit reported zero vulnerabilities.
* All 76 Chromium browser cases passed, including source search, portable path handling, snapshot export, mobile navigation, linked-line history, website motion and automated WCAG AA checks.
* All 40 historical published archive hashes matched their release manifest before packaging.
* The exact packed CLI passed complete staging journeys after empty-cache offline installation. Live and portable inspections exported their selected source line at desktop and phone sizes. Re-exported files retained the newly selected ignored import occurrence, and explicit fragments opened Overview. Exported-line screenshots received visual review.
* Windows, macOS and Linux release verification passed. Linux Firefox completed with 73 passes and three browser-gated skips for touch emulation and WebGL context-loss checks. Anonymous download of the published archive matched its recorded SHA-256. [Release verification](https://github.com/iamzwxyy/agent-sightline/actions/runs/43612588854)

## v0.3.21

Verified locally on macOS ARM64 with Node 22.23.5 on 2026-11-14.

* Two regression journeys failed against v0.3.20. Searching a repeated import by its captured parent and line produced no results, and hidden ignored matches had no scope-recovery action.
* Source search now combines whitespace-separated terms across captured and displayed paths and import origins. Tests cover case, surrounding whitespace, full captured paths, Windows slash spellings and separate decisions for the same physical source.
* Browser history preserves a matching import-origin query and clears a query excluding the restored occurrence. A target-changing journey edits the import line between scans and confirms matching against the restored report. Earlier reports can search a captured parent absent from the source inventory.
* Scope exclusions expose Show all discovered and focus the resulting list entry. Clear search returns focus to the input. Result counts update an accessible status. A repository with no captured configuration shows creation guidance.
* The 413-case core suite completed with 411 passes and two platform-gated skips. Lint, strict TypeScript, build and empty-cache offline installation passed. The production dependency audit reported zero vulnerabilities.
* All 74 Chromium browser cases passed, including live and offline provenance search at desktop and phone sizes, keyboard recovery, existing source navigation, linked-line reload, mobile navigation, website motion and automated WCAG AA checks.
* All 39 historical published archive hashes matched their release manifest before packaging.
* The exact packed CLI passed staging installation and complete live/portable browser journeys, including provenance search, normalized captured paths, scope recovery, keyboard focus, import navigation, linked-line reload and physical touch. Desktop and phone search states received visual review.
* Windows, macOS and Linux release verification passed. Linux Firefox completed with 71 passes and three browser-gated skips for touch emulation and WebGL context-loss checks. Anonymous download of the published archive matched its recorded SHA-256. [Release verification](https://github.com/iamzwxyy/agent-sightline/actions/runs/43607816801)

## v0.3.20

Verified locally on macOS ARM64 with Node 22.23.5 on 2026-11-14.

* The public v0.3.19 package reproduced a linked source line outside the viewport after keyboard traversal reached Copy source content and the page was reloaded. A regression fixture failed on the portable desktop journey.
* Instrumented file and HTTP snapshots showed an initial source jump followed by native scroll restoration during document display. A fresh-page display callback now reapplies the current rendered highlight after that restoration. Post-fix timing traces show the linked line within the viewport.
* The 413-case core suite completed with 411 passes and two platform-gated skips. Lint, strict TypeScript, build and empty-cache offline installation passed. The production dependency audit reported zero vulnerabilities.
* All 72 Chromium browser cases passed. The added journey covers live and portable reload after source-list traversal, keyboard focus on source controls, desktop and phone sizes, visible linked lines and the original browser location.
* All 38 historical published archive hashes matched their release manifest before packaging.
* The exact packed CLI passed the complete installation and browser journey before publication, including the formerly failing reload sequence. Windows, macOS and Linux release verification passed. Linux Firefox completed with 69 passes and three browser-gated skips for touch emulation and WebGL context-loss checks. Anonymous download of the published archive matched its recorded SHA-256. [Release verification](https://github.com/iamzwxyy/agent-sightline/actions/runs/43602659930)

## v0.3.19

Verified locally on macOS ARM64 with Node 22.23.5 on 2026-11-14.

* Three keyboard regressions failed against v0.3.18. Source inspection lacked a focused semantic filename heading, view navigation retained the navigation focus, and mobile navigation opened with focus on the obscured toggle.
* Source inspection now focuses a filename heading with the loading status as its accessible description. Shift+Tab returns to the source list. One source row participates in Tab navigation, including a filtered result when the selected row is excluded. Arrow keys, Home/End and Enter support focus and selection.
* The 413-case core suite completed with 411 passes and two platform-gated skips. Lint, strict TypeScript, build and empty-cache offline installation passed. The production dependency audit reported zero vulnerabilities.
* All 71 Chromium browser cases passed. Added journeys cover live and portable keyboard inspection on desktop and phone, native dialog dismissal, focused source lines, filtered/empty lists, mobile focus boundaries, the explicit close button, Escape, help, scan scope and target-search shortcuts.
* Responsive checks restore a visible navigation focus when moving between desktop and phone layouts. Closed mobile navigation leaves the Tab sequence. The expanded navigation passed automated WCAG AA checks. Accessible filename names and status descriptions are asserted directly.
* Desktop and phone source-focus screenshots and the keyboard-opened mobile menu received visual review. All 37 historical published archive hashes matched their release manifest before packaging.
* Windows, macOS and Linux release verification passed. Linux Firefox completed with 68 passes and three browser-gated skips for touch emulation and WebGL context-loss checks. Anonymous download of the published archive matched its recorded SHA-256. [Release verification](https://github.com/iamzwxyy/agent-sightline/actions/runs/43599128483)

## v0.3.18

Verified locally on macOS ARM64 with Node 22.23.5 on 2026-11-14.

* Two browser regressions failed against v0.3.17. Effective-text origins and instruction coverage links opened the requested source while a retained search excluded its selected row from the list.
* The existing source-inspection path now handles those origins and preserves a requested loading occurrence. Sidebar clients, overview client cards, comparison instruction chains and the discovered-source overview start with a clear source search.
* The 413-case core suite completed with 411 passes and two platform-gated skips. Lint, strict TypeScript, build and empty-cache offline installation passed. The production dependency audit reported zero vulnerabilities.
* All 68 Chromium browser cases passed. Added live/offline journeys cover desktop and phone layouts, active and ignored coverage states, repeated-import selection, source-row filtering, reload and browser history. Back/Forward clears an excluding search and retains a matching query. Local refresh retains search text, including a query with no matching sources.
* A legacy renderer fixture retains the second truncated contribution and its eight-byte count after following an effective-text origin from an empty search result.
* All 36 historical published archive hashes matched their release manifest before packaging.
* Windows, macOS and Linux release verification passed. Linux Firefox completed with 65 passes and three browser-gated skips for touch emulation and WebGL context-loss checks. Anonymous download of the published archive matched its recorded SHA-256. [Release verification](https://github.com/iamzwxyy/agent-sightline/actions/runs/43593563077)

## v0.3.17

Verified locally on macOS ARM64 with Node 22.23.5 on 2026-11-14.

* A v0.3.16 regression with 48 source decisions placed the selected repeated import outside the list's scroll area. A second reproduction showed that viewport changes could clip a previously selected row. Both checks failed before their fixes.
* Source headings, search and filters stay above the independently scrolling list on desktop. Selection visibility updates after navigation and layout changes. Source buttons expose their selected state to assistive technology.
* The 413-case core suite completed with 411 passes and two platform-gated skips. Lint, strict TypeScript, build and empty-cache offline installation passed. The production dependency audit reported zero vulnerabilities.
* All 66 Chromium browser cases passed. Long-list journeys cover live and offline reports at 1440×1000, 390×844 and 844×390, repeated decisions, reload, browser history, keyboard focus, window resizing, local refresh and source-search editing. Source-line jumps retain their visible highlight while the list adjusts its own scroll position.
* Desktop and phone source-list screenshots received visual review. All 35 historical published archive hashes matched their release manifest before packaging.
* Windows, macOS and Linux release verification passed. Linux Firefox completed with 63 passes and three browser-gated skips for touch emulation and WebGL context-loss checks. Anonymous download of the published archive matched its recorded SHA-256. [Release verification](https://github.com/iamzwxyy/agent-sightline/actions/runs/43589622443)

## v0.3.16

Verified locally on macOS ARM64 with Node 22.23.5 on 2026-11-14.

* A v0.3.15 repeated-import reproduction selected two rows together and displayed the first loaded decision after clicking an ignored import. The inspector now selects a single captured decision with its own status, byte contribution, reason and parent.
* The 413-case core suite completed with 411 passes and two platform-gated skips. Lint, strict TypeScript, build and empty-cache offline installation passed. The production dependency audit reported zero vulnerabilities.
* All 65 Chromium browser cases passed. Repeated-import fixtures cover three branches, captured parent lines, reload, browser history, cross-client navigation, keyboard focus, local refresh and removal of one reference. Portable reports retain their original import decisions. Phone layouts keep import metadata visible within the viewport width.
* A synthetic legacy report verifies separate active and truncated contributions for one path, effective-text origin navigation and the selected byte count. File-only links and malformed or unavailable occurrence selectors select the first decision. Missing captured parents retain readable provenance.
* All 34 historical published archive hashes matched their release manifest before packaging.
* Windows, macOS and Linux release verification passed, including 62 passing Linux Firefox browser cases and three browser-gated skips for touch emulation and WebGL context-loss checks. Anonymous download of the published archive matched its recorded SHA-256. [Release verification](https://github.com/iamzwxyy/agent-sightline/actions/runs/43585258115)

## v0.3.15

Verified locally on macOS ARM64 with Node 22.23.5 on 2026-11-14.

* A v0.3.14 phone reproduction left the menu and target input more than 8,100 pixels above the viewport after following line 352. The persistent workspace header and source filename bar retain the controls and selected source while reading long files.
* A long-list regression reproduced view navigation landing below the heading and filters. Newly selected views start at their heading. Browser Back/Forward retains the source line and reading position.
* The 413-case core suite completed with 411 passes and two platform-gated skips. Lint, strict TypeScript, build and empty-cache offline installation passed. The production dependency audit reported zero vulnerabilities.
* All 63 Chromium browser cases passed. Live and portable long-file journeys verify visible source context, unoccluded highlighted lines, desktop source/details panels, bounded long-path captions, reload and browser history.
* Physical-coordinate touch checks cover 390×844, 320×568 and 844×390 viewports, larger controls, target suggestions, invalid-target feedback, correction, scrollable short-screen navigation and horizontal containment. Removing the final source clears the filename, status and parsed settings.
* The local macOS Firefox launcher failed with “Could not find profile folder” before test execution. The Windows, macOS and Linux release verification jobs passed. The complete Linux Firefox suite passed. [Release verification](https://github.com/iamzwxyy/agent-sightline/actions/runs/43548933013)

## v0.3.14

Verified locally on macOS ARM64 with Node 22.23.5 on 2026-11-14.

* A v0.3.13 inspector reproduction highlighted line 352 below the viewport and lost the selection on reload. The new source jump centers the requested line after rendering and native history scroll restoration.
* The 413-case core suite completed with 411 passes and two platform-gated skips. Lint, strict TypeScript, build and empty-cache offline installation passed. The production dependency audit reported zero vulnerabilities.
* All 62 Chromium browser cases passed. Long-file journeys cover two distinct hook locations, live and portable reports, desktop and phone layouts, reload, Back/Forward and opening another source from effective text.
* Direct line links survive Refresh scan. Deleted or unavailable sources, nonpositive and fractional values, nonnumeric strings, unsafe integers and absent line numbers produce no unrelated highlight. Existing skill-definition and controlling-setting links retain their original lines.
* The local macOS Firefox launcher failed with “Could not find profile folder” before test execution. The Windows, macOS and Linux release verification jobs passed. The complete Linux Firefox suite passed. [Release verification](https://github.com/iamzwxyy/agent-sightline/actions/runs/43542194826)

## v0.3.13

Verified locally on macOS ARM64 with Node 22.23.5 on 2026-11-14.

* The 413-case core suite completed with 411 passes and two platform-gated skips. Lint, strict TypeScript, build and empty-cache offline installation passed. The production dependency audit reported zero vulnerabilities.
* A targeted regression failed before the implementation. Post-publication v0.3.11 evidence also reproduced native acceptance of logical saved paths while Sightline reported conditional trust.
* Windows hosted verification exposed a cross-volume relative-path fixture and a real executable-lookup failure after environment copying. The fixture supplies a relative input on every volume layout. Environment regression cases cover Windows key selection, POSIX case sensitivity, executable lookup and MCP references.
* Twenty-seven isolated native MCP inventories compare canonical/logical paths, directory aliases, ancestor and path-prefix boundaries, symlink escapes, missing paths, relative/tilde entries, alias declaration order and complete typed lists. Unmatched strings leave other absolute matches eligible. Marker checks verify configuration-only inventories.
* Public scan fixtures cover trust-dependent project models, explicit trust overrides, user exclusion, malformed syntax, private JSON/terminal/HTML output and an explicit probe skipped after a symlink escape. CLI correction checks source keys, warning thresholds, portable privacy and restored active state.
* All 59 Chromium browser cases passed. The added live/offline journey verifies saved aliases, conditional state after a later malformed declaration, model selection, source navigation with a withheld private preview, correction and phone layouts. Installed-package checks verify alias trust and rejection of a malformed later key.

## v0.3.11

Verified locally on macOS ARM64 with Node 22.23.5 on 2026-11-14.

* The 377-case core suite completed with 375 passes and two platform-gated skips. Lint, strict TypeScript, build and empty-cache offline installation passed. The production dependency audit reported zero vulnerabilities.
* Synthetic fixtures reproduced internal Copilot state in JSON and HTML previews from an offline installation of the published v0.3.10 archive. Explicit personal discovery now refines cached scope/kind and parsing while retaining one source identity and replacing obsolete parser findings.
* Native Codex, Claude and Copilot comparisons cover a user-only notification setting, personal MCP approval, personal JSONC, persisted trust and disabled-server aliases with overlapping inspection boundaries.
* Fixtures cover the home root, a wider boundary, a custom COPILOT_HOME, directory aliases, personal setting normalization and user-disabled resolution across all six adapters. Shared Copilot project settings retain project trust beside a personal Claude source.
* All 58 Chromium browser cases passed. The added live/offline journey checks private state absence, source metadata, active/ignored/conditional MCP states, user inclusion and phone layouts. Installed-package checks also cover repository-only and aliased-root privacy.

## v0.3.10

Verified locally on macOS ARM64 with Node 22.23.5 on 2026-11-14.

* The 367-case core suite completed with 365 passes and two platform-gated skips. Lint, strict TypeScript, build and empty-cache offline installation passed. The production dependency audit reported zero vulnerabilities.
* Three targeted regression checks failed before the implementation. A native Codex configuration read succeeded while the old report treated a malformed sibling project's TOML as a current-target error. Native Claude and Copilot MCP inventories also preserve root-project discovery beside malformed sibling files.
* Fixtures cover syntax, field-case/capability warnings, impossible globs, filename placement, client selection, trust decisions and private values captured from outside-scope sources. Invalid source metadata and discovery explanations accompany the target-scoped findings.
* CLI and installed-package checks verify successful root CI scans and syntax findings after selecting the malformed project's target. The current repository's repository-only CI scan passed while retaining the intentionally invalid example source in discovery metadata.
* Synthetic fixtures reproduced copied environment-value disclosure after whole-file TOML parse failure in source and an offline installation of the published v0.3.9 archive. Sixty-six combinations cover eleven TOML forms across project/user/sibling scopes and LF/CRLF. The original syntax location, invalid source metadata, withheld settings and ordinary public labels remain correct. JSON, terminal, HTML and installed-package checks mask the copied private strings.
* All 57 Chromium browser cases passed. The added live/offline journey verifies clean-target exports, error findings after target changes, original source metadata, phone layout and a return to the clean target. A second journey verifies malformed-TOML privacy in live JSON, instruction text, paragraph comparison and offline phone layouts.

## v0.3.9

Verified locally on macOS ARM64 with Node 22.23.5 on 2026-11-14.

* The 359-case core suite completed with 357 passes and two platform-gated skips. Lint, strict TypeScript, build and empty-cache offline installation passed. The production dependency audit reported zero vulnerabilities.
* Two targeted regression cases failed against v0.3.8 before the implementation. Current-workspace validation removed two false parse findings from a valid commented Copilot state file.
* Nine native Copilot inventory scenarios cover plain configuration, comments and trailing commas in personal state, personal settings, personal MCP and workspace MCP files. The complete Copilot native suite passed 54 cases. The inventory checks verify persisted trust and disabled-server values while checking the synthetic server marker.
* Fixtures cover LF/CRLF, original command field lines, explicit trust assumptions, repository-only scans, malformed JSONC and preserved valid sibling definitions. Privacy checks cover internal state, escaped environment values, copied values and portable paths.
* All 55 Chromium browser cases passed. The added live/offline flow checks persisted workspace trust, source navigation at the original line, redacted personal MCP previews, phone layout and state changes after trust removal.

## v0.3.8

Verified locally on macOS ARM64 with Node 22.23.5 on 2026-11-14.

* Lint, strict TypeScript, build and empty-cache offline installation passed. The 345-case core suite completed with 343 passes and two platform-gated skips. The production dependency audit reported zero vulnerabilities.
* Forty native Claude MCP policy cases cover command/name/URL selection, merged lists, deny priority, ports, paths, queries, fragments and pinned environment expansion. Two additional scripted-API cases verify that malformed ordinary MCP policies retain other valid settings in that file.
* The isolated Linux file-policy matrix includes 53 permission/hook scenarios and 32 MCP scenarios. It compares the native fixed system directory with the public SDK, built CLI and portable export. Initial failures exposed null managed allowlists and malformed exclusive files suppressing ordinary servers. Regression cases also cover unreadable files, directory-shaped paths and broken symlinks.
* Fixtures preserve whole-entry replacement for provided servers, managed-file precedence, allowlist exemptions, managed-only controls, typed repair and original policy locations after invalid entries. Blocked servers retain their field definitions and skip executable/startup probes.
* All 54 Chromium browser cases passed. The added policy journey follows original denylist lines in live and offline reports, verifies correction and checks phone layout. Desktop and phone dialogs received visual review.
* All 27 previously published package archive digests were verified before publication.

## v0.3.7

Verified locally on macOS ARM64 with Node 22.23.5 on 2026-11-14.

* Lint, strict TypeScript, build and empty-cache offline installation passed. The 292-case core suite completed with 291 passes and one Windows-only skip.
* All 53 Chromium browser cases passed, including live/offline source navigation, portable privacy, phone layouts, accessibility and website opening behavior.
* A regression fixture reproduced v0.3.6 assigning a surviving managed permission rule to the rejected predecessor's key. Current fixtures cover multiple rejected entries before valid allow, ask and deny rules, their original keys and lines, masking origins, compacted effective arrays and preserved raw sources.
* The isolated Linux matrix includes 51 native scenarios and compares rejected-predecessor origins through the public scan API, built CLI and portable HTML. Unreadable managed lists retain invalid declarations while applicable lower-scope rules remain effective.
* Post-publication v0.3.6 checks exposed a cold Copilot connection exceeding 15 seconds and a Codex background plugin clone racing temporary-home removal. The test harness now allows 30 seconds for connection, stops owned POSIX process groups after wrapper exit and retries fixture cleanup. Dedicated Codex and Copilot suites passed 22 and 44 cases respectively.

## v0.3.6

Verified locally on macOS ARM64 with Node 22.23.5 on 2026-11-14.

* Lint, strict TypeScript, build and empty-cache offline package installation passed. The 291-case core suite completed with 290 passes and one Windows-only skip.
* Twenty-five native Claude 2.1.322 permission, trust and ordinary-hook scenarios passed against the loopback scripted Messages API. The invalid ordinary hook-switch case demonstrated that the whole settings layer is rejected, and the resolver follows that behavior.
* The isolated Linux file-policy step passed all 51 native scenarios through the real system directory. It compares actual marker writes, hook execution, tool inventory and startup failure against the public scan API and built CLI. A portable managed report retains controlling origins and removes private home paths.
* Fixtures cover managed-only permissions and hooks, alphabetical drop-ins, supported Boolean and permission-list repairs, empty policy files, malformed-policy startup blocking, source attribution and preserved skill discovery with withheld tool pre-approval.
* All 53 Chromium browser cases passed, including ignored-hook navigation to the controlling setting online and offline, correction, phone layout and portable-path privacy. Desktop and phone views received visual review. The production dependency audit reported zero vulnerabilities.
* Hosted macOS verification uses the documented macos-15-intel runner after repeated hosted ARM runner-capacity failures in the preceding release. Local verification also covers macOS ARM64.

## v0.3.5

Verified locally on macOS with Node 22.23.5 on 2026-11-13.

* Lint, strict TypeScript, build and empty-cache offline package installation passed. The 277-case core suite completed with 276 passes and one Windows-only skip.
* Controlled fixtures reproduced v0.3.4 paragraph disclosure for CRLF-normalized and cross-paragraph private values before the fix. Captured multi-line values now match LF, CRLF and mixed line endings in logical longest-match order.
* Comparison content retains whole-contribution redaction context. A group intersecting a cross-paragraph private value is masked across its recipients, including an earlier public occurrence, while raw membership, source ranges and occurrence order remain inspectable.
* Private-key blocks crossing paragraph boundaries retain redaction in public scan output, JSON, terminal diff and HTML. Safe neighboring paragraphs remain visible. Installed-package smoke checks mixed-ending private comparisons and portable exports.
* All fifty-two Chromium browser cases passed. The added live and offline case verifies absent private sentinels in JSON and exported HTML, masked paragraph rows and original source-line navigation. The independent full-page WCAG AA audits remain included.
* v0.3.4 has an explicit privacy notice and is marked as a prerelease. Its published archive and tag retain their original contents. The v0.3.5 public installation route is advanced after complete local validation, with hosted cross-platform verification continuing through completion.

## v0.3.4

Verified locally on macOS with Node 22.23.5 on 2026-11-13.

* Lint, strict TypeScript, build and empty-cache offline package installation passed. The 271-case core suite completed with 270 passes and one Windows-only skip.
* Paragraph regressions reproduced the missing common content before implementation. Current checks cover different source files, CRLF, exact ranges, repeated occurrence order, whitespace, fenced code, frontmatter, removed comments, loaded byte prefixes, excluded trust states, privacy collisions and legacy report rendering.
* CLI and installed-package checks follow shared paragraphs to their original client-specific source lines and retain portable origins. The shipped demo includes one shared payment paragraph across three different files, with both Copilot occurrences preserved.
* All fifty-one Chromium browser cases passed. The added live and offline journeys exercise recipient filters, source navigation, changed content, inert HTML, phone layout, incremental rendering and legacy snapshots. The independent full-page WCAG AA audit covers the comparison view.
* A fresh process inspecting the existing 10,000-file fixture with 1,000 skills and 1,201 configuration sources completed in 1,282 ms. Discovery was complete. The filesystem cache was warmed by fixture creation. Run `node scripts/benchmark.mjs --skills 1000` after building to reproduce this synthetic workload.
* Desktop and phone visual review covers the paragraph comparison and source links. Production dependency audit reported zero vulnerabilities. Paragraph membership is determined before private-value redaction. Transformed text without a proven contiguous source range retains an explicit source-start link.
* Two cold Copilot inventory startups exceeded their former 15-second bound during the v0.3.3 main Windows run. Those isolated tests now use the existing 30-second startup allowance.

## v0.3.3

Verified locally on macOS with Node 22.23.5 on 2026-11-13.

* Lint, strict TypeScript, build and empty-cache offline installation passed. The 264-case core suite completed with 263 passes and one Windows-only skip.
* Nineteen isolated Claude 2.1.322 runs use a loopback scripted Messages API with synthetic credentials and fixed tool requests. They inspect actual temporary-marker creation, tool availability and prompt-denial output, covering exact/tool-wide ask and deny precedence, cross-scope rules, shared-project trust and local Git/session boundaries.
* Targeted permission regressions failed before the implementation and passed afterward. Source assertions cover each allow/ask/deny array entry, every highest-priority overriding origin, narrower rules that leave broader grants applicable, Bash(*), EndConversation's inventory condition and captured private values matching generated permission-action enums.
* CLI checks cover trust assumptions, source lines, terminal origins, warning thresholds under severity filtering, portable export and correction. Installed-package smoke independently verifies ask masking, source origins, conditional grants and redacted portable findings.
* Shared-project grants retain explicit trust states in both structured settings and permission entries. Local grants without explicit trusted state remain conditional because the static report has no live-session Git-check acceptance state. Native print runs demonstrate an untracked local grant being admitted and a tracked one being withheld.
* The added browser journey opens the masked grant and its overriding rule, verifies source lines online and offline, changes the trust assumption, then refreshes after the rule is corrected.
* All forty-nine local Chromium browser cases passed, including the existing accessibility, phone, history, cancellation, export and website-motion coverage.

## v0.3.2

Verified locally on macOS with Node 22.23.5 on 2026-11-13.

* Lint, strict TypeScript checks, build and empty-cache offline installation passed. The 227-case core suite completed with 226 passes and one Windows-only skip.
* Twenty-four isolated Copilot 1.0.110 skill inventories match Sightline's eligible skill and enabled state. They cover excluded project and personal roots, inherited directories, same-name fallback, path boundaries, aliases, disabled skills and invalid personal documents. Four additional native setting-type checks cover ignoredSkillsLocations. The targeted regressions failed before the implementation and passed afterward.
* Excluded sources retain an ignored decision and extension, with a link to the original personal setting key and line. They do not shadow an eligible same-name fallback or receive a false name-conflict finding. Repository-only installed scans exclude personal settings from their selection.
* Installed-package smoke covers root exclusion, fallback, registered aliases, repository-only selection, and replacement of captured paths inside the exported setting value. The native CLI remains outside the production dependency tree.
* The added browser flow verifies excluded and eligible skill states, skill-source navigation, the exclusion-setting origin, original snake_case source lines and restored priority after removing the exclusion. It exercises live and portable reports.
* All forty-eight local Chromium browser cases passed, including existing accessibility, phone, history, cancellation, source-navigation, export and website-motion coverage.
* The first hosted Windows comparison exposed its native short-path spelling, which differs from fs.realpath. The resolver now retains the supplied Windows session spelling and compares both supplied and canonical exclusions with the real CLI. An observed cold MCP-inventory extraction exceeded the former startup allowance, so that isolated native comparison has a 30-second bound.

## v0.3.1

Verified locally on macOS on 2026-11-13.

* Lint, strict TypeScript checks, build and empty-cache offline installation passed. The 202-case core suite completed with 201 passes and one Windows-only skip.
* Two cancellation regressions failed before the fix and passed afterward. Controlled pending reads verify connection cancellation for the initial inspector, refreshed scans, exported reports and sample workspace. The same server accepts a subsequent healthy scan, and caller cancellation remains effective. A separate case aborts during final portable-path mapping and requires the scan promise to reject.
* Configuration reads use the scan's cancellation signal. Path resolution checks cancellation between filesystem operations, and the scan checks it after its final asynchronous mapping step. Closed HTTP responses skip error delivery.
* Node 22.23.5 on macOS arm64 measured a fresh CLI process at 282 ms for 10,000 source files and one instruction source. With 100 nested instruction files, 100 path rules and 100 skills, it measured 433 ms and discovered all 301 sources. With 1,000 skills, it measured 1,239 ms and discovered all 1,201 sources. From a source checkout, build and reproduce these configurations with `node scripts/benchmark.mjs --skills 100` and `node scripts/benchmark.mjs --skills 1000`. The default command retains the original single-instruction workload.
* In a local Chromium inspector with the 10,000-file/1,201-source fixture, three trust changes 100 ms apart completed in 3,637–4,184 ms before cancellation propagation and 1,616–1,617 ms afterward, across two fresh-process samples per revision. The final trust state, target and configuration remained inspectable. The filesystem cache was warmed by fixture creation. These measurements describe this synthetic setup.
* All forty-seven Chromium browser cases passed, including refresh, trust changes, inspection history and snapshot export. The production dependency audit reported zero vulnerabilities.
* The bundled terminal demonstration, inspector screenshot and portable example report were regenerated from the current CLI. Existing native-client, privacy, source-navigation and export regressions remain included.

## v0.3.0

Verified locally on macOS on 2026-11-13.

* Lint, strict TypeScript checks, build and empty-cache offline installation passed. The 200-case core suite completed with 199 passes and one Windows-only skip. Production dependency audit reported zero vulnerabilities.
* All forty-seven Chromium browser cases passed. The motion cases verify a compiled Three.js/WebGL2 renderer when supported, stable paused frames, resume, keyboard client selection, context-loss fallback, blur/offscreen suspension and teardown. Reduced motion removes the canvas and smooth scrolling, then restores them when the preference changes. Separate cases disable WebGL and JavaScript and complete the relevant phone, demo, guide and download journeys.
* Every client mark decodes in the local inspector and an offline portable export. Reporter checks compare embedded SVG bytes with the shared source assets and preserve the complete MIT and font OFL notices in live and portable HTML. Existing privacy, source-navigation, delayed-initialization and report-export regressions remain included.
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
* The package includes twenty-four production dependency packages with their license files. Archive inspection found no bundled TypeScript, esbuild, Playwright, ESLint or tsx packages. Production dependency audit reported zero vulnerabilities.
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
