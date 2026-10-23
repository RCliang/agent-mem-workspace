import fs from 'node:fs';
import path from 'node:path';
import type { MemoryItem, Plan } from '@agent-mem/core';
import { createApp, EventBus, startWatcher, type HubEvent } from '@agent-mem/server';
import { describe, expect, it } from 'vitest';
import { setup } from '../../core/test/helpers.js';

async function makeApp() {
  const env = await setup();
  const bus = new EventBus();
  const app = createApp({ hub: env.hub, bus });
  const call = async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(url, {
      method,
      headers: { host: '127.0.0.1:4477', 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  return { ...env, app, bus, call };
}

describe('HTTP API', () => {
  it('lists agents, projects and memories', async () => {
    const { call, project } = await makeApp();
    expect((await call('GET', '/api/agents')).json.map((a: { id: string }) => a.id)).toEqual(['claude-code', 'codex', 'pi', 'gemini', 'cursor', 'opencode']);
    expect((await call('GET', '/api/projects')).json.some((p: { path: string }) => p.path === project)).toBe(true);
    const mems: MemoryItem[] = (await call('GET', `/api/memories?project=${encodeURIComponent(project)}`)).json;
    expect(mems.length).toBe(17);
    const globals: MemoryItem[] = (await call('GET', '/api/memories')).json;
    expect(globals.every((m) => m.scope === 'global')).toBe(true);
  });

  it('saves edits with optimistic concurrency and supports undo', async () => {
    const { call, project, bus } = await makeApp();
    const events: HubEvent[] = [];
    bus.on((e) => events.push(e));
    const q = `?project=${encodeURIComponent(project)}`;
    const mems: MemoryItem[] = (await call('GET', `/api/memories${q}`)).json;
    const agents = mems.find((m) => m.agent === 'codex' && m.scope === 'project')!;

    const ok = await call('PUT', `/api/memory/${agents.id}${q}`, { content: '# new\n', expectedHash: agents.hash });
    expect(ok.status).toBe(200);
    expect(fs.readFileSync(agents.filePath, 'utf8')).toBe('# new\n');
    expect(events).toContainEqual({ type: 'applied', files: [agents.filePath] });

    const stale = await call('PUT', `/api/memory/${agents.id}${q}`, { content: 'x', expectedHash: agents.hash });
    expect(stale.status).toBe(409);
    expect(stale.json.conflict.filePath).toBe(agents.filePath);

    expect((await call('POST', '/api/undo', {})).status).toBe(200);
    expect(fs.readFileSync(agents.filePath, 'utf8')).toMatch(/^# shop-api agent guide/);
  });

  it('previews and applies a drag-and-drop handoff', async () => {
    const { call, project } = await makeApp();
    const mems: MemoryItem[] = (await call('GET', `/api/memories?project=${encodeURIComponent(project)}`)).json;
    const codexSession = mems.find((m) => m.agent === 'codex' && m.kind === 'session')!;
    const preview = await call('POST', '/api/transfer/preview', { project, memoryId: codexSession.id, targetAgent: 'claude-code' });
    expect(preview.status).toBe(200);
    const plan: Plan = preview.json;
    expect(plan.kind).toBe('handoff');
    expect(fs.existsSync(plan.writes[0]!.filePath)).toBe(false);
    const applied = await call('POST', '/api/apply', { plan });
    expect(applied.status).toBe(200);
    expect(fs.readFileSync(plan.writes[0]!.filePath, 'utf8')).toContain('# Handoff: shop-api (from Codex)');
  });

  it('shares through the matrix endpoints', async () => {
    const { call, project } = await makeApp();
    const q = `?project=${encodeURIComponent(project)}`;
    const rows = (await call('GET', `/api/matrix${q}`)).json as { item: MemoryItem; cells: { agent: string; state: string }[] }[];
    const globalClaude = rows.find((r) => r.item.agent === 'claude-code' && r.item.scope === 'global')!;
    const plan = (await call('POST', '/api/share/preview', { project, memoryId: globalClaude.item.id, targetAgent: 'pi' })).json as Plan;
    expect(plan.share?.strategy).toBe('copy');
    await call('POST', '/api/apply', { plan });
    const after = (await call('GET', `/api/matrix${q}`)).json as typeof rows;
    const cell = after.find((r) => r.item.id === globalClaude.item.id)!.cells.find((c) => c.agent === 'pi');
    expect(cell?.state).toBe('shared');
  });

  it('returns parsed sessions', async () => {
    const { call, project } = await makeApp();
    const q = `?project=${encodeURIComponent(project)}`;
    const mems: MemoryItem[] = (await call('GET', `/api/memories${q}`)).json;
    const s = mems.find((m) => m.agent === 'pi' && m.kind === 'session')!;
    const res = await call('GET', `/api/session/${s.id}${q}`);
    expect(res.json.sessionId).toBe('pi-5e8a91');
  });

  it('creates a missing instruction file', async () => {
    const { call, otherProject } = await makeApp();
    const res = await call('POST', '/api/memory', { agent: 'claude-code', project: otherProject });
    expect(res.status).toBe(200);
    expect(fs.readFileSync(path.join(otherProject, 'CLAUDE.md'), 'utf8')).toBe('# web-app\n');
    expect((await call('POST', '/api/memory', { agent: 'claude-code', project: otherProject })).status).toBe(400);
  });

  it('rejects foreign hosts and cross-site writes', async () => {
    const { call } = await makeApp();
    expect((await call('GET', '/api/agents', undefined, { host: 'evil.example' })).status).toBe(403);
    expect((await call('POST', '/api/sync', {}, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('POST', '/api/sync', {}, { origin: 'http://localhost:5173' })).status).toBe(200);
  });
});

describe('watcher', () => {
  it('watches the extra agents\' memory directories too', async () => {
    const { hub, bus, home } = await makeApp();
    const watcher = await startWatcher(hub, bus, 50);
    try {
      const changed = new Promise<HubEvent>((resolve) => bus.on((e) => e.type === 'changed' && e.paths.some((p) => p.endsWith('GEMINI.md')) && resolve(e)));
      fs.appendFileSync(path.join(home, '.gemini', 'GEMINI.md'), '- watched gemini change\n');
      const e = await changed;
      expect(e.paths.some((p) => p === path.join(home, '.gemini', 'GEMINI.md'))).toBe(true);
    } finally {
      await watcher.close();
    }
  }, 15000);

  it('re-syncs copy shares when the source changes and notifies listeners', async () => {
    const { call, project, hub, bus } = await makeApp();
    const q = `?project=${encodeURIComponent(project)}`;
    const mems: MemoryItem[] = (await call('GET', `/api/memories${q}`)).json;
    const claudeMd = mems.find((m) => m.agent === 'claude-code' && m.filePath === path.join(project, 'CLAUDE.md'))!;
    const plan = (await call('POST', '/api/share/preview', { project, memoryId: claudeMd.id, targetAgent: 'codex' })).json as Plan;
    await call('POST', '/api/apply', { plan });

    const watcher = await startWatcher(hub, bus, 50);
    try {
      const synced = new Promise<HubEvent>((resolve) => bus.on((e) => e.type === 'synced' && resolve(e)));
      fs.appendFileSync(claudeMd.filePath, '- watched change\n');
      const e = await synced;
      expect(e).toEqual({ type: 'synced', shareIds: [plan.share!.id] });
      expect(fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8')).toContain('watched change');
    } finally {
      await watcher.close();
    }
  }, 15000);
});
