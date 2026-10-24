import fs from 'node:fs/promises';
import path from 'node:path';
import { readBlock, removeBlock, upsertBlock } from './blocks.js';
import { tildify } from './context.js';
import { convertForTarget } from './convert.js';
import { idFor, readText, sha } from './fsutil.js';
import type { Hub } from './hub.js';
import { plannedWrite, type Plan } from './plan.js';
import { redact } from './redact.js';
import { listShares, saveShares, type Share } from './share-store.js';
import { safeWrite } from './store.js';
import type { AgentAdapter, AgentId, MemoryItem, ShareStrategy } from './types.js';

export function targetFileFor(target: AgentAdapter, item: Pick<MemoryItem, 'scope' | 'projectPath'>): string {
  return target.instructionFile(item.scope === 'global' ? null : item.projectPath).filePath;
}

function isInside(child: string, parent: string) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function importRef(hub: Hub, sourcePath: string, targetPath: string, projectPath: string | null): string {
  if (projectPath && isInside(sourcePath, projectPath) && isInside(targetPath, projectPath)) {
    return path.relative(path.dirname(targetPath), sourcePath);
  }
  return tildify(hub.ctx, sourcePath);
}

function copyNotice(hub: Hub, item: MemoryItem) {
  return `> Synced by agent-mem from ${item.agent}: \`${tildify(hub.ctx, item.filePath)}\`. Edit the source; this block is overwritten on sync.`;
}

export async function planShare(hub: Hub, item: MemoryItem, targetAgent: AgentId, strategy?: ShareStrategy): Promise<Plan> {
  if (item.kind === 'session') throw new Error('Sessions cannot be shared directly; use a handoff instead');
  const target = hub.adapter(targetAgent);
  if (item.agent === target.id || item.alsoReadBy.includes(target.id)) {
    throw new Error(`${target.displayName} already reads ${tildify(hub.ctx, item.filePath)} natively`);
  }
  const targetPath = targetFileFor(target, item);
  const sourceReal = await fs.realpath(item.filePath).catch(() => item.filePath);
  const targetExisting = await readText(targetPath);
  const chosen: ShareStrategy = strategy ?? (target.capabilities.imports ? 'import' : targetExisting == null ? 'symlink' : 'copy');
  const id = idFor(item.filePath, `${target.id}:${targetPath}`);
  const label = `shared from ${item.agent} ${tildify(hub.ctx, item.filePath)}`;
  const notes: string[] = [];
  let write;

  if (chosen === 'import') {
    if (!target.capabilities.imports) throw new Error(`${target.displayName} does not support @imports`);
    write = await plannedWrite(targetPath, upsertBlock(targetExisting, id, label, `@${importRef(hub, sourceReal, targetPath, item.projectPath)}`));
    notes.push(`${target.displayName} will load the source file through an @import, so edits stay in sync automatically.`);
  } else if (chosen === 'symlink') {
    if (targetExisting != null) throw new Error(`${tildify(hub.ctx, targetPath)} already exists; use the copy strategy instead`);
    write = await plannedWrite(targetPath, item.content, { symlinkTo: path.relative(path.dirname(targetPath), sourceReal) });
    notes.push(`${tildify(hub.ctx, targetPath)} becomes a symlink to the source; both agents edit the same file.`);
  } else {
    const body = await convertForTarget(hub.ctx, item, target);
    write = await plannedWrite(targetPath, upsertBlock(targetExisting, id, label, `${copyNotice(hub, item)}\n\n${body}`));
    notes.push('A synced copy is written into a managed block and refreshed whenever the source changes.');
  }

  const share: Share = {
    id,
    projectPath: item.projectPath,
    sourceAgent: item.agent,
    sourcePath: item.filePath,
    targetAgent: target.id,
    targetPath,
    strategy: chosen,
    createdAt: new Date().toISOString(),
    syncedHash: chosen === 'copy' ? item.hash : undefined,
  };
  return {
    kind: 'share',
    title: `Share ${item.title} with ${target.displayName}`,
    writes: [write],
    notes,
    findings: redact(write.after).findings,
    share,
  };
}

export async function planUnshare(hub: Hub, shareId: string): Promise<Plan> {
  const share = (await listShares(hub.ctx)).find((s) => s.id === shareId);
  if (!share) throw new Error(`No share with id ${shareId}`);
  const title = `Stop sharing ${tildify(hub.ctx, share.sourcePath)} with ${share.targetAgent}`;
  const before = await readText(share.targetPath);
  if (before == null) return { kind: 'unshare', title, writes: [], notes: ['Target file is already gone.'], findings: [], unshareId: shareId };

  if (share.strategy === 'symlink') {
    const lst = await fs.lstat(share.targetPath);
    if (!lst.isSymbolicLink()) {
      return { kind: 'unshare', title, writes: [], notes: ['Target is no longer a symlink; leaving it untouched.'], findings: [], unshareId: shareId };
    }
    return { kind: 'unshare', title, writes: [await plannedWrite(share.targetPath, '', { remove: true })], notes: ['The symlink is removed.'], findings: [], unshareId: shareId };
  }
  const after = removeBlock(before, share.id);
  const write = await plannedWrite(share.targetPath, after, after.trim() === '' ? { remove: true } : {});
  return { kind: 'unshare', title, writes: [write], notes: [], findings: [], unshareId: shareId };
}

/** Refresh copy-strategy shares whose source changed. Returns ids that were rewritten. */
export async function syncShares(hub: Hub, onlySource?: string): Promise<{ updated: string[]; missing: string[] }> {
  const shares = await listShares(hub.ctx);
  const updated: string[] = [];
  const missing: string[] = [];
  for (const s of shares) {
    if (s.strategy !== 'copy') continue;
    if (onlySource && s.sourcePath !== onlySource) continue;
    const content = await readText(s.sourcePath);
    if (content == null) {
      missing.push(s.id);
      continue;
    }
    const item = {
      agent: s.sourceAgent,
      filePath: s.sourcePath,
      content,
      title: path.basename(s.sourcePath),
    } as MemoryItem;
    const body = `${copyNotice(hub, item)}\n\n${await convertForTarget(hub.ctx, item, hub.adapter(s.targetAgent))}`;
    const targetText = await readText(s.targetPath);
    if (targetText != null && readBlock(targetText, s.id)?.trim() === body.trim()) {
      s.syncedHash = sha(content);
      continue;
    }
    const label = `shared from ${s.sourceAgent} ${tildify(hub.ctx, s.sourcePath)}`;
    await safeWrite(hub.ctx, s.targetPath, upsertBlock(targetText, s.id, label, body), { reason: `sync: ${label}` });
    s.syncedHash = sha(content);
    updated.push(s.id);
  }
  await saveShares(hub.ctx, shares);
  return { updated, missing };
}

export interface MatrixCell {
  agent: AgentId;
  state: 'native' | 'shared' | 'available';
  shareId?: string;
  strategy?: ShareStrategy;
}

export interface MatrixRow {
  item: MemoryItem;
  cells: MatrixCell[];
}

/** Rows are non-session memories; columns are agents; each cell says whether that agent reads the memory. */
export async function shareMatrix(hub: Hub, projectPath: string | null): Promise<MatrixRow[]> {
  const items = (await hub.memories(projectPath)).filter((m) => m.kind !== 'session');
  const shares = await listShares(hub.ctx);
  const seen = new Set<string>();
  const rows: MatrixRow[] = [];
  for (const item of items) {
    const real = await fs.realpath(item.filePath).catch(() => item.filePath);
    // A file read by several agents (e.g. AGENTS.md) appears once.
    if (seen.has(real)) continue;
    seen.add(real);
    const readers = new Set([item.agent, ...item.alsoReadBy]);
    const cells = hub.adapters.map((a): MatrixCell => {
      if (readers.has(a.id)) return { agent: a.id, state: 'native' };
      const share = shares.find((s) => s.sourcePath === item.filePath && s.targetAgent === a.id);
      if (share) return { agent: a.id, state: 'shared', shareId: share.id, strategy: share.strategy };
      return { agent: a.id, state: 'available' };
    });
    rows.push({ item, cells });
  }
  return rows;
}
