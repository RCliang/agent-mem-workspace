# agent-mem

Overview: a local-first tool that shows the memory files of the coding agents installed on your machine (Claude Code, Codex, Pi, and anything you add), lets you edit them, share one file with the other agents, and drag a session from one agent onto another. Sharing writes a file the target agent already reads. A drag of a session becomes a handoff note, because one agent's transcript cannot be loaded into another's session.

在本机用一个界面看、改、同步 Claude Code、Codex、Pi 的记忆文件，也可以把某个会话整理成交接文档交给另一个 agent。程序只监听 `127.0.0.1`，不上传任何内容。

## 它能做什么

静态记忆就是这些 agent 启动时会读的 Markdown，所以直接改文件是可靠的：

| Agent | 全局 | 项目 | 会话记录 |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/CLAUDE.md` | `CLAUDE.md`、`.claude/CLAUDE.md`、`CLAUDE.local.md`，以及 `~/.claude/projects/<项目>/memory/*.md` | `~/.claude/projects/<项目>/*.jsonl` |
| Codex | `~/.codex/AGENTS.md` | `AGENTS.md`（`AGENTS.override.md` 优先） | `~/.codex/sessions/**/*.jsonl` |
| Pi | `~/.pi/agent/AGENTS.md` | `AGENTS.md`、`CLAUDE.md` | `~/.pi/agent/sessions/--<项目>--/*.jsonl` |
| Gemini CLI | `~/.gemini/GEMINI.md` | `GEMINI.md`、`.gemini/GEMINI.md` | 不解析 |
| Cursor | `~/.cursor/rules/*.mdc` | `.cursor/rules/*.mdc` | 不解析 |
| opencode | `~/.config/opencode/AGENTS.md` | `AGENTS.md` | 不解析 |

同一个文件被多个 agent 读取时（项目里的 `AGENTS.md` 同时属于 Codex 和 Pi），界面只把它算作一份，并标出「also read by」。

工作记忆不一样。会话是各家自己的 JSONL，没法塞进另一个 agent 正在进行的对话里。拖过去时，agent-mem 会把会话整理成一份 `handoff.md`（目标、后续要求、改过的文件、跑过的命令、最后状态），写到目标 agent 下一次启动会读到的位置，并在写入前打码疑似密钥。配置了 `AGENT_MEM_LLM_API_KEY` 时，可以用兼容 OpenAI 的接口把这份摘要再润色一次。

## 界面

`agent-mem ui` 会在本地起一个网页。

- **Board**：每个 agent 一列。点开卡片编辑 Markdown，保存前可以看 diff。把卡片拖到另一列会先弹出预览，确认后才写入。拖指令文件是一次性复制；拖会话会生成交接文档。
- **Share matrix**：一行一条记忆，一列一个 agent。点空格子即可授权。已经在读这个文件的 agent 显示为实心勾，点不了。
- **History**：每次写入都会先备份，可以单条撤销。
- **Agents 勾选**：侧边栏的 Agents 区块按 agent 勾选，取消勾选即隐藏 Board 列和 matrix 列（保存在浏览器本地，新装的 agent 默认显示）。

授权有三种写法，矩阵里可以指定，不指定就按顺序自动选：

1. `import`，在 Claude Code 里加一行 `@路径`，源文件一改，它读到的就是新的。
2. `symlink`，目标文件还不存在时，直接链到源文件。
3. `copy`，把内容写进目标文件里一段 `<!-- agent-mem:begin -->` 标记的区块。源文件变化后会自动同步，你手写的其余部分留着不动。

## 安装与运行

需要 Node 20 以上。

```bash
pnpm install
pnpm build
pnpm ui
```

没有安装这些 agent、只想看看界面时：

```bash
pnpm ui -- --demo --no-open
```

`--demo` 使用一个临时目录，不会读你真实的 `~/.claude`、`~/.codex`、`~/.pi`。

## 命令行

界面上的操作都有对应命令。默认只打印将要写入的内容和 diff，加上 `--yes` 才会写盘。在终端里不加 `--yes` 时会再问一次。

```bash
agent-mem agents                   # 支持的 agent 及安装状态
agent-mem ls                       # 发现到的项目
agent-mem ls -p ~/code/shop-api    # 这个项目下的全部记忆
agent-mem link codex:AGENTS.md --to claude -p . --yes
agent-mem link ~/.claude/CLAUDE.md --to codex,pi --global --strategy copy --yes
agent-mem shares
agent-mem unlink <shareId> --yes
agent-mem handoff --from codex --to claude -p . --yes
agent-mem handoff --from codex --to pi --session <id> --llm --yes
agent-mem edit claude:CLAUDE.md -p . --file ./CLAUDE.md
agent-mem sync
agent-mem undo                     # 撤销最近一次写入
agent-mem projects add ~/code/app
```

`claude` 是 `claude-code` 的别名，`gemini-cli` 是 `gemini` 的别名，`oc` 是 `opencode` 的别名。记忆可以用 `ls` 输出的 id、文件路径，或者 `agent:相对路径`。

## 接入别的 agent

DeepSeek harness 这类「读某个 Markdown」的工具不用改代码。在 `~/.agent-mem/config.json` 里声明它读哪些文件：

```json
{
  "projects": ["/home/you/extra-project"],
  "agents": [
    {
      "id": "deepseek",
      "displayName": "DeepSeek harness",
      "homeDir": "~/.deepseek",
      "globalFile": "~/.deepseek/AGENTS.md",
      "projectFiles": ["AGENTS.md"],
      "imports": false
    }
  ]
}
```

`homeDir` 存在才算已安装。更复杂的读取逻辑可以用 `plugins` 指向一个 ESM 模块，默认导出 `(ctx) => AgentAdapter`。

模型摘要使用环境变量，不写进参数，避免留在 shell 历史里：

```bash
export AGENT_MEM_LLM_API_KEY=...
export AGENT_MEM_LLM_BASE_URL=https://api.deepseek.com   # 可选，默认 OpenAI
export AGENT_MEM_LLM_MODEL=deepseek-chat                 # 可选
```

## 开发

```bash
pnpm test          # vitest
pnpm typecheck
pnpm lint
pnpm --filter @agent-mem/web dev   # 前端热更新，接口代理到 4477
```

仓库是 pnpm workspace：`packages/core` 是适配器和写入计划，`packages/server` 是只绑定本机的 Hono 服务（含文件监听和 SSE），`packages/web` 是 React 界面，`packages/cli` 是 `agent-mem` 命令。

写入前会比对你打开文件时的内容哈希，磁盘上的版本已经变了就拒绝覆盖。备份在 `~/.agent-mem/backups/`。服务会拒绝不是来自本机的 Host 和跨站的写请求。

## 边界

- 各 agent 的目录结构会随版本变化。适配器用公开的路径约定，并带了三家会话格式的样例测试；对不上时优先看 `ls` 读到了什么。
- 交接文档是给「下一次启动」读的，不会改写一个已经打开的会话。
- 复制和交接会扫描常见的密钥格式并打码，但不能代替你自己看一遍 diff。
