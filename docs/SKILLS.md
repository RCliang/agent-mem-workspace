# Skills 库管理

> 分支：`feature/skills-library`。与记忆管理同构（适配器 → core Plan → server API → Web/CLI），但 skill 是**目录**（`SKILL.md` + 任意资源文件），不是单个文件。

## 支持的库

| 库 | 位置 | 说明 |
| --- | --- | --- |
| Claude Code | `~/.claude/skills`、项目 `.claude/skills` | |
| Codex | `~/.codex/skills` | |
| Pi | `~/.pi/agent/skills` | |
| ZCode | `~/.zcode/skills` | |
| Qoder | `~/.qoder/skills` | |
| **Shared (.agents)** | `~/.agents/skills`、项目 `.agents/skills` | 跨 agent 共用约定，多个工具同时读取，**破坏性操作需谨慎** |

适配器通过可选的 `AgentAdapter.skillRoots(projectPath)` 声明自己的技能根目录；`.agents` 共用库由 core 统一注入（虚拟 `shared` 库，独立列展示）。目录里没有 `SKILL.md` 的文件夹不算技能。同名技能在多个库存在时用 `agent:name` 消歧（如 `codex:browse`）。跨根 realpath 去重与记忆一致（`alsoReadBy`）。

## 操作与安全

所有操作走与记忆相同的 **Plan 流水线**：预览 → 确认 → 应用，应用前做磁盘漂移检查（目录存在性与预览时不符即拒绝）。`Plan` 新增 `dirOps`（`copy-dir` / `delete-dir`），`applyPlan` 先校验后执行。

- **复制 / 迁移**：`copy-dir` 递归复制整个技能目录；`--move`（或 UI 的 Move 开关）= 复制后删除源目录。目标已有同名技能默认报错，`--overwrite`（UI 在确认框中替换）覆盖前先备份。
- **删除**：整目录删除，删除前打包为 tar.gz 存入 `~/.agent-mem/backups/files/`（`BackupEntry.isDir`），`undo` 解包完整还原（含嵌套文件）。
- **`.agents` 共用库的谨慎处理**：shared 库的删除/移出在 Plan notes 中给出显著警告（"every agent reading .agents loses it / moving it takes it away from all of them"），UI 卡片与列均带 shared 标记；写入 shared 库也会提示"对所有遵循该约定的工具生效"。

## 界面

顶栏独立的 **Skills** tab（不与记忆 Board 混排）：每个库一列，卡片显示技能名、frontmatter 描述（截断 220 字符）、文件数/体积/时间、shared 与 also-read-by 标记。点卡片打开抽屉编辑 `SKILL.md`（乐观并发，409 提示重新预览）。卡片的迁移菜单选择目标库，确认框内可切换 Copy/Move 并预览目录操作；`Delete…` 走同一确认流。侧边栏的 agent 勾选同样过滤 Skills 列（shared 列始终显示），顶栏搜索框过滤技能卡片。

## API 与 CLI

```
GET    /api/skills?project=          # { libraries, skills }
GET    /api/skill/:id?project=       # 含 SKILL.md 内容与 hash
PUT    /api/skill/:id                # 编辑 SKILL.md（expectedHash 并发检查）
POST   /api/skill/transfer/preview   # { project, skillId, targetAgent, move?, overwrite? }
POST   /api/skill/delete/preview     # { project, skillId }
POST   /api/apply                    # 既有端点，执行 dirOps
```

```bash
agent-mem skills ls [-p <dir> | -g] [--json]
agent-mem skills libraries
agent-mem skills migrate <name|agent:name> --to <库> [--move] [--overwrite] [-y]
agent-mem skills rm <name|agent:name> [-y]
```

watcher 把所有技能根目录纳入深监听（技能库规模 = 技能数，有界），技能文件变化实时刷新 UI。

## 测试

`packages/core/test/skills.test.ts`（发现/去重/shared 标记/描述解析/名称消歧/复制含嵌套文件/overwrite/迁移+undo 还原/删除+undo/漂移冲突）+ server API 测试 + CLI `skills` 全流程测试（ls → migrate --move → 重复冲突 → rm → undo）。全套 85 个用例通过。
