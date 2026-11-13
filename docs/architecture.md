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

Structured parsers retain internal value ranges and decoded literals. JSON/JSONC and YAML traverse their syntax trees, while TOML reuses its statement scanner for literal ranges and private assignments. Source previews replace private values at those ranges before applying shared captured-value and credential-text redaction. Quoted placeholders and line padding preserve source line counts. Public reports exclude the ranges and their decoded values. Private flattened settings are identified from actual parsed key paths and owning files, preserving literal dotted keys and hook-state identifiers.

An implicit scan finds the nearest ancestor `.git` file or directory, retaining the startup working directory as the target base. Explicit repository selections provide the boundary and target base. The browser resolves and pins its filesystem paths before scanning, so redacted report paths remain presentation data and target navigation stays repository-relative.

Repository enumeration records its actual entry count and budget. Each user rule or skill root counts its own matching files independently of repository sources. Traversal handles deep directories with canonical-path cycle detection and configurable discovery budgets. The additive `discovery` report metadata records whether locations or source contents were skipped by limits or access restrictions. Severity filtering retains that operational status.

Adapters keep client semantics. Codex overlays an explicitly selected user profile file between base user and project configuration, retaining replaced source locations. Retired legacy profile syntax and ignored project-local machine settings have deterministic diagnostics. Codex uses first-existing project candidates, per-directory overrides, trust and a raw-byte project budget. Claude expands bounded imports and matching rules while retaining a separate settings/MCP/skill priority contract. Copilot accumulates instruction files without inventing precedence, deduplicates identical non-modular bodies, and keeps workspace MCP trust conditional.

Codex selects its project root before resolving automatic trust and project configuration. The nearest configured root marker bounds project layers. Without a marker, the session directory is the project root. Trust is read from that root's canonical key with a logical-path fallback.

`tests/codex-runtime.test.ts` compares public `scan()` results with the pinned Codex app-server configuration API in isolated temporary homes and real Git repositories. It checks selected effective scalar/MCP values and winning source files across root, trust and alias cases. The client receives initialization and configuration-read requests. Profiles, instruction content and source line numbers remain covered by source/schema fixtures. The development-only Codex binary is excluded from production archives.

`Decision` records source, scope, state, reason, loading position, raw/loaded bytes and content. `Setting` records a key’s value, winning location and replaced locations. `Extension` records discovered MCP/skill/hook/permission definitions separately from unconditional prompt content. Conditional contributions are visible but excluded from proven `instructions`.

`core/comparison.ts` groups blank-line-delimited instruction paragraphs across proven active and truncated decisions. CRLF is normalized for matching, fenced code stays together, and repeated occurrences retain their client-specific order. Additive `Report.instructionDiff` records each block's recipients and source origins. Original source ranges are proven against eligible source text, with frontmatter and stripped comments excluded from candidate positions. Transformed text without a contiguous source match links to its contribution's starting location and omits `endLine`. Membership is computed before captured private values are redacted. Existing `Report.diff` keeps its whole-source groups.

MCP extensions optionally include an `origins` array mapping field paths to source locations. Codex field merges retain inherited leaf origins and replace array origins with the incoming array. Unknown-trust project layers retain the proven user baseline and a merged conditional candidate. Terminal explanations, diagnostics and browser field links consume the same metadata. Older reports fall back to the server's location.

Content diagnostics use the selected client owners for parser findings, field checks and glob validation. MCP shape checks use the clients’ source loading decisions. Shared sources retain diagnostics for each supported selected owner. Discovery coverage and filesystem findings describe the full inspected tree.

Extension validation checks field types before filesystem lookup and process probing. Malformed definitions retain field-specific findings while valid sibling definitions remain inspectable. JSON array entries retain individual line locations for handlers and permission rules. The redaction boundary collects private string leaves from environment and header containers, including malformed containers.

Claude MCP definitions pass structural validation before scope replacement, preserving a lower-priority server when a higher layer has an invalid entry. A shared runtime-field projection drives static checks, drift and explicit probes. The public definition retains declared fields and origins, and the browser marks ignored fields. Claude stdio processes use the session directory. Repository/local approval settings are excluded until explicit trust, while user/managed approvals and inspected rejections determine individual server states.

`tests/claude-runtime.test.ts` compares MCP parsing and approval results with Claude 2.1.322 `mcp get` in temporary homes. Remote transport cases remain pending approval. Synthetic stdio fixtures answer initialization and tool-list requests for health checks and directory observations. Codex and Claude binaries are development dependencies excluded from the installed package.

Claude and Copilot MCP environment references are expanded privately for endpoint, working-directory and executable checks. Static validation retains unresolved references while checking independent fields. Explicit probes require complete expansion before startup. Public extension definitions retain their original references.

The scanner captures logical/canonical repository and home roots plus filesystem-verified aliases from absolute structured configuration paths and assigned command-line arguments. Alias discovery uses the redacted diagnostic paths, settings and extension definitions selected by the adapters. Path resolution checks directory metadata without reading additional configuration contents. Additive `Report.pathMappings` survives filtering and JSON serialization. The portable renderer applies those mappings to strings and keys, then removes the mappings. Export uses the context captured in the inspected report, preserving the snapshot through later filesystem edits.

`scan()` returns only redacted public data. The renderers redact again. The report format avoids clocks/timestamps and sorts sources/findings so repeated scans of the same filesystem are stable. Finding IDs hash rule/client/location/message; they remain stable within the same repository path. Relocating a repository changes location-derived IDs.

`ScanOptions.signal` supports cancellation. An interrupted probe finishes child-process cleanup before the scan rejects with the abort reason. POSIX probes own a process group, and Windows probes stop their process tree. Shutdown escalates after a one-second grace period and waits for process closure.

The browser renders source content with `textContent`. One HTML template embeds CSS, JS and escaped JSON. It serves both offline reports and the live read-only UI. Local endpoints accept GET only and recheck repository bounds for target requests.

The HTML template disables its controls during initialization and shows loading feedback. Once event handlers are installed, the application enables those controls before the first render applies content-specific copy and read-only states. Browser regressions pause the streamed HTML before its executable script to verify initialization and the first navigation action in live and portable reports.

Copilot settings resolution retains per-key collection policies, replacement of whole marketplace entries, trust-dependent model fields and disabled-extension state. Repository Claude settings share a JSONC parse tree with Copilot. Claude applies strict JSON validation to its own settings layer, retaining client-specific syntax findings and decisions. Conflicting values across the two file formats in the same scope remain conditional. Additional customization-directory declarations retain an incomplete-discovery status until their content is resolved or the declaration is cleared by a local layer.

Live pages include a portable HTML export produced from their initial report. Browser scan requests use `include=html` to receive the redacted report and its portable HTML together. The browser replaces both after a successful current request and retains them during pending or failed refreshes. Export downloads the retained snapshot, preserving the inspected contents across subsequent disk edits. The default scan and export endpoints retain their existing response formats.

Resolution uses the target parent as the assumed session directory. This is a static view of documented inputs, not an inspection of an already-running agent transcript. Session toggles, command-line overrides, remote policy, bundled plugins and model decisions require future explicit inputs/integration.

Personal Copilot settings normalize registered aliases on a cloned settings layer. Canonical effective keys retain the original declared key and line, including earlier spellings replaced in the same file. Raw parsed sources and value ranges remain available to privacy redaction. Repository settings retain their own canonical-key contract. Native file-loading comparisons cover document rejection and alias-normalization fallback for the validated settings subset.

Client SVG assets live in packages/web/assets/clients. The reporter embeds their data URLs in its CSP-hashed stylesheet, preserving standalone and offline rendering. The website build copies the compiled assets to its icon directory. The landing-page WebGL scene uses the real example’s selected client, with a static composition available alongside motion controls and reduced-motion handling.
