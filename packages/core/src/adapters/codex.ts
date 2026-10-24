import path from 'node:path';
import type { Context } from '../context.js';
import { isDir, walk } from '../fsutil.js';
import { parseSessionFile } from '../sessions.js';
import type { AgentAdapter, MemoryItem, ProjectInfo } from '../types.js';
import { fileItem, MAX_SESSIONS_PER_PROJECT, newestFirst, renderPlain, sessionHead, sessionItem, type SessionHead } from './common.js';

export function codexAdapter(ctx: Context): AgentAdapter {
  const root = ctx.env.CODEX_HOME ?? path.join(ctx.home, '.codex');
  const sessionsDir = path.join(root, 'sessions');
  const id = 'codex';

  // Codex keeps sessions in date folders, so the project is only known from each file's header.
  let cache: { at: number; heads: SessionHead[] } | null = null;
  async function allHeads(): Promise<SessionHead[]> {
    if (cache && Date.now() - cache.at < 2000) return cache.heads;
    const files = await walk(sessionsDir, (p) => p.endsWith('.jsonl'), 4);
    const heads: SessionHead[] = [];
    for (const f of files) {
      const h = await sessionHead(f);
      if (h) heads.push(h);
    }
    cache = { at: Date.now(), heads };
    return heads;
  }

  return {
    id,
    displayName: 'Codex',
    capabilities: { imports: false },
    cli: { command: 'codex', args: (p) => ['exec', '--skip-git-repo-check', p] },

    detect: () => isDir(root),

    watchRoots: () => [root],

    skillRoots: () => [{ dir: path.join(root, 'skills'), scope: 'global' }],

    async listProjects() {
      const byCwd = new Map<string, ProjectInfo>();
      for (const h of await allHeads()) {
        if (!h.cwd) continue;
        const p = byCwd.get(h.cwd) ?? { path: h.cwd, name: path.basename(h.cwd), agents: [id], lastActivityMs: 0 };
        p.lastActivityMs = Math.max(p.lastActivityMs, h.mtimeMs);
        byCwd.set(h.cwd, p);
      }
      return [...byCwd.values()];
    },

    async readMemories(projectPath) {
      const items: (MemoryItem | null)[] = [
        await fileItem(id, path.join(root, 'AGENTS.override.md'), 'global', 'instructions', null, 'Global override (~/.codex/AGENTS.override.md)'),
        await fileItem(id, path.join(root, 'AGENTS.md'), 'global', 'instructions', null, 'Global instructions (~/.codex/AGENTS.md)'),
      ];
      if (projectPath) {
        items.push(
          await fileItem(id, path.join(projectPath, 'AGENTS.override.md'), 'project', 'instructions', projectPath, 'Project override (AGENTS.override.md)'),
          await fileItem(id, path.join(projectPath, 'AGENTS.md'), 'project', 'instructions', projectPath, 'Project instructions (AGENTS.md)'),
        );
        const heads = (await allHeads()).filter((h) => h.cwd === projectPath);
        for (const h of newestFirst(heads).slice(0, MAX_SESSIONS_PER_PROJECT)) items.push(sessionItem(id, h, projectPath));
      }
      return items.filter((i): i is MemoryItem => i !== null);
    },

    instructionFile(projectPath) {
      return projectPath
        ? { filePath: path.join(projectPath, 'AGENTS.md'), scope: 'project' }
        : { filePath: path.join(root, 'AGENTS.md'), scope: 'global' };
    },

    handoffTarget(projectPath, name) {
      return {
        docPath: path.join(projectPath, '.agent-mem', 'handoffs', `${name}.md`),
        referenceFile: path.join(projectPath, 'AGENTS.md'),
      };
    },

    formatReference({ docPath, referenceFile, content }) {
      // Codex has no import syntax, so the handoff is inlined; the file stays as the canonical copy.
      const rel = path.relative(path.dirname(referenceFile), docPath);
      return `${content.trim()}\n\n_Full handoff document: \`${rel}\`_`;
    },

    renderFor: renderPlain,

    parseSession: (filePath) => parseSessionFile(id, filePath),
  };
}
