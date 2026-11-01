import path from 'node:path';
import type { Context } from '../context.js';
import { exists, idFor, listDir, readText, safeJson } from '../fsutil.js';
import type { MemoryItem, ParsedSession, ProjectInfo, SessionMessage } from '../types.js';
import { MAX_SESSIONS_PER_PROJECT } from './common.js';
import { openReadonly, sqlAll } from './sqlite.js';

const AGENT = 'opencode';

/** opencode stores sessions and messages under XDG data: JSON files, or SQLite in newer builds. */
export function opencodeStorage(ctx: Context): string {
  const dataRoot = ctx.env.OPENCODE_DATA_DIR ?? (ctx.env.XDG_DATA_HOME && path.isAbsolute(ctx.env.XDG_DATA_HOME) ? ctx.env.XDG_DATA_HOME : path.join(ctx.home, '.local', 'share'));
  return path.join(dataRoot, 'opencode', 'storage');
}

function opencodeDataRoot(ctx: Context): string {
  return path.dirname(opencodeStorage(ctx));
}

/** Channel-named databases (opencode.db, opencode-<channel>.db) live next to storage/. */
async function opencodeDbFiles(ctx: Context): Promise<string[]> {
  const dir = opencodeDataRoot(ctx);
  const out: string[] = [];
  for (const name of await listDir(dir)) {
    if (!/^opencode.*\.db$/.test(name)) continue;
    const file = path.join(dir, name);
    if (await exists(file)) out.push(file);
  }
  return out.sort();
}

interface SessionFile {
  id: string;
  directory: string;
  title: string;
  createdMs: number;
  updatedMs: number;
  filePath: string;
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asMs(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    if (Number.isFinite(t) && t > 0) return t;
  }
  return 0;
}

async function readSessions(ctx: Context): Promise<SessionFile[]> {
  const byId = new Map<string, SessionFile>();

  // Newer builds keep sessions in SQLite (session/message/part tables, JSON in data columns).
  for (const dbFile of await opencodeDbFiles(ctx)) {
    const db = openReadonly(dbFile);
    if (!db) continue;
    try {
      const rows = sqlAll(
        db,
        `SELECT id, directory, title, time_created, time_updated FROM session
         WHERE directory IS NOT NULL AND directory != ''
         ORDER BY time_updated DESC`,
      );
      for (const row of rows) {
        const id = typeof row.id === 'string' ? row.id : '';
        const directory = typeof row.directory === 'string' ? row.directory : '';
        if (!id || !directory) continue;
        const title = typeof row.title === 'string' ? row.title : '';
        byId.set(id, {
          id,
          directory,
          title,
          createdMs: asMs(row.time_created),
          updatedMs: asMs(row.time_updated) || asMs(row.time_created),
          filePath: path.join(opencodeStorage(ctx), 'session', `${id}.json`),
        });
      }
    } catch {
      // A database without the expected schema is not ours to read.
    } finally {
      db.close();
    }
  }

  // Older builds store one JSON file per session; same ids keep their existing entry.
  const dir = path.join(opencodeStorage(ctx), 'session');
  for (const name of await listDir(dir)) {
    if (!name.endsWith('.json')) continue;
    const filePath = path.join(dir, name);
    const parsed = asObj(safeJson((await readText(filePath)) ?? '{}'));
    if (!parsed) continue;
    const id = typeof parsed.id === 'string' && parsed.id ? parsed.id : name.replace(/\.json$/, '');
    const directory = typeof parsed.directory === 'string' ? parsed.directory : '';
    if (!directory || byId.has(id)) continue;
    const time = asObj(parsed.time) ?? {};
    const title = typeof parsed.title === 'string' ? parsed.title : '';
    byId.set(id, { id, directory, title, createdMs: asMs(time.created), updatedMs: asMs(time.updated) || asMs(time.created), filePath });
  }
  return [...byId.values()];
}

export async function listOpencodeProjects(ctx: Context): Promise<ProjectInfo[]> {
  const byDir = new Map<string, { name: string; last: number }>();
  for (const s of await readSessions(ctx)) {
    const cur = byDir.get(s.directory);
    if (cur) cur.last = Math.max(cur.last, s.updatedMs);
    else byDir.set(s.directory, { name: path.basename(s.directory), last: s.updatedMs });
  }
  return [...byDir.entries()].map(([dir, { name, last }]) => ({ path: dir, name, agents: [AGENT], lastActivityMs: last }));
}

function sessionItemFor(s: SessionFile, projectPath: string, firstPrompt: string | undefined): MemoryItem {
  const title = s.title.trim() || firstPrompt?.trim().slice(0, 80) || s.id;
  return {
    id: idFor(AGENT, s.filePath),
    agent: AGENT,
    scope: 'local',
    kind: 'session',
    title,
    filePath: s.filePath,
    projectPath,
    content: '',
    hash: `${s.id}-${s.updatedMs}`,
    mtimeMs: s.updatedMs,
    size: 0,
    alsoReadBy: [],
    isWriteTarget: false,
    isSymlink: false,
  };
}

/** Messages are separate JSON files sharded by the first two characters of the session id. */
async function messageFiles(ctx: Context, sessionId: string): Promise<string[]> {
  const shard = path.join(opencodeStorage(ctx), 'message', sessionId.slice(0, 2));
  const out: string[] = [];
  for (const name of await listDir(shard)) {
    if (!name.endsWith('.json')) continue;
    const filePath = path.join(shard, name);
    const parsed = asObj(safeJson((await readText(filePath)) ?? '{}'));
    if (parsed && parsed.sessionID === sessionId) out.push(filePath);
  }
  return out;
}

async function firstUserPrompt(ctx: Context, sessionId: string): Promise<string | undefined> {
  const files = await messageFiles(ctx, sessionId);
  for (const f of files.slice(0, 5)) {
    const parsed = asObj(safeJson((await readText(f)) ?? '{}'));
    if (!parsed || parsed.role !== 'user') continue;
    const text = partsText(parsed.parts);
    if (text) return text.split('\n')[0];
  }
  return undefined;
}

function partsText(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  const out: string[] = [];
  for (const p of parts) {
    const part = asObj(p);
    if (part && part.type === 'text' && typeof part.text === 'string') out.push(part.text);
  }
  return out.join('\n').trim();
}

function partsToolCalls(parts: unknown): SessionMessage['toolCalls'] {
  if (!Array.isArray(parts)) return [];
  const out: SessionMessage['toolCalls'] = [];
  for (const p of parts) {
    const part = asObj(p);
    if (!part || part.type !== 'tool') continue;
    const name = typeof part.tool === 'string' ? part.tool : '';
    if (!name) continue;
    const state = asObj(part.state);
    const input = state ? state.input : undefined;
    let target: string | undefined;
    if (typeof input === 'string') target = input.slice(0, 120);
    else if (input && typeof input === 'object') {
      for (const key of ['filePath', 'path', 'file', 'command', 'cmd', 'pattern', 'url'] as const) {
        const v = (input as Record<string, unknown>)[key];
        if (typeof v === 'string' && v) {
          target = v.slice(0, 120);
          break;
        }
      }
    }
    out.push({ name, ...(target ? { target } : {}) });
  }
  return out;
}

export async function listOpencodeSessions(ctx: Context, projectPath: string): Promise<MemoryItem[]> {
  const sessions = (await readSessions(ctx)).filter((s) => path.resolve(s.directory) === path.resolve(projectPath));
  const items: MemoryItem[] = [];
  const recent = [...sessions].sort((a, b) => b.updatedMs - a.updatedMs).slice(0, MAX_SESSIONS_PER_PROJECT);
  for (const s of recent) {
    const prompt = await firstUserPrompt(ctx, s.id);
    items.push(sessionItemFor(s, projectPath, prompt));
  }
  return items;
}

/** One message with its parts, however they were stored. */
interface RawMessage {
  role: 'user' | 'assistant';
  time: string | undefined;
  parts: unknown[];
}

async function fileMessages(ctx: Context, sessionId: string): Promise<RawMessage[]> {
  const out: RawMessage[] = [];
  const files = await messageFiles(ctx, sessionId);
  const timed: { file: string; at: number }[] = [];
  for (const f of files) {
    const m = asObj(safeJson((await readText(f)) ?? '{}'));
    const t = m ? asObj(m.time) : null;
    timed.push({ file: f, at: t ? asMs(t.created) : 0 });
  }
  timed.sort((a, b) => a.at - b.at);
  for (const { file } of timed) {
    const m = asObj(safeJson((await readText(file)) ?? '{}'));
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    out.push({ role: m.role, time: asObj(m.time) && typeof (asObj(m.time) as { created?: unknown }).created === 'string' ? (asObj(m.time) as { created: string }).created : undefined, parts: Array.isArray(m.parts) ? m.parts : [] });
  }
  return out;
}

/** SQLite layout: message rows carry {role,...} JSON, parts live in their own table. */
async function dbMessages(ctx: Context, sessionId: string): Promise<RawMessage[]> {
  for (const dbFile of await opencodeDbFiles(ctx)) {
    const db = openReadonly(dbFile);
    if (!db) continue;
    try {
      const messages = sqlAll(
        db,
        `SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created, rowid`,
        sessionId,
      );
      if (!messages.length) continue;
      const out: RawMessage[] = [];
      for (const m of messages) {
        const data = asObj(safeJson(typeof m.data === 'string' ? m.data : '{}'));
        const role = data?.role === 'user' || data?.role === 'assistant' ? (data.role as 'user' | 'assistant') : null;
        if (!role) continue;
        const parts = sqlAll(
          db,
          `SELECT data FROM part WHERE message_id = ? ORDER BY time_created, rowid`,
          typeof m.id === 'string' ? m.id : '',
        ).flatMap((p) => (typeof p.data === 'string' ? [safeJson(p.data)] : []));
        out.push({ role, time: undefined, parts });
      }
      return out;
    } catch {
      // Schema mismatch on this database; try the next one.
    } finally {
      db.close();
    }
  }
  return [];
}

/** The working directory of a session that lives in SQLite (no file to read it from). */
async function sessionDirectory(ctx: Context, sessionId: string): Promise<string | null> {
  for (const s of await readSessions(ctx)) {
    if (s.id === sessionId) return s.directory;
  }
  return null;
}

export async function parseOpencodeSession(ctx: Context, filePath: string): Promise<ParsedSession> {
  const parsed = asObj(safeJson((await readText(filePath)) ?? '{}'));
  const sessionId = parsed && typeof parsed.id === 'string' && parsed.id ? parsed.id : path.basename(filePath, '.json');
  const directory = parsed && typeof parsed.directory === 'string' ? parsed.directory : null;
  const time = parsed ? asObj(parsed.time) : null;
  const startedAtMs = time ? asMs(time.created) : 0;

  const raw = (await exists(filePath)) ? await fileMessages(ctx, sessionId) : await dbMessages(ctx, sessionId);
  const messages: SessionMessage[] = [];
  for (const m of raw) {
    const text = partsText(m.parts);
    const toolCalls = partsToolCalls(m.parts);
    if (!text && !toolCalls.length) continue;
    messages.push({ role: m.role, text, toolCalls, ...(m.time ? { timestamp: m.time } : {}) });
  }

  return {
    agent: AGENT,
    filePath,
    sessionId,
    cwd: directory ?? (await sessionDirectory(ctx, sessionId)),
    ...(startedAtMs ? { startedAt: new Date(startedAtMs).toISOString() } : {}),
    messages,
  };
}
