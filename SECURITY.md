# Security policy

The supported release series are 0.1.x and 0.2.x. Report a reproducible security issue through [GitHub private vulnerability reporting](https://github.com/iamzwxyy/agent-sightline/security/advisories/new). Use synthetic sentinel values and describe the affected function.

The CLI reads documented local config paths. It does not collect telemetry, call models, sign in, upload files, fetch instruction URLs, or start configured processes during default scans. The local UI binds to 127.0.0.1 and rejects external Host/Origin values. Config content is inert text; scripts are protected by a hash-based CSP.

Environment and header mappings, sensitive structured keys, common credential formats, labelled Markdown credentials, auth headers and URL credentials are redacted. Portable HTML replaces captured repository/home paths and filesystem-verified aliases found in absolute structured configuration values and --option=path arguments. Custom agent configuration roots use named placeholders. Exported HTML discards the captured path mappings. Unrecognized paths in prose or shell snippets can remain. Review personal prose and unfamiliar path spellings before sharing.

`doctor --probe` is an explicit execution boundary: it launches a configured local MCP process, sends initialize and tools/list, and kills the process after completion or timeout. Server code can have startup side effects. It does not invoke tools or probe remote endpoints. Hook commands and dynamic skill shell snippets are never executed by Sightline.

External import/symlink trees are skipped or marked incomplete. File reads are capped at 2 MiB. Repository discovery defaults to 50,000 entries and can be configured with --max-entries.
