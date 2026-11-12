# Launch drafts

## Show HN

**Show HN: Agent Sightline — see which instructions your coding agent actually loads**

Submit the interactive inspector at https://iamzwxyy.github.io/agent-sightline/demo/

I built a local, read-only configuration inspector for coding agents. Point it at a source file and see each instruction/config source, its loading reason, overrides, path matching and truncation. It compares Codex, Claude Code and Copilot CLI and produces a shareable standalone HTML report. No account, API key, model call or telemetry.

The example includes a missing import, a cycle, an override, missing MCP runtimes and contradictory permission entries. The adapter metadata links to dated official evidence and fixtures. Gemini, Cursor and OpenCode support is explicitly experimental. Feedback on incorrect loading rules is especially welcome.

Website and browser demo https://iamzwxyy.github.io/agent-sightline

Source and releases https://github.com/iamzwxyy/agent-sightline

Try the sample with Node.js 22+

```sh
npm exec --yes --package=https://github.com/iamzwxyy/agent-sightline/releases/download/v0.2.0/agent-sightline-0.2.0.tgz -- agent-sightline demo
```

The package is publicly downloadable from the website. Initial npm-registry publication is awaiting account authentication.

## Reddit

Built an offline inspector for the “why is my agent ignoring this configuration?” problem. It shows effective instructions for a chosen file and links every loading decision to a local source line. Codex override/budget rules, Claude imports/path rules, and Copilot instruction accumulation differ; the comparison view makes those differences visible. Includes read-only MCP/skill/hook diagnostics and CI-friendly JSON. Would love minimal repros for version-specific rules.

Try the interactive example at https://iamzwxyy.github.io/agent-sightline/demo/ and find the source at https://github.com/iamzwxyy/agent-sightline.

## X

Your coding agents can read different instructions from the same repo.

Agent Sightline shows what each one loads, why, what gets ignored or truncated, and where it came from. Local CLI + browser inspector. No model calls.

Try it in your browser https://iamzwxyy.github.io/agent-sightline/demo/

Source https://github.com/iamzwxyy/agent-sightline

Use the actual product screenshot in `docs/assets/inspector.png` when posting.

## 中文社区

做了一个 AI Coding Agent 配置诊断工具：Agent Sightline。

给它一个源文件，就能看到 Codex、Claude Code、Copilot CLI 会读哪些指令和配置、为何生效、哪些被 override 遮蔽、glob 未匹配或字节预算截断。支持来源行号、客户端对比、MCP/Skill/Hook 检查、CI JSON 和单文件 HTML 报告。

默认本地、只读，不需要账号或 API Key，不调用模型。规则有官方依据和 fixture，实验性适配器标注了限制。

官网和浏览器演示 https://iamzwxyy.github.io/agent-sightline

开源地址 https://github.com/iamzwxyy/agent-sightline

Node.js 22+ 可运行示例

```sh
npm exec --yes --package=https://github.com/iamzwxyy/agent-sightline/releases/download/v0.2.0/agent-sightline-0.2.0.tgz -- agent-sightline demo
```
