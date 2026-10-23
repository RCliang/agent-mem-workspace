import os from 'node:os';
import path from 'node:path';

export interface Context {
  home: string;
  /** Where Agent Memory Hub keeps its own state (shares, backups, config). */
  dataDir: string;
  env: Record<string, string | undefined>;
}

export function createContext(overrides: Partial<Context> = {}): Context {
  const env = overrides.env ?? process.env;
  const home = overrides.home ?? env.AGENT_MEM_HOME ?? os.homedir();
  const dataDir = overrides.dataDir ?? env.AGENT_MEM_DATA_DIR ?? path.join(home, '.agent-mem');
  return { home, dataDir, env };
}

export function expandHome(ctx: Context, p: string): string {
  if (p === '~') return ctx.home;
  if (p.startsWith('~/')) return path.join(ctx.home, p.slice(2));
  return p;
}

export function tildify(ctx: Context, p: string): string {
  if (p === ctx.home) return '~';
  if (p.startsWith(ctx.home + path.sep)) return '~' + p.slice(ctx.home.length);
  return p;
}
