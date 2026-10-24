import fs from 'node:fs/promises';
import path from 'node:path';
import type { Context } from './context.js';
import { exists, readText, sha } from './fsutil.js';

export class ConflictError extends Error {
  constructor(
    readonly filePath: string,
    readonly expectedHash: string | null,
    readonly actualHash: string | null,
  ) {
    super(`File changed on disk since it was loaded: ${filePath}`);
    this.name = 'ConflictError';
  }
}

export interface BackupEntry {
  id: string;
  filePath: string;
  /** `null` when the file did not exist before the write (undo deletes it). */
  backupPath: string | null;
  wasSymlinkTo: string | null;
  reason: string;
  createdAt: string;
  undone?: boolean;
}

function journalPath(ctx: Context) {
  return path.join(ctx.dataDir, 'backups', 'journal.json');
}

async function readJsonFile<T>(p: string, fallback: T): Promise<T> {
  const text = await readText(p);
  if (text == null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(p: string, value: unknown) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, p);
}

export async function listBackups(ctx: Context): Promise<BackupEntry[]> {
  return readJsonFile<BackupEntry[]>(journalPath(ctx), []);
}

/** Snapshot `filePath` before it is modified so the write can be undone. */
export async function backupFile(ctx: Context, filePath: string, reason: string): Promise<BackupEntry> {
  const journal = await listBackups(ctx);
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  let backupPath: string | null = null;
  let wasSymlinkTo: string | null = null;
  if (await exists(filePath)) {
    const st = await fs.lstat(filePath);
    if (st.isSymbolicLink()) {
      wasSymlinkTo = await fs.readlink(filePath);
    } else {
      const dir = path.join(ctx.dataDir, 'backups', 'files');
      await fs.mkdir(dir, { recursive: true });
      backupPath = path.join(dir, `${id}-${path.basename(filePath)}`);
      await fs.copyFile(filePath, backupPath);
    }
  }
  const entry: BackupEntry = { id, filePath, backupPath, wasSymlinkTo, reason, createdAt: new Date().toISOString() };
  journal.unshift(entry);
  await writeJsonFile(journalPath(ctx), journal.slice(0, 500));
  return entry;
}

export async function undoBackup(ctx: Context, id?: string): Promise<BackupEntry> {
  const journal = await listBackups(ctx);
  const entry = id ? journal.find((e) => e.id === id) : journal.find((e) => !e.undone);
  if (!entry) throw new Error(id ? `No backup with id ${id}` : 'Nothing to undo');
  if (entry.undone) throw new Error(`Backup ${entry.id} was already restored`);
  await fs.rm(entry.filePath, { force: true });
  if (entry.wasSymlinkTo) {
    await fs.symlink(entry.wasSymlinkTo, entry.filePath);
  } else if (entry.backupPath) {
    await fs.mkdir(path.dirname(entry.filePath), { recursive: true });
    await fs.copyFile(entry.backupPath, entry.filePath);
  }
  entry.undone = true;
  await writeJsonFile(journalPath(ctx), journal);
  return entry;
}

export async function currentHash(filePath: string): Promise<string | null> {
  const text = await readText(filePath);
  return text == null ? null : sha(text);
}

/** Remove backup snapshots the journal no longer references (entries are capped at 500). */
export async function pruneBackups(ctx: Context): Promise<{ removedFiles: string[] }> {
  const journal = await listBackups(ctx);
  const referenced = new Set(journal.flatMap((e) => (e.backupPath ? [e.backupPath] : [])));
  const dir = path.join(ctx.dataDir, 'backups', 'files');
  const removedFiles: string[] = [];
  for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
    const full = path.join(dir, name);
    if (!referenced.has(full)) {
      await fs.rm(full, { force: true });
      removedFiles.push(full);
    }
  }
  return { removedFiles };
}

export async function orphanBackupCount(ctx: Context): Promise<number> {
  const journal = await listBackups(ctx);
  const referenced = new Set(journal.flatMap((e) => (e.backupPath ? [e.backupPath] : [])));
  const dir = path.join(ctx.dataDir, 'backups', 'files');
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  return names.filter((n) => !referenced.has(path.join(dir, n))).length;
}

export interface WriteOptions {
  /** Hash the caller last saw; `null` means "expect the file to be absent". Omit to skip the check. */
  expectedHash?: string | null;
  reason: string;
}

/** Write with optimistic concurrency and a backup entry. Writes through symlinks to their target. */
export async function safeWrite(ctx: Context, filePath: string, content: string, opts: WriteOptions) {
  if (opts.expectedHash !== undefined) {
    const actual = await currentHash(filePath);
    if (actual !== opts.expectedHash) throw new ConflictError(filePath, opts.expectedHash, actual);
  }
  let target = filePath;
  try {
    target = await fs.realpath(filePath);
  } catch {
    // new file
  }
  const backup = await backupFile(ctx, target, opts.reason);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
  return { backup, hash: sha(content), filePath: target };
}

export async function readState<T>(ctx: Context, name: string, fallback: T): Promise<T> {
  return readJsonFile<T>(path.join(ctx.dataDir, name), fallback);
}

export async function writeState(ctx: Context, name: string, value: unknown) {
  await writeJsonFile(path.join(ctx.dataDir, name), value);
}
