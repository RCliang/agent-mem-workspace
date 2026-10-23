import path from 'node:path';
import { listShares, syncShares, type Hub } from '@agent-mem/core';
import chokidar, { type FSWatcher } from 'chokidar';
import type { EventBus } from './events.js';

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'target', '.venv']);

/** Directories whose Markdown/JSONL files hold agent memories. */
async function watchRoots(hub: Hub): Promise<string[]> {
  const roots = new Set<string>();
  for (const a of hub.adapters) {
    if (!(await a.detect())) continue;
    for (const r of a.watchRoots?.() ?? []) roots.add(r);
  }
  for (const p of await hub.projects()) roots.add(p.path);
  for (const s of await listShares(hub.ctx)) roots.add(path.dirname(s.sourcePath));
  return [...roots];
}

function ignored(file: string, stats?: { isFile(): boolean }) {
  const parts = file.split(path.sep);
  if (parts.some((p) => IGNORED_DIRS.has(p))) return true;
  if (stats?.isFile()) return !/\.(md|mdc|jsonl)$/.test(file);
  return false;
}

export interface Watcher {
  refresh(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Watches memory files, re-syncs copy shares whose source changed, and tells
 * connected UIs to reload. Events are debounced because agents write in bursts.
 */
export async function startWatcher(hub: Hub, bus: EventBus, debounceMs = 250): Promise<Watcher> {
  let watcher: FSWatcher | null = null;
  let pending = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  // Files written by our own sync must not trigger another sync of the same share.
  let syncing = false;

  const flush = async () => {
    timer = null;
    const paths = [...pending];
    pending = new Set();
    if (!paths.length) return;
    if (!syncing) {
      syncing = true;
      try {
        const sources = new Set((await listShares(hub.ctx)).map((s) => s.sourcePath));
        const updated: string[] = [];
        for (const p of paths.filter((x) => sources.has(x))) updated.push(...(await syncShares(hub, p)).updated);
        if (updated.length) bus.emit({ type: 'synced', shareIds: updated });
      } catch (e) {
        console.error('[agent-mem] sync failed:', (e as Error).message);
      } finally {
        syncing = false;
      }
    }
    bus.emit({ type: 'changed', paths });
  };

  const onEvent = (p: string) => {
    pending.add(p);
    timer ??= setTimeout(() => void flush(), debounceMs);
  };

  async function start() {
    const roots = await watchRoots(hub);
    watcher = chokidar.watch(roots, { ignored, ignoreInitial: true, depth: 5, awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 } });
    watcher.on('add', onEvent).on('change', onEvent).on('unlink', onEvent);
    await new Promise<void>((resolve) => watcher!.once('ready', () => resolve()));
  }

  await start();
  return {
    async refresh() {
      await watcher?.close();
      await start();
    },
    async close() {
      if (timer) clearTimeout(timer);
      await watcher?.close();
    },
  };
}
