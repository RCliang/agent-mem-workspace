import fs from 'node:fs/promises';
import path from 'node:path';
import type { Context } from './context.js';
import { exists, readText, sha } from './fsutil.js';
import type { RedactionFinding } from './redact.js';
import { addShare, removeShareRecord, type Share } from './share-store.js';
import { backupFile, ConflictError, currentHash, safeWrite, type BackupEntry } from './store.js';

export interface PlannedWrite {
  filePath: string;
  before: string | null;
  beforeHash: string | null;
  after: string;
  /** Create a symlink to this (relative) path instead of writing `after`. */
  symlinkTo?: string;
  /** Delete the file (used when unlinking a symlink share). */
  remove?: boolean;
}

/**
 * Every mutation is first computed as a Plan so the UI can preview a diff,
 * then applied verbatim with hash checks against what was previewed.
 */
export interface Plan {
  kind: 'share' | 'unshare' | 'transfer' | 'handoff';
  title: string;
  writes: PlannedWrite[];
  notes: string[];
  findings: RedactionFinding[];
  share?: Share;
  unshareId?: string;
}

export async function plannedWrite(filePath: string, after: string, extra: Partial<PlannedWrite> = {}): Promise<PlannedWrite> {
  const before = await readText(filePath);
  return { filePath, before, beforeHash: before == null ? null : sha(before), after, ...extra };
}

export interface ApplyResult {
  backups: BackupEntry[];
  files: string[];
}

export async function applyPlan(ctx: Context, plan: Plan): Promise<ApplyResult> {
  // Check every file first so a conflict never leaves a half-applied plan.
  for (const w of plan.writes) {
    const actual = await currentHash(w.filePath);
    if (actual !== w.beforeHash) throw new ConflictError(w.filePath, w.beforeHash, actual);
  }
  const backups: BackupEntry[] = [];
  const reason = `${plan.kind}: ${plan.title}`;
  for (const w of plan.writes) {
    if (w.symlinkTo || w.remove) {
      backups.push(await backupFile(ctx, w.filePath, reason));
      await fs.rm(w.filePath, { force: true });
      if (w.symlinkTo) {
        if (await exists(w.filePath)) throw new Error(`Refusing to replace ${w.filePath}`);
        await fs.mkdir(path.dirname(w.filePath), { recursive: true });
        await fs.symlink(w.symlinkTo, w.filePath);
      }
    } else {
      const res = await safeWrite(ctx, w.filePath, w.after, { reason });
      backups.push(res.backup);
    }
  }
  if (plan.share) await addShare(ctx, plan.share);
  if (plan.unshareId) await removeShareRecord(ctx, plan.unshareId);
  return { backups, files: plan.writes.map((w) => w.filePath) };
}
