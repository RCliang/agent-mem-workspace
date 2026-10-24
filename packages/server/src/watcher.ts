import path from 'node:path';
import { listShares, sharedSkillRoots, syncShares, type Hub } from '@agent-mem/core';
import chokidar, { type FSWatcher } from 'chokidar';
import type { EventBus } from './events.js';

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'target', '.venv']);

/**
 * What to watch, split by how deep it is safe to recurse:
 * - `deep`: agent config trees (~/.claude, ~/.codex, ...) hold session
 *   transcripts in nested directories, so recurse (bounded by session count).
 *   Skill libraries recurse too - they only contain one folder per skill.
 * - `shallow`: project trees are huge (node_modules-scale), so watch only the
 *   exact directories that contain memory files, without recursing.
 */
export interface WatchTargets {
  deep: string[];
  shallow: string[];
}

export async function watchTargets(hub: Hub): Promise<WatchTargets> {
  const { home } = hub.ctx;
  const deep = new Set<string>();
  for (const a of hub.adapters) {
    if (!(await a.detect())) continue;
    for (const r of a.watchRoots?.() ?? []) deep.add(r);
  }
  const shallow = new Set<string>();
  const projects = await hub.projects();
  for (const p of projects) {
    shallow.add(p.path);
    for (const m of await hub.memories(p.path)) {
      if (m.projectPath === p.path) shallow.add(path.dirname(m.filePath));
    }
  }
  for (const s of await listShares(hub.ctx)) shallow.add(path.dirname(s.sourcePath));
  // Skill libraries are small, bounded trees (one folder per skill).
  for (const p of [null, ...projects.map((x) => x.path)]) {
    for (const r of sharedSkillRoots(hub.ctx, p)) deep.add(r.dir);
    for (const a of hub.adapters) {
      for (const r of a.skillRoots?.(p) ?? []) deep.add(r.dir);
    }
  }
  // A session whose cwd was $HOME or a trashed folder must not pull protected
  // directories (~/.Trash is unwatchable on macOS) into the watch list.
  const trash = path.join(home, '.Trash');
  const ok = (r: string) => r !== home && r !== trash && !r.startsWith(trash + path.sep);
  return { deep: [...deep].filter(ok), shallow: [...shallow].filter(ok) };
}

function ignored(file: string, stats?: { isFile(): boolean; isDirectory(): boolean }) {
  const parts = file.split(path.sep);
  if (parts.some((p) => IGNORED_DIRS.has(p))) return true;
  if (stats) {
    if (stats.isFile()) return !/\.(md|mdc|jsonl)$/.test(file);
    // Sockets and fifos (e.g. ~/.codex/ipc/ipc.sock) cannot be watched.
    if (!stats.isDirectory()) return true;
  }
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
  let watchers: FSWatcher[] = [];
  let pending = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  // Files written by our own sync must not trigger another sync of the same share.
  let syncing = false;
  const seenErrors = new Set<string>();
  const onError = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    if (seenErrors.has(message)) return;
    seenErrors.add(message);
    console.error('[agent-mem] watch error:', message);
  };

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
    const { deep, shallow } = await watchTargets(hub);
    const common = { ignored, ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 } } as const;
    // A root becoming unreadable (permissions, unmounted drive) must not kill the server.
    watchers = [
      chokidar.watch(deep, { ...common, depth: 5 }),
      chokidar.watch(shallow, { ...common, depth: 0 }),
    ];
    for (const w of watchers) w.on('error', onError).on('add', onEvent).on('change', onEvent).on('unlink', onEvent);
    await Promise.all(watchers.map((w) => new Promise<void>((resolve) => w.once('ready', () => resolve()))));
  }

  async function stop() {
    const ws = watchers;
    watchers = [];
    await Promise.all(ws.map((w) => w.close()));
  }

  await start();
  return {
    async refresh() {
      await stop();
      await start();
    },
    async close() {
      if (timer) clearTimeout(timer);
      await stop();
    },
  };
}
