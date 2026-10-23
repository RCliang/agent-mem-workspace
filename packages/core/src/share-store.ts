import type { Context } from './context.js';
import { readState, writeState } from './store.js';
import type { AgentId, ShareStrategy } from './types.js';

export interface Share {
  id: string;
  projectPath: string | null;
  sourceAgent: AgentId;
  sourcePath: string;
  targetAgent: AgentId;
  targetPath: string;
  strategy: ShareStrategy;
  createdAt: string;
  /** Hash of the source content last written into the target (copy strategy). */
  syncedHash?: string;
}

const FILE = 'shares.json';

export async function listShares(ctx: Context): Promise<Share[]> {
  return readState<Share[]>(ctx, FILE, []);
}

export async function saveShares(ctx: Context, shares: Share[]) {
  await writeState(ctx, FILE, shares);
}

export async function addShare(ctx: Context, share: Share) {
  const shares = (await listShares(ctx)).filter((s) => s.id !== share.id);
  shares.push(share);
  await saveShares(ctx, shares);
}

export async function removeShareRecord(ctx: Context, id: string) {
  await saveShares(
    ctx,
    (await listShares(ctx)).filter((s) => s.id !== id),
  );
}
