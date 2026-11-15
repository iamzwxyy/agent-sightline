# Experimental adapters

Cursor and OpenCode contracts were checked against official documentation on 2026-11-12. Gemini context imports were checked against published 0.68.0 code on 2026-11-15. Partial discovery contracts also have fixtures in `fixtures/mixed/experimental.json`.

* Gemini inspects default user/project settings, bare context filenames, applicable ancestor context and local imports. Its import processor has thirty-one isolated executable comparisons covering both formats, shared references, cycles, code regions, native boundaries, aliases and a forty-file flat chain. Workspace trust, user-project memory, additional directories, .env loading, extensions, hooks, skills and policy remain partial. [Configuration](https://geminicli.com/docs/reference/configuration/) [Context files](https://geminicli.com/docs/cli/gemini-md/)
* [Cursor rules](https://cursor.com/docs/rules): AGENTS.md hierarchy, .mdc frontmatter, alwaysApply, globs, intelligent/manual conditional state. @references remain literal. Editor user/team rules, plugin components and hooks are outside scope. Local MCP files are recognized.
* [OpenCode V2 instructions](https://opencode.ai/docs/instructions/) and [config](https://opencode.ai/docs/config/): global + nearest-first ancestor AGENTS.md, direct config before .opencode layers. V2 recognizes AGENTS.md only, so V1 CLAUDE.md fallback is not asserted. Configured glob/remote instructions, MCP and policy evaluation need expansion.

Experimental reports remain useful for discovery and syntax errors, but must be reviewed with each adapter’s limitations before setting CI policy.

## Gemini import evidence

`fixtures/upstream/gemini-0.68.0` contains the published `memoryImportProcessor.js`, its `paths.js` and `debugLogger.js` dependencies, and the package's Apache 2.0 license. The modules use Node built-ins. Their byte hashes are checked before the comparisons in `tests/gemini-memory.test.ts`. The downloaded package has SHA-256 `e5c9e297c721acdf89df21012ac88603a846cdb71bcc714950fe251d0d3ac025`. [Published package](https://registry.npmjs.org/@google/gemini-cli-core/-/gemini-cli-core-0.68.0.tgz)

The tree processor inserts imported content at each reference, with HTML comment delimiters. Sibling references can load the same path repeatedly. The processed-path set follows the current chain, and the root file is initially absent from that set. At depth five, the deepest text retains its import directives. Code regions are identified by paired backticks. Tilde fences retain the processor's literal treatment and can contain active imports. [Versioned processor source](https://github.com/google-gemini/gemini-cli/blob/v0.68.0/packages/core/src/utils/memoryImportProcessor.ts)

Flat processing retains each file's text and appends uniquely normalized paths in reverse encounter depth-first order. Its root block uses the context file's directory as its label. The published flat branch expands beyond five levels. Each top-level context starts a separate processed-path set. Native memory markers determine each context's import boundary. [Versioned discovery source](https://github.com/google-gemini/gemini-cli/blob/v0.68.0/packages/core/src/utils/memoryDiscovery.ts)

Sightline reads imported text through the existing source cache and reading budget. A native-permitted import outside the selected inspection scope produces an incomplete report and a source-linked diagnostic. Source segments preserve the literal positions around inserted imports. Effective text includes native formatting, while source comparisons use the captured literal segments. The adapter's overall maturity remains experimental.

Imported structured text receives the existing parser's privacy ranges. Source-aware redaction covers scalar environment values and Markdown frontmatter while preserving public Boolean fields. Decoded aliases and escaped spellings join the captured private-value set. YAML graph traversal retains alias privacy across cycles. A tree import inside a private field marks its expanded source text private, including earlier contributions from the same source. Paragraph grouping uses raw content before source-specific masking.
