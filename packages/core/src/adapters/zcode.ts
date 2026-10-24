import type { Context } from '../context.js';
import type { AgentAdapter } from '../types.js';
import { declarativeAdapter } from './declarative.js';

/** ZCode reads `AGENTS.md` in `~/.zcode` and in the project. No CLI and no auto-memory directory. */
export function zcodeAdapter(ctx: Context): AgentAdapter {
  return declarativeAdapter(ctx, {
    id: 'zcode',
    displayName: 'ZCode',
    homeDir: '~/.zcode',
    globalFile: '~/.zcode/AGENTS.md',
    projectFiles: ['AGENTS.md'],
    imports: false,
  });
}
