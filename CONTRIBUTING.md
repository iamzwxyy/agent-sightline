# Contributing

Fix a demonstrably wrong loading rule before adding another client. Every rule change needs an official source link, a dated version/contract, and a fixture that fails with the old behavior.

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:web
```

Keep scans local and read-only. Never spawn an agent, hook, or configured command during default scan. An explicit stdio probe may initialize an MCP server and list tools; never invoke a tool. Return raw source text only inside internal resolution, and redact at all public/export boundaries.

Small pull requests should explain the previous behavior, the client version that establishes the correction, the fixture demonstrating it, and validation. Do not classify natural-language disagreements as deterministic conflicts. Use experimental maturity when evidence is incomplete.

See [adapter guide](docs/adapters.md), [architecture](docs/architecture.md), and [starter issues](docs/good-first-issues.md).
