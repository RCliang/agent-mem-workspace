import path from 'node:path';
import type { Context } from '../context.js';
import { idFor, listDir, readText, safeJson } from '../fsutil.js';
import type { MemoryItem, ParsedSession, ProjectInfo, SessionMessage } from '../types.js';
import { MAX_SESSIONS_PER_PROJECT } from './common.js';

const AGENT = 'opencode';

/** opencode stores sessions and messages as JSON under XDG data (legacy file storage). */
export function opencodeStorage(ctx: Context): string {
  const dataRoot = ctx.env.OPENCODE_DATA_DIR ?? (ctx.env.XDG_DATA_HOME && path.isAbsolute(ctx.env.XDG_DATA_HOME) ? ctx.env.XDG_DATA_HOME : path.join(ctx.home, '.local', 'share'));
  return path.join(dataRoot, 'opencode', 'storage');
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
  const dir = path.join(opencodeStorage(ctx), 'session');
  const out: SessionFile[] = [];
  for (const name of await listDir(dir)) {
    if (!name.endsWith('.json')) continue;
    const filePath = path.join(dir, name);
    const parsed = asObj(safeJson((await readText(filePath)) ?? '{}'));
    if (!parsed) continue;
    const id = typeof parsed.id === 'string' && parsed.id ? parsed.id : name.replace(/\.json$/, '');
    const directory = typeof parsed.directory === 'string' ? parsed.directory : '';
    if (!directory) continue;
    const time = asObj(parsed.time) ?? {};
    const title = typeof parsed.title === 'string' ? parsed.title : '';
    out.push({
      id,
      directory,
      title,
      createdMs: asMs(time.created),
      updatedMs: asMs(time.updated) || asMs(time.created),
      filePath,
    });
  }
  return out;
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

export async function parseOpencodeSession(ctx: Context, filePath: string): Promise<ParsedSession> {
  const parsed = asObj(safeJson((await readText(filePath)) ?? '{}'));
  const sessionId = parsed && typeof parsed.id === 'string' && parsed.id ? parsed.id : path.basename(filePath, '.json');
  const directory = parsed && typeof parsed.directory === 'string' ? parsed.directory : null;
  const time = parsed ? asObj(parsed.time) : null;
  const startedAtMs = time ? asMs(time.created) : 0;

  const messages: SessionMessage[] = [];
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
    if (!m) continue;
    const role = m.role === 'user' || m.role === 'assistant' ? (m.role as 'user' | 'assistant') : null;
    if (!role) continue;
    const text = partsText(m.parts);
    const toolCalls = partsToolCalls(m.parts);
    if (!text && !toolCalls.length) continue;
    const t = asObj(m.time);
    const timestamp = t && typeof t.created === 'string' ? t.created : undefined;
    messages.push({ role, text, toolCalls, ...(timestamp ? { timestamp } : {}) });
  }

  return {
    agent: AGENT,
    filePath,
    sessionId,
    cwd: directory,
    ...(startedAtMs ? { startedAt: new Date(startedAtMs).toISOString() } : {}),
    messages,
  };
}
