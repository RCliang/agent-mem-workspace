import path from 'node:path';
import type { Context } from '../context.js';
import { isDir, listDir } from '../fsutil.js';
import { parseSessionFile } from '../sessions.js';
import type { AgentAdapter, MemoryItem, ProjectInfo } from '../types.js';
import { fileItem, MAX_SESSIONS_PER_PROJECT, newestFirst, renderPlain, sessionHead, sessionItem } from './common.js';

/** Claude Code stores per-project state under a directory named after the path with non-alphanumerics replaced. */
export function encodeClaudeProject(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, '-');
}

export function claudeCodeAdapter(ctx: Context): AgentAdapter {
  const root = ctx.env.CLAUDE_CONFIG_DIR ?? path.join(ctx.home, '.claude');
  const projectsDir = path.join(root, 'projects');
  const projectDir = (p: string) => path.join(projectsDir, encodeClaudeProject(p));
  const id = 'claude-code';

  return {
    id,
    displayName: 'Claude Code',
    capabilities: { imports: true },
    // --tools "" keeps the summarizer read-only; --no-session-persistence keeps the user's history clean.
    cli: { command: 'claude', args: (p) => ['-p', p, '--output-format', 'text', '--tools', '', '--no-session-persistence'] },

    detect: () => isDir(root),

    watchRoots: () => [root],

    async listProjects() {
      const out: ProjectInfo[] = [];
      for (const name of await listDir(projectsDir)) {
        const dir = path.join(projectsDir, name);
        if (!(await isDir(dir))) continue;
        const sessions = (await listDir(dir)).filter((f) => f.endsWith('.jsonl'));
        let cwd: string | null = null;
        let last = 0;
        for (const f of sessions) {
          const head = await sessionHead(path.join(dir, f));
          if (!head) continue;
          last = Math.max(last, head.mtimeMs);
          cwd ??= head.cwd;
        }
        if (!cwd) continue;
        out.push({ path: cwd, name: path.basename(cwd), agents: [id], lastActivityMs: last });
      }
      return out;
    },

    async readMemories(projectPath) {
      const items: (MemoryItem | null)[] = [await fileItem(id, path.join(root, 'CLAUDE.md'), 'global', 'instructions', null, 'User memory (~/.claude/CLAUDE.md)')];
      if (!projectPath) return items.filter((i): i is MemoryItem => i !== null);

      items.push(
        await fileItem(id, path.join(projectPath, 'CLAUDE.md'), 'project', 'instructions', projectPath, 'Project memory (CLAUDE.md)'),
        await fileItem(id, path.join(projectPath, '.claude', 'CLAUDE.md'), 'project', 'instructions', projectPath, 'Project memory (.claude/CLAUDE.md)'),
        await fileItem(id, path.join(projectPath, 'CLAUDE.local.md'), 'local', 'instructions', projectPath, 'Local memory (CLAUDE.local.md)'),
      );

      const memDir = path.join(projectDir(projectPath), 'memory');
      for (const f of (await listDir(memDir)).filter((f) => f.endsWith('.md')).sort()) {
        items.push(await fileItem(id, path.join(memDir, f), 'local', 'auto-memory', projectPath, `Auto memory: ${f}`));
      }

      const heads = [];
      for (const f of (await listDir(projectDir(projectPath))).filter((f) => f.endsWith('.jsonl'))) {
        const h = await sessionHead(path.join(projectDir(projectPath), f));
        if (h) heads.push(h);
      }
      for (const h of newestFirst(heads).slice(0, MAX_SESSIONS_PER_PROJECT)) items.push(sessionItem(id, h, projectPath));

      return items.filter((i): i is MemoryItem => i !== null);
    },

    instructionFile(projectPath) {
      return projectPath
        ? { filePath: path.join(projectPath, 'CLAUDE.md'), scope: 'project' }
        : { filePath: path.join(root, 'CLAUDE.md'), scope: 'global' };
    },

    handoffTarget(projectPath, name) {
      const memDir = path.join(projectDir(projectPath), 'memory');
      return { docPath: path.join(memDir, `${name}.md`), referenceFile: path.join(memDir, 'MEMORY.md') };
    },

    formatReference({ docPath, referenceFile, title }) {
      // MEMORY.md is an index Claude reads at startup; topic files are opened on demand via links.
      const rel = path.relative(path.dirname(referenceFile), docPath);
      return `- [${title}](${rel}) - read this before continuing the work it describes.`;
    },

    renderFor: renderPlain,

    parseSession: (filePath) => parseSessionFile(id, filePath),
  };
}
