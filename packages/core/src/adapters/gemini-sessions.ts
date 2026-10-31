import fs from 'node:fs/promises';
import path from 'node:path';
import type { Context } from '../context.js';
import { listDir, readHeadLines, readText, safeJson } from '../fsutil.js';
import type { MemoryItem, ParsedSession, ProjectInfo, SessionMessage } from '../types.js';
import { MAX_SESSIONS_PER_PROJECT, newestFirst, sessionItem } from './common.js';

const AGENT = 'gemini';

/**
 * Gemini CLI keeps one chats folder per project under `~/.gemini/tmp/<dir>`;
 * `~/.gemini/projects.json` maps every project root to its directory name
 * (the naming scheme changed several times, the index covers all of them).
 */
function geminiRoot(ctx: Context): string {
  return ctx.env.GEMINI_CLI_DIR ?? path.join(ctx.home, '.gemini');
}

async function projectIndex(root: string): Promise<Map<string, string>> {
  const byDir = new Map<string, string>();
  const raw = await readText(path.join(root, 'projects.json'));
  const parsed = raw ? safeJson(raw) : undefined;
  const projects = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as { projects?: Record<string, string> }).projects : undefined;
  if (projects) {
    for (const [projPath, dir] of Object.entries(projects)) {
      if (typeof dir === 'string') byDir.set(dir, projPath);
    }
  }
  return byDir;
}

interface Head {
  filePath: string;
  cwd: string | null;
  title: string | undefined;
  startedAt: string | undefined;
  mtimeMs: number;
  size: number;
}

/** The first lines carry the session metadata record plus enough turns for a title. */
async function headOf(filePath: string): Promise<Head | null> {
  const st = await fs.stat(filePath).catch(() => null);
  if (!st) return null;
  const lines = await readHeadLines(filePath, 64 * 1024);
  let cwd: string | null = null;
  let title: string | undefined;
  let startedAt: string | undefined;
  for (const line of lines) {
    const r = safeJson(line);
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
    const rec = r as Record<string, unknown>;
    if (cwd === null && Array.isArray(rec.directories)) {
      const first = rec.directories[0];
      if (typeof first === 'string' && first) cwd = first;
    }
    if (startedAt === undefined && typeof rec.startTime === 'string') startedAt = rec.startTime;
    if (title === undefined && rec.type === 'user' && typeof rec.content === 'string' && rec.content.trim()) {
      title = rec.content.trim().split('\n')[0]!.slice(0, 80);
    }
  }
  return { filePath, cwd, title, startedAt, mtimeMs: st.mtimeMs, size: st.size };
}

export async function listGeminiProjects(ctx: Context): Promise<ProjectInfo[]> {
  const root = geminiRoot(ctx);
  const byDir = await projectIndex(root);
  const out: ProjectInfo[] = [];
  const tmp = path.join(root, 'tmp');
  for (const name of await listDir(tmp)) {
    const projectPath = byDir.get(name);
    if (!projectPath) continue;
    const chats = path.join(tmp, name, 'chats');
    const files = (await listDir(chats)).filter((f) => f.endsWith('.jsonl'));
    if (!files.length) continue;
    let last = 0;
    for (const f of files) {
      const st = await fs.stat(path.join(chats, f)).catch(() => null);
      if (st) last = Math.max(last, st.mtimeMs);
    }
    out.push({ path: projectPath, name: path.basename(projectPath), agents: [AGENT], lastActivityMs: last });
  }
  return out;
}

export async function listGeminiSessions(ctx: Context, projectPath: string): Promise<MemoryItem[]> {
  const root = geminiRoot(ctx);
  const byDir = await projectIndex(root);
  const dir = [...byDir.entries()].find(([, p]) => typeof p === 'string' && path.resolve(p) === path.resolve(projectPath))?.[0];
  if (!dir) return [];
  const chats = path.join(root, 'tmp', dir, 'chats');
  const heads: Head[] = [];
  for (const f of (await listDir(chats)).filter((x) => x.endsWith('.jsonl'))) {
    const h = await headOf(path.join(chats, f));
    if (h) heads.push(h);
  }
  return newestFirst(
    heads.map((h) => sessionItem(AGENT, { filePath: h.filePath, cwd: h.cwd ?? projectPath, title: h.title, mtimeMs: h.mtimeMs, size: h.size }, projectPath)),
  ).slice(0, MAX_SESSIONS_PER_PROJECT);
}

export async function parseGeminiSession(filePath: string): Promise<ParsedSession> {
  const text = await fs.readFile(filePath, 'utf8').catch(() => '');
  const records = text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => safeJson(l))
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r));

  let sessionId = path.basename(filePath, '.jsonl');
  let cwd: string | null = null;
  let startedAt: string | undefined;
  const messages: SessionMessage[] = [];

  for (const rec of records) {
    if (Array.isArray(rec.directories)) {
      // SessionMetadataRecord: names the working directories and the session.
      const first = rec.directories[0];
      if (typeof first === 'string' && first) cwd = first;
      if (typeof rec.sessionId === 'string' && rec.sessionId) sessionId = rec.sessionId;
      if (typeof rec.startTime === 'string') startedAt = rec.startTime;
      continue;
    }
    const type = rec.type;
    if (type !== 'user' && type !== 'gemini') continue; // info/error/warning are UI noise
    const role: SessionMessage['role'] = type === 'user' ? 'user' : 'assistant';
    const parts: string[] = [];
    if (typeof rec.content === 'string' && rec.content.trim()) parts.push(rec.content.trim());
    if (Array.isArray(rec.thoughts)) {
      // Assistant turns without content carry their prose in thoughts.
      for (const t of rec.thoughts) {
        if (!t || typeof t !== 'object' || Array.isArray(t)) continue;
        const subject = (t as { subject?: unknown }).subject;
        const description = (t as { description?: unknown }).description;
        if (typeof subject === 'string' && subject.trim()) parts.push(subject.trim());
        else if (typeof description === 'string' && description.trim()) parts.push(description.trim());
      }
    }
    const toolCalls: SessionMessage['toolCalls'] = [];
    if (Array.isArray(rec.toolCalls)) {
      for (const c of rec.toolCalls) {
        if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
        const name = (c as { name?: unknown }).name;
        const description = (c as { description?: unknown }).description;
        if (typeof name === 'string' && name) {
          toolCalls.push({ name, ...(typeof description === 'string' && description ? { target: description.slice(0, 120) } : {}) });
        }
      }
    }
    const body = parts.join('\n\n').trim();
    if (!body && !toolCalls.length) continue;
    const timestamp = typeof rec.timestamp === 'string' ? rec.timestamp : undefined;
    messages.push({ role, text: body, toolCalls, ...(timestamp ? { timestamp } : {}) });
  }

  return { agent: AGENT, filePath, sessionId, cwd, ...(startedAt ? { startedAt } : {}), messages };
}
