import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyPlan, ConflictError, listShares, planShare, planTransfer, planUnshare, shareMatrix, syncShares } from '@agent-mem/core';
import { read, setup } from './helpers.js';

async function memory(hub: Awaited<ReturnType<typeof setup>>['hub'], project: string, agent: string, file: string) {
  const m = (await hub.memories(project)).find((i) => i.agent === agent && i.filePath === file);
  if (!m) throw new Error(`missing ${agent} ${file}`);
  return m;
}

describe('sharing', () => {
  it('uses an @import for Claude Code', async () => {
    const { hub, project } = await setup();
    const agentsMd = await memory(hub, project, 'codex', path.join(project, 'AGENTS.md'));
    const plan = await planShare(hub, agentsMd, 'claude-code');
    expect(plan.share?.strategy).toBe('import');
    await applyPlan(hub.ctx, plan);
    const claudeMd = read(path.join(project, 'CLAUDE.md'));
    expect(claudeMd).toMatch(/^# shop-api/);
    expect(claudeMd).toContain('<!-- agent-mem:begin');
    expect(claudeMd).toContain('\n@AGENTS.md\n');
    expect(await listShares(hub.ctx)).toHaveLength(1);
  });

  it('symlinks when the target file does not exist yet', async () => {
    const { hub, otherProject } = await setup();
    fs.writeFileSync(path.join(otherProject, 'NOTES.md'), 'x');
    const agentsMd = await memory(hub, otherProject, 'codex', path.join(otherProject, 'AGENTS.md'));
    const plan = await planShare(hub, agentsMd, 'claude-code', 'symlink');
    await applyPlan(hub.ctx, plan);
    const link = path.join(otherProject, 'CLAUDE.md');
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(link)).toBe('AGENTS.md');

    const unshare = await planUnshare(hub, plan.share!.id);
    await applyPlan(hub.ctx, unshare);
    expect(fs.existsSync(link)).toBe(false);
    expect(await listShares(hub.ctx)).toHaveLength(0);
  });

  it('copies into a managed block, inlining imports, and re-syncs on change', async () => {
    const { hub, project } = await setup();
    const claudeMd = await memory(hub, project, 'claude-code', path.join(project, 'CLAUDE.md'));
    // Pi already reads CLAUDE.md, so share with Codex.
    await expect(planShare(hub, claudeMd, 'pi')).rejects.toThrow(/natively/);
    const plan = await planShare(hub, claudeMd, 'codex');
    expect(plan.share?.strategy).toBe('copy');
    await applyPlan(hub.ctx, plan);
    let agentsMd = read(path.join(project, 'AGENTS.md'));
    expect(agentsMd).toMatch(/^# shop-api agent guide/);
    expect(agentsMd).toContain('Validate request bodies with zod.');
    expect(agentsMd).not.toMatch(/^@docs/m);

    fs.appendFileSync(path.join(project, 'CLAUDE.md'), '- `pnpm e2e` runs end-to-end tests.\n');
    const res = await syncShares(hub);
    expect(res.updated).toEqual([plan.share!.id]);
    agentsMd = read(path.join(project, 'AGENTS.md'));
    expect(agentsMd).toContain('pnpm e2e');
    expect(agentsMd.match(/agent-mem:begin/g)).toHaveLength(1);
    expect((await syncShares(hub)).updated).toEqual([]);

    await applyPlan(hub.ctx, await planUnshare(hub, plan.share!.id));
    expect(read(path.join(project, 'AGENTS.md'))).toBe('# shop-api agent guide\n\n- Run `pnpm lint` before committing.\n');
  });

  it('builds a matrix with native, shared and available cells', async () => {
    const { hub, project } = await setup();
    const agentsMd = await memory(hub, project, 'codex', path.join(project, 'AGENTS.md'));
    await applyPlan(hub.ctx, await planShare(hub, agentsMd, 'claude-code'));
    const rows = await shareMatrix(hub, project);
    const row = rows.find((r) => r.item.filePath === path.join(project, 'AGENTS.md'))!;
    expect(row.cells.map((c) => `${c.agent}:${c.state}`)).toEqual([
      'claude-code:shared',
      'codex:native',
      'pi:native',
      'gemini:available',
      'cursor:available',
      'opencode:native',
    ]);
    // AGENTS.md is read by both Codex and Pi but listed once.
    expect(rows.filter((r) => r.item.filePath === path.join(project, 'AGENTS.md'))).toHaveLength(1);
  });

  it('refuses to apply a plan when the target changed after preview', async () => {
    const { hub, project } = await setup();
    const agentsMd = await memory(hub, project, 'codex', path.join(project, 'AGENTS.md'));
    const plan = await planShare(hub, agentsMd, 'claude-code');
    fs.appendFileSync(path.join(project, 'CLAUDE.md'), 'edited meanwhile\n');
    await expect(applyPlan(hub.ctx, plan)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('transfer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('copies an instruction file once and refreshes the same block on repeat', async () => {
    const { hub, project } = await setup();
    hub.ctx.env.AGENT_MEM_LLM_API_KEY = 'test-key';
    hub.ctx.env.AGENT_MEM_LLM_MODE = 'api';
    const fetchMock = vi.fn(async () => new Response('# rewritten by the summarizer\n'));
    vi.stubGlobal('fetch', fetchMock);
    const mem = await memory(hub, project, 'claude-code', path.join(hub.ctx.home, '.claude', 'CLAUDE.md'));
    const plan = await planTransfer(hub, mem, 'codex', { render: 'verbatim' });
    expect(plan.writes[0]?.filePath).toBe(path.join(hub.ctx.home, '.codex', 'AGENTS.md'));
    await applyPlan(hub.ctx, plan);
    await applyPlan(hub.ctx, await planTransfer(hub, mem, 'codex', { render: 'verbatim' }));
    const out = read(path.join(hub.ctx.home, '.codex', 'AGENTS.md'));
    expect(out).toContain('Prefer pnpm over npm.');
    expect(out.match(/agent-mem:begin xfer-/g)).toHaveLength(1);
    expect(out).not.toContain('rewritten by the summarizer');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await listShares(hub.ctx)).toHaveLength(0);
  });

  it('summarizes another memory as an outline when no model is configured', async () => {
    const { hub, project } = await setup();
    hub.ctx.env.AGENT_MEM_LLM_MODE = 'api';
    const fetchMock = vi.fn(async () => new Response('# rewritten\n'));
    vi.stubGlobal('fetch', fetchMock);
    const mem = await memory(hub, project, 'claude-code', path.join(project, 'CLAUDE.md'));
    const plan = await planTransfer(hub, mem, 'codex', { render: 'summary' });
    const after = plan.writes[0]?.after ?? '';
    expect(after).toContain('# shop-api');
    expect(after).toContain('## Commands');
    expect(after).toContain('pnpm test');
    expect(after).not.toContain('Validate request bodies with zod');
    expect(after.match(/agent-mem:begin xfer-/g)).toHaveLength(1);
    expect(plan.notes.join(' ')).toMatch(/No model ran/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
