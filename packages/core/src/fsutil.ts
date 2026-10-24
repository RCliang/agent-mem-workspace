import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export function sha(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export function idFor(agent: string, filePath: string): string {
  return createHash('sha1').update(`${agent}\0${filePath}`).digest('hex').slice(0, 12);
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

export async function readText(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return null;
  }
}

export async function listDir(p: string): Promise<string[]> {
  try {
    return await fs.readdir(p);
  } catch {
    return [];
  }
}

export async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Recursively collect files matching `filter`, bounded by `maxDepth`. */
export async function walk(root: string, filter: (p: string) => boolean, maxDepth = 6): Promise<string[]> {
  const out: string[] = [];
  async function rec(dir: string, depth: number) {
    if (depth > maxDepth) return;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await rec(full, depth + 1);
      else if (e.isFile() && filter(full)) out.push(full);
    }
  }
  await rec(root, 0);
  return out;
}

/** Read the first `maxBytes` of a file and return complete lines. */
export async function readHeadLines(p: string, maxBytes = 64 * 1024): Promise<string[]> {
  let fh: fs.FileHandle | undefined;
  try {
    fh = await fs.open(p, 'r');
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    const text = buf.subarray(0, bytesRead).toString('utf8');
    const lines = text.split('\n');
    if (bytesRead === maxBytes) lines.pop();
    return lines.filter((l) => l.trim().length > 0);
  } catch {
    return [];
  } finally {
    await fh?.close();
  }
}

export function safeJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/**
 * Group items that resolve to the same real path and fill `alsoReadBy` on each
 * (used for memories and skills: one file or folder read through several roots).
 */
export async function markAlsoReadBy<T extends { agent: string; alsoReadBy: string[] }>(items: T[], pathOf: (item: T) => string): Promise<void> {
  const byReal = new Map<string, T[]>();
  for (const item of items) {
    const p = pathOf(item);
    const real = await fs.realpath(p).catch(() => p);
    byReal.set(real, [...(byReal.get(real) ?? []), item]);
  }
  for (const group of byReal.values()) {
    for (const item of group) {
      item.alsoReadBy = [...new Set(group.map((g) => g.agent).filter((a) => a !== item.agent))];
    }
  }
}
