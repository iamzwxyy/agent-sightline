# 30-second demo

Use the installed local tarball. Run commands below in a terminal large enough to show 100 columns.

1. **0–8s:** `agent-sightline demo --clients codex,claude,copilot --severity warn` — show missing import/cycle, unavailable MCP command/env, and permission masking.
2. **8–18s:** `agent-sightline explain src/payments/refund.ts --repo examples/broken-agent-config --client codex --no-user --trust trusted` — point to the override source and exact byte truncation line.
3. **18–25s:** `agent-sightline diff src/payments/refund.ts --repo examples/broken-agent-config --clients codex,claude,copilot --no-user --trust trusted` — compare instruction recipients.
4. **25–30s:** `agent-sightline ui --repo examples/broken-agent-config --no-user --trust trusted` — inspect a source and export HTML.

Steps 2–4 use the example tree in this source checkout. `demo` resolves the bundled example even when the CLI is installed globally.

The terminal screenshot in README is generated from actual demo output; no fabricated statistics or claims are inserted.
