# Claude evidence ledger

Verified 2026-11-12. Documentation target: Claude Code 2.1.322 (npm latest at research time). Assertions are official-document contract fixtures; an authenticated model session was not used.

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

Not resolved: filesystem ancestors outside --repo, session switches, account-synced/bundled/plugin components, worktree main-checkout fallback, full managed exceptions and all settings-specific scope/environment pairs. The tool does not claim to observe a running session.
