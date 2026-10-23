import path from 'node:path';
import { expandHome, type Context } from '../context.js';
import { isDir } from '../fsutil.js';
import type { AgentAdapter, MemoryItem } from '../types.js';
import { fileItem, renderPlain } from './common.js';

/**
 * Config-only adapter for harnesses that just read Markdown files
 * (e.g. a DeepSeek harness, Gemini CLI). Declared in `~/.agent-mem/config.json`.
 */
export interface DeclarativeAgentSpec {
  id: string;
  displayName: string;
  /** Directory whose existence means the agent is installed, e.g. `~/.gemini`. */
  homeDir: string;
  /** Global instruction file, e.g. `~/.gemini/GEMINI.md`. */
  globalFile?: string;
  /** Instruction file names relative to a project root. The first one is the write target. */
  projectFiles: string[];
  imports?: boolean;
}

export function declarativeAdapter(ctx: Context, spec: DeclarativeAgentSpec): AgentAdapter {
  const home = expandHome(ctx, spec.homeDir);
  const globalFile = spec.globalFile ? expandHome(ctx, spec.globalFile) : path.join(home, 'AGENTS.md');
  const primary = spec.projectFiles[0] ?? 'AGENTS.md';

  return {
    id: spec.id,
    displayName: spec.displayName,
    capabilities: { imports: spec.imports ?? false },
    detect: () => isDir(home),

    watchRoots: () => [home],
    listProjects: async () => [],
    async readMemories(projectPath) {
      const items: (MemoryItem | null)[] = [await fileItem(spec.id, globalFile, 'global', 'instructions', null, `Global (${path.basename(globalFile)})`)];
      if (projectPath) {
        for (const f of spec.projectFiles) {
          items.push(await fileItem(spec.id, path.join(projectPath, f), 'project', 'instructions', projectPath, `Project (${f})`));
        }
      }
      return items.filter((i): i is MemoryItem => i !== null);
    },
    instructionFile(projectPath) {
      return projectPath ? { filePath: path.join(projectPath, primary), scope: 'project' } : { filePath: globalFile, scope: 'global' };
    },
    handoffTarget(projectPath, name) {
      return { docPath: path.join(projectPath, '.agent-mem', 'handoffs', `${name}.md`), referenceFile: path.join(projectPath, primary) };
    },
    formatReference({ docPath, referenceFile, content }) {
      if (spec.imports) return `@${path.relative(path.dirname(referenceFile), docPath)}`;
      return `${content.trim()}\n\n_Full handoff document: \`${path.relative(path.dirname(referenceFile), docPath)}\`_`;
    },
    renderFor: renderPlain,
  };
}
