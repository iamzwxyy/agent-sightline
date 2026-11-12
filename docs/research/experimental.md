# Experimental adapters

All verified against official documentation on 2026-11-12, with a partial contract fixture in `fixtures/mixed/experimental.json`. No exact installed-client conformance claim is made.

* [Gemini CLI](https://geminicli.com/docs/reference/configuration/) and [GEMINI.md source docs](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md): user/project settings, context.fileName, global/ancestor/JIT context. Imports, .env loading, workspace extensions, hooks, skills and policy engine need additional resolution.
* [Cursor rules](https://cursor.com/docs/rules): AGENTS.md hierarchy, .mdc frontmatter, alwaysApply, globs, intelligent/manual conditional state. @references remain literal. Editor user/team rules, plugin components and hooks are outside scope. Local MCP files are recognized.
* [OpenCode V2 instructions](https://opencode.ai/docs/instructions/) and [config](https://opencode.ai/docs/config/): global + nearest-first ancestor AGENTS.md, direct config before .opencode layers. V2 recognizes AGENTS.md only, so V1 CLAUDE.md fallback is not asserted. Configured glob/remote instructions, MCP and policy evaluation need expansion.

Experimental reports remain useful for discovery and syntax errors, but must be reviewed with each adapter’s limitations before setting CI policy.
