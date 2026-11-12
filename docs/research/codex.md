# Codex evidence ledger

Verified 2026-11-13. Rule target: npm `@openai/codex` 0.167.2. Configuration comparisons run against the exact 0.167.2 npm binary. The host also has 0.167.0-alpha.4.1 installed.

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
| Hooks | hooks.json alongside active layers and inline event tables accumulate; hooks.state stores enabled/trust-hash overrides as settings. The final features.hooks flag controls hook discovery. Coexisting same-layer handler definitions warn; exact hash trust is conditional |
| Skills | Metadata discovery only; duplicate names can coexist; skills.config disable selectors evaluated |
| Invalid config | Official version-pinned schema and parser errors produce invalid decisions; inspector continues other sources |

Fixture: `fixtures/codex/chain.json`; additional resolver tests cover empty overrides, no markers, trust and split UTF-8. The current official prose simplifies empty-file and trust details; the release-pinned Rust source takes priority where they differ.

Not resolved: Other CLI overrides, cloud/MDM requirements, exec-policy scripts, plugin/bundled assets and multi-environment sessions. These are explicit metadata limitations, not completed compatibility claims.

Profile contracts were checked against the [version-pinned loader](https://github.com/openai/codex/blob/rust-v0.167.2/codex-rs/config/src/loader/mod.rs), [layer precedence](https://github.com/openai/codex/blob/rust-v0.167.2/codex-rs/config/src/config_layer_source.rs), [name validation](https://github.com/openai/codex/blob/rust-v0.167.2/codex-rs/protocol/src/config_types.rs) and [official profile guidance](https://developers.openai.com/codex/config-advanced#profiles). Reproduce them with `tests/profiles.test.ts`, CLI/server integration cases and the browser profile-selection case.

## Real-client configuration comparisons

`npm run test:codex` runs a binary-version check and eighteen isolated scenarios through Codex 0.167.2 `app-server`. Each scenario sends `initialize`, `initialized` and `config/read` with `includeLayers=true`, then compares selected effective scalar/MCP values and winning source files with Sightline's public `scan()`. Array values have per-element native origins. The harness uses temporary homes and Git repositories, disables client analytics and supplies no model requests or account credentials. [App-server protocol](https://learn.chatgpt.com/docs/app-server)

The scenarios cover user/root/nested precedence, untrusted layers, ignored project-only fields, MCP field merging, nested Git roots, marker-free directories, ancestor/intermediate trust, custom and disabled root markers, canonical/alias trust entries and conflicting alias entries in both directions. They exposed and now guard against applying project layers above the chosen root and inheriting trust from unrelated ancestor keys. [Project layers and root markers](https://learn.chatgpt.com/docs/config-file/config-advanced.md)

The API exposes configuration origins at file granularity. Source line numbers come from Sightline's parser fixtures. Codex 0.167.2 `config/read` accepts `cwd` and `includeLayers`, so the harness covers base/project configuration. Profile loading and instruction bodies retain their version-pinned source/schema fixture contracts. No model turn or MCP server is started by the harness.


## Hook review state

The pinned official schema defines `HooksToml.state` as a map of `HookStateToml` entries with `enabled`, `trusted_hash` and `trusted_content_hash` fields. These values retain ordinary settings provenance. Event handlers live in the sibling event tables. The real-client configuration comparisons verify stored review values and both directions of user/project `features.hooks` precedence. [Hook review and configuration guidance](https://learn.chatgpt.com/docs/hooks)

Sightline's same-layer dual-source diagnostic identifies coexisting handler definitions. Hook event matching and exact-definition approval use conditional modelling. Native comparisons read configuration values and file origins without creating a model turn.
