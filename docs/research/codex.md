# Codex evidence ledger

Verified 2026-11-14. Rule target: npm `@openai/codex` 0.167.2. Configuration comparisons run against the exact 0.167.2 npm binary. The host also has 0.167.0-alpha.4.1 installed.

Primary source: [agents_md.rs at rust-v0.167.2](https://github.com/openai/codex/blob/rust-v0.167.2/codex-rs/core/src/agents_md.rs), its adjacent tests, [global instruction provider](https://github.com/openai/codex/blob/rust-v0.167.2/codex-rs/codex-home/src/instructions/mod.rs), [official config docs](https://developers.openai.com/codex/config-basic), [skills](https://developers.openai.com/codex/skills), [hooks](https://learn.chatgpt.com/docs/hooks).

| Concern | Implemented contract |
| --- | --- |
| User paths | `$CODEX_HOME` or `~/.codex`: config.toml, AGENTS.override.md, AGENTS.md, hooks.json; ~/.agents/skills and compatibility ~/.codex/skills |
| Project discovery | Nearest project root marker (.git default); root → assumed session directory; no marker means cwd only |
| Candidate selection | First existing regular file: AGENTS.override.md → AGENTS.md → configured bare fallback names |
| Empty candidates | Global uses first non-empty file; project empty override still shadows normal file |
| Order | Global then project root-to-leaf; later natural language placement is not deterministic semantic replacement |
| Budget | project_doc_max_bytes defaults 32768, counts project raw bytes only, not global or joining separators; UTF-8 prefix conversion is lossy at split codepoints |
| Trust | Selected project root determines automatic trust. Its canonical projects key wins, followed by its logical-path key. Ancestor/intermediate trust entries do not grant trust to a different root. Version-pinned source skips project instructions/config in explicitly untrusted projects; unknown trust remains conditional |
| Settings | User → selected project root-to-cwd .codex/config.toml; scalar override, table merge; optional Unix /etc/codex layer below user |
| Includes/globs | @path is literal in AGENTS.md; fallback entries are names, not path/glob rules |
| Profiles | Explicit `--profile name` loads `$CODEX_HOME/name.config.toml` after the base user config and before project layers. Names are ASCII alphanumeric, hyphen or underscore. An absent file contributes an empty layer. Legacy top-level `profile` fails startup, and a selected legacy table in base user config blocks the matching file profile. |
| Project-only restrictions | The pinned loader removes top-level provider/auth/notification/profile/telemetry routing keys before merging project configuration. Sightline retains ignored definitions with source locations. Additional field-specific runtime restrictions remain outside this static contract. |
| MCP | mcp_servers tables in TOML; per-field merge across config layers, command/env/cwd validation |
| Hooks | hooks.json alongside active layers and inline event tables accumulate; hooks.state stores enabled/trust-hash overrides as settings. The final features.hooks flag controls hook discovery. Command and MCP tool handlers are supported. Prompt/agent handlers are parsed and skipped. Windows selects commandWindows or the TOML command_windows alias. Coexisting same-layer handler definitions warn; exact hash trust is conditional |
| Skills | Metadata discovery only; duplicate names can coexist; skills.config disable selectors evaluated |
| Invalid config | Official version-pinned schema and parser errors produce invalid decisions; inspector continues other sources |

Fixture: `fixtures/codex/chain.json`; additional resolver tests cover empty overrides, no markers, trust and split UTF-8. The current official prose simplifies empty-file and trust details; the release-pinned Rust source takes priority where they differ.

Not resolved: Other CLI overrides, cloud/MDM requirements, exec-policy scripts, plugin/bundled assets and multi-environment sessions. These are explicit metadata limitations, not completed compatibility claims.

Profile contracts were checked against the [version-pinned loader](https://github.com/openai/codex/blob/rust-v0.167.2/codex-rs/config/src/loader/mod.rs), [layer precedence](https://github.com/openai/codex/blob/rust-v0.167.2/codex-rs/config/src/config_layer_source.rs), [name validation](https://github.com/openai/codex/blob/rust-v0.167.2/codex-rs/protocol/src/config_types.rs) and [official profile guidance](https://developers.openai.com/codex/config-advanced#profiles). Reproduce them with `tests/profiles.test.ts`, CLI/server integration cases and the browser profile-selection case.

## Real-client configuration comparisons

`npm run test:codex` runs a binary-version check and twenty-one isolated scenarios through Codex 0.167.2 `app-server`. Each scenario sends `initialize`, `initialized` and `config/read` with `includeLayers=true`, then compares selected scalar/MCP values, configured hook fields and winning source files with Sightline's public `scan()`. Array comparisons retain lengths and ordering, with native origins for their configured fields. The API supplies defaults and normalizes the Windows alias to commandWindows. Reports retain original configured field names for source navigation. The harness uses temporary homes and Git repositories, disables client analytics and supplies no model requests or account credentials. [App-server protocol](https://learn.chatgpt.com/docs/app-server)

The scenarios cover user/root/nested precedence, untrusted layers, ignored project-only fields, MCP field merging, nested Git roots, marker-free directories, ancestor/intermediate trust, custom and disabled root markers, canonical/alias trust entries and conflicting alias entries in both directions. They exposed and now guard against applying project layers above the chosen root and inheriting trust from unrelated ancestor keys. [Project layers and root markers](https://learn.chatgpt.com/docs/config-file/config-advanced.md)

The API exposes configuration origins at file granularity. Source line numbers come from Sightline's parser fixtures. Codex 0.167.2 `config/read` accepts `cwd` and `includeLayers`, so the harness covers base/project configuration. Profile loading and instruction bodies retain their version-pinned source/schema fixture contracts. No model turn or MCP server is started by the harness.

The merged-MCP scenario checks a user command and working directory, root-project arguments and nested-project environment declarations. Private mapping values are compared through their native origin files while public reports retain redacted values. Fixtures separately verify source lines, nested maps, empty/replaced arrays and the complete unknown-trust conditional candidate.


## Hook review state

The pinned official schema defines `HooksToml.state` as a map of `HookStateToml` entries with `enabled`, `trusted_hash` and `trusted_content_hash` fields. These values retain ordinary settings provenance. Event handlers live in the sibling event tables. The real-client configuration comparisons verify stored review values and both directions of user/project `features.hooks` precedence. [Hook review and configuration guidance](https://learn.chatgpt.com/docs/hooks)

Sightline's same-layer dual-source diagnostic identifies coexisting handler definitions. Hook event matching and exact-definition approval use conditional modelling. Native comparisons read configuration values and file origins without creating a model turn.

## Hook command and handler compatibility

The documented command_windows TOML alias is accepted by the pinned client and canonicalized to commandWindows in its configuration API. The generated JSON schema lists the canonical name, so Sightline supplements its in-memory validation schema with the documented alias. Windows executable checks and source locations share the same command-field selection. POSIX uses command. Nested TOML array tables retain per-handler lines, with multiline values excluded from table-header tracking. [Hook command fields](https://learn.chatgpt.com/docs/hooks)

Codex 0.167.2's schema includes PreModelRequest and PostModelRequest events, plus command, mcp_tool, prompt and agent handlers. The documented runtime supports command/MCP handlers and skips prompt/agent handlers. Codex commands use the session working directory. Sightline explains ignored cwd, env and args fields and retains Copilot's client-specific directory/environment handling. Hook matching, MCP readiness and exact-definition trust remain runtime conditions. [Hook behavior](https://learn.chatgpt.com/docs/hooks)

A native configuration comparison places malformed TOML in a sibling project outside the session directory chain. Codex reads the applicable root configuration successfully. Sightline retains the sibling source and its invalid flag while selecting diagnostics from the current target scope. Selecting a target under that sibling makes its syntax findings applicable. [Configuration loading](https://github.com/openai/codex/blob/rust-v0.167.2/codex-rs/core/src/config_loader/mod.rs)

Malformed-TOML privacy fixtures place synthetic environment values in readable assignments and copy them into loaded instructions. Recovery retains values for redaction across project, user and sibling discovery scopes, with LF/CRLF, escapes, multiline strings, duplicate definitions and unfinished private arrays or inline tables. Settings remain invalid and the original parser error location is retained. Installed-package and live/offline browser checks exercise the public output boundary.
