# Launch drafts — use after public release

## Show HN

**Show HN: Agent Sightline — see which instructions your coding agent actually loads**

I built a local, read-only configuration inspector for coding agents. Point it at a source file and see each instruction/config source, its loading reason, overrides, path matching and truncation. It compares Codex, Claude Code and Copilot CLI and produces a shareable standalone HTML report. No account, API key, model call or telemetry.

The example includes a missing import, a cycle, an override, missing MCP runtimes and contradictory permission entries. The adapter metadata links to dated official evidence and fixtures. Gemini, Cursor and OpenCode support is explicitly experimental. Feedback on incorrect loading rules is especially welcome.

Add verified repository/package links and the tested install command at launch.

## Reddit

Built an offline inspector for the “why is my agent ignoring this configuration?” problem. It shows effective instructions for a chosen file and links every loading decision to a local source line. Codex override/budget rules, Claude imports/path rules, and Copilot instruction accumulation differ; the comparison view makes those differences visible. Includes read-only MCP/skill/hook diagnostics and CI-friendly JSON. Would love minimal repros for version-specific rules.

## X

Your coding agents can read different instructions from the same repo.

Agent Sightline shows what each one loads, why, what gets ignored or truncated, and where it came from. Local CLI + browser inspector. No model calls.

Attach the real terminal screenshot, demo clip and verified link after publication.

## 中文社区

做了一个 AI Coding Agent 配置诊断工具：Agent Sightline。

给它一个源文件，就能看到 Codex、Claude Code、Copilot CLI 会读哪些指令和配置、为何生效、哪些被 override 遮蔽、glob 未匹配或字节预算截断。支持来源行号、客户端对比、MCP/Skill/Hook 检查、CI JSON 和单文件 HTML 报告。

默认本地、只读，不需要账号或 API Key，不调用模型。规则有官方依据和 fixture；实验性适配器明确标注限制。发布时附真实演示和可运行安装命令。
