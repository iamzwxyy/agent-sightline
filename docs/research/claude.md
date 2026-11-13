# Claude evidence ledger

Verified 2026-11-13 against Claude Code 2.1.322. MCP has native CLI comparisons. Instructions, settings, skills, hooks and permissions retain official-document fixtures.

Sources: [memory/instructions](https://code.claude.com/docs/en/memory), [settings](https://code.claude.com/docs/en/settings), [MCP](https://code.claude.com/docs/en/mcp), [skills](https://code.claude.com/docs/en/skills), [permissions](https://code.claude.com/docs/en/permissions), [hooks](https://code.claude.com/docs/en/hooks).

| Concern | Implemented contract |
| --- | --- |
| User | ~/.claude/CLAUDE.md, settings.json, rules/**/*.md, skills/**/SKILL.md; ~/.claude.json MCP scopes only |
| Project instructions | Ancestor CLAUDE.md, .claude/CLAUDE.md and CLAUDE.local.md, broadest → deepest; local appended per directory |
| AGENTS fallback | 2.1.277+ default only without ancestor CLAUDE.md/local; explicit user plugin instructionFiles supports both, Claude-only and managed-only |
| Imports | @path relative to referring file; code spans/fences excluded; escaped spaces; max four hops; external references reported/skipped by privacy boundary |
| Rules | .claude/rules recursively; paths YAML matches relative to rule base; bare *.md matches descendants; leading / anchors to base |
| Exclusions | claudeMdExcludes arrays merge and match absolute source paths |
| Settings | User → shared repository .claude/settings.json → local → optional system managed; arrays merge, scalar values override |
| MCP | User ~/.claude.json → repository .mcp.json → current-project local entry in ~/.claude.json; whole server replacement; interactive approval conditional |
| Skills | Personal over project bare names; body loads on invocation; nested directory-qualified variants are a recorded runtime limitation |
| Hooks/permissions | Hook event/matcher definitions discovered; no shell execution. Exact/tool-wide deny overrides allow; no prose semantics |
| Limits | No global 32 KiB cap. On-demand path rules beyond 40,000 characters are conditional because context/model limits vary in 2.1.309+ |
| Invalid formats | JSON, YAML metadata, duplicate keys and known deterministic field/type errors produce findings |

Fixture: `fixtures/claude/chain.json`. Tests also cover AGENTS fallback modes, imports, cycles, depth, exclusions, raw Markdown and permission masking.

Structural validation was reviewed against the official MCP, hooks and permissions references on 2026-11-13. Fixtures now cover malformed server/handler collections, typed extension fields, individual permission-entry locations and private strings inside invalid environment/header containers. Command hooks with `args` use literal executable resolution. The documented command handler fields exclude per-handler `cwd`, `env` and `commandWindows`, which receive warnings. The current hooks reference also lists `mcp_tool`; Sightline retains its declaration as hook metadata. Runtime dispatch and MCP-tool invocation remain outside this inspection.

## Native MCP comparisons

`npm run test:claude` checks the pinned CLI in temporary homes. The matrix compares transport acceptance, pending approval, user-level approvals, repository/local self-approval, explicit rejection and fallback after invalid higher-priority entries. Synthetic stdio servers answer health-check requests and record their working directory.

Claude requires an explicit remote type and accepts `streamable-http` as an HTTP alias. Omitted types select stdio. The selected schema determines which fields participate, and stdio uses the session directory. The scanner retains ignored fields with source warnings and uses the same field projection for drift and probes. Empty remote endpoints await configuration. [MCP transport reference](https://code.claude.com/docs/en/mcp)

User and managed settings can approve project servers before workspace trust. Repository and local approval settings are excluded in the static unknown-trust model. Inspected rejections still apply. `--trust trusted` explicitly models workspace trust and server approval. Invalid approval setting types receive source findings. [Approval behavior](https://code.claude.com/docs/en/mcp#project-server-approvals-and-workspace-trust)

Not resolved: filesystem ancestors outside --repo, session switches, account-synced/bundled/plugin components, worktree main-checkout fallback, full managed exceptions and all settings-specific scope/environment pairs. The tool does not claim to observe a running session.
