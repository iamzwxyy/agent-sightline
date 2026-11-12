# CLI contract

| Command | Behavior |
| --- | --- |
| `agent-sightline [repository]` / `scan` | Discover and summarize compatible configuration |
| `explain <target>` | Full load decisions, source lines, effective instructions/settings/extensions |
| `diff <target> --clients codex,claude,copilot` | Instruction content recipients and extensions by client |
| `doctor` | Extension validation; `--probe` opts into local stdio startup |
| `ui` | Loopback browser inspector; `--no-open` prints URL |
| `report --format html --output report.html` | Portable, self-contained report |
| `ci --fail-on warn` | JSON diagnostics; finding threshold sets exit 1 |
| `adapters --json` | Rule evidence/version/limitations |
| `version` / `--version` | Package version |

Common flags: `--repo`, `--client` or `--clients`, `--no-user`, `--home` (isolated synthetic home), `--trust auto|trusted|untrusted`, `--system`, `--json`, `--format terminal|json|html`, `--severity error|warn|info`, `--fail-on error|warn|info|none`, `--output`.

`--severity` filters displayed findings at or above that level. `--fail-on` always evaluates the unfiltered report. CI defaults to `--json --fail-on error`; other commands default to no threshold. Unknown/missing arguments, invalid targets, bad formats and write errors exit 2. Help/version exit 0. Non-interactive output has no ANSI or animations.

No-argument runs include explicit documented user configuration locations. Use `--no-user` for repository-only CI. Unknown project trust is conditional. `--trust trusted` models a trusted session and, for Claude project MCP, approved servers; it does not change the client’s real trust state.

Reports write only when `--output` is supplied. Output uses a temporary sibling and atomic rename; invalid CLI input does not create partial files. The UI never writes user configuration. The default scan never executes a client, hook, MCP server or skill script.

JSON `schemaVersion: "1.0"` includes tool, repository, target, sessionDirectory, assumptions, sources, clients, findings and diff. A finding has `id`, `ruleId`, `severity`, optional `client`, `message`, `location: {path,line,column,key?}`, `related`, `why` and `suggestion`. Missing/invalid config is a finding, not a crashed scan.

Sources may include an additive `preview` string containing the redacted source file. Internal account/session state files omit this preview. The inspector uses previews for line-numbered source navigation. Snapshot reports retain source exploration and comparison while live target rescanning remains in the local UI.

Use rule IDs for CI integrations; prose is not a compatibility API. JSON keeps absolute paths for diagnosis. HTML replaces the repo root with `<repo>` and common home paths with `~` for sharing.
