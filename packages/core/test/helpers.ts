import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createContext, Hub, type AgentAdapter } from '@agent-mem/core';
import { createSandbox } from './fixtures/sandbox.mjs';

export async function setup(extraAdapters: AgentAdapter[] = []) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mem-')));
  const sb = createSandbox(root);
  const ctx = createContext({ home: sb.home, dataDir: sb.dataDir, env: {} });
  const hub = await Hub.create(ctx, extraAdapters);
  return { ...sb, root, ctx, hub };
}

export const read = (p: string) => fs.readFileSync(p, 'utf8');

/** Windows requires Developer Mode or an account with permission to create symlinks. */
export function canCreateSymlink(project: string): boolean {
  if (process.platform !== 'win32') return true;
  const probe = path.join(project, 'symlink-permission-probe');
  try {
    fs.symlinkSync('AGENTS.md', probe);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EPERM') return false;
    throw error;
  }
  fs.unlinkSync(probe);
  return true;
}
