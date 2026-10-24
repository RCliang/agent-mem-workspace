import path from 'node:path';
import type { Context } from '../context.js';
import { isDir, listDir } from '../fsutil.js';
import { parseSessionFile } from '../sessions.js';
import type { AgentAdapter, MemoryItem, ProjectInfo } from '../types.js';
import { fileItem, MAX_SESSIONS_PER_PROJECT, newestFirst, renderPlain, sessionHead, sessionItem } from './common.js';

export function encodeQoderProject(projectPath: string): string {
  return projectPath.replace(/[/\\:]/g, '-');
}

export function qoderAdapter(ctx: Context): AgentAdapter {
  const home = path.join(ctx.home, '.qoder');
  const id = 'qoder';

  return {
    id,
    displayName: 'Qoder',
    capabilities: { imports: false },

    detect: () => isDir(home),

    watchRoots: () => [home],

    skillRoots: () => [{ dir: path.join(home, 'skills'), scope: 'global' }],

    async listProjects() {
      const out: ProjectInfo[] = [];
      const projectsDir = path.join(home, 'projects');
      for (const name of await listDir(projectsDir)) {
        const dir = path.join(projectsDir, name);
        const heads = [];
        for (const file of (await listDir(dir)).filter((f) => f.endsWith('.jsonl'))) {
          const head = await sessionHead(path.join(dir, file));
          if (head) heads.push(head);
        }
        const cwd = heads.find((h) => h.cwd)?.cwd;
        if (!cwd) continue;
        out.push({ path: cwd, name: path.basename(cwd), agents: [id], lastActivityMs: Math.max(0, ...heads.map((h) => h.mtimeMs)) });
      }
      return out;
    },

    async readMemories(projectPath) {
      const items: (MemoryItem | null)[] = [
        await fileItem(id, path.join(home, 'AGENTS.md'), 'global', 'instructions', null, 'Global instructions (~/.qoder/AGENTS.md)'),
      ];
      if (projectPath) {
        items.push(
          await fileItem(id, path.join(projectPath, 'AGENTS.md'), 'project', 'instructions', projectPath, 'Project instructions (AGENTS.md)'),
          await fileItem(id, path.join(projectPath, 'AGENTS.local.md'), 'local', 'instructions', projectPath, 'Local instructions (AGENTS.local.md)'),
        );
        const rulesDir = path.join(projectPath, '.qoder', 'rules');
        const names = (await listDir(rulesDir)).filter((f) => f.endsWith('.md')).sort();
        items.push(...(await Promise.all(names.map((f) => fileItem(id, path.join(rulesDir, f), 'project', 'instructions', projectPath, `Rule (${f})`)))));
        const sessionDir = path.join(home, 'projects', encodeQoderProject(projectPath));
        const heads = [];
        for (const file of (await listDir(sessionDir)).filter((f) => f.endsWith('.jsonl'))) {
          const head = await sessionHead(path.join(sessionDir, file));
          if (head) heads.push(head);
        }
        for (const head of newestFirst(heads).slice(0, MAX_SESSIONS_PER_PROJECT)) items.push(sessionItem(id, head, projectPath));
      }
      return items.filter((i): i is MemoryItem => i !== null);
    },

    instructionFile(projectPath) {
      return projectPath
        ? { filePath: path.join(projectPath, 'AGENTS.md'), scope: 'project' }
        : { filePath: path.join(home, 'AGENTS.md'), scope: 'global' };
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
