# Adapter development

`Adapter` defines `detect`, `discover`, `parse`, `resolveForTarget`, `validate`, `probe` and `explain`. Parsing is shared through the discovery cache for portable formats; each adapter owns discovery locations, effective semantics and rule-specific diagnostics. See `packages/core/types.ts`.

1. Fetch official documentation, versioned source or public schema. Record source URL, verified date and version/contract in metadata and `docs/research/<client>.md`.
2. Create a fixture manifest with repository and synthetic user filesystem inputs. Include expected sources, effective content, states, reasons and rule IDs. Never read a developer’s real home directory in tests.
3. Keep startup-loaded, on-demand, manually invoked, model-selected and trust-dependent states distinct.
4. Define priority separately for instructions, settings, MCP, skills and hooks. Shared IR must not imply identical client semantics.
5. Return stable finding IDs, severity, source line, related locations, a reason and an actionable suggestion. Avoid raw parser messages that include secret values.
6. Check public report and HTML redaction with synthetic sentinel values. Add the adapter to the registry only after its vertical fixture passes. Use experimental maturity if evidence is incomplete.

Fixtures live under `fixtures/<client>/`; golden tests build real temporary trees and assert meaningful decisions instead of mirroring resolver internals. Experimental fixtures live under `fixtures/mixed/`.

The vendored Codex schema is sourced from the pinned official repository under its Apache-2.0 license. Update schema and metadata together, and preserve its attribution in `docs/third-party.md`.
