# Claude evidence ledger

Verified 2026-11-15 against Claude Code 2.1.322. Instruction order and imports have scripted native request comparisons. MCP, permission precedence and configured hook gates also have native CLI comparisons. Other settings and skill metadata retain official-document fixtures.

Sources: [memory/instructions](https://code.claude.com/docs/en/memory), [settings](https://code.claude.com/docs/en/settings), [MCP](https://code.claude.com/docs/en/mcp), [skills](https://code.claude.com/docs/en/skills), [permissions](https://code.claude.com/docs/en/permissions), [hooks](https://code.claude.com/docs/en/hooks).

| Concern | Implemented contract |
| --- | --- |
| User | ~/.claude/CLAUDE.md, settings.json, rules/**/*.md, skills/**/SKILL.md, ~/.claude.json MCP scopes and selected-project external-import approval |
| Project instructions | Ancestor CLAUDE.md, .claude/CLAUDE.md and CLAUDE.local.md, broadest → deepest, shared files → unconditional rules → local files → AGENTS per directory |
| AGENTS fallback | 2.1.277+ default only without ancestor CLAUDE.md/local; explicit user plugin instructionFiles supports both, Claude-only and managed-only |
| Imports | @path relative to referring file, code spans/fences excluded, escaped spaces, max four hops, imports outside the session directory use saved native-project approval, imports outside inspected privacy roots are reported and skipped |
| Rules | .claude/rules recursively, paths YAML matches relative to rule base, bare *.md matches descendants, leading / anchors to base, empty path lists are unconditional, scoped bodies follow startup instructions while imports expand during discovery |
| Exclusions | claudeMdExcludes arrays merge and match absolute source paths |
| Settings | User → shared repository .claude/settings.json → local → optional system managed-settings.json and immediate nonhidden managed-settings.d/*.json, alphabetically; arrays merge, scalar values override |
| MCP | User ~/.claude.json → repository .mcp.json → native selected-project local entry in ~/.claude.json → managedMcpServers → managed-mcp.json; whole server replacement; interactive project approval conditional |
| MCP policy | Allow/deny lists merge across scopes, deny precedes allow and managed-only control restricts allowlist contributions. Exclusive managed-mcp.json suppresses ordinary sources. Provided servers skip the allowlist, and managed-file servers skip it when expansion occurs only in env |
| Skills | Personal over project bare names; body loads on invocation; nested directory-qualified variants are a recorded runtime limitation |
| Hooks/permissions | Hook event/matcher definitions discovered. Proven whole-rule masking follows deny → ask → allow, retaining every highest-priority origin. Bash(*) is tool-wide. EndConversation ask entries are ignored and denial depends on the remaining tool inventory |
| Permission trust | User/system grants are independent of workspace trust. Shared project allow/additionalDirectories entries require explicit trusted state; unknown trust is conditional. Local grants without explicit trust retain native Git/session conditions. Restrictive ask/deny entries remain applicable |
| Managed gates | Managed-only permission rules exclude ordinary allow/ask/deny and personal/project skill allowed-tools. Managed-only hooks exclude ordinary handlers. disableAllHooks follows scalar precedence and protects managed hooks from ordinary disabling |
| Limits | No global 32 KiB cap. On-demand path rules beyond 40,000 characters are conditional because context/model limits vary in 2.1.309+ |
| Invalid formats | JSON, YAML metadata, duplicate keys and known deterministic field/type errors produce findings |

Fixture: `fixtures/claude/chain.json`. Tests also cover AGENTS fallback modes, imports, cycles, depth, exclusions, raw Markdown and permission masking.

## Native permission checks

Nineteen isolated scenarios run the pinned CLI in manual mode against a loopback scripted Messages API. The fixture supplies one Bash request to write a temporary marker, followed by a fixed completion. Synthetic credentials and static responses keep these checks independent of accounts and model services. Assertions inspect the actual marker, native tool inventory, prompt-denial output and public scan results. Cases cover exact and tool-wide ask/deny priority, Bash(*), cross-scope restrictions, trusted project/local grants and withheld shared-project grants.

The native print session applies an untracked local grant after its Git check, and withholds a tracked local grant in the same untrusted folder. Static reports retain both as conditional until workspace trust is explicitly modeled. The inspection has no live-session acceptance state. General wildcard containment, session permission modes and the remaining EndConversation tool inventory retain partial scope. [Permission reference](https://code.claude.com/docs/en/permissions)

Structural validation was reviewed against the official MCP, hooks and permissions references on 2026-11-13. Fixtures now cover malformed server/handler collections, typed extension fields, individual permission-entry locations and private strings inside invalid environment/header containers. Command hooks with `args` use literal executable resolution. The documented command handler fields exclude per-handler `cwd`, `env` and `commandWindows`, which receive warnings. The current hooks reference also lists `mcp_tool`; Sightline retains its declaration as hook metadata. Runtime dispatch and MCP-tool invocation remain outside this inspection.

## Managed file policy and hook gates

The local scripted-API matrix includes 27 permission, trust, ordinary-hook and policy-recovery cases. A separate serialized Linux CI step expands that matrix to 53 cases using fixtures in the native `/etc/claude-code` directory. It starts with an empty policy directory in an ephemeral runner, removes each fixture before the next case, and compares both the public scan API and built CLI. Assertions inspect native file writes, actual hook markers, tool removal and startup failure. The distributed 2.1.322 binary has fixed system roots, so an environment path override supplies no test evidence.

The native file-policy cases cover managed-only grants, ignored ordinary restrictions, quoted and invalid Boolean locks, null and empty policies, base/drop-in ordering, accumulated permission arrays, hook-only controls, ordinary versus managed disableAllHooks, supported permission-list repairs and malformed base/drop-in startup blocking. Portable export retains controlling keys while replacing private home paths. A browser journey follows an ignored hook to its controlling setting online and offline, then verifies correction.

Skill allowed-tools withholding uses official-reference fixtures while retaining skill discovery. Static file-policy results assume the file-based managed tier is selected. Remote, MDM, registry and embedding-host policy selection require session evidence. Managed schema recovery covers the implemented permission, hook and MCP locks, disableAllHooks, permission/MCP lists and provided MCP entries. Other managed schema repairs retain partial coverage. [Managed settings](https://code.claude.com/docs/en/managed-settings) [Settings reference](https://code.claude.com/docs/en/settings-reference)

Permission-list recovery retains each surviving rule's original array key and line. The resolver uses a separate location map for compacted effective lists. The native matrix checks a rejected entry before an applicable Bash restriction through the built CLI and portable report.

## Native MCP comparisons

`npm run test:claude` checks the pinned CLI in temporary homes. The matrix compares transport acceptance, pending approval, user-level approvals, repository/local self-approval, explicit rejection and fallback after invalid higher-priority entries. Synthetic stdio servers answer health-check requests and record their working directory. Eleven native `claude mcp add --scope local` registrations compare the actual saved key and selected server with the public scan. The cases cover logical/canonical project paths, nested and non-Git sessions, a wider --repo boundary, linked worktrees and separate Git directories. The shared project-identity resolver follows the same Windows and worktree selection used for external-import approval. Local definitions replace lower-scope servers with the same name, including pending project candidates. Four invalid local declarations verify native fallback to a valid user server. Portable reports retain field origins while replacing a separate project-state path with `<claude-project>`.

Claude requires an explicit remote type and accepts `streamable-http` as an HTTP alias. Omitted types select stdio. The selected schema determines which fields participate, and stdio uses the session directory. The scanner retains ignored fields with source warnings and uses the same field projection for drift and probes. Empty remote endpoints await configuration. [MCP transport reference](https://code.claude.com/docs/en/mcp)

User and managed settings can approve project servers before workspace trust. Repository and local approval settings are excluded in the static unknown-trust model. Inspected rejections still apply. `--trust trusted` explicitly models workspace trust and server approval. Invalid approval setting types receive source findings. [Approval behavior](https://code.claude.com/docs/en/mcp#project-server-approvals-and-workspace-trust)

Forty native policy cases compare literal names, exact command/argument arrays, transport-specific allowlist selectors, deny priority, scope merging, default/explicit/wildcard ports, case-sensitive paths, queries, fragments and environment expansion. URL patterns normalize literal dot segments. An expanded allowlist path may contain a slash or colon, while wildcard injection and parent traversal cause the entry to be ignored. The denylist may widen through expansion. User and managed settings can fill a missing denylist variable. Live server expansion uses settings environments while policy entries remain pinned to startup and managed environments. [Managed MCP matching](https://code.claude.com/docs/en/managed-mcp#match-servers-by-url-command-or-name)

Two scripted-API permission cases verify that unreadable ordinary MCP lists and invalid entries retain otherwise valid settings from that file. An invalid ordinary disableAllHooks rejects its settings layer.

Thirty-two native managed MCP cases exercise exclusive files, provided HTTPS servers, whole-entry replacement across drop-ins, managed-only allowlist controls, source locations after invalid entries and allowlist exemptions. A null managed allowlist becomes an empty allowlist. Malformed, empty and unreadable exclusive files, and an exclusive path that is a directory, suppress ordinary servers. A broken symlink leaves ordinary sources eligible. The dedicated Linux CI step uses the native system directory and compares the SDK, built CLI and portable report. Policy-blocked extensions retain field definitions and controlling origins. Executable diagnostics and explicit probes skip those extensions. [Managed MCP](https://code.claude.com/docs/en/managed-mcp)

Not resolved: filesystem ancestors outside --repo, session switches, account-synced/bundled/plugin components, worktree instruction-file fallback from the main checkout, full managed exceptions and all settings-specific scope/environment pairs. The tool does not claim to observe a running session.

A native MCP check discovers a root-project server alongside malformed settings and MCP files in a sibling project. The public report selects syntax diagnostics from the root target scope. Inspecting the sibling with its own --repo boundary activates its parser findings. [MCP configuration scopes](https://code.claude.com/docs/en/mcp#scope-hierarchy-and-precedence)

A native MCP health check verifies personal enableAllProjectMcpServers while the inspection boundary contains the personal settings directory. The source retains user scope and the approved project server remains active.

## Native instruction requests

Isolated scenarios run Claude Code 2.1.322 against a loopback scripted Messages API. The scenarios capture startup and post-Read requests and check the fixed completion, request count, empty permission-denial lists, ordered instruction markers and canonical file paths against the public scan. Target-opening scenarios issue a Read call and compare the next request, while checking that path-scoped bodies were absent from the initial request.

The matrix covers personal/project rules, per-directory local files, AGENTS fallback and combined/managed-only modes, recursive imports, rule imports, empty path lists, unmatched scoped parents and imported files with their own path metadata. Scoped-rule imports appear in startup discovery, and matching parent bodies arrive after the target is opened.

Project imports resolving outside the session directory use hasClaudeMdExternalIncludesApproved from the native Git project entry in ~/.claude.json. Windows retains the launch path with forward slashes. POSIX uses the canonical path. A non-Git session uses its directory entry. Exact native, canonical and logical state keys, approval, rejection and absent approval have native comparisons. The enclosing Git project entry supplies approval for sessions launched in its subdirectories. Linked worktrees use a shared Git project identity. A standard .git directory selects the main checkout, and a separate Git directory retains its own key. On Windows, launch aliases that differ from the canonical path retain their own project entry. Main-only and linked-only approval fixtures compare canonical and logical launches with the pinned native client. Git pointer metadata is inspected when project external-import approval or local MCP selection needs the project identity. Unreadable metadata produces a warning and conditional approval. Personal imports use their documented trusted scope, within Sightline’s existing read boundary. Repository-only scans report external-import approval as conditional.

Conditional or rejected imports can later load through an unconditional rule-discovery path. The account-state preview stays withheld, and the captured private-state marker is absent from the public report. Run npm run test:claude to reproduce the instruction and existing MCP/permission comparisons.

Linked-worktree identity also has a primary public report. The pinned local comparison verifies the behavior used here. [Claude Code issue 89460](https://github.com/anthropics/claude-code/issues/89460)

## Independent starting directory

Native request comparisons launch at the repository root with a nested target, and in a sibling directory with an explicitly permitted Read. Descendant CLAUDE.md, .claude/CLAUDE.md and CLAUDE.local.md load on demand. On-demand unconditional rules follow the local file, and matching newly discovered scoped rules precede scoped rules discovered at startup. Startup rules retain their rules-before-local order. Nested AGENTS files stay outside on-demand loading, including combined instruction mode. Reading a target outside the starting directory adds no on-demand instructions or scoped-rule bodies.

Relative and empty CLAUDE_CONFIG_DIR values have isolated native MCP comparisons. A custom directory contains both user settings and the selected .claude.json state file. Empty values select the ordinary OS-home locations. CLI comparisons launch from a different process directory with an explicit --session-dir and withhold account-state previews.
