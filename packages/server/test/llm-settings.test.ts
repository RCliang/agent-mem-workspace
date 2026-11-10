import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLlmSettings, planTransfer, resolveLlmSettings } from '@agent-mem/core';
import { createApp, EventBus } from '@agent-mem/server';
import { fileItem } from '../../core/src/adapters/common.js';
import { setup } from '../../core/test/helpers.js';

const profile = { mode: 'api', baseUrl: 'https://example.test/v1/', model: 'custom-model', apiKey: 'test-only-secret' };
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const env = await setup();
  roots.push(env.root);
  const app = createApp({ hub: env.hub, bus: new EventBus() });
  const save = (body: unknown) => app.request('/api/settings/llm', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { ...env, app, save };
}

describe('summary API settings', () => {
  it('persists without returning the key, preserves blank keys, clears and restores environment settings', async () => {
    const { ctx, app, save } = await fixture();
    ctx.env.AGENT_MEM_LLM_API_KEY = 'environment-test-secret';
    expect(await getLlmSettings(ctx)).toMatchObject({ source: 'environment', hasApiKey: true });
    const saved = await save(profile);
    expect(saved.status, await saved.clone().text()).toBe(200);
    const savedText = await saved.text();
    expect(savedText).not.toContain(profile.apiKey);
    expect(JSON.parse(savedText)).toMatchObject({ mode: 'api', source: 'settings', hasApiKey: true, baseUrl: 'https://example.test/v1' });
    expect((await app.request('/api/settings/llm')).headers.get('cache-control')).toBe('no-store');
    expect(await (await app.request('/api/settings/llm')).text()).not.toContain(profile.apiKey);
    const restartedContext = { ...ctx, env: {} };
    expect(await resolveLlmSettings(restartedContext)).toMatchObject({ apiKey: profile.apiKey, model: profile.model });
    expect((await save({ ...profile, apiKey: '', model: 'updated-model' })).status).toBe(200);
    expect(await resolveLlmSettings(ctx)).toMatchObject({ apiKey: profile.apiKey, model: 'updated-model' });
    expect((await save({ ...profile, apiKey: '', baseUrl: 'https://another.test/v1' })).status).toBe(400);
    expect(await resolveLlmSettings(ctx)).toMatchObject({ baseUrl: 'https://example.test/v1', apiKey: profile.apiKey });
    expect((await save({ ...profile, mode: 'local', clearApiKey: true })).status).toBe(200);
    expect(await resolveLlmSettings(ctx)).toMatchObject({ apiKey: '', mode: 'local' });
    expect(await (await app.request('/api/settings/llm', { method: 'DELETE' })).json()).toMatchObject({ source: 'environment', hasApiKey: true });
    expect(await resolveLlmSettings(ctx)).toMatchObject({ apiKey: 'environment-test-secret' });
  });

  it('rejects invalid inputs and cross-site writes without changing settings', async () => {
    const { ctx, app, save } = await fixture();
    for (const body of [null, { ...profile, mode: 'bad' }, { ...profile, baseUrl: 'file:///tmp/x' },
      { ...profile, baseUrl: 'https://user:pass@example.test' }, { ...profile, model: '' },
      { ...profile, apiKey: 123 }, { ...profile, apiKey: 'bad\nkey' }, { ...profile, apiKey: '' }]) {
      expect((await save(body)).status).toBe(400);
    }
    expect((await app.request('/api/settings/llm', { method: 'PUT', headers: { origin: 'https://untrusted.test', 'content-type': 'application/json' }, body: JSON.stringify(profile) })).status).toBe(403);
    expect(await getLlmSettings(ctx)).toMatchObject({ source: 'defaults', hasApiKey: false });
  });

  it('uses saved endpoint and model for transfers immediately and reports safe fallback errors', async () => {
    const { ctx, hub, project, save, app } = await fixture();
    // No CLI execution or external requests in this test.
    for (const adapter of hub.adapters) adapter.cli = undefined;
    const transcript = path.join(project, 'summary-fixture.jsonl');
    await fs.writeFile(transcript, JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text: 'Finish upload tests.' }] } }));
    const item = await fileItem('cursor', transcript, 'local', 'session', project, 'Upload');
    if (!item) throw new Error('Missing transcript fixture');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '# API handoff\nContinue tests.' } }] })));
    vi.stubGlobal('fetch', fetchMock);
    expect((await save(profile)).status).toBe(200);
    expect(await (await app.request('/api/info')).json()).toMatchObject({ llm: true });
    const plan = await planTransfer(hub, item, 'zcode', { render: 'summary' });
    expect(fetchMock).toHaveBeenCalledWith('https://example.test/v1/chat/completions', expect.objectContaining({
      headers: expect.objectContaining({ authorization: `Bearer ${profile.apiKey}` }),
      body: expect.stringContaining('"model":"custom-model"'),
    }));
    expect(plan.writes[0]?.after).toContain('# API handoff');
    expect(plan.notes.join(' ')).toContain('custom-model (example.test)');
    fetchMock.mockResolvedValue(new Response(`provider echoed ${profile.apiKey}`, { status: 401 }));
    const fallback = await planTransfer(hub, item, 'zcode', { render: 'summary' });
    expect(fallback.notes.join(' ')).toContain('HTTP 401');
    expect(JSON.stringify(fallback)).not.toContain(profile.apiKey);
    expect(fallback.writes[0]?.after).toContain('Finish upload tests.');
    expect(fallback.notes.join(' ')).not.toContain('no API key');
    await save({ ...profile, mode: 'local' });
    fetchMock.mockClear();
    expect(await (await app.request('/api/info')).json()).toMatchObject({ llm: false });
    expect((await planTransfer(hub, item, 'zcode', { render: 'summary' })).notes.join(' ')).toContain('API disabled');
    expect(fetchMock).not.toHaveBeenCalled();
    await save({ ...profile, mode: 'auto' });
    await planTransfer(hub, item, 'zcode', { render: 'summary' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((await resolveLlmSettings(ctx)).mode).toBe('auto');
    await fs.writeFile(path.join(ctx.dataDir, 'llm.json'), '{invalid');
    expect((await app.request('/api/info')).status).toBe(200);
    expect((await app.request('/api/settings/llm')).status).toBe(400);
    expect((await planTransfer(hub, item, 'zcode', { render: 'summary' })).notes.join(' ')).toContain('Could not load summary settings');
    expect((await app.request('/api/settings/llm', { method: 'DELETE' })).status).toBe(200);
  });
});
