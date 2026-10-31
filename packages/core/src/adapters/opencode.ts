import path from 'node:path';
import type { Context } from '../context.js';
import { isDir } from '../fsutil.js';
import type { AgentAdapter, MemoryItem } from '../types.js';
import { fileItem, renderPlain } from './common.js';
import { listOpencodeProjects, listOpencodeSessions, opencodeStorage, parseOpencodeSession } from './opencode-sessions.js';

/** opencode reads the standard `AGENTS.md` globally under its config dir and in every project. */
export function opencodeAdapter(ctx: Context): AgentAdapter {
  const configRoot = ctx.env.XDG_CONFIG_HOME && path.isAbsolute(ctx.env.XDG_CONFIG_HOME)
    ? path.join(ctx.env.XDG_CONFIG_HOME, 'opencode')
    : path.join(ctx.home, '.config', 'opencode');
  const id = 'opencode';

  return {
    id,
    displayName: 'opencode',
    capabilities: { imports: false },
    cli: { command: 'opencode', args: (p) => ['run', p] },

    detect: () => isDir(configRoot),

    watchRoots: () => [configRoot, path.dirname(opencodeStorage(ctx))],

    // opencode keeps global skills under <config>/skill/<name>/SKILL.md.
    skillRoots: (projectPath) => [
      { dir: path.join(configRoot, 'skill'), scope: 'global' as const },
      ...(projectPath ? [{ dir: path.join(projectPath, '.opencode', 'skill'), scope: 'project' as const }] : []),
    ],

    listProjects: () => listOpencodeProjects(ctx),

    async readMemories(projectPath) {
      const items: (MemoryItem | null)[] = [await fileItem(id, path.join(configRoot, 'AGENTS.md'), 'global', 'instructions', null, 'Global instructions (~/.config/opencode/AGENTS.md)')];
      if (projectPath) {
        items.push(await fileItem(id, path.join(projectPath, 'AGENTS.md'), 'project', 'instructions', projectPath, 'Project instructions (AGENTS.md)'));
        items.push(...(await listOpencodeSessions(ctx, projectPath)));
      }
      return items.filter((i): i is MemoryItem => i !== null);
    },

    instructionFile(projectPath) {
      return projectPath
        ? { filePath: path.join(projectPath, 'AGENTS.md'), scope: 'project' }
        : { filePath: path.join(configRoot, 'AGENTS.md'), scope: 'global' };
    },

    handoffTarget(projectPath, name) {
      return { docPath: path.join(projectPath, '.agent-mem', 'handoffs', `${name}.md`), referenceFile: path.join(projectPath, 'AGENTS.md') };
    },

    formatReference({ docPath, referenceFile, content }) {
      const rel = path.relative(path.dirname(referenceFile), docPath);
      return `${content.trim()}\n\n_Full handoff document: \`${rel}\`_`;
    },

    renderFor: renderPlain,

    parseSession: (filePath) => parseOpencodeSession(ctx, filePath),
  };
}
