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

Common flags: `--repo`, `--client` or `--clients`, `--profile` (Codex), `--no-user`, `--home` (isolated synthetic home), `--trust auto|trusted|untrusted`, `--system`, `--json`, `--format terminal|json|html`, `--severity error|warn|info`, `--fail-on error|warn|info|none`, `--output`.

`--max-entries` sets the repository discovery budget, defaulting to 50,000 filesystem entries. `--max-user-files` sets the matching-file budget for each user instruction, rule, skill or hook root, defaulting to 4,000. Both accept non-negative safe integers. Zero prevents repository-entry processing or matching-file reads for the respective budget. Explicit target-chain files and user settings use their documented direct lookup paths. The file picker shares the repository entry budget.

Reports add optional `discovery` metadata with `complete`, `repositoryEntries`, `repositoryEntryLimit` and `userFileLimit`. Limits and inaccessible locations produce an incomplete-discovery status that survives severity filtering and portable export. The terminal and browser keep that status visible. Use `--severity warn` to inspect the reasons, and `--fail-on warn` when CI should reject partial results.

`--severity` filters displayed findings at or above that level. `--fail-on` always evaluates the unfiltered report. CI defaults to `--json --fail-on error`; other commands default to no threshold. Unknown/missing arguments, invalid targets, bad formats and write errors exit 2. Help/version exit 0. Non-interactive output has no ANSI or animations.

The terminal scan summary groups identical diagnostics across clients at the same source location and shows severity totals for the complete grouped list after severity filtering. It displays up to 12 findings and reports the full count when the list continues. Findings at different files, lines, columns or configuration keys stay separate. Each displayed finding includes its source line and column plus related locations. Use `explain` for all client-specific findings or `--json` for machine-readable records. Experimental clients carry an explicit label in the summary. Empty scans include the bundled demo command.

`--profile review` models Codex with `$CODEX_HOME/review.config.toml`. Profile names use letters, numbers, hyphens and underscores. The selected file loads after base user configuration and before applicable project layers. It requires user configuration and Codex among the selected clients. JSON adds optional `inputs.codexProfile`. Omitting the flag loads the base configuration. Legacy `[profiles.*]` definitions and the retired `profile` selector receive migration diagnostics.

SIGINT and SIGTERM interruptions stop active probes before returning exit code 130 or 143 respectively. SDK callers can pass `ScanOptions.signal` to cancel an inspection.

No-argument runs include explicit documented user configuration locations. Use `--no-user` for repository-only CI. Unknown project trust is conditional. `--trust trusted` models a trusted session and, for Claude project MCP, approved servers; it does not change the client’s real trust state.

Reports write only when `--output` is supplied. Output uses a temporary sibling and atomic rename; invalid CLI input does not create partial files. The UI never writes user configuration. The default scan never executes a client, hook, MCP server or skill script.

JSON `schemaVersion: "1.0"` includes tool, repository, target, sessionDirectory, assumptions, sources, clients, findings and diff. A finding has `id`, `ruleId`, `severity`, optional `client`, `message`, `location: {path,line,column,key?}`, `related`, `why` and `suggestion`. Missing/invalid config is a finding, not a crashed scan.

Sources may include an additive `preview` string containing the redacted source file. Internal account/session state files omit this preview. The inspector uses previews for line-numbered source navigation. Snapshot reports retain source exploration and comparison while live target rescanning remains in the local UI.

The browser's Export report action saves the most recent successful inspection. Configuration edits appear after Refresh scan. Exports during an in-flight or failed refresh keep the last displayed report, including its target, trust and selected Codex profile.

Use rule IDs for CI integrations; prose is not a compatibility API. JSON keeps absolute paths for diagnosis. HTML replaces the repo root with `<repo>` and common home paths with `~` for sharing.
