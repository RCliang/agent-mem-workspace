import path from 'node:path';
import type { Context } from '../context.js';
import { idFor } from '../fsutil.js';
import type { MemoryItem, ParsedSession, ProjectInfo, SessionMessage } from '../types.js';
import { MAX_SESSIONS_PER_PROJECT } from './common.js';
import { openReadonly, sqlAll } from './sqlite.js';

const AGENT = 'zcode';

export function zcodeSessionPath(home: string, sessionId: string): string {
  return path.join(home, '.zcode', 'cli', 'db', 'by-session', sessionId);
}

function dbPath(home: string): string {
  return path.join(home, '.zcode', 'cli', 'db', 'db.sqlite');
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asTime(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1e12 ? n * 1000 : n;
}

function parseJson(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function toolCall(data: Record<string, unknown>): SessionMessage['toolCalls'][number] | null {
  if (data.type !== 'tool') return null;
  const name = asText(data.tool) || 'tool';
  const state = data.state;
  if (!state || typeof state !== 'object' || Array.isArray(state)) return { name };
  const input = (state as Record<string, unknown>).input;
  if (typeof input === 'string') return { name, target: input.slice(0, 200) };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { name };
  const fields = input as Record<string, unknown>;
  const picked = fields.file_path ?? fields.path ?? fields.command ?? fields.pattern;
  return typeof picked === 'string' ? { name, target: picked.slice(0, 200) } : { name };
}

export function listZcodeProjects(ctx: Context): ProjectInfo[] {
  const db = openReadonly(dbPath(ctx.home));
  if (!db) return [];
  try {
    const rows = sqlAll(
      db,
      `SELECT directory, MAX(time_updated) AS updated
       FROM session
       WHERE COALESCE(time_deleted, 0) = 0 AND directory != ''
       GROUP BY directory`,
    );
    return rows.map((row) => {
      const projectPath = asText(row.directory);
      return { path: projectPath, name: path.basename(projectPath), agents: [AGENT], lastActivityMs: asTime(row.updated) };
    });
  } finally {
    db.close();
  }
}

export function listZcodeSessions(ctx: Context, projectPath: string): MemoryItem[] {
  const db = openReadonly(dbPath(ctx.home));
  if (!db) return [];
  try {
    const rows = sqlAll(
      db,
      `SELECT id, title, time_created, time_updated
       FROM session
       WHERE directory = ? AND COALESCE(time_deleted, 0) = 0
       ORDER BY time_updated DESC
       LIMIT ?`,
      projectPath,
      MAX_SESSIONS_PER_PROJECT,
    );
    return rows.flatMap((row) => {
      const sessionId = asText(row.id);
      if (!sessionId) return [];
      const filePath = zcodeSessionPath(ctx.home, sessionId);
      const title = asText(row.title).trim() || sessionId;
      const mtimeMs = asTime(row.time_updated) || asTime(row.time_created);
      return [
        {
          id: idFor(AGENT, filePath),
          agent: AGENT,
          scope: 'local' as const,
          kind: 'session' as const,
          title,
          filePath,
          projectPath,
          content: '',
          hash: `${sessionId}-${mtimeMs}`,
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

export function parseZcodeSession(ctx: Context, filePath: string): ParsedSession {
  const sessionId = path.basename(filePath);
  const db = openReadonly(dbPath(ctx.home));
  if (!db) {
    return { agent: AGENT, filePath, sessionId, cwd: null, messages: [] };
  }
  try {
    const meta = sqlAll(db, 'SELECT directory, title, time_created FROM session WHERE id = ?', sessionId)[0];
    const messages = sqlAll(db, 'SELECT id, data, time_created FROM message WHERE session_id = ? ORDER BY sequence', sessionId);
    const parts = sqlAll(db, 'SELECT message_id, data FROM part WHERE session_id = ? ORDER BY sequence', sessionId);
    const byMessage = new Map<string, Record<string, unknown>[]>();
    for (const part of parts) {
      const data = parseJson(part.data);
      const messageId = asText(part.message_id);
      if (!data || !messageId) continue;
      byMessage.set(messageId, [...(byMessage.get(messageId) ?? []), data]);
    }
    const out: SessionMessage[] = [];
    for (const message of messages) {
      const data = parseJson(message.data);
      const role = data?.role;
      if (role !== 'user' && role !== 'assistant' && role !== 'tool' && role !== 'system') continue;
      const chunks = byMessage.get(asText(message.id)) ?? [];
      const text = chunks
        .filter((chunk) => chunk.type === 'text' && typeof chunk.text === 'string')
        .map((chunk) => chunk.text as string)
        .join('\n')
        .trim();
      const toolCalls = chunks.flatMap((chunk) => {
        const call = toolCall(chunk);
        return call ? [call] : [];
      });
      if (!text && toolCalls.length === 0) continue;
      const created = asTime(message.time_created);
      out.push({ role, text, toolCalls, timestamp: created ? new Date(created).toISOString() : undefined });
    }
    const started = asTime(meta?.time_created);
    return {
      agent: AGENT,
      filePath,
      sessionId,
      cwd: asText(meta?.directory) || null,
      startedAt: started ? new Date(started).toISOString() : undefined,
      messages: out,
    };
  } finally {
    db.close();
  }
}
