# Broken agent configuration

These files contain deliberate errors. Do not copy them into a real project.

From the Sightline source repository:

```sh
node dist/cli/index.js examples/broken-agent-config --no-user
node dist/cli/index.js explain src/payments/refund.ts --repo examples/broken-agent-config --clients codex,claude,copilot --no-user --trust trusted
```

Expected findings include missing imports, an import cycle, missing MCP commands/environment, divergent MCP commands, deny overriding allow, an unavailable hook command, invalid skill metadata and malformed JSON. The target explanation also shows the Codex override, its byte truncation, and the Python rule failing to match.

The sample's Codex configuration is in `src/payments/.codex/config.toml`. The installed sample has no Git root marker, so Codex uses the target's session directory for project configuration. This keeps the 160-byte limit and MCP example active in both the source checkout and the installed package.
