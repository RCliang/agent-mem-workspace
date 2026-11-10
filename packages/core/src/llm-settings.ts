import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Context } from './context.js';

export type LlmMode = 'auto' | 'local' | 'api';
export interface LlmSettings {
  mode: LlmMode;
  baseUrl: string;
  model: string;
  apiKey: string;
}
export interface LlmSettingsView extends Omit<LlmSettings, 'apiKey'> {
  hasApiKey: boolean;
  source: 'settings' | 'environment' | 'defaults';
}
export interface LlmSettingsInput extends Omit<LlmSettings, 'apiKey'> {
  /** Omit or leave blank to keep the effective key. */
  apiKey?: string;
  clearApiKey?: boolean;
}

const settingsPath = (ctx: Context) => path.join(ctx.dataDir, 'llm.json');

function validate(input: unknown): LlmSettingsInput {
  if (!input || typeof input !== 'object') throw new Error('Invalid LLM settings');
  const value = input as Record<string, unknown>;
  if (value.mode !== 'auto' && value.mode !== 'local' && value.mode !== 'api') throw new Error('Mode must be auto, local or api');
  if (typeof value.baseUrl !== 'string' || typeof value.model !== 'string' || !value.model.trim()) throw new Error('Base URL and model are required');
  let url: URL;
  try { url = new URL(value.baseUrl.trim()); } catch { throw new Error('Base URL must be an HTTP or HTTPS URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Base URL must use HTTP(S), without credentials, query or fragment');
  if (value.apiKey !== undefined && (typeof value.apiKey !== 'string' || /[\r\n]/.test(value.apiKey))) throw new Error('Invalid API key');
  if (value.clearApiKey !== undefined && typeof value.clearApiKey !== 'boolean') throw new Error('Invalid clearApiKey');
  return { mode: value.mode, baseUrl: url.href.replace(/\/+$/, ''), model: value.model.trim(),
    ...(typeof value.apiKey === 'string' ? { apiKey: value.apiKey.trim() } : {}),
    ...(typeof value.clearApiKey === 'boolean' ? { clearApiKey: value.clearApiKey } : {}) };
}

/** A saved profile takes precedence as a whole, including an explicitly empty key. */
export async function resolveLlmSettings(ctx: Context): Promise<LlmSettings & { source: LlmSettingsView['source'] }> {
  let raw: string;
  try { raw = await fs.readFile(settingsPath(ctx), 'utf8'); }
  catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    const env = ctx.env;
    return { mode: env.AGENT_MEM_LLM_MODE === 'api' ? 'api' : env.AGENT_MEM_LLM_MODE === 'local' ? 'local' : 'auto',
      baseUrl: env.AGENT_MEM_LLM_BASE_URL || 'https://api.openai.com/v1', model: env.AGENT_MEM_LLM_MODEL || 'gpt-4o-mini',
      apiKey: env.AGENT_MEM_LLM_API_KEY || '', source: Object.keys(env).some((key) => key.startsWith('AGENT_MEM_LLM_') && env[key]) ? 'environment' : 'defaults' };
  }
  try {
    const saved = validate(JSON.parse(raw));
    return { mode: saved.mode, baseUrl: saved.baseUrl, model: saved.model, apiKey: saved.apiKey || '', source: 'settings' };
  } catch { throw new Error('Invalid llm.json settings; fix or reset the saved profile'); }
}

export async function getLlmSettings(ctx: Context): Promise<LlmSettingsView> {
  const { apiKey, ...settings } = await resolveLlmSettings(ctx);
  return { ...settings, hasApiKey: !!apiKey };
}

export async function saveLlmSettings(ctx: Context, input: unknown): Promise<LlmSettingsView> {
  const value = validate(input);
  const previous = await resolveLlmSettings(ctx);
  if (previous.apiKey && !value.apiKey && !value.clearApiKey && value.baseUrl !== previous.baseUrl.replace(/\/+$/, '')) {
    throw new Error('Enter a new API key or clear the current key when changing the Base URL');
  }
  const settings: LlmSettings = { mode: value.mode, baseUrl: value.baseUrl, model: value.model,
    apiKey: value.clearApiKey ? '' : value.apiKey || previous.apiKey };
  if (settings.mode === 'api' && !settings.apiKey) throw new Error('API mode requires an API key');
  await fs.mkdir(ctx.dataDir, { recursive: true });
  const temporary = `${settingsPath(ctx)}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(settings, null, 2), { mode: 0o600 });
    await fs.rename(temporary, settingsPath(ctx));
  } finally { await fs.rm(temporary, { force: true }); }
  return getLlmSettings(ctx);
}

export async function resetLlmSettings(ctx: Context): Promise<LlmSettingsView> {
  await fs.rm(settingsPath(ctx), { force: true });
  return getLlmSettings(ctx);
}
