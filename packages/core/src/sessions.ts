import fs from 'node:fs/promises';
import path from 'node:path';
import { safeJson } from './fsutil.js';
import type { AgentId, ParsedSession, SessionMessage } from './types.js';

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Text injected by harnesses rather than typed by the user. */
const SYNTHETIC_PREFIXES = [
  '<environment_context>',
  '<user_instructions>',
  '# AGENTS.md instructions',
  '<command-name>',
  '<local-command-stdout>',
  '<system-reminder>',
  'Caveat: The messages below were generated',
];

function toolTarget(input: unknown): string | undefined {
  let v = input;
  if (typeof v === 'string') v = safeJson(v) ?? v;
  if (typeof v === 'string') return v.slice(0, 200);
  if (!isObj(v)) return undefined;
  for (const key of ['file_path', 'path', 'filePath', 'notebook_path', 'pattern', 'url']) {
    const s = str(v[key]);
    if (s) return s;
  }
  const cmd = v.command ?? v.cmd;
  if (Array.isArray(cmd)) {
    const parts = cmd.map(String);
    // Codex wraps shell commands as ["bash", "-lc", "<script>"].
    const script = parts.length >= 3 && /^(ba|z)?sh$/.test(path.basename(parts[0] ?? '')) ? parts.slice(2).join(' ') : parts.join(' ');
    return script.slice(0, 200);
  }
  if (typeof cmd === 'string') return cmd.slice(0, 200);
  return undefined;
}

/** Files named in a Codex `apply_patch` envelope. */
function patchFiles(text: string): string[] {
  return [...text.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)].map((m) => m[1]!.trim());
}

interface Extracted {
  text: string;
  toolCalls: SessionMessage['toolCalls'];
  onlyToolResults: boolean;
}

function extractContent(content: unknown): Extracted {
  if (typeof content === 'string') return { text: content, toolCalls: [], onlyToolResults: false };
  const texts: string[] = [];
  const toolCalls: SessionMessage['toolCalls'] = [];
  let sawResult = false;
  let sawOther = false;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (!isObj(part)) continue;
      const type = str(part.type);
      if (type === 'text' || type === 'input_text' || type === 'output_text') {
        const t = str(part.text);
        if (t) texts.push(t);
        sawOther = true;
      } else if (type === 'tool_use' || type === 'toolCall' || type === 'function_call') {
        toolCalls.push({ name: str(part.name) ?? 'tool', target: toolTarget(part.input ?? part.arguments) });
        sawOther = true;
      } else if (type === 'tool_result' || type === 'toolResult') {
        sawResult = true;
      }
    }
  }
  return { text: texts.join('\n').trim(), toolCalls, onlyToolResults: sawResult && !sawOther };
}

function normalizeRole(role: unknown): SessionMessage['role'] | undefined {
  switch (role) {
    case 'user':
      return 'user';
    case 'assistant':
      return 'assistant';
    case 'system':
    case 'developer':
      return 'system';
    case 'tool':
    case 'toolResult':
      return 'tool';
    default:
      return undefined;
  }
}

/**
 * Parse one JSONL record from Claude Code, Codex, Pi, Cursor, or Qoder into a normalized message.
 * The formats differ mainly in where the `{role, content}` pair lives.
 */
export function parseRecord(obj: unknown): SessionMessage | undefined {
  if (!isObj(obj)) return undefined;
  const timestamp = str(obj.timestamp);
  // Cursor agent transcripts: {role, message: {content}} with no type field.
  if (!obj.type && isObj(obj.message) && (obj.role === 'user' || obj.role === 'assistant')) {
    const role = normalizeRole(obj.role);
    if (!role) return undefined;
    const ex = extractContent(obj.message.content);
    return { role: ex.onlyToolResults ? 'tool' : role, text: ex.text, toolCalls: ex.toolCalls, timestamp };
  }
  // Claude Code and Qoder: {type: "user"|"assistant", message: {role, content}}
  // Pi: {type: "message", message: {role, content}}
  if (isObj(obj.message) && (obj.type === 'user' || obj.type === 'assistant' || obj.type === 'message')) {
    if (obj.isMeta === true || obj.isSidechain === true) return undefined;
    const role = normalizeRole(obj.message.role);
    if (!role) return undefined;
    const ex = extractContent(obj.message.content);
    return { role: ex.onlyToolResults ? 'tool' : role, text: ex.text, toolCalls: ex.toolCalls, timestamp };
  }
  // Codex: {type: "response_item", payload: {...}} or legacy bare items.
  const item = obj.type === 'response_item' && isObj(obj.payload) ? obj.payload : obj;
  if (item.type === 'message') {
    const role = normalizeRole(item.role);
    if (!role) return undefined;
    const ex = extractContent(item.content);
    return { role, text: ex.text, toolCalls: ex.toolCalls, timestamp };
  }
  if (item.type === 'function_call' || item.type === 'local_shell_call' || item.type === 'custom_tool_call') {
    const name = str(item.name) ?? 'shell';
    const raw = item.arguments ?? item.input ?? item.action;
    const patched = typeof raw === 'string' ? patchFiles(raw) : [];
    return {
      role: 'assistant',
      text: '',
      toolCalls: patched.length ? patched.map((f) => ({ name, target: f })) : [{ name, target: toolTarget(raw) }],
      timestamp,
    };
  }
  if (item.type === 'function_call_output' || item.type === 'custom_tool_call_output') {
    return { role: 'tool', text: '', toolCalls: [], timestamp };
  }
  return undefined;
}

export function isSyntheticText(text: string): boolean {
  const t = text.trimStart();
  return SYNTHETIC_PREFIXES.some((p) => t.startsWith(p));
}

/** Find the working directory recorded in a session's header records. */
export function cwdFromRecords(records: unknown[]): string | null {
  for (const r of records) {
    if (!isObj(r)) continue;
    const direct = str(r.cwd);
    if (direct) return direct;
    if (isObj(r.payload)) {
      const p = str(r.payload.cwd);
      if (p) return p;
    }
  }
  return null;
}

function sessionIdFrom(records: unknown[], filePath: string): string {
  for (const r of records) {
    if (!isObj(r)) continue;
    const id = str(r.sessionId) ?? (r.type === 'session' || r.type === 'session_meta' ? str(r.id) ?? (isObj(r.payload) ? str(r.payload.id) : undefined) : undefined);
    if (id) return id;
  }
  return path.basename(filePath, '.jsonl');
}

export async function parseSessionFile(agent: AgentId, filePath: string): Promise<ParsedSession> {
  const raw = await fs.readFile(filePath, 'utf8');
  const records = raw
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => safeJson(l))
    .filter((r) => r !== undefined);
  const messages: SessionMessage[] = [];
  for (const r of records) {
    const m = parseRecord(r);
    if (!m) continue;
    if (m.role === 'user' && isSyntheticText(m.text)) continue;
    if (!m.text && m.toolCalls.length === 0 && m.role !== 'tool') continue;
    messages.push(m);
  }
  const first = records.find(isObj);
  return {
    agent,
    filePath,
    sessionId: sessionIdFrom(records, filePath),
    cwd: cwdFromRecords(records.slice(0, 50)),
    startedAt: first ? str(first.timestamp) ?? (isObj(first.payload) ? str(first.payload.timestamp) : undefined) : undefined,
    messages,
  };
}

/** Short human-readable title: the first real user prompt in the head of the file. */
export function titleFromRecords(records: unknown[]): string | undefined {
  for (const r of records) {
    const m = parseRecord(r);
    if (m?.role === 'user' && m.text && !isSyntheticText(m.text)) {
      const oneLine = m.text.replace(/\s+/g, ' ').trim();
      return oneLine.length > 80 ? `${oneLine.slice(0, 77)}...` : oneLine;
    }
  }
  return undefined;
}
