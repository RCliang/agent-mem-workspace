# Web UI 可美化点审查

> 范围：`packages/web`（Board / Share matrix / History / Editor / Session / Plan 弹窗）
> 方式：`agent-mem ui --demo --no-open` 启动示例数据，在 905px 视口实测并对照源码
> 日期：2026-10-24

## 总体判断

当前设计底子是统一的：暗色主题、IBM Plex Sans/Mono、agent 品牌色、lucide 图标、焦点环、自定义滚动条，以及 `prefers-reduced-motion` 都已覆盖，不需要推翻重做。

主要问题不在配色，而在四点：

1. **响应式断点**：768–1023px 区间信息过挤，1024px 以下侧边栏直接消失。
2. **信息层级**：标题、路径、元信息重量接近，操作入口过弱或过吵。
3. **空状态**：风格不统一，搜索无结果时文案会误导。
4. **细节一致性**：编辑器缺少暗色语法高亮、Ctrl/⌘ 不区分平台、设计 token 未收干净。

---

## P0：布局与响应式

### 1. Header 导航文字溢出

**现象**：905px 下 `Share matrix` 按钮内容高度 34px，但按钮固定 `h-7`（28px），文字实际溢出容器。

**位置**：[App.tsx:230](../packages/web/src/App.tsx#L230)（导航）、[App.tsx:242](../packages/web/src/App.tsx#L242)（标签显隐）

**建议**：

- 按钮加 `whitespace-nowrap`。
- `md` 区间使用短标签（`Matrix`），`xl` 再显示完整文案。
- 更窄时只留图标，用 `title` / tooltip 补全语义。

### 2. 1024px 以下侧边栏完全消失

**现象**：侧边栏固定 `hidden lg:flex`，且没有移动端替代入口。窄屏下无法切换 agent 可见性、无法添加项目，只能通过 header 的项目下拉切换项目。

**位置**：[App.tsx:257](../packages/web/src/App.tsx#L257)、[Sidebar.tsx:47](../packages/web/src/components/Sidebar.tsx#L47)

**建议**：Header 增加汉堡按钮，复用现有 Sidebar 做成左侧 Sheet 抽屉；桌面端保留常驻侧栏。

### 3. 768px 以下搜索框消失

**现象**：搜索区使用 `hidden md:block`，但 `/` 快捷键仍然生效，形成“快捷键可用但看不到输入框”的状态。

**位置**：[App.tsx:201](../packages/web/src/App.tsx#L201)、[App.tsx:56](../packages/web/src/App.tsx#L56)

**建议**：窄屏改为搜索图标，点击展开全宽输入框；或把搜索放进移动端抽屉。

### 4. 看板列宽在中等屏过挤

**现象**：列最小宽度 300px，905px 视口只能看到 2.8 列，唯一提示是底部横向滚动条。

**位置**：[Board.tsx:215](../packages/web/src/components/Board.tsx#L215)、[Board.tsx:321](../packages/web/src/components/Board.tsx#L321)

**建议**：

- 横向滚动加 `scroll-snap-type` 与列 `scroll-snap-align`。
- 两侧加渐隐遮罩或滚动阴影，明确“还有内容”。
- `md` 以下改为纵向堆叠，避免横向滚动。

### 5. 窄屏 Drawer 全屏覆盖，缺少返回感

**现象**：`lg` 以下 Editor/Session 抽屉变为 `absolute inset-0`，只剩右上角关闭按钮；Editor 按 Esc 直接关闭（`EditorDrawer.tsx:96`），未保存草稿没有确认步骤。

**位置**：[App.tsx:301](../packages/web/src/App.tsx#L301)、[App.tsx:313](../packages/web/src/App.tsx#L313)、[EditorDrawer.tsx:96](../packages/web/src/components/EditorDrawer.tsx#L96)

**建议**：补返回箭头和标题栏；关闭前若 `dirty` 为真，弹出“放弃修改 / 继续编辑”确认。

### 6. Matrix 宽表没有粘性表头和首列

**现象**：表格 `min-w-[720px]`，6 个 agent 时实际宽度约 1400px；横向滚动后行名与 agent 名都不可见。

**位置**：[Matrix.tsx:67](../packages/web/src/components/Matrix.tsx#L67)、[Matrix.tsx:74](../packages/web/src/components/Matrix.tsx#L74)、[Matrix.tsx:85](../packages/web/src/components/Matrix.tsx#L85)

**建议**：

- 表头 `sticky top-0`，首列 `sticky left-0`。
- 首列加右侧阴影，滚动时与数据区形成层次。
- 行 hover 状态覆盖首列，避免粘性列背景割裂。

---

## P1：信息层级与卡片

### 7. 看板卡片主次不分，操作过弱

**现象**：标题、路径、元信息视觉重量接近；发送按钮常态使用 `text-ink-500`，对比度仅 2.42:1，既不够可发现又形成干扰。

**位置**：[Board.tsx:66](../packages/web/src/components/Board.tsx#L66)、[Board.tsx:73](../packages/web/src/components/Board.tsx#L73)、[Board.tsx:146](../packages/web/src/components/Board.tsx#L146)

**建议**：

- 标题提升到 13px/600，路径降到 11px 并做中间省略（保留文件名）。
- 操作按钮改为 hover/focus 时显现，触屏设备常驻。
- scope 标签增加图标或颜色区分 `global` / `project` / `private`。

### 8. Matrix 被长路径和常驻加号占据

**现象**：每行都是“标题 + 完整路径”两行，长路径喧宾夺主；每个空单元格常驻虚线加号，6×11 的表格会产生大量视觉噪音。

**位置**：[Matrix.tsx:85](../packages/web/src/components/Matrix.tsx#L85)、[Matrix.tsx:117](../packages/web/src/components/Matrix.tsx#L117)

**建议**：

- 路径单行截断，完整路径放 `title`。
- 空单元格默认只显示浅色占位，行或单元格 hover 时再显示加号。
- native 状态目前是整块 agent 实心色，建议改为浅色底 + agent 色描边 + 勾选图标，降低“满屏色块”感。

### 9. 空状态风格不统一

**现象**：Board 的“全部 agent 被隐藏”是居中提示，做得不错；History 和 Matrix 的空状态只是左上角一行 13px 灰字。

**位置**：[Board.tsx:322](../packages/web/src/components/Board.tsx#L322)、[History.tsx:7](../packages/web/src/components/History.tsx#L7)、[Matrix.tsx:60](../packages/web/src/components/Matrix.tsx#L60)

**建议**：统一为“图标 + 一句说明 + 主操作按钮”的居中空状态。History 可引导“去 Board 拖动或共享一条记忆”，Matrix 可引导“先创建 instructions”。

### 10. 搜索无结果时文案错误

**现象**：过滤后 Board 仍显示 `No memory files for this agent here yet.`，Matrix 会提示“先去创建文件”，但实际只是没有匹配项。

**位置**：[Board.tsx:230](../packages/web/src/components/Board.tsx#L230)、[Matrix.tsx:60](../packages/web/src/components/Matrix.tsx#L60)

**建议**：

- 区分“本来为空”与“搜索无匹配”。
- 展示查询词与清除入口。
- 在标题/路径中高亮命中片段。

### 11. 看板列存在大面积死空间

**现象**：列背景与页面同为 `ink-950`/`ink-900`，内容少时右侧大片空洞，容器边界不够明确。

**位置**：[Board.tsx:215](../packages/web/src/components/Board.tsx#L215)

**建议**：

- 列体使用极淡 tinted 背景或内阴影。
- 组标题（Instructions / Auto memory / Sessions）吸顶。
- 列头补数量徽标，增强“每列是一个 agent”的结构感。

---

## P2：编辑器、Diff、会话细节

### 12. 编辑器缺少暗色语法高亮

**现象**：CodeMirror 只定义了基础主题，没有暗色 highlight style。实测 Markdown 标记颜色为 `rgb(64, 71, 64)`，在 `#0c0e11` 背景上对比度仅 **2.02:1**；标题与正文几乎同色，代码块和行内代码没有区分。

**位置**：[EditorDrawer.tsx:11](../packages/web/src/components/EditorDrawer.tsx#L11)、[EditorDrawer.tsx:25](../packages/web/src/components/EditorDrawer.tsx#L25)

**建议**：

- 引入暗色 syntax highlighting（One Dark 或自定义）。
- 单独设置标题、粗体、链接、行内代码、代码块、列表标记的颜色和字重。
- 选中背景与光标色已统一为 signal，可继续保持。

### 13. Diff 长行折行破坏可读性

**现象**：`break-all` 会把一行 diff 折成多行，行号与内容错位感强；无文件/段落粘性标题，长文件滚动时上下文丢失。

**位置**：[DiffView.tsx:55](../packages/web/src/components/DiffView.tsx#L55)、[DiffView.tsx:47](../packages/web/src/components/DiffView.tsx#L47)

**建议**：

- 改为横向滚动 + `white-space: pre`。
- 增加粘性文件头或 hunk 头。
- `unchanged lines` 支持点击展开。
- 增删底色再柔化一档，避免与 agent 色冲突。

### 14. 会话气泡过宽，角色信息太弱

**现象**：气泡铺满整行，但正文限制 72ch；角色标签只有 11px 灰字；长消息直接截断 1800 字。

**位置**：[SessionDrawer.tsx:82](../packages/web/src/components/SessionDrawer.tsx#L82)、[SessionDrawer.tsx:83](../packages/web/src/components/SessionDrawer.tsx#L83)、[SessionDrawer.tsx:84](../packages/web/src/components/SessionDrawer.tsx#L84)

**建议**：

- 加 agent 头像/品牌色条，用户与 agent 分列或缩进。
- 气泡设置最大宽度，正文左对齐。
- 支持 Markdown 渲染与代码块样式。
- 截断改为“展开全文”。

### 15. 编辑器细节不平台化

**现象**：页脚硬编码 `Ctrl S`，Mac 用户看到错误提示；禁用态主按钮仅 45% 透明，金色底仍像可点击。

**位置**：[EditorDrawer.tsx:187](../packages/web/src/components/EditorDrawer.tsx#L187)、[EditorDrawer.tsx:192](../packages/web/src/components/EditorDrawer.tsx#L192)、[ui.tsx:50](../packages/web/src/ui.tsx#L50)

**建议**：

- 根据 `navigator.platform` / `userAgentData` 显示 ⌘ 或 Ctrl。
- 禁用主按钮改中性底色，不要保留 signal 色。

### 16. Plan 弹窗等待体验与细节

**现象**：默认开启 LLM 后，实测一段时间内只有一块纯色骨架；notes 里的绝对路径未 tildify；`new file` 标签在窄列会换行。

**位置**：[PlanDialog.tsx:125](../packages/web/src/components/PlanDialog.tsx#L125)、[PlanDialog.tsx:84](../packages/web/src/components/PlanDialog.tsx#L84)、[PlanDialog.tsx:140](../packages/web/src/components/PlanDialog.tsx#L140)

**建议**：

- 加载态加 spinner 与阶段文案（“正在用 Codex 总结…”），并提供取消。
- 路径统一走 `useTildify`。
- Tag 增加 `whitespace-nowrap`。
- 文件 tab 加文件类型图标，当前激活 tab 增加底色而不只是下划线。

### 17. 设计 token 未收干净

**现象**：hover 金色写死为 `#f0bf63`；卡片/菜单阴影在多处重复；字号大量使用 11/12/13/14/15 任意值。

**位置**：[ui.tsx:51](../packages/web/src/ui.tsx#L51)、[Board.tsx:60](../packages/web/src/components/Board.tsx#L60)、[Matrix.tsx:26](../packages/web/src/components/Matrix.tsx#L26)、[styles.css:8](../packages/web/src/styles.css#L8)

**建议**：

- `@theme` 中补 `--color-signal-hover`、`--shadow-pop`、`--shadow-drawer`。
- 定义 `--text-xs/sm/base/lg` 对应 11/12/13/15px。
- 编辑器内联的 rgba 阴影和选区色同步收进 token。

### 18. Agent 品牌色使用面积过小

**现象**：目前只出现在 4px 竖条和 7–8px 圆点，识别 agent 仍主要靠文字。

**位置**：[ui.tsx:5](../packages/web/src/ui.tsx#L5)、[Board.tsx:221](../packages/web/src/components/Board.tsx#L221)

**建议**：

- 列头使用 agent 色的极淡渐变或底部描边。
- 拖拽落点、Matrix hover、Session 角色条复用同一色。
- 注意 Cursor 的 `#e0e0e0` 接近白色，大面积使用会过于抢眼，需单独降低饱和度。

### 19. 页面级 polish

- [index.html:5](../packages/web/index.html#L5) 缺少 `theme-color`、`description`、OG 信息。
- [Toasts.tsx:32](../packages/web/src/components/Toasts.tsx#L32) 可加倒计时进度条，Undo 操作更易被发现。
- 视图切换目前是硬切，可加 120–160ms 淡入，保持 `prefers-reduced-motion` 下禁用。

---

## 加分项

| 功能 | 价值 |
| --- | --- |
| `Cmd/Ctrl+K` 命令面板 | 切项目、搜记忆、执行 Sync / 新建，减少鼠标移动 |
| `?` 快捷键帮助面板 | 配合现有 `/`、Esc、⌘S，形成完整键盘体系 |
| 密度切换（舒适 / 紧凑） | 大项目看板和 History 更实用 |
| 编辑器 Markdown 预览 tab | 目前只有 Edit / Diff，预览能提升写作体验 |
| 列头吸顶 + 滚动阴影 | 长列表下仍能定位当前 agent |

---

## 建议落地顺序

1. Header 导航不换行（改动最小，立即消除溢出）。
2. 移动端 Sidebar / 搜索入口（影响可用性）。
3. 搜索无结果文案与空状态统一（低成本，体验提升明显）。
4. 编辑器暗色语法高亮（视觉收益最大）。
5. Matrix 粘性首列 + 表头（宽表可用性）。

## 验收方式

- `pnpm typecheck`、`pnpm lint`、`pnpm test` 全绿。
- `agent-mem ui --demo --no-open` 分别在 **1440px、1024px、905px、768px、390px** 五种宽度下检查：
  - Header 无文字溢出、按钮不换行。
  - 侧边栏/搜索在各断点有可用入口。
  - Board 列可滚动且有明确滚动提示。
  - Editor 抽屉有返回与未保存确认。
  - Matrix 横向滚动时表头与首列保持可见。
- 键盘走查：`/`、Esc、⌘/Ctrl+S、Tab 焦点顺序、`prefers-reduced-motion` 下无动画。
- 对比度检查：正文 ≥ 4.5:1，图标/边框等非文本 ≥ 3:1。
