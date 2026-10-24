import path from 'node:path';
import type { Context } from '../context.js';
import { isDir, listDir } from '../fsutil.js';
import { parseSessionFile } from '../sessions.js';
import type { AgentAdapter, MemoryItem, ProjectInfo } from '../types.js';
import { fileItem, MAX_SESSIONS_PER_PROJECT, newestFirst, renderPlain, sessionHead, sessionItem, type SessionHead } from './common.js';

/** Pi names session folders `--<path with separators replaced by dashes>--`. */
export function encodePiProject(projectPath: string): string {
  return `--${projectPath.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
}

export function piAdapter(ctx: Context): AgentAdapter {
  const root = ctx.env.PI_CODING_AGENT_DIR ?? path.join(ctx.home, '.pi', 'agent');
  const sessionsDir = path.join(root, 'sessions');
  const id = 'pi';

  async function headsIn(dir: string): Promise<SessionHead[]> {
    const heads: SessionHead[] = [];
    for (const f of (await listDir(dir)).filter((f) => f.endsWith('.jsonl'))) {
      const h = await sessionHead(path.join(dir, f));
      if (h) heads.push(h);
    }
    return heads;
  }

  return {
    id,
    displayName: 'Pi',
    capabilities: { imports: false },
    cli: { command: 'pi', args: (p) => ['-p', p, '--mode', 'text'] },

    detect: () => isDir(root),

    watchRoots: () => [root],

    async listProjects() {
      const out: ProjectInfo[] = [];
      for (const name of await listDir(sessionsDir)) {
        const heads = await headsIn(path.join(sessionsDir, name));
        const cwd = heads.find((h) => h.cwd)?.cwd;
        if (!cwd) continue;
        out.push({ path: cwd, name: path.basename(cwd), agents: [id], lastActivityMs: Math.max(0, ...heads.map((h) => h.mtimeMs)) });
      }
      return out;
    },

    async readMemories(projectPath) {
      const items: (MemoryItem | null)[] = [
        await fileItem(id, path.join(root, 'AGENTS.md'), 'global', 'instructions', null, 'Global context (~/.pi/agent/AGENTS.md)'),
      ];
      if (projectPath) {
        items.push(
          await fileItem(id, path.join(projectPath, 'AGENTS.md'), 'project', 'instructions', projectPath, 'Project context (AGENTS.md)'),
          await fileItem(id, path.join(projectPath, 'CLAUDE.md'), 'project', 'instructions', projectPath, 'Project context (CLAUDE.md)'),
        );
        const heads = await headsIn(path.join(sessionsDir, encodePiProject(projectPath)));
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
      const rel = path.relative(path.dirname(referenceFile), docPath);
      return `${content.trim()}\n\n_Full handoff document: \`${rel}\`_`;
    },

    renderFor: renderPlain,

    parseSession: (filePath) => parseSessionFile(id, filePath),
  };
}
