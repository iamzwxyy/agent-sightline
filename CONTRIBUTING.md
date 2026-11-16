# Contributing

Fix a demonstrably wrong loading rule before adding another client. Every rule change needs an official source link, a dated version/contract, and a fixture that fails with the old behavior.

## Get a working checkout

Use Node.js 22 or later and run commands from the repository root.

```sh
npm ci
npm run lint
npm run typecheck
```

Choose a bounded proposal with code entry points and acceptance checks. [Starter work](docs/good-first-issues.md)

The Chinese and Japanese quick starts explain installation, inspection and sharing. [简体中文](README.zh-CN.md) · [日本語](README.ja.md)

## Verify the area you change

Run the focused check for the behavior you changed. Browser checks need Chromium installed once.

```sh
npx playwright install chromium
```

| Change | Focused check |
| --- | --- |
| Parsing, resolution and findings | `node --import tsx --test tests/core.test.ts tests/scoped-findings.test.ts` |
| Report formatting and privacy | `node --import tsx --test tests/reporter.test.ts tests/preview-privacy.test.ts` |
| Local inspector | `npx playwright test tests/web/inspector.spec.ts` |
| Website and install commands | `npm run test:web -- tests/web/website.spec.ts tests/web/website-prefix.spec.ts` |
| Client loading rules | `npm run test:codex`, `npm run test:claude` or `npm run test:copilot`, alongside the relevant fixture tests |

The complete checks include pinned native-client comparisons, a production build and an isolated offline package installation. Run the same complete checks used by CI with the commands below.

```sh
npm run check
npm run test:web
```

CI runs the checks on Linux, macOS and Windows, with Firefox coverage on Linux. Platform-specific skips are recorded by their tests.

## Prepare the change

Keep scans local and read-only. Never spawn an agent, hook, or configured command during default scan. An explicit stdio probe may initialize an MCP server and list tools; never invoke a tool. Return raw source text only inside internal resolution, and redact at all public/export boundaries.

Small pull requests should explain the previous behavior, the client version that establishes the correction, the fixture demonstrating it, and validation. Do not classify natural-language disagreements as deterministic conflicts. Use experimental maturity when evidence is incomplete.

See [adapter guide](docs/adapters.md), [architecture](docs/architecture.md), and [starter issues](docs/good-first-issues.md).
