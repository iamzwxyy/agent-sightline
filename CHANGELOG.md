# Changelog

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
