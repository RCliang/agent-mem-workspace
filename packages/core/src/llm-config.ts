import fs from 'node:fs/promises';
import path from 'node:path';
import type { Context } from './context.js';
import { readState, writeState } from './store.js';

export type LlmMode = 'auto' | 'local' | 'api';

const FILE = 'llm.json';
export const LLM_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
export const LLM_DEFAULT_MODEL = 'gpt-4o-mini';

export interface LlmFile {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  mode?: LlmMode;
}

export interface LlmFieldLocks {
  baseUrl: boolean;
  model: boolean;
  mode: boolean;
  apiKey: boolean;
}

export interface LlmEndpointView {
  baseUrl: string;
  model: string;
  mode: LlmMode;
  hasKey: boolean;
  keyHint: string;
}

/** What the API page may show. The key itself never leaves the machine. */
export interface LlmSettingsView {
  saved: LlmEndpointView;
  effective: LlmEndpointView;
  env: LlmFieldLocks;
  defaults: { baseUrl: string; model: string };
}

export interface ResolvedLlm {
  baseUrl: string;
  model: string;
  apiKey: string;
  mode: LlmMode;
}

export interface LlmUpdate {
  baseUrl?: string;
  model?: string;
  mode?: string;
  apiKey?: string;
  clearKey?: boolean;
}

function isMode(value: unknown): value is LlmMode {
  return value === 'auto' || value === 'local' || value === 'api';
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Last four characters, and only when the token is long enough that they are not the secret. */
export function keyHint(key: string): string {
  return key.length >= 12 ? key.slice(-4) : '';
}

export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (trimmed.length > 300) throw new Error('Base URL is too long');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Base URL must be an http(s) address');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Base URL must start with http:// or https://');
  if (url.username || url.password) throw new Error('Put the API key in the key field, not in the URL');
  if (url.search || url.hash) throw new Error('Base URL cannot include a query or fragment');
  return url.toString().replace(/\/$/, '');
}

export function normalizeModel(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (trimmed.length > 200 || /\s/.test(trimmed)) throw new Error('Model must be a single token, such as gpt-4o-mini');
  return trimmed;
}

export function normalizeApiKey(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (trimmed.length > 2000 || /[\r\n]/.test(trimmed)) throw new Error('API key is not a valid token');
  return trimmed;
}

export async function readLlmFile(ctx: Context): Promise<LlmFile> {
  const raw = await readState<LlmFile>(ctx, FILE, {});
  return {
    ...(typeof raw.baseUrl === 'string' && raw.baseUrl ? { baseUrl: raw.baseUrl } : {}),
    ...(typeof raw.model === 'string' && raw.model ? { model: raw.model } : {}),
    ...(typeof raw.apiKey === 'string' && raw.apiKey ? { apiKey: raw.apiKey } : {}),
    ...(isMode(raw.mode) ? { mode: raw.mode } : {}),
  };
}

export async function writeLlmFile(ctx: Context, file: LlmFile): Promise<void> {
  const stored: LlmFile = {};
  if (file.baseUrl) stored.baseUrl = file.baseUrl;
  if (file.model) stored.model = file.model;
  if (file.apiKey) stored.apiKey = file.apiKey;
  if (file.mode && file.mode !== 'auto') stored.mode = file.mode;
  await writeState(ctx, FILE, stored);
  await fs.chmod(path.join(ctx.dataDir, FILE), 0o600).catch(() => undefined);
}

export function envLocks(ctx: Context): LlmFieldLocks {
  return {
    baseUrl: !!ctx.env.AGENT_MEM_LLM_BASE_URL?.trim(),
    model: !!ctx.env.AGENT_MEM_LLM_MODEL?.trim(),
    mode: isMode(ctx.env.AGENT_MEM_LLM_MODE),
    apiKey: !!ctx.env.AGENT_MEM_LLM_API_KEY?.trim(),
  };
}

export function resolveLlm(ctx: Context, file: LlmFile): ResolvedLlm {
  const locks = envLocks(ctx);
  const mode = locks.mode ? (ctx.env.AGENT_MEM_LLM_MODE as LlmMode) : (file.mode ?? 'auto');
  return {
    baseUrl: (locks.baseUrl ? ctx.env.AGENT_MEM_LLM_BASE_URL!.trim() : file.baseUrl || LLM_DEFAULT_BASE_URL).replace(/\/$/, ''),
    model: locks.model ? ctx.env.AGENT_MEM_LLM_MODEL!.trim() : file.model || LLM_DEFAULT_MODEL,
    apiKey: locks.apiKey ? ctx.env.AGENT_MEM_LLM_API_KEY!.trim() : (file.apiKey ?? ''),
    mode,
  };
}

function endpointView(baseUrl: string, model: string, mode: LlmMode, apiKey: string): LlmEndpointView {
  return { baseUrl, model, mode, hasKey: apiKey.length > 0, keyHint: keyHint(apiKey) };
}

export async function llmSettingsView(ctx: Context): Promise<LlmSettingsView> {
  const file = await readLlmFile(ctx);
  const effective = resolveLlm(ctx, file);
  return {
    saved: endpointView(file.baseUrl ?? '', file.model ?? '', file.mode ?? 'auto', file.apiKey ?? ''),
    effective: endpointView(effective.baseUrl, effective.model, effective.mode, effective.apiKey),
    env: envLocks(ctx),
    defaults: { baseUrl: LLM_DEFAULT_BASE_URL, model: LLM_DEFAULT_MODEL },
  };
}

export async function updateLlmSettings(ctx: Context, update: LlmUpdate): Promise<LlmSettingsView> {
  const file = await readLlmFile(ctx);
  const locks = envLocks(ctx);
  if (update.baseUrl !== undefined && !locks.baseUrl) {
    const baseUrl = normalizeBaseUrl(update.baseUrl);
    if (baseUrl) file.baseUrl = baseUrl;
    else delete file.baseUrl;
  }
  if (update.model !== undefined && !locks.model) {
    const model = normalizeModel(update.model);
    if (model) file.model = model;
    else delete file.model;
  }
  if (update.mode !== undefined && !locks.mode) {
    if (!isMode(update.mode)) throw new Error('Mode must be auto, local, or api');
    file.mode = update.mode;
  }
  if (update.clearKey && !locks.apiKey) delete file.apiKey;
  else if (update.apiKey !== undefined && update.apiKey.trim() && !locks.apiKey) file.apiKey = normalizeApiKey(update.apiKey);
  await writeLlmFile(ctx, file);
  return llmSettingsView(ctx);
}

export async function completeChat(resolved: ResolvedLlm, messages: { role: 'system' | 'user'; content: string }[], temperature = 0.2): Promise<string> {
  if (!resolved.apiKey) throw new Error('Save an API key on the API page, or set AGENT_MEM_LLM_API_KEY');
  let res: Response;
  try {
    res = await fetch(`${resolved.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${resolved.apiKey}` },
      body: JSON.stringify({ model: resolved.model, temperature, messages }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new Error(`LLM request failed: ${(error as Error).message}`);
  }
  if (!res.ok) throw new Error(`LLM request failed: ${res.status} ${clip(await res.text().catch(() => ''), 300)}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('LLM returned an empty reply');
  return text;
}

/** One short completion against the saved endpoint, with optional unsaved form values. */
export async function probeLlm(ctx: Context, override: { baseUrl?: string; model?: string; apiKey?: string } = {}): Promise<{ model: string; reply: string }> {
  const resolved = resolveLlm(ctx, await readLlmFile(ctx));
  const next: ResolvedLlm = {
    baseUrl: override.baseUrl !== undefined && override.baseUrl.trim() ? normalizeBaseUrl(override.baseUrl) : resolved.baseUrl,
    model: override.model !== undefined && override.model.trim() ? normalizeModel(override.model) : resolved.model,
    apiKey: override.apiKey !== undefined && override.apiKey.trim() ? normalizeApiKey(override.apiKey) : resolved.apiKey,
    mode: resolved.mode,
  };
  if (!next.baseUrl) next.baseUrl = LLM_DEFAULT_BASE_URL;
  if (!next.model) next.model = LLM_DEFAULT_MODEL;
  const reply = await completeChat(next, [{ role: 'user', content: 'Reply with the single word ok.' }], 0);
  return { model: next.model, reply: clip(reply, 200) };
}
