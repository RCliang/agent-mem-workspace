import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import type { Hub } from '@agent-mem/core';
import { createApp } from './app.js';
import { EventBus } from './events.js';
import { startWatcher } from './watcher.js';

export { createApp } from './app.js';
export { EventBus, type HubEvent } from './events.js';
export { startWatcher, watchTargets } from './watcher.js';

export interface ServerOptions {
  hub: Hub;
  port?: number;
  host?: string;
  webDist?: string;
  watch?: boolean;
}

export function defaultWebDist(): string | undefined {
  const candidates = [process.env.AGENT_MEM_WEB_DIST, fileURLToPath(new URL('../../web/dist', import.meta.url))];
  return candidates.find((p): p is string => !!p && fs.existsSync(p));
}

export async function startServer({ hub, port = 4477, host = '127.0.0.1', webDist = defaultWebDist(), watch = true }: ServerOptions) {
  const bus = new EventBus();
  const watcher = watch ? await startWatcher(hub, bus) : null;
  const app = createApp({ hub, bus, webDist });
  bus.on((e) => {
    if (e.type === 'roots') void watcher?.refresh();
  });
  const server = await new Promise<ReturnType<typeof serve>>((resolve, reject) => {
    const s = serve({ fetch: app.fetch, port, hostname: host }, () => resolve(s));
    s.once('error', reject);
  });
  const addr = server.address() as AddressInfo;
  const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${addr.port}`;
  return {
    url,
    bus,
    async close() {
      await watcher?.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
