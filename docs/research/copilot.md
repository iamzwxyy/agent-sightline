# Copilot evidence ledger

Verified 2026-11-13 against the pinned @github/copilot 1.0.110 CLI and current official documentation. The recorded contracts cover Copilot CLI.

Sources: [custom instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions), [CLI reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference), [config directory](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference), [MCP](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers), [hooks](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks).

| Concern | Implemented contract |
| --- | --- |
| User | COPILOT_HOME or ~/.copilot: copilot-instructions.md, instructions/**/*.instructions.md, settings.json (JSONC), mcp-config.json, hooks, skills |
| Personal aliases | Registered snake_case fields, legacy colorMode/color_mode and featureFlags normalize within known setting shapes. Dynamic mapping names retain their spelling. Last definition wins within a file, with original source keys retained |
| State | config.json contains internal/trust state; user settings there are ignored in this version |
| Settings | Personal settings followed by .github/copilot/settings.json and settings.local.json, with field-specific replacement, union, map-entry replacement and hook append policies |
| Shared settings | The repository's .claude/settings.json and settings.local.json contribute companyAnnouncements, disableAllHooks, enabledPlugins, extraKnownMarketplaces and hooks. Conflicting same-scope values remain conditional |
| Instructions | AGENTS.md, CLAUDE.md, .claude/CLAUDE.md, GEMINI.md, .github/copilot-instructions.md in root/cwd/intermediate target ancestors |
| Priority | Instructions combine; no general order is documented. Inspector display order is deterministic, not precedence |
| Duplicates | Identical non-modular user/repo/agent bodies are deduplicated |
| Imports | @relative in AGENTS/CLAUDE/repository-wide files; recursively resolves inside repo/user instruction root; none in GEMINI or modular files |
| Modular | .github/instructions/**/*.instructions.md at root/cwd, not intermediate dirs; applyTo glob required, comma patterns/brace expansion; excludeAgent does not disable CLI |
| Shared rules | .claude/rules/**/*.md at repository root and cwd. paths metadata becomes applyTo; rules with no paths contribute unconditionally |
| Size | Does not apply the code-review 4,000-character limit to CLI |
| MCP | Personal then trusted workspace .mcp.json/.github/mcp.json cwd-to-Git-root, closer wins; same-directory ties remain conditional |
| Skills | Project .github → .agents → .claude → inherited .github → personal .copilot → personal .agents; first name wins |
| Hooks | Repository/personal hook files use version 1. Inline hooks contribute from personal, repository, local and shared Claude settings. Commands support platform fields, command fallback and direct exec. cwd is repository-root-relative |
| Invalid files | Parse/shape errors reported. Invalid supported canonical personal fields reject the personal document. Invalid snake_case values can prevent normalization while retaining original canonical values. Invalid MCP entries preserve valid sibling definitions |

Fixture: `fixtures/copilot/chain.json`. Tests distinguish JSONC personal settings, imports, applyTo and CLI-specific limits from other products.

Structural validation was reviewed against the official MCP and hook references on 2026-11-13. Malformed MCP collections retain diagnostics and valid definitions from adjacent workspace files. Hook working directories require path strings, and hook environments map names to strings. Static executable checks use the configured hook environment. Regression fixtures cover invalid collections, field types, platform command locations and an explicit probe that skips invalid definitions while initializing a valid sibling.

`tests/copilot-runtime.test.ts` calls the pinned binary through its framed JSON-RPC interface with auto-login and auto-update disabled. Thirteen merge scenarios compare public scan output with `user.settings.mergeRepoValue`, including empty restriction lists, the default Git-ignore restriction, whole marketplace entries and repeated local layers. Thirty-four type cases compare static subtree validation with `user.settings.validate`. The comparisons require no conversation session or model request.

Separate native CLI inventories cover current and legacy folder-trust keys, disabled workspace MCP servers, and the shared-rule locations and path metadata. Each trust scenario has its own repository and home. The MCP inventory reads configuration without starting the declared server. The native dependency remains a development-only input. [Pinned package](https://www.npmjs.com/package/@github/copilot/v/1.0.110)

Copilot accepts JSONC in shared settings. The native Claude 2.1.322 check reproduces the same file being ignored by Claude when comments/trailing commas are present. Discovery retains the JSONC tree for Copilot while Claude reparses its settings layer using strict JSON. Syntax findings remain client-scoped, with parsed-value redaction applied to source previews.

Known coverage gaps include enterprise allowlists, runtime instruction toggles, plugin contents, saved permission rules and ignoredSkillsLocations. Additional discovery directories retain conditional declarations and mark coverage incomplete. Personal fields outside the fourteen repository-overridable keys have partial schema coverage. Same-scope Copilot/Claude file ordering and workspace MCP file ties retain conditional candidates. [Settings contract](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference) · [Hook formats](https://docs.github.com/en/copilot/reference/hooks-reference) · [Additional discovery locations](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/customization-locations)

`fixtures/copilot/aliases.json` pins the registered field-normalization shapes against `user.settings.normalize`. The test also compares the complete personal-key catalog with `user.settings.get`, then rewrites an isolated settings file through valid collisions, null selectors, invalid canonical fields and normalization fallback. File-loading assertions compare explicitly configured effective values with `user.settings.get`. A separate real MCP inventory checks both spellings of disabledMcpServers without starting the synthetic server. Unknown personal keys are diagnosed from the catalog. Catalog membership comes from user.settings.get. The native single-key validator accepts unknown names.

Personal settings outside the validated subset retain partial value-schema coverage. Native `config --list` and the RPC metadata reader differ on malformed legacy theme values. Theme interpretation follows `user.settings.get`; malformed theme normalization is omitted from effective values.
