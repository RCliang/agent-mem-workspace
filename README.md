<div align="center">
  <img src="https://raw.githubusercontent.com/RCliang/agent-mem-workspace/main/packages/web/public/favicon.svg" width="64" height="64" alt="agent-mem logo">
  <h1>agent-mem</h1>
  <p><strong>One workspace for every coding agent's memory.</strong></p>
  <p>Browse, edit, and share memory files. Hand off work between coding agents.</p>
  <p>
    <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-%E2%89%A522.13.0-3fb68b?style=flat-square" alt="Node.js 22.13.0 or newer"></a>
    <a href="https://github.com/RCliang/agent-mem-workspace/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-a99bea?style=flat-square" alt="MIT license"></a>
    <a href="#quick-start"><img src="https://img.shields.io/badge/UI-English%20%2B%20Chinese-d97757?style=flat-square" alt="English and Chinese UI"></a>
  </p>
  <p><strong>English</strong> · <a href="https://github.com/RCliang/agent-mem-workspace/blob/main/README.zh-CN.md">简体中文</a></p>
  <p><a href="#demo">Demo</a> · <a href="#quick-start">Quick start</a> · <a href="#features">Features</a> · <a href="#supported-agents">Supported agents</a> · <a href="#cli">CLI</a></p>
</div>

---

agent-mem brings the instruction files, skill libraries, and session logs scattered across Claude Code, Codex, Pi, and other tools into one local interface. Reuse your rules and hand off work when you switch agents.

## Demo

https://github.com/user-attachments/assets/52437a36-500a-4212-ae2a-017e961e6925

## Quick start

Requires **Node.js 22.13.0+**. This opens a local web app:

```bash
npx --yes @liangstech/agent-mem@latest ui
```

Want to look around first? Start a demo sandbox:

```bash
npx @liangstech/agent-mem ui --demo
```

`--demo` uses a throwaway directory and never reads your real agent data.

> The server binds to `127.0.0.1` only. No account required. Session summaries use locally installed agent CLIs by default, with no separate API key needed. Model requests are handled by your chosen CLI or configured endpoint.

## Features

| What you need | What agent-mem does |
| --- | --- |
| Find your agents' memories | Browse global and project instructions. Files read by several agents appear once. |
| Edit with confidence | Edit Markdown, review the diff, and undo writes from automatic backups. |
| Reuse rules across agents | Share through `import`, `symlink`, or `copy`, with changes kept in sync. |
| Continue with another agent | Turn a session into a handoff note with goals, files, commands, and current state. |
| Organize skills | Browse, edit, copy, or migrate skill folders, including shared `.agents/skills` libraries. |
| Work your way | English and Chinese UI, dark and light themes, plus CLI commands. |

## The UI

| View | What you can do |
| --- | --- |
| Board | Browse memories by agent, edit Markdown, and drag files or sessions to another agent. |
| Skills | Browse skill libraries, edit `SKILL.md`, and copy or migrate between libraries. |
| Share matrix | See which agents read each memory and grant access by clicking an empty cell. |
| History | Review writes and undo individual changes. |

Search by title, path, or content from the top bar. Use the collapsible sidebar to switch projects and choose visible agents.

<details>
<summary>View interaction details</summary>

- **Board**: one column per agent. Open a card to edit Markdown with a diff before saving. Dragging a card to another column shows a preview first and only writes on confirm. Dragging an instruction file is a one-time copy; dragging a session produces a handoff document.
- **Skills**: a dedicated skill-library view (separate from the Board), one column per agent: `~/.claude/skills`, `~/.codex/skills`, `~/.pi/agent/skills`, `~/.zcode/skills`, `~/.qoder/skills`, `~/.dsh/skills`, project-level `.claude/skills`, plus the cross-agent `.agents/skills` (global and project, marked shared). Open a card to view/edit SKILL.md; copy or migrate between libraries in one click (migrate = copy then remove source, undoable throughout), or delete a whole folder (backed up first). Destructive actions on the shared `.agents` library get a prominent warning.
- **Search**: the top bar filters Board cards, matrix rows and Skills cards by title, path or content (`/` to focus, Esc to clear).
- **Share matrix**: one row per memory, one column per agent. Click an empty cell to grant access; agents already reading the file show a solid check and cannot be toggled.
- **History**: every write is backed up first and can be undone individually.
- **Projects / Agents sidebar**: projects are auto-discovered from session logs, or added manually via a native folder picker and removable from the list; the Agents section toggles Board and matrix columns per agent (stored in the browser; newly installed agents default to visible). The whole sidebar collapses to give the board more room.
- **Theme & language**: the UI ships in English and Chinese, with dark and light themes; both are switchable from the top bar and remembered per browser.

</details>

## Supported agents

| Agent | Instruction files | Session parsing |
| --- | --- | --- |
| Claude Code | `CLAUDE.md`, project memories | Supported |
| Codex | `AGENTS.md`, `AGENTS.override.md` | Supported |
| Pi | `AGENTS.md`, `CLAUDE.md` | Supported |
| Gemini CLI | `GEMINI.md` | Supported (`~/.gemini/tmp/<dir>/chats/*.jsonl` via `projects.json`) |
| Cursor | `rules/*.mdc` | Supported (agent transcripts + Composer chats in `state.vscdb`) |
| opencode | `AGENTS.md` | Supported (`~/.local/share/opencode/storage`, file-based versions) |
| ZCode | `AGENTS.md` | Supported (`~/.zcode/cli/db/db.sqlite`) |
| Qoder | `AGENTS.md`, `AGENTS.local.md`, `.qoder/rules/*.md` | Supported (`~/.qoder/projects/<project>/*.jsonl`) |
| DeepSeek Harness | `AGENTS.md`, `CLAUDE.md`, and local variants | Supported (`~/.dsh/sessions/<project>/*.jsonl`) |

Every parsed session can be handed off to another agent from the UI or `agent-mem handoff --from <agent>`.

<details>
<summary>View full global, project, and session paths</summary>

| Agent | Global | Project | Sessions |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/CLAUDE.md` | `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, plus `~/.claude/projects/<project>/memory/*.md` | `~/.claude/projects/<project>/*.jsonl` |
| Codex | `~/.codex/AGENTS.md` | `AGENTS.md` (`AGENTS.override.md` wins) | `~/.codex/sessions/**/*.jsonl` |
| Pi | `~/.pi/agent/AGENTS.md` | `AGENTS.md`, `CLAUDE.md` | `~/.pi/agent/sessions/--<project>--/*.jsonl` |
| Gemini CLI | `~/.gemini/GEMINI.md` | `GEMINI.md`, `.gemini/GEMINI.md` | `~/.gemini/tmp/<dir>/chats/*.jsonl` |
| Cursor | `~/.cursor/rules/*.mdc` | `.cursor/rules/*.mdc` | `~/.cursor/projects/<project>/agent-transcripts/**` + `state.vscdb` |
| opencode | `~/.config/opencode/AGENTS.md` | `AGENTS.md` | `~/.local/share/opencode/storage/{session,message}` |
| ZCode | `~/.zcode/AGENTS.md` | `AGENTS.md` | `~/.zcode/cli/db/db.sqlite` |
| Qoder | `~/.qoder/AGENTS.md` | `AGENTS.md`, `AGENTS.local.md`, `.qoder/rules/*.md` | `~/.qoder/projects/<project>/*.jsonl` |
| DeepSeek Harness | `~/.dsh/AGENTS.md`, `~/.agents/AGENTS.md` | `AGENTS.md`, `CLAUDE.md` (plus `.local` variants) | `~/.dsh/sessions/<project>/*.jsonl` |

</details>

When several agents read the same file (the project's `AGENTS.md` belongs to Codex, Pi, opencode, ZCode, Qoder and DeepSeek Harness at once), the UI counts it once and marks it "also read by".

## Sharing and handoffs

### Share instruction files

Sharing supports three strategies, selectable in the matrix (otherwise auto-chosen in order):

1. `import` — adds an `@path` line (Claude Code); when the source changes, the agent reads the new content.
2. `symlink` — when the target file does not exist yet, link it straight to the source.
3. `copy` — writes the content into a `<!-- agent-mem:begin -->` marked block inside the target file. Auto-synced when the source changes; the rest of your hand-written file is left alone.

### Hand off a session

Working memory is different. Sessions are per-agent JSONL transcripts and cannot be injected into another agent's live conversation. Dragging one across shows a raw preview first; press Summarize to turn it into a handoff note (goals, follow-up requirements, changed files, commands run, final state) written where the target agent will read it on next start, with suspected secrets masked before writing.

Summarization prefers a locally installed agent CLI (target agent → source agent → any other installed agent, e.g. `claude -p`, `pi -p`, `codex exec` — no API key needed), then falls back to an OpenAI-compatible endpoint configured via `AGENT_MEM_LLM_API_KEY`, and finally to a rule-based summary.

`AGENT_MEM_LLM_MODE=api|local` forces one channel. `agent-mem handoff` always summarizes; `agent-mem transfer` copies verbatim unless you pass `--summarize`.

## CLI

Inspect project memories, check your setup, or hand off work to another agent:

```bash
npx @liangstech/agent-mem ls -p .
npx @liangstech/agent-mem doctor
npx @liangstech/agent-mem handoff --from codex --to claude -p . --yes
```

The full examples below use `agent-mem` directly. If you haven't installed the command globally, replace `agent-mem` at the start of each command with `npx @liangstech/agent-mem`.

<details>
<summary>Expand commands and examples</summary>

Every UI action has a command. By default only the planned writes and diffs are printed; `--yes` writes to disk. Without `--yes`, the terminal asks once more.

```bash
agent-mem agents                   # supported agents and install status
agent-mem agents add <id> ...      # register a custom agent (--display --home --project-file --imports)
agent-mem agents remove <id>       # remove a custom agent (built-ins cannot be removed)
agent-mem doctor                   # health check: detection, data dirs, share consistency, orphan backups
agent-mem clean                    # drop backup snapshots no longer referenced
agent-mem export -p . -o mem.json  # bundle project memories (incl. share relations)
agent-mem import mem.json -p ~/code/shop-api   # restore into another directory/machine
agent-mem ls                       # discovered projects
agent-mem ls -p ~/code/shop-api    # all memories of one project
agent-mem skills ls -p .           # skill inventory per library (shared = .agents)
agent-mem skills libraries         # available skill library ids (values for migrate --to)
agent-mem skills migrate <name> --to claude-code [--move] [--overwrite] -p . --yes
agent-mem skills rm <name> -p . --yes   # delete a skill folder, backed up, undoable
agent-mem search <text> -p .       # search memories by title/path/content (with line numbers, --json)
agent-mem link codex:AGENTS.md --to claude -p . --yes
agent-mem link ~/.claude/CLAUDE.md --to codex,pi --global --strategy copy --yes
agent-mem shares
agent-mem unlink <shareId> --yes
agent-mem handoff --from codex --to claude -p . --yes
agent-mem handoff --from codex --to pi --session <id> --yes
agent-mem transfer codex:AGENTS.md --to claude -p . --summarize --yes
agent-mem edit claude:CLAUDE.md -p . --file ./CLAUDE.md
agent-mem sync
agent-mem undo                     # undo the most recent write
agent-mem history                  # recorded writes and undos
agent-mem projects add ~/code/app
```

`claude` is an alias of `claude-code`, `gemini-cli` of `gemini`, `oc` of `opencode`. Memories can be addressed by the id from `ls`, by file path, or as `agent:relative-path`.

</details>

## Adding your own agent

Any tool that "reads some Markdown" needs no code change — DeepSeek Harness was built in exactly this way. Declare which files your tool reads in `~/.agent-mem/config.json`:

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

The agent counts as installed once `homeDir` exists. For more complex read logic, point `plugins` at an ESM module whose default export is `(ctx) => AgentAdapter`.

Summaries default to local agent CLIs; to use a hosted endpoint, configure it through environment variables rather than flags so it never lands in shell history:

```bash
export AGENT_MEM_LLM_API_KEY=...
export AGENT_MEM_LLM_BASE_URL=https://api.deepseek.com   # optional, defaults to OpenAI
export AGENT_MEM_LLM_MODEL=deepseek-chat                 # optional
```

## Publish to npm

After installing dependencies at the repository root, run:

```bash
pnpm --dir packages/cli publish --access public
```

The `prepack` hook rebuilds and checks the archive. The package includes the CLI, web UI, and internal modules. Users need neither pnpm nor a source build. Publishing requires a valid npm login. Bump `packages/cli/package.json` before publishing another version.

## Development

Run from source:

```bash
pnpm install
pnpm build
pnpm ui
```

Run checks or start frontend hot reload:

```bash
pnpm test          # vitest
pnpm typecheck
pnpm lint
pnpm --filter @agent-mem/web dev   # web hot reload, API proxied to 4477
```

The repo is a pnpm workspace: `packages/core` holds adapters and write plans, `packages/server` is the localhost-only Hono service (file watching + SSE), `packages/web` is the React UI, `packages/cli` is the `agent-mem` command.

Before every write, agent-mem compares the content hash from when you opened the file and refuses to overwrite if the on-disk version changed. Backups live in `~/.agent-mem/backups/`. The server rejects non-local Host headers and cross-site writes.

## Limits

- Agent directory layouts change across versions. Adapters follow the public path conventions and carry sample-format tests for three session formats; when something doesn't line up, check what `ls` reads first.
- Handoff documents are written for the "next startup"; a live session is never rewritten.
- Copies and handoffs scan for common secret formats and mask them, but that does not replace reviewing the diff yourself.
- Agent icons in the UI come from each vendor's official assets (`packages/web/public/agents/`) and are used only to identify the products; copyright belongs to Anthropic, OpenAI, Pi (pi.dev), Google, Cursor, opencode, Z.ai and Qoder respectively. ZCode has no official SVG yet, so its official transparent PNG is used.

## License

[MIT](https://github.com/RCliang/agent-mem-workspace/blob/main/LICENSE).
