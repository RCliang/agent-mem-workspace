import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPlan, exportBundle, listShares, planImportBundle, planShare, registerImportedShares, syncShares } from '@agent-mem/core';
import { read, setup } from './helpers.js';

describe('bundle export/import', () => {
  it('exports one entry per file with the agents that read it', async () => {
    const { hub, project } = await setup();
    const bundle = await exportBundle(hub, project);
    expect(bundle.version).toBe(1);
    expect(bundle.items.map((i) => i.relPath).sort()).toEqual([
      '.cursor/rules/backend.mdc',
      '.qoder/rules/style.md',
      'AGENTS.local.md',
      'AGENTS.md',
      'CLAUDE.md',
      'GEMINI.md',
    ]);
    const agents = bundle.items.find((i) => i.relPath === 'AGENTS.md');
    expect(agents?.agents.sort()).toEqual(['codex', 'deepseek-harness', 'opencode', 'pi', 'qoder', 'zcode']);
    expect(bundle.items.every((i) => !path.isAbsolute(i.relPath) && i.content.length > 0)).toBe(true);
    // Auto memory under ~/.claude and sessions stay out of the bundle.
    expect(bundle.items.some((i) => i.relPath.includes('.claude'))).toBe(false);
  });

  it('round-trips memories and share records into a fresh directory', async () => {
    const { hub, project, root } = await setup();
    // Share project CLAUDE.md into Codex first so the bundle carries a share record.
    const claudeMd = (await hub.memories(project)).find((m) => m.agent === 'claude-code' && m.filePath === path.join(project, 'CLAUDE.md'))!;
    await applyPlan(hub.ctx, await planShare(hub, claudeMd, 'codex'));

    const bundle = await exportBundle(hub, project);
    expect(bundle.shares).toHaveLength(1);
    expect(bundle.shares[0]!.sourceRel).toBe('CLAUDE.md');

    const target = path.join(root, 'work', 'migrated');
    fs.mkdirSync(target, { recursive: true });
    const { plan, shares } = await planImportBundle(hub, bundle, target);
    await applyPlan(hub.ctx, plan);
    await registerImportedShares(hub, shares);

    expect(read(path.join(target, 'CLAUDE.md'))).toBe(read(path.join(project, 'CLAUDE.md')));
    expect(read(path.join(target, 'AGENTS.md'))).toContain('agent-mem:begin');

    // Re-importing the same bundle is a no-op while the files are unchanged.
    const again = await planImportBundle(hub, bundle, target);
    expect(again.plan.writes).toHaveLength(0);

    // The re-registered share keeps syncing inside the migrated directory.
    fs.appendFileSync(path.join(target, 'CLAUDE.md'), '- added after migration\n');
    const res = await syncShares(hub);
    expect(res.updated.length).toBeGreaterThanOrEqual(1);
    expect(read(path.join(target, 'AGENTS.md'))).toContain('added after migration');
    expect(await listShares(hub.ctx)).toHaveLength(1);
  });

  it('rejects bundles that try to escape the project', async () => {
    const { hub, project, root } = await setup();
    const target = path.join(root, 'work', 'elsewhere');
    const evil = {
      version: 1,
      exportedAt: new Date().toISOString(),
      originProject: project,
      items: [{ agents: ['codex'], scope: 'project', kind: 'instructions', title: 'x', relPath: '../outside.md', content: 'x' }],
      shares: [],
    };
    await expect(planImportBundle(hub, evil, target)).rejects.toThrow(/escapes/);
  });
});
