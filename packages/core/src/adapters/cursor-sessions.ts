import fs from 'node:fs/promises';
import path from 'node:path';
import { idFor, listDir, readText, safeJson } from '../fsutil.js';
import { parseSessionFile } from '../sessions.js';
import type { MemoryItem, ParsedSession, ProjectInfo, SessionMessage } from '../types.js';
import { MAX_SESSIONS_PER_PROJECT, newestFirst, sessionHead, sessionItem } from './common.js';
import { openReadonly, sqlAll } from './sqlite.js';

const AGENT = 'cursor';

export function encodeCursorProject(projectPath: string): string {
  return projectPath.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-');
}

export function cursorSupportDir(home: string): string {
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Cursor');
  if (process.platform === 'win32') return path.join(home, 'AppData', 'Roaming', 'Cursor');
  return path.join(home, '.config', 'Cursor');
}

function stateDb(home: string): string {
  return path.join(cursorSupportDir(home), 'User', 'globalStorage', 'state.vscdb');
}

export function cursorComposerPath(home: string, composerId: string): string {
  return path.join(cursorSupportDir(home), 'User', 'globalStorage', 'composer-sessions', composerId);
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asTime(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1e12 ? n * 1000 : n;
}

function fileUrlPath(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'file:') return null;
    return decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
}

async function workspacePaths(home: string): Promise<Map<string, string>> {
  const root = path.join(cursorSupportDir(home), 'User', 'workspaceStorage');
  const out = new Map<string, string>();
  for (const id of await listDir(root)) {
    const raw = await readText(path.join(root, id, 'workspace.json'));
    const parsed = raw ? safeJson(raw) : undefined;
    const folder = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as { folder?: unknown }).folder : undefined;
    const projectPath = typeof folder === 'string' ? fileUrlPath(folder) : null;
    if (projectPath) out.set(id, projectPath);
  }
  return out;
}

async function transcriptFiles(cursorDir: string, projectPath: string): Promise<string[]> {
  const dir = path.join(cursorDir, 'projects', encodeCursorProject(projectPath), 'agent-transcripts');
  const files: string[] = [];
  for (const id of await listDir(dir)) {
    const file = path.join(dir, id, `${id}.jsonl`);
    try {
      await fs.stat(file);
      files.push(file);
    } catch {
      // A transcript folder without its own jsonl is a partial write.
    }
  }
  return files;
}

function composerItems(home: string, projectPath: string, workspaceId: string): MemoryItem[] {
  const db = openReadonly(stateDb(home));
  if (!db) return [];
  try {
    const rows = sqlAll(
      db,
      `SELECT composerId, value, lastUpdatedAt, createdAt
       FROM composerHeaders
       WHERE workspaceId = ? AND isSubagent = 0
       ORDER BY lastUpdatedAt DESC
       LIMIT ?`,
      workspaceId,
      MAX_SESSIONS_PER_PROJECT,
    );
    return rows.flatMap((row) => {
      const composerId = asText(row.composerId);
      if (!composerId) return [];
      const meta = asText(row.value) ? safeJson(asText(row.value)) : undefined;
      const name = meta && typeof meta === 'object' && !Array.isArray(meta) ? asText((meta as { name?: unknown }).name).trim() : '';
      const filePath = cursorComposerPath(home, composerId);
      const mtimeMs = asTime(row.lastUpdatedAt) || asTime(row.createdAt);
      return [
        {
          id: idFor(AGENT, filePath),
          agent: AGENT,
          scope: 'local' as const,
          kind: 'session' as const,
          title: name || composerId,
          filePath,
          projectPath,
          content: '',
          hash: `${composerId}-${mtimeMs}`,
          mtimeMs,
          size: 0,
          alsoReadBy: [],
          isWriteTarget: false,
          isSymlink: false,
        },
      ];
    });
  } finally {
    db.close();
  }
}

function oneCardPerChat(items: MemoryItem[]): MemoryItem[] {
  const kept = new Map<string, MemoryItem>();
  for (const item of items) {
    const key = path.basename(item.filePath, '.jsonl');
    const previous = kept.get(key);
    const composer = item.filePath.includes(`${path.sep}composer-sessions${path.sep}`);
    if (!previous || composer) kept.set(key, item);
  }
  return [...kept.values()];
}

export async function listCursorSessions(home: string, cursorDir: string, projectPath: string): Promise<MemoryItem[]> {
  const transcripts = [];
  for (const file of await transcriptFiles(cursorDir, projectPath)) {
    const head = await sessionHead(file);
    if (head) transcripts.push(sessionItem(AGENT, head, projectPath));
  }
  const workspaces = await workspacePaths(home);
  const composers = [...workspaces.entries()].flatMap(([id, stored]) =>
    path.resolve(stored) === path.resolve(projectPath) ? composerItems(home, projectPath, id) : [],
  );
  return newestFirst(oneCardPerChat([...transcripts, ...composers])).slice(0, MAX_SESSIONS_PER_PROJECT);
}

export async function listCursorProjects(home: string): Promise<ProjectInfo[]> {
  const db = openReadonly(stateDb(home));
  if (!db) return [];
  try {
    const rows = sqlAll(
      db,
      `SELECT workspaceId, MAX(lastUpdatedAt) AS updated
       FROM composerHeaders
       WHERE isSubagent = 0
       GROUP BY workspaceId`,
    );
    const workspaces = await workspacePaths(home);
    const out: ProjectInfo[] = [];
    for (const row of rows) {
      const projectPath = workspaces.get(asText(row.workspaceId));
      if (!projectPath) continue;
      out.push({ path: projectPath, name: path.basename(projectPath), agents: [AGENT], lastActivityMs: asTime(row.updated) });
    }
    return out;
  } finally {
    db.close();
  }
}

function bubbleRole(type: unknown): SessionMessage['role'] | null {
  if (type === 1) return 'user';
  if (type === 2) return 'assistant';
  return null;
}

export async function parseCursorSession(home: string, filePath: string): Promise<ParsedSession> {
  if (filePath.endsWith('.jsonl')) return parseSessionFile(AGENT, filePath);
  const composerId = path.basename(filePath);
  const db = openReadonly(stateDb(home));
  if (!db) return { agent: AGENT, filePath, sessionId: composerId, cwd: null, messages: [] };
  try {
    const headerRow = sqlAll(db, 'SELECT workspaceId, createdAt FROM composerHeaders WHERE composerId = ?', composerId)[0];
    const orderKey = `composerConvHeaders:${composerId}:000000`;
    const orderRaw = sqlAll(db, 'SELECT value FROM cursorDiskKV WHERE key = ?', orderKey)[0];
    const order = orderRaw ? safeJson(asText(orderRaw.value)) : undefined;
    const bubbles = Array.isArray(order) ? order : [];
    const messages: SessionMessage[] = [];
    for (const entry of bubbles) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const bubbleId = asText((entry as { bubbleId?: unknown }).bubbleId);
      if (!bubbleId) continue;
      const stored = sqlAll(db, 'SELECT value FROM cursorDiskKV WHERE key = ?', `bubbleId:${composerId}:${bubbleId}`)[0];
      const bubble = stored ? safeJson(asText(stored.value)) : undefined;
      if (!bubble || typeof bubble !== 'object' || Array.isArray(bubble)) continue;
      const body = bubble as { type?: unknown; text?: unknown; createdAt?: unknown };
      const role = bubbleRole(body.type);
      const text = asText(body.text).trim();
      if (!role || !text) continue;
      messages.push({ role, text, toolCalls: [], timestamp: asText(body.createdAt) || undefined });
    }
    const workspaces = await workspacePaths(home);
    const created = asTime(headerRow?.createdAt);
    return {
      agent: AGENT,
      filePath,
      sessionId: composerId,
      cwd: workspaces.get(asText(headerRow?.workspaceId)) ?? null,
      startedAt: created ? new Date(created).toISOString() : undefined,
      messages,
    };
  } finally {
    db.close();
  }
}
