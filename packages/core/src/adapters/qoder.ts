import path from 'node:path';
import type { Context } from '../context.js';
import { isDir, listDir } from '../fsutil.js';
import type { AgentAdapter, MemoryItem } from '../types.js';
import { fileItem, renderPlain } from './common.js';

export function qoderAdapter(ctx: Context): AgentAdapter {
  const home = path.join(ctx.home, '.qoder');
  const id = 'qoder';

  return {
    id,
    displayName: 'Qoder',
    capabilities: { imports: false },

    detect: () => isDir(home),

    watchRoots: () => [home],

    listProjects: async () => [],

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
  };
}
