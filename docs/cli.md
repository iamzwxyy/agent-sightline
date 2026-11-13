# CLI contract

| Command | Behavior |
| --- | --- |
| `agent-sightline [repository]` / `scan` | Discover and summarize compatible configuration |
| `explain <target>` | Full load decisions, source lines, effective instructions/settings/extensions |
| `diff <target> --clients codex,claude,copilot` | Instruction content recipients and extensions by client |
| `doctor` | Extension validation; `--probe` opts into local stdio startup |
| `ui` | Loopback browser inspector; `--no-open` prints URL |
| `demo --ui` | Open the bundled sample in the browser, excluding personal configuration |
| `report --format html --output report.html` | Portable, self-contained report |
| `ci --fail-on warn` | JSON diagnostics; finding threshold sets exit 1 |
| `adapters --json` | Rule evidence/version/limitations |
| `version` / `--version` | Package version |

Implicit scans select the nearest enclosing Git root while keeping the current directory as the default target and session directory. Relative `explain` and `diff` targets resolve from the current directory. Git worktree `.git` files and nested repositories are recognized. A directory with no Git ancestor uses itself as the inspection boundary. An explicit `--repo` or positional repository selects the boundary and resolves relative targets from that directory. SDK calls with an omitted `ScanOptions.repo` use the same discovery behavior. The browser retains its selected boundary through target changes and reloads.

Common flags: `--repo`, `--client` or `--clients`, `--profile` (Codex), `--no-user`, `--home` (isolated synthetic home), `--trust auto|trusted|untrusted`, `--system`, `--json`, `--format terminal|json|html`, `--severity error|warn|info`, `--fail-on error|warn|info|none`, `--output`.

`--max-entries` sets the repository discovery budget, defaulting to 50,000 filesystem entries. `--max-user-files` sets the matching-file budget for each user instruction, rule, skill or hook root, defaulting to 4,000. Both accept non-negative safe integers. Zero prevents repository-entry processing or matching-file reads for the respective budget. Explicit target-chain files and user settings use their documented direct lookup paths. The file picker shares the repository entry budget.

Reports add optional `discovery` metadata with `complete`, `repositoryEntries`, `repositoryEntryLimit` and `userFileLimit`. Limits and inaccessible locations produce an incomplete-discovery status that survives severity filtering and portable export. The terminal and browser keep that status visible. Use `--severity warn` to inspect the reasons, and `--fail-on warn` when CI should reject partial results.

Syntax, glob and client-field diagnostics follow the selected client owners. MCP-shape diagnostics use the selected clients’ loading decisions. Source previews and loading decisions retain the discovered configuration context across clients. Filesystem discovery findings and completeness describe the inspected repository and documented user locations.

`--severity` filters displayed findings at or above that level. `--fail-on` always evaluates the unfiltered report. CI defaults to `--json --fail-on error`; other commands default to no threshold. Unknown/missing arguments, invalid targets, bad formats and write errors exit 2. Help/version exit 0. Non-interactive output has no ANSI or animations.

The terminal scan summary groups identical diagnostics across clients at the same source location and shows severity totals for the complete grouped list after severity filtering. It displays up to 12 findings and reports the full count when the list continues. Findings at different files, lines, columns or configuration keys stay separate. Each displayed finding includes its source line and column plus related locations. Use `explain` for all client-specific findings or `--json` for machine-readable records. Experimental clients carry an explicit label in the summary. Empty scans include the bundled demo command.

`--profile review` models Codex with `$CODEX_HOME/review.config.toml`. Profile names use letters, numbers, hyphens and underscores. The selected file loads after base user configuration and before applicable project layers. It requires user configuration and Codex among the selected clients. JSON adds optional `inputs.codexProfile`. Omitting the flag loads the base configuration. Legacy `[profiles.*]` definitions and the retired `profile` selector receive migration diagnostics.

SIGINT and SIGTERM interruptions stop active probes before returning exit code 130 or 143 respectively. SDK callers can pass `ScanOptions.signal` to cancel an inspection.

No-argument runs include explicit documented user configuration locations. Use `--no-user` for repository-only CI. Unknown project trust is conditional. `--trust trusted` models a trusted session and, for Claude project MCP, approved servers; it does not change the client’s real trust state.

Claude shared-project permission grants and additionalDirectories entries remain conditional under unknown trust and ignored under explicit untrusted state. Local grants without explicit trusted state remain conditional because native Git/session checks can admit or withhold them. User/system grants and restrictive ask/deny entries have their own applicability. Permission masking checks exact and tool-wide coverage in deny → ask → allow order. Findings and shadowed entries retain every matching source at the highest overriding priority. EndConversation ask rules are ignored, and its deny rules depend on the uncaptured tool inventory.

Reports write only when `--output` is supplied. Output uses a temporary sibling and atomic rename; invalid CLI input does not create partial files. The UI never writes user configuration. The default scan never executes a client, hook, MCP server or skill script.

JSON `schemaVersion: "1.0"` includes tool, repository, target, sessionDirectory, assumptions, sources, clients, findings and diff. A finding has `id`, `ruleId`, `severity`, optional `client`, `message`, `location: {path,line,column,key?}`, `related`, `why` and `suggestion`. Missing/invalid config is a finding, not a crashed scan.

`instructionDiff` is an additive array of exact paragraph groups with `content`, `clients` and `origins`. Each origin has a `client`, `location`, optional `endLine`, and a one-based `order` within that client's loaded paragraph sequence. CRLF normalizes to LF for matching, fenced code blocks remain intact, and wording and indentation remain significant. Membership is computed from proven loaded content before privacy redaction. Repeated occurrences keep separate origins. Conditional and ignored decisions remain available in the client explanations. An omitted `endLine` identifies transformed text whose origin links to the source contribution's start. Whole-source groups remain in `diff`, and terminal rendering supports earlier reports that omit `instructionDiff`.

Captured private values are redacted from configuration payloads, source text, paths and diagnostic prose. Engine-generated client IDs, statuses, rule IDs, source IDs and version metadata retain their stable JSON representation. Exporters apply credential redaction again to caller-modified reports.

Captured multi-line values match LF, CRLF and mixed line endings. Paragraph comparison uses whole-contribution redaction context. A paragraph intersecting a private value spanning multiple paragraphs is displayed as `[REDACTED]` across its receiving group. Membership, source locations and loading order retain their generated metadata. v0.3.5 corrects this handling for reports generated by v0.3.4.

Sources may include an additive `preview` string containing the redacted source file. Internal account/session state and syntax-invalid files omit this preview. Parser recovery can discard environment values or duplicate definitions, so syntax-invalid sources retain their diagnostic locations and loading decisions without raw previews. After correcting their syntax, rescan to view a redacted preview. The inspector uses available previews for line-numbered source navigation. Snapshot reports retain source exploration and comparison while live target rescanning remains in the local UI.

Structured previews redact decoded values at their parser ranges, covering escaped JSON/TOML strings and YAML folded blocks and aliases. Private values use quoted placeholders and line padding to retain original line counts. Source byte counts, lines and columns refer to the original file. Internal value ranges and decoded values are excluded from reports. Private mapping settings use parsed key paths, so literal dotted keys and stored hook identifiers keep their own interpretation.

The browser's Export report action saves the most recent successful inspection. Configuration edits appear after Refresh scan. Exports during an in-flight or failed refresh keep the last displayed report, including its target, trust and selected Codex profile.

Use rule IDs for CI integrations; prose is not a compatibility API. JSON keeps absolute paths for diagnosis. HTML replaces captured repository paths with `<repo>`, home paths with `~` and external agent configuration roots with `<codex-home>`, `<claude-home>` or `<copilot-home>`. Filesystem-verified aliases from absolute structured values and `--option=path` arguments share those replacements. Unknown paths in prose or shell snippets can remain.


JSON may include additive `pathMappings` entries with `path` and `replacement`. They retain the path spellings verified during inspection so a JSON round trip or a later offline HTML render can use the same context. JSON retains absolute diagnostic paths. Portable HTML replaces those paths and removes `pathMappings`. Source byte counts and line numbers describe the original files.
