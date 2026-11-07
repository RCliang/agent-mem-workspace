import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Context } from '../context.js';
import type { AgentAdapter, AgentCli } from '../types.js';
import { declarativeAdapter } from './declarative.js';
import { listZcodeProjects, listZcodeSessions, parseZcodeSession } from './zcode-sessions.js';

/** macOS app bundle ships the CLI here; `zcode` is not placed on PATH unless the user installs a shim. */
const BUNDLED_CJS = '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs';
const BUNDLED_PROVIDER = '/Applications/ZCode.app/Contents/Resources/config/provider/zcode-builtin.json';

function zcodePromptArgs(prompt: string): string[] {
  // `--prompt` defaults to permission mode yolo. plan keeps the summarizer from editing the workspace.
  return ['-p', prompt, '--mode', 'plan', '--no-color'];
}

function zcodeOnPath(env: Context['env']): boolean {
  const entries = (env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const names = process.platform === 'win32' ? ['zcode.cmd', 'zcode.exe', 'zcode'] : ['zcode'];
  return entries.some((dir) => names.some((name) => existsSync(path.join(dir, name))));
}

export function zcodeCli(ctx: Context): AgentCli {
  if (zcodeOnPath(ctx.env)) return { command: 'zcode', args: zcodePromptArgs };
  if (process.platform === 'darwin' && existsSync(BUNDLED_CJS) && existsSync(BUNDLED_PROVIDER)) {
    return {
      command: process.execPath,
      args: (prompt) => [BUNDLED_CJS, ...zcodePromptArgs(prompt)],
      env: {
        ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: BUNDLED_PROVIDER,
        ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: path.join(ctx.home, '.zcode', 'v2', 'provider_config.json'),
      },
    };
  }
  return { command: 'zcode', args: zcodePromptArgs };
}

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
    cli: zcodeCli(ctx),
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
