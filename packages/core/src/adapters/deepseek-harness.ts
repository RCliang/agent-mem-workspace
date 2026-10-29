import path from 'node:path';
import type { Context } from '../context.js';
import { isDir } from '../fsutil.js';
import type { AgentAdapter, MemoryItem } from '../types.js';
import { fileItem, renderPlain } from './common.js';

export function deepseekHarnessAdapter(ctx: Context): AgentAdapter {
  const root = ctx.env.DSH_HOME ?? path.join(ctx.home, '.dsh');
  const agentsHome = ctx.env.DSH_AGENTS_HOME ?? path.join(ctx.home, '.agents');
  const id = 'deepseek-harness';

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

    listProjects: () => Promise.resolve([]),

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
  };
}
