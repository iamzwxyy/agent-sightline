# Agent Sightline

**See what your coding agent actually sees.**

One file. Several agents. Different instructions. Sightline shows every discovered source, why it applies, what is shadowed or truncated, and the effective configuration—with source lines you can inspect.

```sh
npm install -g https://agent-sightline.williamtse700.chatgpt.site/downloads/agent-sightline-0.1.1.tgz
agent-sightline demo --clients codex,claude,copilot --severity warn
agent-sightline demo --ui
```

Node.js 22+. Download and run the package directly from the public website. Public npm-registry publication is pending. [Explore the browser demo](https://agent-sightline.williamtse700.chatgpt.site/demo/) or read the [installation guide](https://agent-sightline.williamtse700.chatgpt.site/guide.html).

![Actual bundled-demo terminal output (excerpt)](docs/assets/terminal.png)

The demo contains real deterministic failures: a missing instruction import, an import cycle, contradictory allow/deny entries, unavailable MCP and hook commands, missing environment variables, invalid skill metadata and a Codex override that exceeds its byte budget.

```sh
agent-sightline                                      # discover and diagnose this repository
agent-sightline explain src/payments/refund.ts --client codex --trust trusted
agent-sightline diff src/payments/refund.ts --clients codex,claude,copilot --trust trusted
```

Targets can be source files that do not yet exist if their parent directory exists. The explanation models a fresh session launched in the target’s directory and opening that file; it does not claim to observe an already-running agent.

## What it shows

* **Loading proof:** ordered sources with absolute paths, lines, scope, status, reason, loaded bytes and an approximate token cost.
* **Effective inputs:** accumulated instruction bodies, structured setting winners and replaced origins, plus MCP/skill/hook/permission definitions.
* **Deterministic findings:** invalid formats/duplicate keys, override selection, missing/circular/repeated imports, unmatched globs, byte truncation, MCP drift and missing commands/env/cwd, skill conflicts and exact deny masking.
* **Comparison:** instruction content grouped by receiving client, plus extension definitions for each client. No invented natural-language conflict scores.
* **Shareable output:** terminal, stable JSON and a redacted standalone HTML inspector, plus CI finding thresholds.

## Local inspector

```sh
agent-sightline ui
agent-sightline report --format html --output report.html
agent-sightline ci --no-user --fail-on warn --json
```

![Local configuration inspector](docs/assets/inspector.png)

The browser UI has client/source navigation, effective content, provenance explanations, client comparison, finding filters and portable HTML export. It binds to `127.0.0.1`; no Electron or hosted service is involved. `--no-open` prints the URL without opening a browser.

The workspace opens with grouped errors and warnings. Select a finding to read its cause and suggested resolution, then jump to the source line. The source explorer shows the original redacted file with line numbers and the byte cutoff. Search target files with ⌘K / Ctrl+K, filter sources with `/`, and inspect client coverage in the comparison matrix. Trust assumptions can be changed from the top bar.

Read effective text shows the exact accumulated instructions with clickable source origins. Compare clients puts those instructions side by side. Settings lets you search resolved values, inspect the selected definition and follow replaced layers. The target and trust choice survive reloads, and browser Back returns through your inspection history. A repository with no configuration opens with a working sample-workspace entry point.

The companion website includes an interactive example, a complete installation guide, product walkthroughs and a working CLI package download. Build and preview both interfaces locally with `npm run build:website` followed by `npm run preview`.

## Supported contracts

| Client | Rule target | Status | Focus |
| --- | --- | --- | --- |
| OpenAI Codex CLI | 0.167.2 source/schema | Fixture-verified | Instruction chain, trust, overrides, raw-byte budget, TOML layers, MCP, skill metadata, hook discovery |
| Claude Code | 2.1.322 official docs | Fixture-verified | CLAUDE/AGENTS fallback, imports, path rules, settings, MCP scope, skills, hooks, exact permissions |
| GitHub Copilot CLI | 1.0.109 official docs | Fixture-verified | Combined instructions, applyTo, import bounds, JSONC user settings, workspace MCP, skills, hooks |
| Gemini CLI | Docs snapshot 2026-11-12 | Experimental | Local settings and global/ancestor/JIT context files |
| Cursor | Docs snapshot 2026-11-12 | Experimental | AGENTS.md and .mdc always/glob/manual/intelligent states, local MCP |
| OpenCode V2 | Docs snapshot 2026-11-12 | Experimental | V2 local configuration and nearest-first AGENTS.md; no V1 fallback assertion |

Rules and known limits are visible through `agent-sightline adapters` and the [evidence ledgers](docs/research/). “Fixture-verified” means the recorded official contracts have executable fixtures; it is not an authenticated live-client conformance claim. Copilot CLI rules differ from VS Code/code review/cloud agent rules.

## Privacy and trust

Default operation is local, read-only, account-free, API-key-free and model-free. No telemetry or uploads. It reads the repository and explicit documented user config locations, marked `user`; use `--no-user` for repository-only CI. It skips external private trees and safely reports damaged config, broken symlinks and access errors.

All public output redacts environment/header values, sensitive keys, common tokens, auth headers and URL credentials; renderers apply redaction again. HTML also replaces the repository root and common home paths. Unlabelled arbitrary prose cannot always be identified as a secret; review reports before sharing. See [security policy](SECURITY.md).

Unknown workspace trust remains **conditional**. `--trust trusted` models a trusted session and approved Claude project MCP servers; it changes no real client settings. Default scans start no configured process. `agent-sightline doctor --probe --trust trusted` explicitly starts local stdio MCP servers for initialization/tools listing; startup code can have side effects, and no MCP tool is invoked.

## Install and develop

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:web
npm pack
npm install -g ./agent-sightline-0.1.1.tgz
agent-sightline demo
```

The example is bundled in the installed package. From this checkout, the original explicit path also works:

```sh
agent-sightline examples/broken-agent-config --no-user
```

`npm run check` runs lint, typecheck, parser/resolver/adapter/CLI/report/server/probe tests, build and a real isolated package-install smoke test. GitHub Actions runs these checks plus Chromium browser tests on Linux, macOS and Windows. See the [executed validation record](docs/validation.md) and its private CI run link for results.

Exit codes: **0** successful inspection, **1** `--fail-on` threshold reached, **2** input/inspection error. CI defaults to JSON and failing on errors. See [CLI contract](docs/cli.md) for flags and JSON structure.

## Scope and next steps

Sightline diagnoses configuration; it does not synchronize it or switch API providers/models. Markdown guidance accumulates, so the tool does not guess which conflicting sentence an LLM will obey. Source-file diff groups identical bodies rather than doing semantic alignment.

Static reports exclude session toggles, command-line/profile overrides, account/managed-cloud policy and bundled/plugin state unless expressly supported by an adapter. Experimental adapters describe their gaps rather than claiming complete resolution. The inspection cap is 2 MiB per file and 50,000 filesystem entries; these are Sightline limits.

The most useful path to v1.0: a live client conformance harness, plugin/managed-policy provenance, and finer paragraph/span comparison. See [architecture](docs/architecture.md), [adapter guide](docs/adapters.md), [contributing](CONTRIBUTING.md), [release procedure](docs/release.md), [30-second demo](docs/demo.md), and [launch drafts](docs/launch-drafts.md).

MIT. Codex schema attribution: [third-party notices](docs/third-party.md).
