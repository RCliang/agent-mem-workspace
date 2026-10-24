import fs from 'node:fs/promises';
import path from 'node:path';
import { idFor, readHeadLines, readText, safeJson, sha } from '../fsutil.js';
import { cwdFromRecords, titleFromRecords } from '../sessions.js';
import type { AgentId, MemoryItem, MemoryKind, MemoryScope } from '../types.js';

export async function fileItem(
  agent: AgentId,
  filePath: string,
  scope: MemoryScope,
  kind: MemoryKind,
  projectPath: string | null,
  title: string,
): Promise<MemoryItem | null> {
  let lst;
  try {
    lst = await fs.lstat(filePath);
  } catch {
    return null;
  }
  const content = await readText(filePath);
  if (content == null) return null;
  return {
    id: idFor(agent, filePath),
    agent,
    scope,
    kind,
    title,
    filePath,
    projectPath,
    content,
    hash: sha(content),
    mtimeMs: lst.mtimeMs,
    size: Buffer.byteLength(content),
    alsoReadBy: [],
    isWriteTarget: false,
    isSymlink: lst.isSymbolicLink(),
  };
}

export interface SessionHead {
  filePath: string;
  cwd: string | null;
  title: string | undefined;
  mtimeMs: number;
  size: number;
}

export async function sessionHead(filePath: string): Promise<SessionHead | null> {
  let st;
  try {
    st = await fs.stat(filePath);
  } catch {
    return null;
  }
  const records = (await readHeadLines(filePath)).map((l) => safeJson(l)).filter((r) => r !== undefined);
  return { filePath, cwd: cwdFromRecords(records.slice(0, 50)), title: titleFromRecords(records), mtimeMs: st.mtimeMs, size: st.size };
}

export function sessionItem(agent: AgentId, head: SessionHead, projectPath: string): MemoryItem {
  return {
    id: idFor(agent, head.filePath),
    agent,
    scope: 'local',
    kind: 'session',
    title: head.title ?? path.basename(head.filePath, '.jsonl'),
    filePath: head.filePath,
    projectPath,
    content: '',
    hash: `${head.size}-${Math.round(head.mtimeMs)}`,
    mtimeMs: head.mtimeMs,
    size: head.size,
    alsoReadBy: [],
    isWriteTarget: false,
    isSymlink: false,
  };
}

export const MAX_SESSIONS_PER_PROJECT = 25;

export function newestFirst<T extends { mtimeMs: number }>(xs: T[]): T[] {
  return [...xs].sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** Render foreign memories for agents without import support: plain Markdown with provenance. */
export function renderPlain(items: { agent: AgentId; filePath: string; content: string; title: string }[]): string {
  return items
    .map((i) => `<!-- source: ${i.agent} ${i.filePath} -->\n${i.content.trim()}`)
    .join('\n\n');
}
