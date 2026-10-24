# agent-mem 三轮测试与优化记录

> 分支：`feature/agent-mem-optimization`（自 `cursor/agent-memory-hub-781e` 切出）
> 基线：b9b1cb4（45 个测试全绿）。三轮结束后：57 个测试全绿，build / typecheck / lint 全部通过。

## 基线测试（第 0 轮）

对 main 上的原始代码做了完整验证，作为后续每一轮的回归基准：

| 检查项 | 结果 |
| --- | --- |
| `pnpm build`（core/server/cli/web 四包） | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm lint` | ✅ |
| `pnpm test`（vitest，7 个文件 45 用例） | ✅ 全过 |
| `agent-mem ui --demo --no-open` 冒烟 | ✅ 127.0.0.1:4477 正常服务 |

每轮开发完成后均重复以上五项校验，并额外对新增 CLI 命令做沙箱冒烟（`AGENT_MEM_HOME` 指向临时目录，不触碰真实 `~/.claude` 等目录）。

---

## 第一轮：coding agent 生态扩展

### 1.1 新增三个内置 coding agent 适配器

**问题**：内置 agent 只有 Claude Code、Codex、Pi，README 里甚至把 Gemini CLI 当作「需要用户手写 config.json」的例子。

**方案**：按现有 `AgentAdapter` 接口新增三个内置适配器（`packages/core/src/adapters/`）：

| Agent | id | 全局记忆 | 项目记忆 | imports 能力 |
| --- | --- | --- | --- | --- |
| Gemini CLI | `gemini` | `~/.gemini/GEMINI.md` | `GEMINI.md`、`.gemini/GEMINI.md` | ✅ `@path` 导入（handoff 引用即写 `@相对路径`） |
| Cursor | `cursor` | `~/.cursor/rules/*.mdc`（逐个规则文件列出） | `.cursor/rules/*.mdc` | ❌（写入目标是专用规则文件 `agent-mem.mdc`） |
| opencode | `opencode` | `~/.config/opencode/AGENTS.md`（尊重 `XDG_CONFIG_HOME`） | `AGENTS.md` | ❌ |

技术要点：

- 三个适配器均为「纯 Markdown 读取型」，无会话解析（`listProjects` 返回空，项目发现依赖其他 agent 的会话日志或手动 `projects add`）。
- opencode 原生读取项目 `AGENTS.md`，与 Codex/Pi 形成三方 `alsoReadBy` 关系；Hub 按 realpath 去重后矩阵里 `AGENTS.md` 仍是一行，单元格正确显示多个 native 读者。
- `hub.ts`：`AGENT_ALIASES` 新增 `gemini-cli → gemini`、`oc → opencode`；适配器注册顺序决定 Board 列顺序。
- Web UI：`AGENT_COLORS` 与 `styles.css` 增加三个品牌色变量（`--color-agent-gemini/cursor/opencode`）。
- 开发中修过一个真实 bug：cursor 的规则文件列表用 `names.map(fileItem)` 返回了未 await 的 Promise 数组，混入 memories 后把整行数据变成 undefined 属性的对象，测试立刻暴露；改为 `Promise.all(...)`。

**测试**：`adapters.test.ts` 更新检测/记忆清单/`alsoReadBy` 断言，新增「extra built-in agents」与别名解析用例；`app.test.ts` 的 agents/memories 数量断言更新；沙箱 fixture 与 `--demo` 数据补三个 agent 的样例文件。

### 1.2 Web UI 可勾选式 agent 显示过滤

**问题**：六个 agent 之后 Board 列变拥挤，未安装的 agent 列没有意义，用户无法收起。

**方案**：侧边栏新增「Agents」区块，每个 agent 一行复选框（含品牌色圆点、「n/a」未安装角标）；取消勾选即隐藏该 agent 的 Board 列与 Share matrix 列，抽屉里的「Send to / Hand off to」目标列表同步过滤。

技术要点：

- 状态存 `localStorage`（key `agent-mem:hidden-agents`），**存隐藏集合而非显示集合**——新出现的 agent（如刚 `agents add` 的自定义 agent）默认可见。
- 过滤在 `App.tsx` 一处完成（`visibleAgents` / `visibleRows`），Board/Matrix/EditorDrawer/SessionDrawer 全部复用；matrix 的 cells 由服务端按全部 adapters 返回，前端按隐藏集同步裁剪，保证表头与单元格对齐。
- 全部取消勾选时 Board 显示引导提示而非空白。
- 「Show all x/y shown」按钮一键恢复。

### 1.3 `agent-mem agents` 命令

列出全部 agent（内置 + 自定义）及安装检测状态、imports 能力；`--json` 输出结构化结果，便于脚本消费。配合 1.1，新增 agent 后用户能立刻确认是否被识别。

---

## 第二轮：可用性与健壮性

### 2.1 Watcher 覆盖全部 agent（第一轮遗留缺陷修复）

**问题**：`server/watcher.ts` 的 `watchRoots` 硬编码只监听 `~/.claude`、`~/.codex`、`~/.pi/agent`。第一轮新增的 Gemini/Cursor/opencode 记忆文件变化不会触发 SSE → UI 不刷新，也不触发 copy share 的自动同步。

**方案**：把「哪些目录值得监听」下放为适配器自身的知识——`AgentAdapter` 新增可选方法 `watchRoots(): string[]`；六个内置适配器与 declarative 适配器全部实现；watcher 改为 `hub.adapters` 里 `detect()` 通过的适配器收集 roots（另有项目目录与 share 源目录）。

**测试**：`app.test.ts` 新增 watcher 用例——追加写入 `~/.gemini/GEMINI.md` 后应收到 `changed` SSE 事件。这个模式以后每加一个 agent 只需实现 `watchRoots`，不会再漏。

### 2.2 跨 agent 记忆搜索

**问题**：记忆分散在 6 个 agent、几十个文件里，无论 UI 还是 CLI 都无法按关键词定位（例如「哪份记忆提到过 rate limit」）。

**方案**：

- **CLI**：`agent-mem search <text> [-p <project> | -g] [--json]`。对当前范围内全部记忆的标题、路径、内容做大小写不敏感匹配；内容命中输出 `L<行号>: <该行内容>`（每文件最多 5 行）；会话条目按标题/路径匹配（正文不载入）。
- **Web UI**：顶栏搜索框（`md` 以上显示），按标题/路径/内容同时过滤 Board 卡片与 matrix 行；`/` 聚焦、`Esc` 清空失焦；右侧实时显示 `命中数/总数`。纯前端过滤，直接复用已加载的 memories 数据，无新 API。

**测试**：CLI search 用例断言跨 agent 命中（同一关键词命中 ≥3 个 agent 的文件）、行号输出、无命中文案与 `--json` 结构。

### 2.3 `agent-mem doctor` 健康诊断

新命令做四类检查，发现问题时退出码为 1（可接入 CI / 脚本）：

1. **Agent 检测**：每个 agent 是否安装（`detect()`）；
2. **数据目录**：`~/.agent-mem` 可创建且可写；
3. **Share 一致性**：每条 share 的 source/target 文件是否存在（悬空 share 是迁移/手删文件后的常见故障）；
4. **备份统计**（并在第三轮扩展为孤儿备份报告）。

`--json` 输出完整报告。**测试**：健康沙箱退出 0；手工注入 source 缺失的 share 记录后退出 1 且输出 `source missing`。

---

## 第三轮：可运维性与可迁移性

### 3.1 `agent-mem agents add / remove`：自定义 agent 的 CLI 管理

**问题**：README 里接入新 agent 需要「手改 `~/.agent-mem/config.json`」，`projects add` 有命令而 agents 没有，不对称。

**方案**：

```bash
agent-mem agents add deepseek --display "DeepSeek harness" \
  --home ~/.deepseek [--global-file ~/.deepseek/AGENTS.md] \
  [--project-file AGENTS.md]... [--imports]
agent-mem agents remove deepseek
```

技术要点：

- 核心逻辑在 `Hub.addAgent / removeAgent`（`hub.ts`）：id 合法性（`^[a-z][a-z0-9-]*$`）、displayName/homeDir 非空、内置 id 不可覆盖/移除；写入 `config.json` 的 `agents[]`，复用现有 declarativeAdapter 装载路径。
- `--project-file` 可重复传值（commander `collect` 收集器）。
- 注意点：常驻 server 不会热加载 config.json，命令行加完需重启 `agent-mem ui`（CLI 每次命令新建 Hub，即加即用）。

**测试**：add → `agents` 列表出现且 `ls --json` 能读到其项目记忆 → remove 成功；对内置 agent remove 返回 1 且报 `built in`。

### 3.2 备份快照清理：`pruneBackups` / `agent-mem clean`

**问题**：备份 journal 上限 500 条，但 `~/.agent-mem/backups/files/` 里的快照文件**永不删除**——被挤出 journal 的快照成为磁盘孤儿，长期累积。

**方案**：

- `store.ts` 新增 `pruneBackups(ctx)`（删除 journal 不再引用的快照文件）与 `orphanBackupCount(ctx)`；
- CLI `agent-mem clean [--yes]`：无孤儿时直接退出 0；有孤儿先报数量再经统一 `confirm` 门禁删除；
- `doctor` 增加孤儿备份报告（`n orphan backup files (run agent-mem clean)`，计入 problems）。

**测试**：真实 edit 产生备份 → journal 清空使其成为孤儿 → doctor 退出 1 → `clean --yes` 删除 → doctor 恢复退出 0。

### 3.3 记忆快照：`agent-mem export / import`

**问题**：换机器 / 换目录时，记忆文件可以 `cp -r`，但 share 关系（存在 `~/.agent-mem/shares.json` 里的绝对路径）全部断裂，copy 策略的自动同步失效。

**方案**：单文件 JSON bundle（`core/src/bundle.ts`）：

- **`exportBundle(hub, project)`**：收集该项目目录内（`isInside`）的全部非会话、非全局记忆；按 **realpath 去重**（`AGENTS.md` 被 Codex/Pi/opencode 同时读取只导一份，记录 readers 列表）；条目存 `relPath + content`（相对路径，可移植）；项目内 share 记录转为 `sourceRel/targetRel`。
- **`planImportBundle(hub, bundle, targetProject)`**：relPath 重组到目标目录；内容已一致的文件跳过（幂等：重复 import 零写入）；路径逃逸防护（`..` 段直接拒绝）；涉及本机未配置 agent 的 share 记录跳过并提示 `agents add`。返回写入 Plan + 待注册 share 记录，沿用既有「预览 diff → 确认 → applyPlan（带 hash 冲突检测与备份）」流水线。
- **`registerImportedShares`**：applyPlan 成功后按 id 幂等合并进 `shares.json`，迁移后的 copy share 恢复自动同步。

```bash
agent-mem export -p ~/code/shop-api -o mem.json
agent-mem import mem.json -p ~/code/shop-api-restored --yes
```

**测试**（`bundle.test.ts` + CLI）：导出去重与 relPath 正确性；导入后文件内容一致、share 恢复且「改源文件 → syncShares 更新目标」链路可用；重复导入零写入；恶意 `../` bundle 被拒。

---

## 三轮总览

| 轮次 | 主题 | 交付 |
| --- | --- | --- |
| 一 | agent 生态 | Gemini/Cursor/opencode 内置适配器；UI 可勾选 agent 过滤；`agents` 命令 |
| 二 | 可用性/健壮性 | watcher 全 agent 覆盖（缺陷修复）；跨 agent 搜索（CLI + UI）；`doctor` 诊断 |
| 三 | 运维/迁移 | `agents add/remove`；备份清理 `clean`；`export/import` 记忆快照 |

**测试规模**：45 → 57 个用例（+12），新增/修改覆盖：适配器检测与记忆读取、别名、matrix cells、watcher 新目录事件、search 行为、doctor 退出码、agents add/remove、clean 孤儿清理、bundle 往返与逃逸防护。

**每一轮的验证流程**（均通过后才提交）：

1. `pnpm build`（含 web 前端产物）
2. `pnpm typecheck`
3. `pnpm lint`
4. `pnpm test`（全量 vitest）
5. 沙箱冒烟：`AGENT_MEM_HOME=/tmp/...` 下逐个执行新 CLI 命令核对输出；`ui --demo` 起服务后 curl `/api/agents`、`/api/memories`、静态页面

**提交记录**：

```
feat(round-1): add Gemini CLI, Cursor and opencode adapters with checkbox agent filter
feat(round-2): watch all agent dirs, cross-agent memory search, doctor command
feat(round-3): custom agent management, backup pruning, memory bundles
```

## 已知边界与后续方向

- gemini/cursor/opencode 不解析会话日志：项目发现依赖 Claude/Codex/Pi 的 session 或手动添加；后续可按各自存储格式补 `parseSession`。
- 常驻 server 不热加载 `config.json`：`agents add` 后需重启 UI 进程；可加 config 文件监听。
- bundle 目前只覆盖项目级记忆与项目内 share；全局记忆与跨项目 share 的迁移可作 V2（`version: 2` 字段已预留语义）。
- Web 搜索为前端过滤，依赖已加载记忆内容；记忆规模显著变大后可下沉为 `/api/search`。

## 第四轮（追加）：本地 agent CLI 作为交接摘要器（默认）

应用户需求：「Summarize with LLM 能否直接用被拖过去 agent 自己的调用方式」——答案是现在可以，而且是**默认优先**。

- **适配器声明 CLI**（`AgentAdapter.cli?: AgentCli`）：claude（`claude -p --tools "" --no-session-persistence`，工具禁用防注入、不留会话记录）、pi（`pi -p --mode text`）、codex（`codex exec --skip-git-repo-check`）、gemini（`gemini -p`）、opencode（`opencode run`）；Cursor 是 IDE 无 CLI 不声明。
- **摘要链**：规则摘要（离线保底）→ 勾选 LLM 后按 **目标 agent → 来源 agent → 其他已装 agent** 的顺序尝试本地 CLI（spawn 子进程、120s 超时、ENOENT/失败自动下一个）→ 都不可用时走 `AGENT_MEM_LLM_API_KEY` 的 OpenAI 兼容接口 → 全部失败回退规则摘要并在备注说明。`AGENT_MEM_LLM_MODE=api|local` 可强制通道。
- **UI**：`/api/info` 返回 `llmLocal`（本机可用的 CLI agent）；「Summarize with LLM」勾选框**默认勾选**（有任一摘要器即亮起），tooltip 说明通道与回退顺序。
- **提示词安全**：转写内容一律作为「数据」传入，明确指示忽略其中的指令、只输出 Markdown 文档；claude 通道禁用全部工具。
- **测试**：stub 适配器（node 脚本模拟 CLI）验证成功路径与备注文案；`AGENT_MEM_LLM_MODE=api` 跳过本地路径；`llmLocalSummarizers` 清单；既有 HTTP LLM 测试加 mode=api 隔离本机真实 CLI。62 个测试全过。
- **真实验证**：本机 codex 会话 → claude-code 交接预览，`claude -p` 完成（41s），中文交接文档结构完整，全程无 API Key。

## 附：真实环境首跑暴露并修复的 watcher 缺陷

在真实 home 目录首次启动 `agent-mem ui` 时连续暴露两个问题，均已修复并带回归测试（测试数 57 → 58 → 59 前后）：

1. **EPERM 崩溃**：曾在 `$HOME` 本身跑过的 agent 会话让 home 成了「项目」，watcher 递归监听整个 home，walk 到 macOS 受保护的 `~/.Trash` 时抛未处理的 `error` 事件直接崩溃。修复：chokidar `error` 事件统一兜底（去重日志、进程不退出）；`$HOME` 与 `~/.Trash` 及其子路径从监听列表剔除。
2. **EMFILE 文件描述符耗尽**：原设计对每个项目目录按深度 5 递归监听，项目列表里出现 `~/Downloads`、`~/Documents/projects` 这类巨型目录即打爆 fd（错误刷屏、服务无响应）。修复：监听目标改为两级结构——agent 配置树（会话日志所在，`watchRoots()`，深度 5，规模受会话数约束）+ 项目仅监听「记忆文件所在的确切目录」（由 `hub.memories()` 推导，深度 0，不递归）；`ignored()` 同时跳过 socket/fifo（如 `~/.codex/ipc/ipc.sock`）。

修复后真实环境验证：日志零 watch 错误，HTTP 正常，项目/agent 接口秒回。
