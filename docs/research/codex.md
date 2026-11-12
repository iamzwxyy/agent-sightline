# Codex evidence ledger

Verified 2026-11-12. Rule target: npm `@openai/codex` 0.167.2. Local executable available during development: 0.167.0-alpha.4.1; it was detected, not used as a model oracle.

Primary source: [agents_md.rs at rust-v0.167.2](https://github.com/openai/codex/blob/rust-v0.167.2/codex-rs/core/src/agents_md.rs), its adjacent tests, [global instruction provider](https://github.com/openai/codex/blob/rust-v0.167.2/codex-rs/codex-home/src/instructions/mod.rs), [official config docs](https://developers.openai.com/codex/config-basic), [skills](https://developers.openai.com/codex/skills), [hooks](https://learn.chatgpt.com/docs/hooks).

| Concern | Implemented contract |
| --- | --- |
| User paths | `$CODEX_HOME` or `~/.codex`: config.toml, AGENTS.override.md, AGENTS.md, hooks.json; ~/.agents/skills and compatibility ~/.codex/skills |
| Project discovery | Nearest project root marker (.git default); root → assumed session directory; no marker means cwd only |
| Candidate selection | First existing regular file: AGENTS.override.md → AGENTS.md → configured bare fallback names |
| Empty candidates | Global uses first non-empty file; project empty override still shadows normal file |
| Order | Global then project root-to-leaf; later natural language placement is not deterministic semantic replacement |
| Budget | project_doc_max_bytes defaults 32768, counts project raw bytes only, not global or joining separators; UTF-8 prefix conversion is lossy at split codepoints |
| Trust | Version-pinned source skips project instructions/config in explicitly untrusted projects; unknown trust remains conditional |
| Settings | User → project .codex/config.toml root-to-cwd; scalar override, table merge; optional Unix /etc/codex layer below user |
| Includes/globs | @path is literal in AGENTS.md; fallback entries are names, not path/glob rules |
| Profiles | Explicit `--profile name` loads `$CODEX_HOME/name.config.toml` after the base user config and before project layers. Names are ASCII alphanumeric, hyphen or underscore. An absent file contributes an empty layer. Legacy top-level `profile` fails startup, and a selected legacy table in base user config blocks the matching file profile. |
| Project-only restrictions | The pinned loader removes top-level provider/auth/notification/profile/telemetry routing keys before merging project configuration. Sightline retains ignored definitions with source locations. Additional field-specific runtime restrictions remain outside this static contract. |
| MCP | mcp_servers tables in TOML; per-field merge across config layers, command/env/cwd validation |
| Hooks | hooks.json alongside active layers and inline hooks accumulate; dual same-layer form warns; exact hash trust is conditional |
| Skills | Metadata discovery only; duplicate names can coexist; skills.config disable selectors evaluated |
| Invalid config | Official version-pinned schema and parser errors produce invalid decisions; inspector continues other sources |

Fixture: `fixtures/codex/chain.json`; additional resolver tests cover empty overrides, no markers, trust and split UTF-8. The current official prose simplifies empty-file and trust details; the release-pinned Rust source takes priority where they differ.

Not resolved: Other CLI overrides, cloud/MDM requirements, exec-policy scripts, plugin/bundled assets and multi-environment sessions. These are explicit metadata limitations, not completed compatibility claims.

Profile contracts were checked against the [version-pinned loader](https://github.com/openai/codex/blob/rust-v0.167.2/codex-rs/config/src/loader/mod.rs), [layer precedence](https://github.com/openai/codex/blob/rust-v0.167.2/codex-rs/config/src/config_layer_source.rs), [name validation](https://github.com/openai/codex/blob/rust-v0.167.2/codex-rs/protocol/src/config_types.rs) and [official profile guidance](https://developers.openai.com/codex/config-advanced#profiles). Reproduce them with `tests/profiles.test.ts`, CLI/server integration cases and the browser profile-selection case.
