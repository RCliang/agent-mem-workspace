import fs from 'node:fs/promises';
import path from 'node:path';
import {
  applyPlan,
  ConflictError,
  currentHash,
  deleteFile,
  listBackups,
  listShares,
  llmLocalSummarizers,
  parseSessionFile,
  planShare,
  planTransfer,
  planUnshare,
  readText,
  safeWrite,
  shareMatrix,
  syncShares,
  undoBackup,
  type Hub,
  type Plan,
  type ShareStrategy,
} from '@agent-mem/core';
import { Hono, type Context as HonoContext } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { EventBus } from './events.js';
import { revealFile } from './reveal.js';

export interface AppOptions {
  hub: Hub;
  bus: EventBus;
  /** Built web UI; when absent only the API is served. */
  webDist?: string;
  /** Extra hostnames allowed in the Host header besides localhost/127.0.0.1. */
  allowedHosts?: string[];
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

const projectParam = (c: HonoContext): string | null => c.req.query('project') || null;

export function createApp({ hub, bus, webDist, allowedHosts = [] }: AppOptions) {
  const app = new Hono();
  const hosts = new Set(['localhost', '127.0.0.1', '[::1]', ...allowedHosts]);

  // The API can rewrite files in $HOME, so only answer requests addressed to this machine
  // (blocks DNS rebinding) and reject cross-site writes.
  app.use('*', async (c, next) => {
    const host = (c.req.header('host') ?? '').replace(/:\d+$/, '');
    if (host && !hosts.has(host)) return c.text('Forbidden host', 403);
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const origin = c.req.header('origin');
      if (origin) {
        const originHost = new URL(origin).hostname;
        if (!hosts.has(originHost) && !hosts.has(`[${originHost}]`)) return c.text('Forbidden origin', 403);
      }
    }
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof ConflictError) {
      return c.json({ error: err.message, conflict: { filePath: err.filePath, expectedHash: err.expectedHash, actualHash: err.actualHash } }, 409);
    }
    return c.json({ error: err.message }, 400);
  });

  const api = new Hono();

  api.get('/info', async (c) => {
    const local = await llmLocalSummarizers(hub);
    return c.json({ home: hub.ctx.home, dataDir: hub.ctx.dataDir, llm: local.length > 0 || !!hub.ctx.env.AGENT_MEM_LLM_API_KEY, llmLocal: local });
  });

  api.get('/agents', async (c) => c.json(await hub.agents()));

  api.get('/projects', async (c) => c.json(await hub.projects()));

  api.post('/projects', async (c) => {
    const { path: p } = await c.req.json<{ path: string }>();
    await hub.addProject(p);
    bus.emit({ type: 'roots' });
    return c.json(await hub.projects());
  });

  api.get('/memories', async (c) => c.json(await hub.memories(projectParam(c))));

  api.get('/memory/:id', async (c) => c.json(await hub.findMemory(c.req.param('id'), projectParam(c))));

  api.delete('/memory/:id', async (c) => {
    const { expectedHash } = await c.req.json<{ expectedHash: string }>();
    const item = (await hub.memories(projectParam(c))).find((m) => m.id === c.req.param('id'));
    if (!item) return c.json({ backupId: null });
    if (item.kind !== 'instructions') throw new Error('Only instructions can be deleted');
    const result = await deleteFile(hub.ctx, item.filePath, expectedHash);
    if (!result.removed) return c.json({ backupId: null });
    await syncShares(hub, item.filePath);
    bus.emit({ type: 'applied', files: [item.filePath] });
    return c.json({ backupId: result.backup.id });
  });

  api.post('/memory/:id/reveal', async (c) => {
    const item = await hub.findMemory(c.req.param('id'), projectParam(c));
    await revealFile(item.filePath);
    return c.json({ ok: true });
  });

  api.put('/memory/:id', async (c) => {
    const item = await hub.findMemory(c.req.param('id'), projectParam(c));
    if (item.kind === 'session') throw new Error('Sessions are read-only');
    const { content, expectedHash } = await c.req.json<{ content: string; expectedHash: string }>();
    const res = await safeWrite(hub.ctx, item.filePath, content, { expectedHash, reason: `edit: ${item.title}` });
    await syncShares(hub, item.filePath);
    bus.emit({ type: 'applied', files: [res.filePath] });
    return c.json({ hash: res.hash, backupId: res.backup.id });
  });

  /** Create an agent's instruction file when it does not exist yet. */
  api.post('/memory', async (c) => {
    const { agent, project } = await c.req.json<{ agent: string; project: string | null }>();
    const target = hub.adapter(agent).instructionFile(project || null);
    if ((await readText(target.filePath)) != null) throw new Error(`${target.filePath} already exists`);
    const title = project ? path.basename(project) : `${hub.adapter(agent).displayName} global instructions`;
    await safeWrite(hub.ctx, target.filePath, `# ${title}\n`, { expectedHash: null, reason: `create: ${target.filePath}` });
    bus.emit({ type: 'applied', files: [target.filePath] });
    return c.json(target);
  });

  api.get('/session/:id', async (c) => {
    const item = await hub.findMemory(c.req.param('id'), projectParam(c));
    if (item.kind !== 'session') throw new Error('Not a session');
    const adapter = hub.adapter(item.agent);
    const parsed = await (adapter.parseSession ?? ((p: string) => parseSessionFile(adapter.id, p)))(item.filePath);
    return c.json({ ...parsed, messages: parsed.messages.slice(-200) });
  });

  api.get('/matrix', async (c) => c.json(await shareMatrix(hub, projectParam(c))));

  api.get('/shares', async (c) => c.json(await listShares(hub.ctx)));

  api.post('/share/preview', async (c) => {
    const body = await c.req.json<{ project: string | null; memoryId: string; targetAgent: string; strategy?: ShareStrategy }>();
    const item = await hub.findMemory(body.memoryId, body.project || null);
    return c.json(await planShare(hub, item, body.targetAgent, body.strategy));
  });

  api.post('/unshare/preview', async (c) => {
    const { shareId } = await c.req.json<{ shareId: string }>();
    return c.json(await planUnshare(hub, shareId));
  });

  api.post('/transfer/preview', async (c) => {
    const body = await c.req.json<{ project: string | null; memoryId: string; targetAgent: string; render?: unknown }>();
    if (body.render !== 'verbatim' && body.render !== 'summary') throw new Error('render must be "verbatim" or "summary"');
    const item = await hub.findMemory(body.memoryId, body.project || null);
    return c.json(await planTransfer(hub, item, body.targetAgent, { render: body.render }));
  });

  api.post('/apply', async (c) => {
    const { plan } = await c.req.json<{ plan: Plan }>();
    const res = await applyPlan(hub.ctx, plan);
    for (const f of res.files) await syncShares(hub, f);
    bus.emit({ type: 'applied', files: res.files });
    if (plan.share) bus.emit({ type: 'roots' });
    return c.json(res);
  });

  api.post('/sync', async (c) => {
    const res = await syncShares(hub);
    if (res.updated.length) bus.emit({ type: 'synced', shareIds: res.updated });
    return c.json(res);
  });

  api.get('/backups', async (c) => c.json((await listBackups(hub.ctx)).slice(0, 100)));

  api.post('/undo', async (c) => {
    const { id } = await c.req.json<{ id?: string }>().catch(() => ({ id: undefined }));
    const entry = await undoBackup(hub.ctx, id);
    await syncShares(hub, entry.filePath);
    bus.emit({ type: 'applied', files: [entry.filePath] });
    return c.json({ ...entry, hash: await currentHash(entry.filePath) });
  });

  api.get('/events', (c) =>
    streamSSE(c, async (stream) => {
      let open = true;
      const off = bus.on((e) => {
        void stream.writeSSE({ event: e.type, data: JSON.stringify(e) });
      });
      stream.onAbort(() => {
        open = false;
        off();
      });
      await stream.writeSSE({ event: 'hello', data: '{}' });
      while (open) {
        await stream.sleep(15000);
        if (open) await stream.writeSSE({ event: 'ping', data: '{}' });
      }
    }),
  );

  app.route('/api', api);

  if (webDist) {
    app.get('*', async (c) => {
      const rel = decodeURIComponent(new URL(c.req.url).pathname).replace(/^\/+/, '');
      const candidate = path.resolve(webDist, rel || 'index.html');
      const inside = candidate === webDist || candidate.startsWith(webDist + path.sep);
      const file = inside && (await fs.stat(candidate).catch(() => null))?.isFile() ? candidate : path.join(webDist, 'index.html');
      const data = await fs.readFile(file).catch(() => null);
      if (!data) return c.text('Web UI not built. Run `pnpm build` first.', 404);
      return c.body(data, 200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    });
  }

  return app;
}
