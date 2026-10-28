import path from 'node:path';
import type { Context } from '../context.js';
import { isDir, listDir } from '../fsutil.js';
import type { AgentAdapter, MemoryItem } from '../types.js';
import { fileItem, renderPlain } from './common.js';
import { listCursorProjects, listCursorSessions, parseCursorSession } from './cursor-sessions.js';

/** Cursor keeps rules as `.mdc` files in a rules directory, globally and per project. */
export function cursorAdapter(ctx: Context): AgentAdapter {
  const root = ctx.env.CURSOR_DIR ?? path.join(ctx.home, '.cursor');
  const globalRules = path.join(root, 'rules');
  const id = 'cursor';
  /** Rule file agent-mem writes to when sharing or handing off into Cursor. */
  const memRule = 'agent-mem.mdc';

  async function ruleItems(dir: string, scope: 'global' | 'project', projectPath: string | null): Promise<(MemoryItem | null)[]> {
    const names = (await listDir(dir)).filter((f) => f.endsWith('.mdc')).sort();
    return Promise.all(names.map((f) => fileItem(id, path.join(dir, f), scope, 'instructions', projectPath, `Rule (${f})`)));
  }

  return {
    id,
    displayName: 'Cursor',
    capabilities: { imports: false },

    detect: () => isDir(root),

    watchRoots: () => [globalRules, path.join(root, 'projects')],

    listProjects: () => listCursorProjects(ctx.home),

    async readMemories(projectPath) {
      const items: (MemoryItem | null)[] = [...(await ruleItems(globalRules, 'global', null))];
      if (projectPath) {
        items.push(...(await ruleItems(path.join(projectPath, '.cursor', 'rules'), 'project', projectPath)));
        items.push(...(await listCursorSessions(ctx.home, root, projectPath)));
      }
      return items.filter((i): i is MemoryItem => i !== null);
    },

    instructionFile(projectPath) {
      return projectPath
        ? { filePath: path.join(projectPath, '.cursor', 'rules', memRule), scope: 'project' }
        : { filePath: path.join(globalRules, memRule), scope: 'global' };
    },

    handoffTarget(projectPath, name) {
      return { docPath: path.join(projectPath, '.agent-mem', 'handoffs', `${name}.md`), referenceFile: path.join(projectPath, '.cursor', 'rules', memRule) };
    },

    formatReference({ docPath, referenceFile, content }) {
      const rel = path.relative(path.dirname(referenceFile), docPath);
      return `${content.trim()}\n\n_Full handoff document: \`${rel}\`_`;
    },

    renderFor: renderPlain,

    parseSession: (filePath) => parseCursorSession(ctx.home, filePath),
  };
}
