import fs from 'node:fs/promises';
import path from 'node:path';
import type { Context } from './context.js';
import { exists, isDir, readText, sha } from './fsutil.js';
import type { RedactionFinding } from './redact.js';
import { addShare, removeShareRecord, type Share } from './share-store.js';
import { backupDir, backupFile, ConflictError, currentHash, safeWrite, type BackupEntry } from './store.js';

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

/** Whole-directory operation for skills; checked upfront like file writes. */
export interface SkillDirOp {
  op: 'copy-dir' | 'delete-dir';
  srcDir?: string;
  destDir: string;
  /** Whether the directory existed when the plan was computed. */
  destExisted: boolean;
}

/**
 * Every mutation is first computed as a Plan so the UI can preview a diff,
 * then applied verbatim with hash checks against what was previewed.
 */
export interface Plan {
  kind: 'share' | 'unshare' | 'transfer' | 'handoff' | 'skill-transfer' | 'skill-delete';
  title: string;
  writes: PlannedWrite[];
  /** Skill folder copies and deletions; performed after the file writes. */
  dirOps?: SkillDirOp[];
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
  for (const op of plan.dirOps ?? []) {
    const actual = await exists(op.destDir);
    if (actual !== op.destExisted) throw new ConflictError(op.destDir, op.destExisted ? 'dir' : null, actual ? 'dir' : null);
    if (op.op === 'copy-dir' && !(await isDir(op.srcDir!))) throw new ConflictError(op.srcDir!, 'dir', null);
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
  for (const op of plan.dirOps ?? []) {
    if (op.op === 'copy-dir') {
      if (op.destExisted) {
        backups.push(await backupDir(ctx, op.destDir, reason));
        await fs.rm(op.destDir, { recursive: true, force: true });
      } else {
        await fs.mkdir(path.dirname(op.destDir), { recursive: true });
      }
      await fs.cp(op.srcDir!, op.destDir, { recursive: true });
    } else {
      backups.push(await backupDir(ctx, op.destDir, reason));
      await fs.rm(op.destDir, { recursive: true, force: true });
    }
  }
  if (plan.share) await addShare(ctx, plan.share);
  if (plan.unshareId) await removeShareRecord(ctx, plan.unshareId);
  const files = [
    ...plan.writes.map((w) => w.filePath),
    ...(plan.dirOps ?? []).flatMap((op) => {
      const list = [op.destDir];
      if (op.srcDir && op.op === 'copy-dir') list.push(op.srcDir);
      return list;
    }),
  ];
  return { backups, files };
}
