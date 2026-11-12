# Copilot evidence ledger

Verified 2026-11-12. Documentation target: @github/copilot 1.0.109 (npm latest at research time). Copilot CLI differs from VS Code, cloud agent and code review; those products are not inferred.

Sources: [custom instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions), [CLI reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference), [config directory](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference), [MCP](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers), [hooks](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks).

| Concern | Implemented contract |
| --- | --- |
| User | COPILOT_HOME or ~/.copilot: copilot-instructions.md, instructions/**/*.instructions.md, settings.json (JSONC), mcp-config.json, hooks, skills |
| State | config.json contains internal/trust state; user settings there are ignored in this version |
| Instructions | AGENTS.md, CLAUDE.md, .claude/CLAUDE.md, GEMINI.md, .github/copilot-instructions.md in root/cwd/intermediate target ancestors |
| Priority | Instructions combine; no general order is documented. Inspector display order is deterministic, not precedence |
| Duplicates | Identical non-modular user/repo/agent bodies are deduplicated |
| Imports | @relative in AGENTS/CLAUDE/repository-wide files; recursively resolves inside repo/user instruction root; none in GEMINI or modular files |
| Modular | .github/instructions/**/*.instructions.md at root/cwd, not intermediate dirs; applyTo glob required, comma patterns/brace expansion; excludeAgent does not disable CLI |
| Size | Does not apply the code-review 4,000-character limit to CLI |
| MCP | Personal then trusted workspace .mcp.json/.github/mcp.json cwd-to-Git-root, closer wins; same-directory ties remain conditional |
| Skills | Project .github → .agents → .claude → inherited .github → personal .copilot → personal .agents; first name wins |
| Hooks | .github/hooks/*.json and personal hooks; version 1; bash/Powershell platform commands, cwd and literal command checks |
| Invalid files | Parse/shape errors reported; invalid MCP entry does not discard valid sibling definitions |

Fixture: `fixtures/copilot/chain.json`. Tests distinguish JSONC personal settings, imports, applyTo and CLI-specific limits from other products.

Structural validation was reviewed against the official MCP and hook references on 2026-11-13. Malformed MCP collections retain diagnostics and valid definitions from adjacent workspace files. Hook working directories require path strings, and hook environments map names to strings. Static executable checks use the configured hook environment. Regression fixtures cover invalid collections, field types, platform command locations and an explicit probe that skips invalid definitions while initializing a valid sibling.

Not resolved: enterprise allowlists, runtime /instructions toggles, plugin priority, added/custom roots, all saved permission rules and ignoredSkillsLocations. These limitations are visible in adapter metadata.
