import fs from 'node:fs/promises';
import path from 'node:path';
import { idFor, isDir, listDir, readHeadLines, walk } from './fsutil.js';
import type { Hub } from './hub.js';
import type { Plan } from './plan.js';
import type { AgentAdapter, AgentId, SkillItem, SkillRootLocation } from './types.js';

/** The `.agents/skills` convention is a skill library several tools read at once. */
export const SHARED_AGENT = { id: 'shared', displayName: 'Shared (.agents)' } as const;

export function sharedSkillRoots(ctx: Hub['ctx'], projectPath: string | null): SkillRootLocation[] {
  const roots: SkillRootLocation[] = [{ dir: path.join(ctx.home, '.agents', 'skills'), scope: 'global', shared: true }];
  if (projectPath) roots.push({ dir: path.join(projectPath, '.agents', 'skills'), scope: 'project', shared: true });
  return roots;
}

/** Columns the Skills tab shows: every adapter with skill roots plus the shared library. */
export async function skillLibraries(hub: Hub): Promise<{ id: AgentId; displayName: string; detected: boolean }[]> {
  const out: { id: AgentId; displayName: string; detected: boolean }[] = [];
  for (const a of hub.adapters) {
    if (a.skillRoots && (await a.detect())) out.push({ id: a.id, displayName: a.displayName, detected: true });
  }
  out.push({ ...SHARED_AGENT, detected: true });
  return out;
}

/** First paragraph of the `description:` frontmatter field, block or inline scalar. */
function parseDescription(frontmatterLines: string[]): string {
  const idx = frontmatterLines.findIndex((l) => /^description:\s*/.test(l));
  if (idx === -1) return '';
  const inline = /^description:\s*(.*)$/.exec(frontmatterLines[idx]!)![1]!.trim();
  if (inline && inline !== '|' && inline !== '>' && inline !== '|-' && inline !== '>-') return clip(oneLine(inline));
  const block: string[] = [];
  for (const l of frontmatterLines.slice(idx + 1)) {
    if (l.trim() === '') continue;
    if (/^\s/.test(l)) block.push(l.trim());
    else break;
  }
  return clip(block.join(' '));
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const clip = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

async function buildSkill(agent: AgentId, root: SkillRootLocation, projectPath: string | null, dir: string): Promise<SkillItem | null> {
  const skillMdPath = path.join(dir, 'SKILL.md');
  const head = await readHeadLines(skillMdPath, 8 * 1024);
  if (head.length === 0) return null; // a skill folder is defined by its SKILL.md
  const inFrontmatter = head[0]?.trim() === '---';
  const end = inFrontmatter ? head.indexOf('---', 1) : -1;
  const description = inFrontmatter && end > 0 ? parseDescription(head.slice(1, end)) : '';
  const files = await walk(dir, () => true, 8);
  let sizeBytes = 0;
  let mtimeMs = 0;
  for (const f of files) {
    const st = await fs.stat(f).catch(() => null);
    if (!st) continue;
    sizeBytes += st.size;
    mtimeMs = Math.max(mtimeMs, st.mtimeMs);
  }
  return {
    id: idFor(agent, dir),
    agent,
    name: path.basename(dir),
    description,
    dirPath: dir,
    skillMdPath,
    scope: root.scope,
    projectPath: root.scope === 'project' ? projectPath : null,
    fileCount: files.length,
    sizeBytes,
    mtimeMs,
    alsoReadBy: [],
    shared: root.shared ?? false,
  };
}

/** Every skill visible for a project (or only global libraries when `projectPath` is null). */
export async function listSkills(hub: Hub, projectPath: string | null): Promise<SkillItem[]> {
  const sources: { agent: AgentId; root: SkillRootLocation }[] = [];
  for (const a of hub.adapters) {
    for (const root of a.skillRoots?.(projectPath) ?? []) sources.push({ agent: a.id, root });
  }
  for (const root of sharedSkillRoots(hub.ctx, projectPath)) sources.push({ agent: SHARED_AGENT.id, root });

  const items: SkillItem[] = [];
  for (const { agent, root } of sources) {
    for (const name of (await listDir(root.dir)).sort()) {
      const dir = path.join(root.dir, name);
      if (!(await isDir(dir))) continue;
      const skill = await buildSkill(agent, root, projectPath, dir);
      if (skill) items.push(skill);
    }
  }
  // Same story as memories: a directory reached through several roots is one skill.
  const byReal = new Map<string, SkillItem[]>();
  for (const item of items) {
    const real = await fs.realpath(item.dirPath).catch(() => item.dirPath);
    byReal.set(real, [...(byReal.get(real) ?? []), item]);
  }
  for (const group of byReal.values()) {
    for (const item of group) {
      item.alsoReadBy = [...new Set(group.map((g) => g.agent).filter((a) => a !== item.agent))];
    }
  }
  return items;
}

export async function findSkill(hub: Hub, idOrRef: string, projectPath: string | null): Promise<SkillItem> {
  const skills = await listSkills(hub, projectPath);
  const byId = skills.find((s) => s.id === idOrRef);
  if (byId) return byId;
  const m = /^([\w-]+):(.+)$/.exec(idOrRef);
  const name = m?.[2] ?? idOrRef;
  const matches = skills.filter((s) => s.name === name && (!m || s.agent === m[1]));
  if (matches.length === 0) throw new Error(`No skill matches "${idOrRef}"`);
  if (matches.length > 1) throw new Error(`Skill "${name}" exists in ${matches.length} libraries: ${matches.map((s) => s.agent).join(', ')}. Prefix it with agent:name.`);
  return matches[0]!;
}

/** Where a transferred skill lands for `target` (an adapter id or the shared library). */
export function skillTargetDir(hub: Hub, target: AgentId, scope: 'global' | 'project', projectPath: string | null): string {
  if (target === SHARED_AGENT.id) {
    return scope === 'project' && projectPath ? path.join(projectPath, '.agents', 'skills') : path.join(hub.ctx.home, '.agents', 'skills');
  }
  const adapter: AgentAdapter | undefined = hub.adapters.find((a) => a.id === target);
  if (!adapter) throw new Error(`Unknown skill library "${target}"`);
  const roots = adapter.skillRoots?.(scope === 'project' ? projectPath : null) ?? [];
  const match = roots.find((r) => r.scope === scope) ?? roots[0];
  if (!match) throw new Error(`${adapter.displayName} has no skill library`);
  return match.dir;
}

export interface SkillTransferOptions {
  /** Copy the folder and delete the source (backed up) instead of leaving it in place. */
  move?: boolean;
  /** Replace a skill with the same name in the target library. */
  overwrite?: boolean;
}

export async function planSkillTransfer(hub: Hub, skill: SkillItem, target: AgentId, opts: SkillTransferOptions = {}): Promise<Plan> {
  if (skill.agent === target && !opts.move) throw new Error('Source and target library are the same');
  const targetName = target === SHARED_AGENT.id ? SHARED_AGENT.displayName : hub.adapter(target).displayName;
  const destDir = path.join(skillTargetDir(hub, target, skill.scope, skill.projectPath), skill.name);
  if (destDir === skill.dirPath) throw new Error('Source and target library are the same');
  const destExisted = await isDir(destDir);
  if (destExisted && !opts.overwrite) {
    throw new Error(`${targetName} already has a skill named "${skill.name}"; pass overwrite to replace it`);
  }

  const notes: string[] = [];
  notes.push(`${opts.move ? 'Move' : 'Copy'} ${skill.fileCount} file${skill.fileCount === 1 ? '' : 's'} to ${targetName}.`);
  if (skill.shared && opts.move) notes.push(`"${skill.name}" lives in the shared .agents library that several agents read; moving it takes it away from all of them.`);
  if (skill.alsoReadBy.length && opts.move) notes.push(`Also read by ${skill.alsoReadBy.join(', ')}; the move removes it for them too.`);
  if (target === SHARED_AGENT.id) notes.push('The shared .agents library is read by every tool that follows the convention — the skill becomes available to all of them.');

  return {
    kind: 'skill-transfer',
    title: `${opts.move ? 'Move' : 'Copy'} skill "${skill.name}" to ${targetName}`,
    writes: [],
    dirOps: [
      { op: 'copy-dir', srcDir: skill.dirPath, destDir, destExisted },
      ...(opts.move ? [{ op: 'delete-dir' as const, destDir: skill.dirPath, destExisted: true }] : []),
    ],
    notes,
    findings: [],
  };
}

export async function planSkillDelete(hub: Hub, skill: SkillItem): Promise<Plan> {
  const notes: string[] = [`Delete ${skill.fileCount} file${skill.fileCount === 1 ? '' : 's'}; a full backup is kept so this can be undone.`];
  if (skill.shared) notes.push('This skill is in the shared .agents library — every agent reading .agents loses it. Consider a move instead.');
  if (skill.alsoReadBy.length) notes.push(`Also read by ${skill.alsoReadBy.join(', ')}.`);
  return {
    kind: 'skill-delete',
    title: `Delete skill "${skill.name}"`,
    writes: [],
    dirOps: [{ op: 'delete-dir', destDir: skill.dirPath, destExisted: true }],
    notes,
    findings: [],
  };
}
