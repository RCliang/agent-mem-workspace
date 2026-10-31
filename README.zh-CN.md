<div align="center">
  <img src="https://raw.githubusercontent.com/RCliang/agent-mem-workspace/main/packages/web/public/favicon.svg" width="64" height="64" alt="agent-mem logo">
  <h1>agent-mem</h1>
  <p><strong>一个工作台，管理所有编码 agent 的记忆。</strong></p>
  <p>查看、编辑、共享记忆文件，在不同 agent 之间交接工作。</p>
  <p>
    <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-%E2%89%A522.13.0-3fb68b?style=flat-square" alt="Node.js 22.13.0 or newer"></a>
    <a href="https://github.com/RCliang/agent-mem-workspace/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-a99bea?style=flat-square" alt="MIT license"></a>
    <a href="#快速开始"><img src="https://img.shields.io/badge/UI-English%20%2B%20中文-d97757?style=flat-square" alt="English and Chinese UI"></a>
  </p>
  <p><a href="https://github.com/RCliang/agent-mem-workspace/blob/main/README.md">English</a> · <strong>简体中文</strong></p>
  <p><a href="#产品演示">产品演示</a> · <a href="#快速开始">快速开始</a> · <a href="#功能概览">功能概览</a> · <a href="#支持的-agent">支持的 agent</a> · <a href="#命令行">命令行</a></p>
</div>

---

agent-mem 把 Claude Code、Codex、Pi 等工具分散的指令文件、技能库和会话记录放到同一个本地界面。切换 agent 时，可以复用已有规则，也可以把工作整理成交接文档。

## 产品演示

https://github.com/user-attachments/assets/35be245a-d86e-4f83-8438-97e660956099

[观看英文版演示](https://github.com/user-attachments/assets/52437a36-500a-4212-ae2a-017e961e6925)

## 快速开始

需要 **Node.js 22.13.0+**。运行后会打开本地网页。

```bash
npx --yes @liangstech/agent-mem@latest ui
```

想先看看界面，可以使用演示沙盒：

```bash
npx @liangstech/agent-mem ui --demo
```

`--demo` 使用一次性临时目录，不读取你的真实 agent 数据。

> 服务只监听 `127.0.0.1`，无需注册账号。会话摘要默认调用本机 agent CLI，无需单独配置 API Key；模型请求由所选 CLI 或你配置的接口处理。

## 功能概览

| 你想做什么 | agent-mem 怎么帮你 |
| --- | --- |
| 找到各家 agent 的记忆 | 汇总全局与项目级指令文件，同一文件被多个 agent 读取时只显示一份。 |
| 修改规则并检查改动 | 直接编辑 Markdown，保存前查看 diff，每次写入先备份，可撤销。 |
| 让多个 agent 复用规则 | 通过 `import`、`symlink` 或 `copy` 共享，源文件变化后保持同步。 |
| 换个 agent 接着做 | 把会话整理成包含目标、文件、命令与当前状态的交接文档。 |
| 整理技能库 | 查看、编辑、复制或迁移技能，同时管理跨 agent 共用的 `.agents/skills`。 |
| 按自己的习惯使用 | 中英文界面、深浅主题，也可直接使用命令行。 |

## 界面

| 视图 | 用途 |
| --- | --- |
| Board | 每个 agent 一列，查看记忆、编辑 Markdown、拖动复制文件或交接会话。 |
| Skills | 按技能库浏览，查看和编辑 `SKILL.md`，在库之间复制或迁移。 |
| Share matrix | 一眼看清每份记忆由谁读取，点击空格子为其他 agent 添加访问。 |
| History | 查看写入记录，撤销单次修改。 |

顶栏支持按标题、路径和内容搜索。侧边栏可以切换项目、选择显示的 agent，也可以折叠。

<details>
<summary>查看各视图的操作细节</summary>

- **Board**：每个 agent 一列。点开卡片编辑 Markdown，保存前可以看 diff。把卡片拖到另一列会先弹出预览，确认后才写入。拖指令文件是一次性复制；拖会话会生成交接文档。
- **Skills**：独立的技能库视图（不占 Board）。每个 agent 一列：`~/.claude/skills`、`~/.codex/skills`、`~/.pi/agent/skills`、`~/.zcode/skills`、`~/.qoder/skills`、`~/.dsh/skills` 和项目级 `.claude/skills`，外加跨 agent 共用的 `.agents/skills`（全局与项目级，带 shared 标记）。点卡片查看/编辑 SKILL.md；一键在库间复制或迁移（迁移 = 复制后删源，全程可撤销），也可整目录删除（先打包备份）。对 `.agents` 共用库的删除/移出会给出显著警告。
- **搜索**：顶栏搜索框按标题、路径、内容过滤 Board 卡片、matrix 行和 Skills 卡片（按 `/` 聚焦，Esc 清空）。
- **Share matrix**：一行一条记忆，一列一个 agent。点空格子即可授权。已经在读这个文件的 agent 显示为实心勾，点不了。
- **History**：每次写入都会先备份，可以单条撤销。
- **Projects / Agents 侧边栏**：项目由会话记录自动发现，也可以用「添加项目文件夹」（系统原生选择器）手动添加、或从列表移除不再展示；Agents 区块按 agent 勾选，取消勾选即隐藏 Board 列和 matrix 列（保存在浏览器本地，新装的 agent 默认显示）。整个侧边栏可以折叠，给看板让出空间。
- **主题与语言**：界面内置中文 / English 双语和深 / 浅两套主题，顶栏一键切换，选择保存在浏览器本地。

</details>

## 支持的 agent

| Agent | 指令文件 | 会话解析 |
| --- | --- | --- |
| Claude Code | `CLAUDE.md`、项目记忆 | 支持 |
| Codex | `AGENTS.md`、`AGENTS.override.md` | 支持 |
| Pi | `AGENTS.md`、`CLAUDE.md` | 支持 |
| Gemini CLI | `GEMINI.md` | 不解析 |
| Cursor | `rules/*.mdc` | 不解析 |
| opencode | `AGENTS.md` | 不解析 |
| ZCode | `AGENTS.md` | 不解析 |
| Qoder | `AGENTS.md`、`AGENTS.local.md`、`.qoder/rules/*.md` | 不解析 |
| DeepSeek Harness | `AGENTS.md`、`CLAUDE.md` 及本地变体 | 不解析 |

<details>
<summary>查看全局、项目与会话文件的完整路径</summary>

| Agent | 全局 | 项目 | 会话记录 |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/CLAUDE.md` | `CLAUDE.md`、`.claude/CLAUDE.md`、`CLAUDE.local.md`，以及 `~/.claude/projects/<项目>/memory/*.md` | `~/.claude/projects/<项目>/*.jsonl` |
| Codex | `~/.codex/AGENTS.md` | `AGENTS.md`（`AGENTS.override.md` 优先） | `~/.codex/sessions/**/*.jsonl` |
| Pi | `~/.pi/agent/AGENTS.md` | `AGENTS.md`、`CLAUDE.md` | `~/.pi/agent/sessions/--<项目>--/*.jsonl` |
| Gemini CLI | `~/.gemini/GEMINI.md` | `GEMINI.md`、`.gemini/GEMINI.md` | 不解析 |
| Cursor | `~/.cursor/rules/*.mdc` | `.cursor/rules/*.mdc` | 不解析 |
| opencode | `~/.config/opencode/AGENTS.md` | `AGENTS.md` | 不解析 |
| ZCode | `~/.zcode/AGENTS.md` | `AGENTS.md` | 不解析 |
| Qoder | `~/.qoder/AGENTS.md` | `AGENTS.md`、`AGENTS.local.md`、`.qoder/rules/*.md` | 不解析 |
| DeepSeek Harness | `~/.dsh/AGENTS.md`、`~/.agents/AGENTS.md` | `AGENTS.md`、`CLAUDE.md`（含 `.local` 变体） | 不解析 |

</details>

同一个文件被多个 agent 读取时（项目里的 `AGENTS.md` 同时属于 Codex、Pi、opencode、ZCode、Qoder 和 DeepSeek Harness），界面只把它算作一份，并标出「also read by」。

## 共享与交接

### 共享指令文件

授权有三种写法，矩阵里可以指定，不指定就按顺序自动选：

1. `import`，在 Claude Code 里加一行 `@路径`，源文件一改，它读到的就是新的。
2. `symlink`，目标文件还不存在时，直接链到源文件。
3. `copy`，把内容写进目标文件里一段 `<!-- agent-mem:begin -->` 标记的区块。源文件变化后会自动同步，你手写的其余部分留着不动。

### 交接会话

工作记忆不一样。会话是各家自己的 JSONL，没法塞进另一个 agent 正在进行的对话里。拖过去时先按原文预览，点 Summarize 才整理成交接摘要（目标、后续要求、改过的文件、跑过的命令、最后状态），写到目标 agent 下一次启动会读到的位置，并在写入前打码疑似密钥。

摘要优先用本机已装 agent 自己的 CLI（目标 agent → 来源 agent → 其他已装 agent，如 `claude -p`、`pi -p`、`codex exec`，无需任何 API Key），其次才用配置了 `AGENT_MEM_LLM_API_KEY` 的 OpenAI 兼容接口；没有可用模型时用规则摘要。

`AGENT_MEM_LLM_MODE=api|local` 可以强制只走某一条通道。`agent-mem handoff` 走摘要，`agent-mem transfer` 默认原文，加上 `--summarize` 才摘要。

## 命令行

查看项目记忆、检查环境，或把工作交给另一个 agent：

```bash
npx @liangstech/agent-mem ls -p .
npx @liangstech/agent-mem doctor
npx @liangstech/agent-mem handoff --from codex --to claude -p . --yes
```

下面的完整示例使用 `agent-mem` 命令。如果未全局安装，把命令开头的 `agent-mem` 换成 `npx @liangstech/agent-mem`。

<details>
<summary>展开命令与示例</summary>

界面上的操作都有对应命令。默认只打印将要写入的内容和 diff，加上 `--yes` 才会写盘。在终端里不加 `--yes` 时会再问一次。

```bash
agent-mem agents                   # 支持的 agent 及安装状态
agent-mem agents add <id> ...      # 注册自定义 agent（--display --home --project-file --imports）
agent-mem agents remove <id>       # 移除自定义 agent（内置 agent 不可移除）
agent-mem doctor                   # 体检：agent 检测、数据目录、share 一致性、孤儿备份
agent-mem clean                    # 删除历史已不引用的备份快照
agent-mem export -p . -o mem.json  # 项目记忆打包（含 share 关系）
agent-mem import mem.json -p ~/code/shop-api   # 恢复到另一个目录/机器
agent-mem ls                       # 发现到的项目
agent-mem ls -p ~/code/shop-api    # 这个项目下的全部记忆
agent-mem skills ls -p .           # 各库技能清单（shared = .agents 共用库）
agent-mem skills libraries         # 当前可用的技能库 id（migrate --to 的取值）
agent-mem skills migrate <name> --to claude-code [--move] [--overwrite] -p . --yes
agent-mem skills rm <name> -p . --yes   # 整目录删除，先备份，可 undo
agent-mem search <text> -p .       # 按标题/路径/内容搜记忆（含行号，--json 可选）
agent-mem link codex:AGENTS.md --to claude -p . --yes
agent-mem link ~/.claude/CLAUDE.md --to codex,pi --global --strategy copy --yes
agent-mem shares
agent-mem unlink <shareId> --yes
agent-mem handoff --from codex --to claude -p . --yes
agent-mem handoff --from codex --to pi --session <id> --yes
agent-mem transfer codex:AGENTS.md --to claude -p . --summarize --yes
agent-mem edit claude:CLAUDE.md -p . --file ./CLAUDE.md
agent-mem sync
agent-mem undo                     # 撤销最近一次写入
agent-mem history                  # 已记录的写入与撤销
agent-mem projects add ~/code/app
```

`claude` 是 `claude-code` 的别名，`gemini-cli` 是 `gemini` 的别名，`oc` 是 `opencode` 的别名。记忆可以用 `ls` 输出的 id、文件路径，或者 `agent:相对路径`。

</details>

## 接入别的 agent

任何「读某个 Markdown」的工具都不用改代码，DeepSeek Harness 就是这样内置进来的。自家工具在 `~/.agent-mem/config.json` 里声明它读哪些文件即可：

```json
{
  "projects": ["/home/you/extra-project"],
  "agents": [
    {
      "id": "my-cli",
      "displayName": "My CLI agent",
      "homeDir": "~/.my-cli",
      "globalFile": "~/.my-cli/AGENTS.md",
      "projectFiles": ["AGENTS.md"],
      "imports": false
    }
  ]
}
```

`homeDir` 存在才算已安装。更复杂的读取逻辑可以用 `plugins` 指向一个 ESM 模块，默认导出 `(ctx) => AgentAdapter`。

模型摘要默认走本机 agent CLI；想用托管接口时通过环境变量配置，不写进参数，避免留在 shell 历史里：

```bash
export AGENT_MEM_LLM_API_KEY=...
export AGENT_MEM_LLM_BASE_URL=https://api.deepseek.com   # 可选，默认 OpenAI
export AGENT_MEM_LLM_MODEL=deepseek-chat                 # 可选
```

## 发布 npm

在仓库根目录安装依赖后，执行：

```bash
pnpm --dir packages/cli publish --access public
```

`prepack` 会重新构建并检查安装包。发布包内含 CLI、网页和内部模块，用户无需安装 pnpm 或编译源码。需要有效的 npm 登录；发布新版本前先更新 `packages/cli/package.json` 的版本号。

## 开发

从源码运行：

```bash
pnpm install
pnpm build
pnpm ui
```

开发检查与前端热更新：

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
- 界面中的 agent 图标取自各家官方素材（`packages/web/public/agents/`），仅用于标识对应产品；其版权归 Anthropic、OpenAI、Pi (pi.dev)、Google、Cursor、opencode、Z.ai、Qoder 各自所有。ZCode 官方暂未发布 SVG，使用其官方透明 PNG。

## 许可证

[MIT](https://github.com/RCliang/agent-mem-workspace/blob/main/LICENSE)。
