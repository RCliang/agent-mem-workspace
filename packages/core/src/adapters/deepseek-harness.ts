import path from 'node:path';
import type { Context } from '../context.js';
import { isDir, listDir } from '../fsutil.js';
import { parseSessionFile } from '../sessions.js';
import type { AgentAdapter, MemoryItem, ProjectInfo } from '../types.js';
import { fileItem, MAX_SESSIONS_PER_PROJECT, newestFirst, renderPlain, sessionHead, sessionItem, type SessionHead } from './common.js';

/** DeepSeek Harness names session folders after the project path with separators dashed. */
export function encodeDshProject(projectPath: string): string {
  return projectPath.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-');
}

export function dshSessionPath(home: string, sessionId: string, projectPath: string): string {
  return path.join(home, '.dsh', 'sessions', encodeDshProject(projectPath), `${sessionId}.jsonl`);
}

export function deepseekHarnessAdapter(ctx: Context): AgentAdapter {
  const root = ctx.env.DSH_HOME ?? path.join(ctx.home, '.dsh');
  const agentsHome = ctx.env.DSH_AGENTS_HOME ?? path.join(ctx.home, '.agents');
  const sessionsDir = path.join(root, 'sessions');
  const id = 'deepseek-harness';

  async function headsIn(dir: string): Promise<SessionHead[]> {
    const heads: SessionHead[] = [];
    for (const f of (await listDir(dir)).filter((x) => x.endsWith('.jsonl'))) {
      const h = await sessionHead(path.join(dir, f));
      if (h) heads.push(h);
    }
    return heads;
  }

  return {
    id,
    displayName: 'DeepSeek Harness',
    capabilities: { imports: false },

    detect: () => isDir(root),

    watchRoots: () => [root, agentsHome],

    skillRoots: (projectPath) => [
      { dir: path.join(root, 'skills'), scope: 'global' as const },
      ...(projectPath ? [{ dir: path.join(projectPath, '.dsh', 'skills'), scope: 'project' as const }] : []),
    ],

    async listProjects() {
      const out: ProjectInfo[] = [];
      for (const name of await listDir(sessionsDir)) {
        const dir = path.join(sessionsDir, name);
        if (!(await isDir(dir))) continue;
        const heads = await headsIn(dir);
        const cwd = heads.find((h) => h.cwd)?.cwd;
        if (!cwd) continue;
        out.push({ path: cwd, name: path.basename(cwd), agents: [id], lastActivityMs: Math.max(0, ...heads.map((h) => h.mtimeMs)) });
      }
      return out;
    },

    async readMemories(projectPath) {
      const items: (MemoryItem | null)[] = [
        await fileItem(id, path.join(root, 'AGENTS.md'), 'global', 'instructions', null, 'Global instructions (~/.dsh/AGENTS.md)'),
        await fileItem(id, path.join(agentsHome, 'AGENTS.md'), 'global', 'instructions', null, 'Shared global instructions (~/.agents/AGENTS.md)'),
      ];
      if (projectPath) {
        items.push(
          await fileItem(id, path.join(projectPath, 'AGENTS.md'), 'project', 'instructions', projectPath, 'Project instructions (AGENTS.md)'),
          await fileItem(id, path.join(projectPath, 'CLAUDE.md'), 'project', 'instructions', projectPath, 'Project instructions (CLAUDE.md)'),
          await fileItem(id, path.join(projectPath, 'AGENTS.local.md'), 'local', 'instructions', projectPath, 'Local instructions (AGENTS.local.md)'),
          await fileItem(id, path.join(projectPath, 'CLAUDE.local.md'), 'local', 'instructions', projectPath, 'Local instructions (CLAUDE.local.md)'),
        );
        const heads = await headsIn(path.join(sessionsDir, encodeDshProject(projectPath)));
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
      return { docPath: path.join(projectPath, '.agent-mem', 'handoffs', `${name}.md`), referenceFile: path.join(projectPath, 'AGENTS.md') };
    },

    formatReference({ docPath, referenceFile, content }) {
      const rel = path.relative(path.dirname(referenceFile), docPath);
      return `${content.trim()}\n\n_Full handoff document: \`${rel}\`_`;
    },

    renderFor: renderPlain,

    parseSession: (filePath) => parseSessionFile(id, filePath),
  };
}
