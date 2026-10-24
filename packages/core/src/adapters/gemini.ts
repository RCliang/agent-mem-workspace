import path from 'node:path';
import type { Context } from '../context.js';
import { isDir } from '../fsutil.js';
import type { AgentAdapter, MemoryItem } from '../types.js';
import { fileItem, renderPlain } from './common.js';

/** Gemini CLI reads `GEMINI.md` at the global and project level and supports `@path` imports. */
export function geminiAdapter(ctx: Context): AgentAdapter {
  const root = ctx.env.GEMINI_CLI_DIR ?? path.join(ctx.home, '.gemini');
  const id = 'gemini';

  return {
    id,
    displayName: 'Gemini CLI',
    capabilities: { imports: true },
    cli: { command: 'gemini', args: (p) => ['-p', p] },

    detect: () => isDir(root),

    watchRoots: () => [root],

    listProjects: async () => [],

    async readMemories(projectPath) {
      const items: (MemoryItem | null)[] = [await fileItem(id, path.join(root, 'GEMINI.md'), 'global', 'instructions', null, 'Global context (~/.gemini/GEMINI.md)')];
      if (projectPath) {
        items.push(
          await fileItem(id, path.join(projectPath, 'GEMINI.md'), 'project', 'instructions', projectPath, 'Project context (GEMINI.md)'),
          await fileItem(id, path.join(projectPath, '.gemini', 'GEMINI.md'), 'project', 'instructions', projectPath, 'Project context (.gemini/GEMINI.md)'),
        );
      }
      return items.filter((i): i is MemoryItem => i !== null);
    },

    instructionFile(projectPath) {
      return projectPath
        ? { filePath: path.join(projectPath, 'GEMINI.md'), scope: 'project' }
        : { filePath: path.join(root, 'GEMINI.md'), scope: 'global' };
    },

    handoffTarget(projectPath, name) {
      return { docPath: path.join(projectPath, '.agent-mem', 'handoffs', `${name}.md`), referenceFile: path.join(projectPath, 'GEMINI.md') };
    },

    formatReference({ docPath, referenceFile }) {
      const rel = path.relative(path.dirname(referenceFile), docPath);
      return `@${rel}`;
    },

    renderFor: renderPlain,
  };
}
