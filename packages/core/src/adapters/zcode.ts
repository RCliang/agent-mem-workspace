import path from 'node:path';
import type { Context } from '../context.js';
import type { AgentAdapter } from '../types.js';
import { declarativeAdapter } from './declarative.js';
import { listZcodeProjects, listZcodeSessions, parseZcodeSession } from './zcode-sessions.js';

export function zcodeAdapter(ctx: Context): AgentAdapter {
  const base = declarativeAdapter(ctx, {
    id: 'zcode',
    displayName: 'ZCode',
    homeDir: '~/.zcode',
    globalFile: '~/.zcode/AGENTS.md',
    projectFiles: ['AGENTS.md'],
    imports: false,
  });
  return {
    ...base,
    skillRoots: () => [{ dir: path.join(ctx.home, '.zcode', 'skills'), scope: 'global' }],
    listProjects: () => Promise.resolve(listZcodeProjects(ctx)),
    async readMemories(projectPath) {
      const items = await base.readMemories(projectPath);
      if (projectPath) items.push(...listZcodeSessions(ctx, projectPath));
      return items;
    },
    parseSession: (filePath) => Promise.resolve(parseZcodeSession(ctx, filePath)),
  };
}
