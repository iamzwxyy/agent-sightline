# Architecture

The distribution is a single ESM npm package requiring Node 22+. Internal packages divide responsibilities without a monorepo runtime dependency manager.

```mermaid
flowchart TD
  FS[Bounded read-only filesystem] --> D[Discovery and cached sources]
  D --> P[JSON / JSONC / TOML / YAML / frontmatter]
  P --> A[Client-owned resolution]
  A --> E[Effective instructions + settings + extensions]
  E --> F[Deterministic findings]
  F --> R[Public redaction boundary]
  R --> T[Terminal / JSON]
  R --> H[Standalone portable HTML]
  R --> U[Read-only loopback UI]
```

`core/discovery.ts` reads known filenames and documented user paths. It caches each logical source path, catches access failures and compares canonical paths for symlink bounds. `parse.ts` retains line maps and refuses duplicate/invalid structured data. Instructions are raw Markdown except rule/skill frontmatter.

Adapters keep client semantics. Codex uses first-existing project candidates, per-directory overrides, trust and a raw-byte project budget. Claude expands bounded imports and matching rules while retaining a separate settings/MCP/skill priority contract. Copilot accumulates instruction files without inventing precedence, deduplicates identical non-modular bodies, and keeps workspace MCP trust conditional.

`Decision` records source, scope, state, reason, loading position, raw/loaded bytes and content. `Setting` records a key’s value, winning location and replaced locations. `Extension` records discovered MCP/skill/hook/permission definitions separately from unconditional prompt content. Conditional contributions are visible but excluded from proven `instructions`.

`scan()` returns only redacted public data. The renderers redact again. The report format avoids clocks/timestamps and sorts sources/findings so repeated scans of the same filesystem are stable. Finding IDs hash rule/client/location/message; they remain stable within the same repository path. Relocating a repository changes location-derived IDs.

`ScanOptions.signal` supports cancellation. An interrupted probe finishes child-process cleanup before the scan rejects with the abort reason. POSIX probes own a process group, and Windows probes stop their process tree. Shutdown escalates after a one-second grace period and waits for process closure.

The browser renders source content with `textContent`. One HTML template embeds CSS, JS and escaped JSON. It serves both offline reports and the live read-only UI. Local endpoints accept GET only and recheck repository bounds for target requests.

Resolution uses the target parent as the assumed session directory. This is a static view of documented inputs, not an inspection of an already-running agent transcript. Session toggles, command-line overrides, remote policy, bundled plugins and model decisions require future explicit inputs/integration.
