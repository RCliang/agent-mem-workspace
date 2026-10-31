import fs from 'node:fs';
import path from 'node:path';
import type { MemoryItem, Plan } from '@agent-mem/core';
import { createApp, EventBus, startWatcher, watchTargets, type HubEvent } from '@agent-mem/server';
import { describe, expect, it, vi } from 'vitest';
import { directoryPicker, directoryPickerCommand } from '../src/pick-directory.js';
import { revealCommand, revealFile, revealOpener } from '../src/reveal.js';
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
  it('reports the available handoff summarizers', async () => {
    const { call } = await makeApp();
    const info = (await call('GET', '/api/info')).json as { llm: boolean; llmLocal: string[] };
    // The sandbox installs every agent; all but Cursor ship a one-shot CLI.
    expect(info.llm).toBe(true);
    expect(info.llmLocal).toContain('claude-code');
    expect(info.llmLocal).not.toContain('cursor');
  });

  it('lists, previews and applies skill operations', async () => {
    const { call, project, home } = await makeApp();
    const q = `?project=${encodeURIComponent(project)}`;
    const res = (await call('GET', `/api/skills${q}`)).json as { libraries: { id: string }[]; skills: { id: string; name: string; agent: string; shared: boolean }[] };
    expect(res.libraries.map((l) => l.id)).toContain('shared');
    expect(res.skills.some((s) => s.name === 'agent-reach' && s.agent === 'shared' && s.shared)).toBe(true);

    const browse = res.skills.find((s) => s.name === 'browse' && s.agent === 'claude-code')!;
    const detail = (await call('GET', `/api/skill/${browse.id}${q}`)).json as { skillMd: { content: string } };
    expect(detail.skillMd.content).toMatch(/headless browser/);

    const preview = await call('POST', '/api/skill/transfer/preview', { project, skillId: browse.id, targetAgent: 'pi', move: false });
    expect(preview.status).toBe(200);
    expect((preview.json as { dirOps: unknown[] }).dirOps).toHaveLength(1);
    const applied = await call('POST', '/api/apply', { plan: preview.json });
    expect(applied.status).toBe(200);
    expect(fs.readFileSync(path.join(home, '.pi', 'agent', 'skills', 'browse', 'SKILL.md'), 'utf8')).toMatch(/headless browser/);

    const del = await call('POST', '/api/skill/delete/preview', { project, skillId: browse.id });
    expect(del.status).toBe(200);
    expect((del.json as { notes: string[] }).notes.join(' ')).not.toMatch(/shared \.agents library/);
  });

  it('adds a project chosen in the native folder picker and ignores cancellation', async () => {
    const { call, otherProject, bus } = await makeApp();
    const events: HubEvent[] = [];
    bus.on((e) => events.push(e));
    const spy = vi
      .spyOn(directoryPicker, 'run')
      .mockResolvedValueOnce({ code: 0, stdout: `${otherProject}\n`, stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' });
    try {
      const picked = await call('POST', '/api/projects/pick');
      expect(picked.status).toBe(200);
      expect(picked.json.path).toBe(otherProject);
      expect(picked.json.projects.some((p: { path: string }) => p.path === otherProject)).toBe(true);
      const expected = directoryPickerCommand();
      expect(spy).toHaveBeenCalledWith(expected.command, expected.args);

      const cancelled = await call('POST', '/api/projects/pick');
      expect(cancelled.status).toBe(200);
      expect(cancelled.json.path).toBeNull();
      expect(events.filter((e) => e.type === 'roots')).toHaveLength(1);
      expect(directoryPickerCommand('win32').command).toBe('powershell.exe');
    } finally {
      spy.mockRestore();
    }
  });

  it('removes a project from the list and keeps it hidden', async () => {
    const { call, otherProject } = await makeApp();
    await call('POST', '/api/projects', { path: otherProject });
    expect((await call('GET', '/api/projects')).json.some((p: { path: string }) => p.path === otherProject)).toBe(true);
    const removed = await call('DELETE', '/api/projects', { path: otherProject });
    expect(removed.status).toBe(200);
    expect(removed.json.some((p: { path: string }) => p.path === otherProject)).toBe(false);
    expect((await call('GET', '/api/projects')).json.some((p: { path: string }) => p.path === otherProject)).toBe(false);

    const readded = await call('POST', '/api/projects', { path: otherProject });
    expect(readded.status).toBe(200);
    expect(readded.json.some((p: { path: string }) => p.path === otherProject)).toBe(true);
  });

  it('lists agents, projects and memories', async () => {
    const { call, project } = await makeApp();
    expect((await call('GET', '/api/agents')).json.map((a: { id: string }) => a.id)).toEqual([
      'claude-code',
      'codex',
      'pi',
      'gemini',
      'cursor',
      'opencode',
      'zcode',
      'qoder',
      'deepseek-harness',
    ]);
    expect((await call('GET', '/api/projects')).json.some((p: { path: string }) => p.path === project)).toBe(true);
    const mems: MemoryItem[] = (await call('GET', `/api/memories?project=${encodeURIComponent(project)}`)).json;
    expect(mems.length).toBe(33);
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
    const { call, project, hub } = await makeApp();
    hub.ctx.env.AGENT_MEM_LLM_MODE = 'api';
    const mems: MemoryItem[] = (await call('GET', `/api/memories?project=${encodeURIComponent(project)}`)).json;
    const codexSession = mems.find((m) => m.agent === 'codex' && m.kind === 'session')!;
    const missing = await call('POST', '/api/transfer/preview', { project, memoryId: codexSession.id, targetAgent: 'claude-code' });
    expect(missing.status).toBe(400);
    const verbatim = await call('POST', '/api/transfer/preview', { project, memoryId: codexSession.id, targetAgent: 'claude-code', render: 'verbatim' });
    expect(verbatim.status).toBe(200);
    expect(verbatim.json.writes[0].after).toContain('Migrate the settings page from class components to hooks and keep the existing tests green.');
    expect(verbatim.json.writes[0].after).not.toContain('## Next steps');
    const preview = await call('POST', '/api/transfer/preview', { project, memoryId: codexSession.id, targetAgent: 'claude-code', render: 'summary' });
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

  it('deletes an instruction, and a second delete writes no backup', async () => {
    const { call, project, bus } = await makeApp();
    const events: HubEvent[] = [];
    bus.on((e) => events.push(e));
    const q = `?project=${encodeURIComponent(project)}`;
    const mems: MemoryItem[] = (await call('GET', `/api/memories${q}`)).json;
    const item = mems.find((m) => m.agent === 'qoder' && m.filePath.endsWith(`${path.sep}.qoder${path.sep}rules${path.sep}style.md`))!;
    const before = ((await call('GET', '/api/backups')).json as { id: string }[]).length;

    const removed = await call('DELETE', `/api/memory/${item.id}${q}`, { expectedHash: item.hash });
    expect(removed.status).toBe(200);
    expect(removed.json.backupId).toEqual(expect.any(String));
    expect(fs.existsSync(item.filePath)).toBe(false);
    expect(events).toContainEqual({ type: 'applied', files: [item.filePath] });

    const again = await call('DELETE', `/api/memory/${item.id}${q}`, { expectedHash: item.hash });
    expect(again.status).toBe(200);
    expect(again.json).toEqual({ backupId: null });
    expect(events.filter((e) => e.type === 'applied')).toHaveLength(1);
    expect(((await call('GET', '/api/backups')).json as unknown[]).length).toBe(before + 1);

    const missing = await call('DELETE', `/api/memory/missing-id${q}`, { expectedHash: 'none' });
    expect(missing.status).toBe(200);
    expect(missing.json).toEqual({ backupId: null });
    expect(((await call('GET', '/api/backups')).json as unknown[]).length).toBe(before + 1);
  });

  it('keeps the file when a delete hash does not match', async () => {
    const { call, project } = await makeApp();
    const q = `?project=${encodeURIComponent(project)}`;
    const mems: MemoryItem[] = (await call('GET', `/api/memories${q}`)).json;
    const item = mems.find((m) => m.agent === 'claude-code' && m.filePath === path.join(project, 'CLAUDE.md'))!;
    const before = fs.readFileSync(item.filePath, 'utf8');
    const res = await call('DELETE', `/api/memory/${item.id}${q}`, { expectedHash: 'stale-hash' });
    expect(res.status).toBe(409);
    expect(fs.readFileSync(item.filePath, 'utf8')).toBe(before);
  });

  it('reveals a memory by id and ignores a path in the body', async () => {
    const { call, project } = await makeApp();
    const q = `?project=${encodeURIComponent(project)}`;
    const mems: MemoryItem[] = (await call('GET', `/api/memories${q}`)).json;
    const item = mems.find((m) => m.agent === 'codex' && m.filePath === path.join(project, 'AGENTS.md'))!;
    const spy = vi.spyOn(revealOpener, 'spawn').mockImplementation(() => {});
    try {
      const res = await call('POST', `/api/memory/${item.id}/reveal${q}`, { path: '/tmp/not-the-memory' });
      expect(res.status).toBe(200);
      const expected = revealCommand(item.filePath);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(expected.command, expected.args);
      const rendered = expected.args.join('\0');
      expect(rendered.includes(item.filePath) || rendered === path.dirname(item.filePath)).toBe(true);
      expect(rendered).not.toContain('/tmp/not-the-memory');
    } finally {
      spy.mockRestore();
    }
  });

  it('does not open a folder whose parent is missing', async () => {
    const spy = vi.spyOn(revealOpener, 'spawn').mockImplementation(() => {});
    try {
      await expect(revealFile(path.join('/tmp', `agent-mem-missing-${process.pid}`, 'gone.md'))).rejects.toThrow();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
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
  it('never watches $HOME itself or the macOS Trash, and keeps projects shallow', async () => {
    const { hub, home, project } = await makeApp();
    // A session whose cwd was $HOME, and one trashed project directory.
    const enc = (p: string) => p.replace(/[^a-zA-Z0-9]/g, '-');
    const session = (cwd: string) =>
      `${JSON.stringify({ type: 'user', cwd, sessionId: 'x', message: { role: 'user', content: 'hi' } })}\n`;
    fs.mkdirSync(path.join(home, '.claude', 'projects', enc(home)), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'projects', enc(home), 'in-home.jsonl'), session(home));
    const trashed = path.join(home, '.Trash', 'old-project');
    fs.mkdirSync(path.join(home, '.claude', 'projects', enc(trashed)), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'projects', enc(trashed), 'gone.jsonl'), session(trashed));

    const targets = await watchTargets(hub);
    // Agent config trees are watched deeply; the project only via its memory dirs.
    expect(targets.deep).toContain(path.join(home, '.claude'));
    expect(targets.shallow).toContain(project);
    expect(targets.shallow).toContain(path.join(project, '.cursor', 'rules'));
    for (const list of [targets.deep, targets.shallow]) {
      expect(list).not.toContain(home);
      expect(list.filter((r) => r === path.join(home, '.Trash') || r.startsWith(path.join(home, '.Trash') + path.sep))).toEqual([]);
    }
    // The watcher still starts with those projects discovered.
    const bus2 = new EventBus();
    const w = await startWatcher(hub, bus2, 50);
    await w.close();
  });

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
