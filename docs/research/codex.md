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
| MCP | mcp_servers tables in TOML; per-field merge across config layers, command/env/cwd validation |
| Hooks | hooks.json alongside active layers and inline hooks accumulate; dual same-layer form warns; exact hash trust is conditional |
| Skills | Metadata discovery only; duplicate names can coexist; skills.config disable selectors evaluated |
| Invalid config | Official version-pinned schema and parser errors produce invalid decisions; inspector continues other sources |

Fixture: `fixtures/codex/chain.json`; additional resolver tests cover empty overrides, no markers, trust and split UTF-8. The current official prose simplifies empty-file and trust details; the release-pinned Rust source takes priority where they differ.

Not resolved: CLI/profile inputs, cloud/MDM requirements, exec-policy scripts, plugin/bundled assets and multi-environment sessions. These are explicit metadata limitations, not completed compatibility claims.
