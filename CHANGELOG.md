# Changelog

## 0.3.44 — 2026-11-16

* Retain an opaque source reference when private-value redaction or portable path replacement gives different files the same displayed path. Findings, related locations, settings, extension origins and comparison links carry the reference.
* Keep independent findings and terminal error counts for same-path sources. Display source references in finding locations and source details.
* Open the referenced source and preserve its selection and highlighted line through refresh, reload, browser history, export and offline re-export, including after another same-path source is discovered.
* Offer a source chooser for ambiguous locations captured in earlier reports. A fresh scan supplies the references needed for direct source navigation.

## 0.3.43 — 2026-11-16

* Highlight word replacements and fine-grained character changes within similar words to locate command, path and text differences.
* Keep Unicode grapheme clusters together, including combining accents, skin-tone modifiers and joined emoji. Preserve whitespace, punctuation and redacted text.
* Render the same character highlights in live, standalone and re-exported reports, including earlier reports with captured effective text.
* Bound character alignment work and retain complete line-level replacements when the calculation or browser capability limit is reached.

## 0.3.42 — 2026-11-16

* Preserve the selected target when an unchanged, redacted path is submitted with Inspect or Enter. Retain its starting directory, instruction chain and original whitespace or alias spelling.
* Keep the selected Codex profile through Apply, Enter, refresh, target inspection, reload and browser history when its displayed name is redacted. Clearing the field still selects the base configuration.
* Record an explicit trust assumption in optional inputs.trust metadata. Preserve its generated enum when private text contains auto, trusted or untrusted, and restore the matching browser control and visible offline scan-scope details.
* Restore server-configured defaults for omitted target, starting-directory, profile and trust URL parameters. Invalid profile names receive the server's validation message and retain the last successful export.
* Keep original request selections outside standalone HTML captures. Exported target/profile values and private source text retain their redaction, including after offline re-export.
* Match Gemini 0.68.0 context-root deduplication by filesystem device and inode values. Shared identities retain the first loaded path and mark later context paths as ignored.
* Rerun affected live scans with 0.3.42. Earlier exports retain their captured target, profile and trust assumptions.

## 0.3.41 — 2026-11-16

* Choose the agent starting directory independently of the inspected target with --session-dir and the local scan-scope controls.
* Retain the selected directory through target changes, refresh, browser history, standalone export and offline re-export. Restore automatic target-directory selection from the same dialog.
* Match native Codex startup instructions and Copilot rule/MCP discovery with a fixed nested target. Model Claude descendant instruction loading, startup/on-demand rule order and sibling-target exclusion using native scripted requests.
* Resolve relative configuration-home overrides from the modeled native working directory and use client defaults for empty values. Select the custom Claude state file under CLAUDE_CONFIG_DIR.
* Preserve input field names when private configuration values coincide with those names. Keep live request paths available when displayed diagnostic paths are redacted.

## 0.3.40 — 2026-11-16

* Conceal private numeric and TOML date/time values when copied into instructions, comparisons and report text.
* Capture bare TOML scalar spellings, including numeric separators, scientific notation, non-decimal numbers and recoverable malformed assignments. Conceal complete escaped spellings even when they contain the decoded value.
* Mask typed values in flattened sensitive settings, including numeric passwords and Boolean credentials.
* Quote matching scalar redaction placeholders in source previews and retain original source lines.
* Rescan and replace reports exported with 0.3.39 or earlier when private scalar values were copied into instructions or sensitive fields contained typed values. Previously exported JSON and HTML retain their captured content.

## 0.3.39 — 2026-11-16

* Conceal environment and header values under capitalization variants of `env`, `headers` and `http_headers`, including misspelled fields such as `Env`.
* Apply the same privacy recognition to parsed source ranges, copied instruction text, structured report payloads and recoverable malformed TOML. Preserve original key spelling, schema errors and case-sensitive field warnings.
* Rescan and replace reports exported with 0.3.38 or earlier when configurations contain these capitalization variants. Previously exported JSON and HTML retain their captured content.

## 0.3.38 — 2026-11-16

* Align two clients’ redacted effective instruction texts line by line, with original effective-text line numbers, addition/removal markers and optional unchanged context.
* Select and swap the comparison pair within the selected clients, inspect their source chains and retain the pair, context and expanded lines through reload, browser history, refresh and offline export.
* Compare repeated lines, whitespace, Unicode, CRLF and final-newline differences, including older reports and empty instruction text.
* Compute line alignment asynchronously, discard stale results and paginate long comparisons. A calculation reaching its time budget shows complete text replacements.
* Bundle JsDiff 9.0.0 and include its BSD 3-Clause notice in every standalone HTML report.

## 0.3.37 — 2026-11-15

* Retain comparison client selections, content filters, Differences only and expanded paragraphs in reloadable browser links.
* Restore the inspected comparison through browser history, live refresh, standalone export and offline re-export.
* Honor a single selected client and recover unavailable clients or invalid filter values to supported defaults.
* Keep keyboard focus on the client selector after changing its selection.

## 0.3.36 — 2026-11-15

* Include structured files used as instructions in the client coverage matrix, with configuration roles for other clients reading the same source.
* Compare every instruction contribution when filtering differences, including later repeated loads and mixed loading states.
* Inspect grouped contributions at their exact source occurrence and line, with loading reasons and keyboard focus in live and portable reports.
* Share unique-source counting between overview cards and effective instruction comparisons, including repeated Gemini context segments.
* Wrap long source paths in comparison rows and contribution details, with touch-sized source actions and an explicit empty-instruction state.
* Inspect every active or conditional extension definition and preserve status differences across clients.
* Retain complete extension names containing separator characters, including shell-pipeline permission rules.

## 0.3.35 — 2026-11-15

* Show loaded instruction sources, effective bytes, conditional sources and truncation in the first terminal summary.
* Count distinct instruction sources across repeated imports and source segments, preserving their identities after private path redaction and their zero-budget truncation counts.
* Surface conditional loading near the browser overview heading with a source count and a direct source-inspection action.
* Retain the selected repeated occurrence, source focus and portable navigation when inspecting conditional loading. Refresh instruction counts after changing inspection trust.
* Label client detection for installed executables and discovered configuration. Use the detected client in the terminal's next inspection command.

## 0.3.34 — 2026-11-15

* Withhold raw private-state previews through captured canonical directory aliases.
* Conceal unrelated Gemini trust entries in alias settings, parser diagnostics, imported instructions and client comparisons, including escaped source spellings.
* Scope private trust values to their source and captured aliases. Keep the selected workspace rule's provenance and unrelated client configuration readable.
* Verify live source views, trust refresh, portable offline reports and installed CLI output through private-state aliases.
* Rescan and re-export reports created with 0.3.32 or 0.3.33 when a saved Gemini trust file was also discovered through a configuration alias or imported as context. Previously exported files retain their captured content.

## 0.3.33 — 2026-11-15

* Resolve relative GEMINI_CLI_HOME values from the modeled session's native working directory, including nested targets and configuration homes inside or outside the repository.
* Use the OS home when GEMINI_CLI_HOME is empty. Explicit inspection homes select their configured location.
* Compare resolved instruction text and settings with the published Gemini startup modules and the ordinary CLI entry point.
* Verify target changes, refresh, copied effective text, private portable reports and offline installation for relative configuration homes.

## 0.3.32 — 2026-11-15

* Resolve Gemini persisted workspace trust, parent inheritance and canonical aliases using executable comparisons with the published 0.68.0 startup modules.
* Keep current global context before approval, mark trusted project contributions as conditional and exclude project configuration after saved rejection.
* Honor Gemini trust environment overrides, custom configuration homes, custom trust-file paths and sandbox-exec trust storage. Explicit inspection assumptions and repository-only scans retain their scope.
* Match native JSON comments, trailing-comma rejection and last duplicate values. Invalid applicable settings or trust entries block effective startup contributions.
* Retain GEMINI.md alongside trimmed custom context filenames. Project MCP definitions replace complete user entries.
* Conceal unrelated saved folder entries and raw trust-state previews, with source-line provenance and portable path replacements for the selected rule.
* Verify desktop/phone refresh, clipboard content and offline reports through pending, approved and rejected states. Keep the homepage client-strip wording spaced on phone layouts.

## 0.3.31 — 2026-11-15

* Resolve Gemini context imports with its published 0.68.0 tree and flat processing rules, including nested and repeated references, cycles, code spans, path validation and native context delimiters.
* Apply native memory boundary markers when selecting project context and resolving imports. Retain the five-level tree boundary and longer flat chains.
* Keep literal source segments in their loading order with original line and column positions. Preserve imported configuration files as context text and apply their structural diagnostics to their configuration consumers.
* Redact private fields in imported JSON, TOML, YAML and Markdown frontmatter, including scalar values, escaped strings and aliases. Retain raw paragraph membership before redacting source segments and effective text.
* Mark imports outside the inspection boundary or source-reading budget as incomplete, with a diagnostic at the declaring reference.
* Verify source inspection, effective-text copying, refresh, desktop/phone views, portable exports and installed CLI behavior for both Gemini formats.
* Preserve the selected client and source when opening the website demo, retain keyboard focus and tab navigation, and provide manual command copying when clipboard access fails.

## 0.3.30 — 2026-11-15

* Discover Claude local MCP servers using the native saved project identity, including logical/canonical paths, nested and non-Git sessions, wider scan boundaries and linked worktrees.
* Share project identity with external-import approval and preserve the selected identity throughout a scan. Match separate Git directories for linked-worktree MCP and import-approval keys.
* Mark lower-scope user and project definitions as shadowed when a valid local server replaces them, including pending project candidates. Retain fallback after invalid local declarations.
* Capture separate project-state paths for portable reports, retaining MCP field definitions and source lines while concealing the original checkout path.
* Include extension loading reasons in terminal explanations and client comparisons.
* Keep the detail dialog’s close control visible while inspecting long configurations, and open each new detail at its heading.
* Verify native local-scope registration, explicit probes, desktop/phone refresh, copied definitions and private-state handling in offline reports.

## 0.3.29 — 2026-11-15

* Match Claude Code instruction order across personal rules, shared project files, per-directory rules, local files and AGENTS modes.
* Expand imports in rules files and load matching path-scoped rule bodies after startup instructions. Empty path lists load unconditionally.
* Keep scoped-rule imports in startup discovery, including imports from unmatched rules and imports with their own path metadata.
* Read saved external-import approval from the native Git project state or the session directory for non-Git folders. Match Windows logical paths with forward slashes, canonical linked worktrees’ shared main-project entry and Windows short-path launches’ own entry. Pending approval stays conditional, and saved rejection skips the import.
* Preserve the distinct project/server trust and external-import approval controls through refresh, copying and portable reports.
* Clarify conditional byte counts and loading positions in the inspector and portable reports.
* Verify ordered instruction markers and canonical source files with thirty-one isolated native Claude Code 2.1.322 scenarios.
* Preserve file/line approval provenance while concealing the main checkout path embedded in private state keys in exported worktree reports.
* Keep external-import approval conditional when required Git metadata cannot be inspected, with a targeted diagnostic.

v0.3.28 remained an unpublished candidate after Windows verification exposed native path-namespace differences.

## 0.3.27 — 2026-11-15

* Match Codex 0.167.2 Unicode whitespace handling when selecting global instructions and spending project byte budgets.
* Preserve byte-order marks and handle U+0085 NEXT LINE consistently with the native client.
* Compare exact global/project instruction bodies and byte counts with twenty-one isolated native Codex 0.167.2 requests.
* Verify override and fallback selection, literal Markdown imports, newline preservation, empty fragments, whitespace budgets and split UTF-8.
* Exercise explicit untrusted projects, custom/disabled root markers and selected profile budget/fallback replacements.
* Publish the verified instruction coverage in adapter scope details, documentation and the website.

## 0.3.26 — 2026-11-15

* Show refreshed error and warning counts across inspector views, including phone layouts.
* Link incomplete-discovery outcomes to scan scope and actionable outcomes to filtered findings.
* Retain source-line visibility as the feedback header appears. Clear the feedback while a new scan is pending or after a failed refresh.
* Verify live error correction, unchanged refreshes, partial discovery, keyboard navigation and portable snapshots.

## 0.3.25 — 2026-11-15

* Discover Codex Skill metadata through directory links in documented user and project roots. Match regular SKILL.md files, hidden-directory rules and the pinned client’s six-level discovery depth.
* Deduplicate canonical Skill aliases and resolve disabled Skill paths through their declaring configuration file. Preserve the logical installation paths in source explanations.
* Apply matching-file and traversal budgets during linked metadata discovery. Mark loading decisions as unverified when a root has incomplete discovery. Record captured canonical source identities for portable path replacement.
* Preserve the selected loading decision when portable path replacements identify multiple aliases as the same source, including offline re-export. Normalize Windows path separators when identifying occurrences and restoring source links.
* Compare linked Skill names, canonical files, enabled states and user/project scopes with Codex 0.167.2’s native skills/list API. Keep Windows user fixtures under their isolated CODEX_HOME. Verify live and portable inspection of disabled metadata and alias decisions.

v0.3.23 and v0.3.24 remained unpublished candidates. Windows validation exposed a user-home fixture-isolation difference and a mixed-separator source-selection regression in portable reports.

## 0.3.22 — 2026-11-14

* Open exported HTML reports at the selected view and source location, including the client, repeated import occurrence, highlighted line and effective-text mode.
* Derive saved source locations from the portable capture so personal and external configuration paths retain their existing replacements.
* Update the saved location when re-exporting an offline report. Explicit browser links select their requested destination when opening a snapshot.
* Preserve the displayed inspection through pending and failed refreshes, with source locations paired to the same captured report.
* Verify desktop and phone exports, linked-line reload, offline re-export, user-path replacement and each inspector view.

## 0.3.21 — 2026-11-14

* Search captured source paths and import origins together. Space-separated terms all match, with case, surrounding whitespace and Windows slash spellings normalized.
* Find individual decisions for repeated imports by their declaring path and line, including parent paths retained in earlier portable reports.
* Explain matches hidden by In scope and provide Show all discovered. Empty searches provide Clear search. Both actions restore keyboard focus to their destination, and accessible result counts follow the visible list.
* Preserve matching provenance queries through browser history. Target-changing history checks the refreshed report before deciding whether the restored decision matches.
* Verify live and offline searches at desktop and phone sizes, repeated-import selection, legacy captures, keyboard recovery and empty repositories.

## 0.3.20 — 2026-11-14

* Restore linked source-line visibility after browser document loading restores its saved scroll position. A public v0.3.19 installation reproduced a marked line below the viewport after keyboard traversal reached Copy source content and the page was reloaded.
* Reuse the current rendered highlight for source jumps and the fresh-page display lifecycle. The callback follows the latest source selection and view.
* Verify reload after source-list traversal in live and portable inspections at desktop and phone sizes, alongside source focus and history navigation.

## 0.3.19 — 2026-11-14

* Focus the destination heading when opening a view. Source inspection focuses a semantic filename heading with its loading status available as an accessible description.
* Give source lists one Tab entry. Shift+Tab from the filename returns to the source list. Arrow keys move through sources, Home/End reach its boundaries, and Enter selects the focused decision.
* Provide a keyboard entry for filtered results when the selected source is excluded. With no matching sources, Tab continues to source controls.
* Keep closed mobile navigation outside the keyboard sequence. Open navigation contains focus, marks the workspace inert and provides a close button. Escape returns focus to the menu toggle.
* Close mobile navigation before opening scan scope, keyboard help or target search. Restore a visible navigation focus when crossing the desktop/mobile breakpoint.
* Verify keyboard inspection, filtered lists, modal navigation and native dialog focus in live and portable reports, including desktop and phone layouts.

## 0.3.18 — 2026-11-14

* Open effective-text origins and instruction coverage links through the existing source-inspection path. Stale source searches clear and each destination appears in the source list.
* Retain exact loading occurrences when following effective-text origins, including separate contributions in earlier reports.
* Start client inspections and the discovered-source overview with a clear source search. This applies to sidebar clients, overview cards and comparison instruction chains.
* Clear a source search that excludes the destination when using browser Back/Forward. Matching searches remain available, and source-row selection and local refresh retain search text.
* Verify filtered navigation, loaded and ignored coverage states, repeated imports and client entry points in live and offline reports at desktop and phone sizes.

## 0.3.17 — 2026-11-14

* Reveal the selected source within long lists after deep links, source jumps, reload, browser history and local refresh.
* Keep the source heading, search and filters above an independently scrolling list on desktop. Recalculate the selected row's visibility after layout and viewport changes.
* Keep list scrolling within its own panel and retain the source-line reading position. Editing a source search retains keyboard focus.
* Expose each source button's selected state to assistive technology, including separate decisions for repeated imports.
* Verify long live and portable source lists at desktop, phone and landscape sizes, with keyboard selection, source-line jumps, resizing and search.

## 0.3.16 — 2026-11-14

* Select individual loading decisions when the same physical file appears more than once. Each row displays its own status, byte contribution, reason and captured import origin.
* Retain the selected occurrence through reload, browser history, local refresh and portable reports. File-only links select the first decision, and invalid occurrence selectors recover to that decision.
* Show import origins in the source list, including phone layouts. Follow a captured parent to its declaring import line from the explanation panel.
* Keep keyboard focus on the selected source after activation so arrow-key and Enter navigation can continue.
* Verify repeated-import branches, removed references, cross-client navigation and effective-text contribution links in live and offline inspections.

## 0.3.15 — 2026-11-14

* Keep navigation, export, local inspection controls and scan errors in a persistent header while reading long sources.
* Measure the header as controls wrap and errors appear. Source jumps reserve its current height so the selected line stays below the controls.
* Keep the source filename visible and retain source and explanation panels alongside long code on wide desktop layouts. Long paths use a bounded filename bar with their complete text available on hover and in source details.
* Allow the sidebar to scroll on short screens. Coarse-pointer navigation and inspection controls have larger touch targets, with 16-pixel target/profile inputs.
* Open newly selected views at their heading and filters. Browser Back/Forward retains the previous reading position and source-line selection.
* Clear the filename, status and parsed settings after the final source is removed and the scan is refreshed.
* Verify long-source navigation, target selection, failed-scan feedback and sidebar access at phone, narrow-phone and landscape sizes.

## 0.3.14 — 2026-11-14

* Bring the highlighted source line into view when following findings, settings, extension definitions or comparison origins. Long configuration files now open at the requested line.
* Include one-based line numbers in source links. Restore the same line after reload, refresh and browser Back/Forward in the local inspector and portable reports.
* Clear line selection when opening a different source, and handle unavailable sources and invalid line numbers without highlighting an unrelated location.
* Put one-command repository inspection first on the website, guide and README, with larger mobile copy targets and expandable global-install instructions.

## 0.3.13 — 2026-11-14

* Resolve copied Windows environment keys case-insensitively for executable lookup, MCP references and missing-variable checks. PATH/PATHEXT selection follows Node subprocess key ordering, correcting false command-missing findings when the inherited environment uses Path.
* Correct persisted Copilot trust matching by resolving existing absolute folder paths before comparing canonical directory boundaries. Saved aliases can establish trust, and a session reached through a symlink outside a trusted logical parent retains conditional workspace contributions.
* Normalize trustedFolders and trusted_folders in declaration order. The last spelling supplies the complete list, including an empty list or malformed value.
* Require a complete string list and ignore relative/tilde entries for persisted path matching. Add copilot.trust-type with the controlling source key and line for malformed declarations.
* Apply explicit trust overrides and repository-only resolution. Withhold previews of private state, cover trust-dependent project settings and skip explicit workspace MCP probes while trust is unresolved.
* Compare 27 isolated native trust scenarios and exercise CLI correction, live/offline browser states, portable privacy and installed-package behavior.

## 0.3.11 — 2026-11-14

* Fix a personal-state preview disclosure verified in v0.3.10. When the inspection root contained the active Copilot configuration directory, JSON and HTML previews could include internal config.json state. Review affected reports before sharing them.
* Apply explicit user/system discovery metadata to cached sources and reparse with the correct file-format rules. Remove obsolete parse findings while preserving one source identity.
* Retain Copilot personal JSONC, setting aliases, persisted trust and MCP definitions when personal files are also discovered inside the repository tree. Canonical state paths withhold raw previews during repository-only scans as well.
* Exclude personal configuration from user-disabled resolution across adapters. Shared Copilot repository settings retain their project validation and trust contract beside an overlapping personal source.
* Add native Codex, Claude and Copilot comparisons, wider-boundary and custom-root fixtures, installed-package checks and live/offline browser coverage.

## 0.3.10 — 2026-11-14

* Fix copied-value redaction after a whole-file TOML parse failure. v0.3.9 could expose an environment value from malformed TOML when it was repeated in loaded instruction text. Review affected reports before sharing them.
* Recover readable private TOML assignments for redaction, including escaped and multiline values, duplicate definitions and readable strings in unfinished private arrays or inline tables. Invalid configuration remains withheld and retains its original syntax finding.
* Scope syntax, field-name, capability and glob diagnostics to each selected client's target discovery decisions.
* Track discovered files and their invalid flags alongside outside-target explanations. Target and project-boundary changes recompute the relevant findings.
* Scope filename-placement warnings to configuration namespaces on the target directory chain.
* Add native Codex, Claude and Copilot comparisons for malformed sibling projects, plus CI, installed-package and portable browser coverage.

## 0.3.9 — 2026-11-14

* Parse Copilot personal config.json and mcp-config.json as JSONC, including comments and trailing commas. Restore persisted workspace trust and personal MCP definitions from those files.
* Resolve JSON format rules by Copilot file scope and retain original field locations in personal MCP source previews.
* Cover native file-loading differences, CI admission, escaped-value redaction, portable reports and installed-package behavior.

## 0.3.8 — 2026-11-14

* Discover Claude's exclusive managed-mcp.json and servers provided through managedMcpServers. Preserve whole-entry replacement and managed-file priority.
* Apply MCP allowlists, denylists and managed-only allowlist controls with command, name and URL matching. Account for default ports, wildcards, path/query matching and pinned policy environments.
* Explain blocked servers with their original policy keys and source lines. Retain field origins, skip blocked startup checks/probes and support policy navigation in live and portable browser reports.
* Recover managed MCP list entries without shifting source locations. Validate provided HTTPS servers and retain valid fallback definitions.
* Match native fail-closed behavior for null managed allowlists and malformed, empty or unreadable exclusive MCP paths.

## 0.3.7 — 2026-11-14

* Correct source keys and line numbers for valid Claude managed permission rules following rejected entries. v0.3.6 could attribute a surviving rule to an earlier array position.
* Preserve original permission origins through masking findings, built CLI output and portable reports while retaining dense effective rule arrays.
* Mark unreadable managed permission lists as invalid and retain applicable lower-scope lists in the effective settings view.
* Stop Codex native test process groups after wrapper exit, retry temporary-home removal and allow 30 seconds for the initial Copilot test connection.

## 0.3.6 — 2026-11-14

* Discover Claude's optional managed-settings.d JSON files in alphabetical order after the base system policy.
* Apply managed-only permission and hook controls. Surface excluded declarations in scan findings and link their controlling policy source. Skill discovery retains eligibility while managed permission policy removes personal/project allowed-tools grants.
* Resolve disableAllHooks across settings layers and preserve managed hooks under ordinary-scope disabling. Reject ordinary settings layers with an invalid Boolean hook switch.
* Handle supported managed Boolean repairs, per-entry permission lists, grants withheld beside an unreadable restriction, empty policy files and startup blocking from malformed managed JSON objects.
* Add isolated native Linux policy checks through the real system directory and built CLI, plus local/offline browser source navigation and installed-package hook checks.

## 0.3.5 — 2026-11-13

* Fix a v0.3.4 privacy regression in paragraph comparison. Multi-line captured values and private-key blocks could become visible after paragraph splitting or CRLF normalization. Review affected v0.3.4 reports before sharing them and use v0.3.5 for new reports.
* Match captured private values across LF, CRLF and mixed line endings in logical longest-match order.
* Preserve whole-contribution redaction context while grouping raw paragraph membership. Paragraphs intersecting a cross-paragraph private value are masked across their receiving group, with source locations and order retained.
* Cover multi-line values, overlapping private values, key blocks, public JSON/terminal/HTML, live and portable browsers, and installed-package output.

## 0.3.4 — 2026-11-13

* Compare exact instruction paragraphs across different source files, retaining each receiving client, repeated occurrence, loading order and original line range.
* Keep fenced code blocks intact and normalize CRLF for comparison. Loaded prefixes participate according to their actual content. Client-specific trust and loading decisions determine eligibility.
* Add paragraph filters and clickable client-specific origins to the inspector and portable reports. Initially render up to 100 matching paragraphs, with an action to reveal more.
* Preserve whole-source JSON groups and older report rendering. Build membership before privacy redaction, with explicit source-start navigation when transformed content has no proven contiguous source range.
* Allow 30 seconds for the two isolated Copilot inventory startups that exceeded their former 15-second bound on Windows.

## 0.3.3 — 2026-11-13

* Resolve proven permission masking in deny → ask → allow order. Recognize Bash(*) as tool-wide and retain every matching highest-priority source.
* Link shadowed permission entries to their overriding rules in terminal explanations, the local inspector and offline HTML reports.
* Keep shared Claude project grants conditional under unknown workspace trust and excluded under explicit untrusted state. Retain local grants as conditional when native Git/session checks are outside the inspection, while applying restrictions independently.
* Preserve the EndConversation permission exception and generated permission actions during private-value redaction.
* Drive the pinned Claude CLI through nineteen isolated permission scenarios with a local scripted Messages API, alongside CLI correction, browser navigation and installed-package checks.

## 0.3.2 — 2026-11-13

* Apply Copilot ignoredSkillsLocations before skill-name precedence, including home-relative paths and registered personal-setting aliases. Retain excluded sources with their reason while allowing the next eligible same-name skill to contribute.
* Link excluded skills to the contributing setting's original source key and line in the inspector and portable HTML reports.
* Validate this personal setting through the native file-loading and alias-fallback contract. Repository-only scans retain their independent skill selection.
* Compare twenty-four discovery/priority scenarios and four additional value types with the pinned Copilot CLI. Exercise installed-package behavior, source navigation and portable path privacy.

## 0.3.1 — 2026-11-13

* Cancel obsolete inspector scans when their browser connection closes. Apply cancellation to the initial page, refreshed scans, exported reports and sample workspace while retaining caller cancellation.
* Pass scan cancellation into configuration file reads and honor it through final portable-path mapping. Closed responses skip error delivery.
* Extend the existing benchmark with a configuration-heavy fixture of nested instructions, path rules and an optional skill count. Validate complete discovery and effective inputs before reporting timings.

## 0.3.0 — 2026-11-13

* Introduce a Three.js configuration-layer opening with layered contours, moving light, film grain and pointer parallax. Client selection updates the real example result and its lighting.
* Add explicit motion controls, reduced-motion support, offscreen/blur/hidden-page pausing and a captured static poster for unavailable or lost WebGL contexts.
* Replace letter avatars with six sourced client marks across the website, local inspector, comparisons and findings. Share the same assets with self-contained offline reports.
* Preserve source geometry and colors, embed upstream notices in single-file reports, and record each asset's provenance. Codex uses the community-maintained Lobe Icons asset.
* Use Instrument Sans and a cool blue palette, sourced Solar utility icons, GSAP choreography and Lenis scrolling. Load the shader scene separately and remove it under reduced motion.
* Give each of the nine accessibility routes its own test timeout.
* Keep the real example, download and guide paths connected to the new opening. Include website JavaScript in lint checks.

## 0.2.13 — 2026-11-13

* Resolve registered Copilot personal-setting aliases, including nested schema fields and legacy theme names. Preserve dynamic mapping names and repository key semantics.
* Retain canonical effective keys together with the actual declared key, source line and replaced alias history. Search settings by current or earlier spellings. Diagnose unknown personal keys and repeated spellings.
* Reproduce native personal-document rejection, optional-value omission and alias-normalization fallback for validated fields. Keep repository layers independently applicable.
* Use declared source keys when redacting flattened private mapping values, including numeric values below aliased settings.
* Verify registered aliases, personal file loading and both disabled-server spellings with pinned Copilot 1.0.110. Cover CLI correction, browser source navigation and portable exports.
* Update the public website's Copilot support version and native-verification scope.

## 0.2.12 — 2026-11-13

* Resolve Copilot repository and local JSONC settings with per-key merge policies, precise origins, replaced values and trusted model overrides.
* Apply disabled MCP/skill/hook settings before executable checks and explicit probes. Read current and legacy persisted folder-trust keys.
* Read Copilot's shared subset of Claude repository settings and root/current-directory Claude rules. Preserve Claude's strict JSON behavior for those shared files.
* Show unresolved same-scope setting conflicts and additional customization directories explicitly, including incomplete discovery coverage.
* Inspect inline Copilot hooks, direct executables, command fallbacks, HTTP hooks and prompt hooks requiring a fresh interactive session. Anchor hook working directories to the inspected repository.
* Compare settings folds, value validation, workspace MCP admission and shared-rule discovery with the pinned Copilot 1.0.110 CLI. Keep all three native client dependency trees outside production packages.
* Show the selected hook command in browser summaries and label earlier setting definitions across replacements and collection merges.

## 0.2.11 — 2026-11-13

* Keep inspector controls disabled while the report initializes, with loading feedback for streamed pages. Enable them after event handlers are installed.
* Keep source-copy actions unavailable when no source is selected, and retain snapshot read-only targets and unavailable-copy states.
* Reproduce delayed-script loading in live and portable reports, including the first navigation action after initialization.

## 0.2.10 — 2026-11-13

* Validate Claude MCP transport declarations, including HTTP aliases, explicit remote types and file-based SDK rejection. Keep empty remote endpoints awaiting configuration.
* Respect Claude's transport-specific fields in executable checks, environment references, cross-client drift and explicit stdio probes. Explain ignored working-directory and transport fields at their source lines.
* Require explicit workspace trust before repository MCP approval settings contribute. Honor user/managed approvals and explicit rejections, and diagnose malformed approval settings.
* Preserve lower-priority Claude servers when a higher-priority definition fails structural validation.
* Mark ignored fields in extension details and display the selected remote endpoint in the browser list and comparison view.
* Add pinned Claude 2.1.322 native MCP conformance checks alongside CLI correction/refresh flows and installed-package coverage. Native client binaries stay in development dependencies.

## 0.2.9 — 2026-11-13

* Track MCP field origins through nested Codex configuration merges, including inherited environment maps and replaced arrays. Show each field's file and line in terminal explanations and extension details.
* Merge conditional project MCP layers over the user baseline, retaining the final possible configuration when workspace trust is unknown.
* Locate command, working-directory, environment, argument-type and cross-client drift findings at the contributing fields. Link repeated missing-variable references and probe directory findings to their source locations.
* Replace repository paths embedded in Claude project-local MCP source keys during portable export. Preserve neighboring project keys and reports created before field-origin metadata existed.
* Compare merged MCP values and private mapping origins with the pinned Codex configuration API, alongside CLI, browser and installed-package regressions.

## 0.2.8 — 2026-11-13

* Redact parsed JSON/JSONC, TOML and YAML/frontmatter values before building source previews, including escaped quotes, Unicode escapes, folded blocks and aliases.
* Preserve source line endings and line counts when masking multiline values, labelled credentials and private-key blocks. Redacted values use quoted placeholders with line padding.
* Mask non-string environment/header values and flattened private mapping settings using their parsed source key paths. Literal dotted keys and hook-state identifiers retain their public values.
* Capture private values from earlier duplicate definitions and credential-key aliases, including passwd and private_key. Redact literal defaults inside private environment references.
* Reuse a literal matcher per scan and match longer captured values first. Parser value ranges remain internal to the scanner.
* Verify encoded previews, source navigation and portable exports through CLI, browser and installed-package workflows.

## 0.2.7 — 2026-11-13

* Resolve Codex Windows commandWindows and TOML command_windows overrides through the same field selection used by executable checks and source navigation. Validate override types and duplicate aliases.
* Align Codex event names and handler types with the pinned schema. Recognize model-request events and MCP tool handlers, and mark parsed prompt/agent handlers as skipped.
* Check Codex commands from the session directory and explain ignored cwd, env and args fields. Retain Copilot's configured hook working-directory and environment behavior.
* Track nested TOML array-table indices and skip header-like content inside multiline strings, arrays and comments when mapping source lines.
* Extend native Codex configuration comparisons to twenty scenarios, including Windows aliases and hook handlers, alongside CLI, browser and installed-package regressions.

## 0.2.6 — 2026-11-13

* Preserve engine-generated report fields, client identifiers, statuses, rule IDs, source links and version metadata when private environment values match those strings.
* Apply captured private values to configuration payloads, source text, paths and diagnostic prose. Renderers continue to redact caller-modified reports before export.
* Omit syntax-invalid source previews because parser recovery can discard private values, including earlier duplicate definitions. Retain precise findings and source-loading decisions, with an inspector prompt to correct the syntax and rescan.
* Verify these cases through the scan API, CLI CI thresholds, live/offline browser navigation and the installed package.

## 0.2.5 — 2026-11-13

* Scope parser, field, glob and MCP-shape diagnostics to the selected client owners. Retain source previews and loading decisions across discovered clients.
* Read Codex hooks.state as persisted review settings and apply the final merged features.hooks value to inline and standalone hooks. Identify dual-source definitions from actual inline handlers.
* Extend real Codex configuration comparisons with review-state values and user/project hook-feature precedence in both directions.
* Open related finding locations in their owning client's source view with exact line highlighting. Filesystem findings retain copyable locations, and source inspection follows available source decisions.
* Decode quoted TOML key paths for source-line provenance and replace filesystem paths inside portable hook-review keys.
* Use Copy source path for local and portable source locations.

## 0.2.4 — 2026-11-13

* Capture logical/canonical repository and home paths, plus filesystem-verified aliases found in structured configuration, for portable report export.
* Replace verified aliases in MCP paths, command arguments, source previews and flattened project-setting keys. Handle JSON-escaped Windows paths, mixed separators, drive-letter case and custom user configuration directories.
* Keep captured path context through JSON round trips and successful browser inspections. Portable HTML discards that context after replacing paths, so exported reports retain the inspected snapshot when files or aliases change later.
* Preserve neighboring repository names and HTTP URLs when replacing paths. Keep support for reports created before path metadata was available.

## 0.2.3 — 2026-11-13

* Compare effective base/project scalar and MCP configuration, including winning files, against the real Codex 0.167.2 configuration API in fifteen isolated scenarios.
* Bound Codex project settings and standalone hooks to the selected project root. Marker-free sessions use their current directory.
* Resolve automatic trust from the selected root's canonical key, followed by its logical-path key. Nested repositories and custom roots keep their own trust decisions.
* Keep the bundled sample's Codex byte limit and MCP configuration active in Git-free installations. Package smoke checks the sample's exact byte limit and excludes development tools, including Codex binaries.

## 0.2.2 — 2026-11-13

* Diagnose malformed MCP, hook and permission collections while retaining valid sibling definitions.
* Validate extension field types before filesystem checks and explicit probes, including malformed PATH values and working directories.
* Expand MCP environment references before endpoint and executable checks, preserving independent diagnostics when another variable is missing.
* Keep private string values redacted inside malformed environment and header containers.
* Locate extension errors and permission precedence findings at their individual JSON fields or array entries.
* Resolve Claude exec-form hooks as literal executables, distinguish documented client fields and retain MCP-tool hook metadata. Use configured Copilot hook environments for executable checks.

## 0.2.1 — 2026-11-13

* Find the nearest Git root for implicit scans launched from subdirectories, retaining working-directory-relative targets and inherited project configuration.
* Recognize worktree marker files and nearest nested repositories, with explicit repository selection controlling the inspection boundary.
* Retain the inspector’s filesystem boundary through target changes and reloads, including when configuration values cause report paths to be redacted.
* Verify the nested-directory entry point in the installed-package smoke test.

## 0.2.0 — 2026-11-13

* Add configurable repository-entry and user configuration file budgets with `--max-entries` and `--max-user-files`.
* Report accurate entry counts and incomplete discovery across JSON, terminal, browser refreshes and portable exports, including severity-filtered reports.
* Discover deeply nested repository instructions and personal rules, and keep user discovery independent of the repository source count.
* Apply user file limits within flat directories and surface inaccessible discovery locations.
* Bundle the production dependency tree and its license files, and verify installation offline with an empty npm cache.

## 0.1.4 — 2026-11-13

* Export the most recent successful browser inspection, preserving its configuration content across disk edits and pending or failed refreshes.
* Prepare portable HTML together with the displayed scan so exported reports retain the same target, trust, profile and redacted sources.
* Replace repository paths correctly in portable reports on Windows and in directories containing JSON-escaped characters.
* Route tag verification through the release workflow to avoid duplicate full platform matrices.

## 0.1.3 — 2026-11-12

* Preserve separate source locations when the terminal groups repeated client findings, show severity totals and disclose the summary limit.
* Include related source locations and columns in terminal findings, label experimental clients and guide empty scans to the bundled demo.
* Explain JSON syntax errors in readable language with accurate columns and prevent incomplete JSON values from producing unrelated YAML errors.
* Include source columns in diagnostic IDs so JSON reports and the browser preserve separate same-line errors, and copy full line/column locations from the inspector.

## 0.1.2 — 2026-11-12

* Inspect explicit Codex profile files with `--profile`, including user-to-profile-to-project precedence and replaced source locations.
* Select and clear Codex profiles in the local inspector, preserving the selection on reload and in exported reports.
* Diagnose retired legacy profile selectors/tables and unavailable profile files.
* Preserve user-level provider and routing settings when Codex ignores corresponding project-local definitions.

## 0.1.1 — 2026-11-12

* Search repository targets by filename, path or fuzzy query, including results beyond the initial suggestion limit, with keyboard and touch selection.
* Show failed scan status when target inspection fails.
* Make the manual clipboard fallback keyboard-accessible when browser clipboard access is unavailable.
* Wait for MCP probe processes to exit before returning, terminate ordinary runtime-wrapper children, and bound shutdown for servers that ignore SIGTERM.
* Support Windows command shims with literal argument handling during explicit probes.
* Clean up active probes when a CLI scan is interrupted, with standard SIGINT and SIGTERM exit codes.
* Read the product version from the package manifest across CLI output, reports, the inspector and MCP initialization.
* Preserve historical website package downloads through verified GitHub release assets.

## 0.1.0 — 2026-11-12

Product experience update

* Added a one-command browser demo and first-run guidance for unconfigured repositories.
* Added exact effective-instruction reading, side-by-side client text comparison and a searchable resolved-settings browser with replaced-layer provenance.
* Preserved inspected targets and trust across reloads, enabled browser navigation history and corrected stale startup reports on page reload.
* Excluded ordinary application settings and Cargo configuration from agent discovery, kept subproject configuration outside the selected target informational, and preserved ignored status for malformed sources that a client never loads.
* Rebuilt the browser inspector with a persistent workspace sidebar, grouped issue overview, finding-to-source navigation and redacted source previews with line numbers.
* Added target-path suggestions, keyboard shortcuts, trust modeling, source filters, loading coverage comparison, extension details and responsive navigation.
* Added a complete product website, installation guide, live example report, interactive client demo and downloadable CLI package.
* Added browser regression coverage for the new flows and automated WCAG AA checks across the website, guide and core inspector views.

First local distribution candidate.

* File-target explanations for Codex 0.167.2, Claude 2.1.322 and Copilot CLI 1.0.109, with dated official-rule evidence and golden fixtures.
* Experimental Gemini CLI, Cursor and OpenCode V2 adapters with explicit partial scope.
* Structured layer provenance, import/glob/override/truncation decisions, extension checks and deterministic findings.
* Terminal, stable JSON and portable standalone HTML; loopback browser inspector with comparison and finding filters.
* CI exit thresholds, opt-in stdio MCP startup probes, package-install smoke tests and OS matrix workflow.

See the release validation record for what was actually executed. Hosted CI and public registry publication are separate release gates.
