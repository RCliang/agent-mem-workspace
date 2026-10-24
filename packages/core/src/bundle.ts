import fs from 'node:fs/promises';
import path from 'node:path';
import { readText } from './fsutil.js';
import type { Hub } from './hub.js';
import { plannedWrite, type Plan } from './plan.js';
import { listShares, saveShares, type Share } from './share-store.js';
import type { AgentId, MemoryKind, MemoryScope } from './types.js';

function isInside(child: string, parent: string) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Portable snapshot of one project's memory files so they can move between machines. */
export interface MemoryBundle {
  version: 1;
  exportedAt: string;
  /** Absolute path on the exporting machine; provenance only. */
  originProject: string;
  items: {
    /** Agents that natively read the file (deduplicated; AGENTS.md serves several). */
    agents: AgentId[];
    scope: MemoryScope;
    kind: MemoryKind;
    title: string;
    /** Path relative to the project root, e.g. `docs/conventions.md`. */
    relPath: string;
    content: string;
  }[];
  shares: (Omit<Share, 'sourcePath' | 'targetPath' | 'projectPath'> & { sourceRel: string; targetRel: string })[];
}

export async function exportBundle(hub: Hub, projectPath: string): Promise<MemoryBundle> {
  const items = (await hub.memories(projectPath)).filter(
    (m) => m.kind !== 'session' && m.scope !== 'global' && isInside(m.filePath, projectPath),
  );
  // One entry per file: AGENTS.md is listed by every agent that reads it natively.
  const byReal = new Map<string, MemoryBundle['items'][number]>();
  for (const m of items) {
    const real = await fs.realpath(m.filePath).catch(() => m.filePath);
    const cur = byReal.get(real);
    if (cur) {
      cur.agents = [...new Set([...cur.agents, m.agent])];
      continue;
    }
    byReal.set(real, {
      agents: [m.agent, ...m.alsoReadBy],
      scope: m.scope,
      kind: m.kind,
      title: m.title,
      relPath: path.relative(projectPath, m.filePath),
      content: m.content,
    });
  }
  const shares = (await listShares(hub.ctx)).filter(
    (s) => s.projectPath === projectPath && isInside(s.sourcePath, projectPath) && isInside(s.targetPath, projectPath),
  );
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    originProject: projectPath,
    items: [...byReal.values()].sort((a, b) => a.relPath.localeCompare(b.relPath)),
    shares: shares.map(({ sourcePath, targetPath, projectPath: _projectPath, ...rest }) => ({
      ...rest,
      sourceRel: path.relative(projectPath, sourcePath),
      targetRel: path.relative(projectPath, targetPath),
    })),
  };
}

export interface ImportPlan {
  plan: Plan;
  /** Share records with paths rebased onto the target project; register after applying. */
  shares: Share[];
}

/** Turn a bundle into a write plan for `projectPath`, plus share records to re-register. */
export async function planImportBundle(hub: Hub, bundle: MemoryBundle, projectPath: string): Promise<ImportPlan> {
  if (bundle.version !== 1) throw new Error(`Unsupported bundle version: ${bundle.version}`);
  const writes = [];
  let skipped = 0;
  let unchanged = 0;
  for (const item of bundle.items) {
    if (!item.relPath || item.relPath.split(path.sep).some((p) => p === '..')) throw new Error(`Bundle item escapes the project: ${item.relPath}`);
    const target = path.join(projectPath, item.relPath);
    if ((await readText(target)) === item.content) {
      unchanged++;
      continue;
    }
    writes.push(await plannedWrite(target, item.content));
  }
  const shares: Share[] = [];
  for (const s of bundle.shares) {
    if (!hub.adapters.some((a) => a.id === s.sourceAgent) || !hub.adapters.some((a) => a.id === s.targetAgent)) {
      skipped++;
      continue;
    }
    shares.push({
      ...s,
      projectPath,
      sourcePath: path.join(projectPath, s.sourceRel),
      targetPath: path.join(projectPath, s.targetRel),
    });
  }
  const plan: Plan = {
    kind: 'transfer',
    title: `Import ${bundle.items.length} memories from ${bundle.originProject}`,
    writes,
    notes: [
      `${unchanged} file${unchanged === 1 ? '' : 's'} already identical, ${writes.length} to write.`,
      ...(shares.length ? [`${shares.length} share record${shares.length === 1 ? '' : 's'} will be re-registered so sync keeps working.`] : []),
      ...(skipped ? [`${skipped} share record${skipped === 1 ? '' : 's'} skipped: that agent is not configured here. Use \`agent-mem agents add\` first.`] : []),
    ],
    findings: [],
  };
  return { plan, shares };
}

/** Register imported shares (idempotent). Call after `applyPlan` succeeded. */
export async function registerImportedShares(hub: Hub, shares: Share[]): Promise<void> {
  if (!shares.length) return;
  const existing = await listShares(hub.ctx);
  const byId = new Map(existing.map((s) => [s.id, s]));
  for (const s of shares) byId.set(s.id, s);
  await saveShares(hub.ctx, [...byId.values()]);
}
