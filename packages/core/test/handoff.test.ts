import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyPlan, encodeClaudeProject, planHandoff, planTransfer } from '@agent-mem/core';
import { read, setup } from './helpers.js';

const now = new Date('2026-10-23T08:00:00Z');

async function session(hub: Awaited<ReturnType<typeof setup>>['hub'], project: string, agent: string) {
  const s = (await hub.memories(project)).find((i) => i.agent === agent && i.kind === 'session');
  if (!s) throw new Error(`no ${agent} session`);
  return s;
}

afterEach(() => vi.unstubAllGlobals());

describe('handoff', () => {
  it('turns a Codex session into Claude Code auto memory', async () => {
    const { hub, project } = await setup();
    const s = await session(hub, project, 'codex');
    const plan = await planTransfer(hub, s, 'claude-code', { now });
    expect(plan.kind).toBe('handoff');
    await applyPlan(hub.ctx, plan);

    const memDir = path.join(hub.ctx.home, '.claude', 'projects', encodeClaudeProject(project), 'memory');
    const doc = read(path.join(memDir, 'handoff-codex-0199c1d2-cod.md'));
    expect(doc).toContain('# Handoff: shop-api (from Codex)');
    expect(doc).toContain('## Goal\nMigrate the settings page');
    expect(doc).toContain('- `src/pages/Settings.tsx` (apply_patch)');
    expect(doc).toContain("- `rg -n 'class Settings' src`");
    expect(doc).toContain('ProfileForm child is still a class component');

    const index = read(path.join(memDir, 'MEMORY.md'));
    expect(index).toMatch(/^# Memory index/);
    expect(index).toContain('](handoff-codex-0199c1d2-cod.md)');
  });

  it('inlines a Claude session into AGENTS.md for Pi and masks secrets', async () => {
    const { hub, project } = await setup();
    const s = await session(hub, project, 'claude-code');
    const plan = await planHandoff(hub, s, 'pi', { now });
    expect(plan.findings).toEqual([{ type: 'secret-assignment', count: 1 }]);
    await applyPlan(hub.ctx, plan);
    const agentsMd = read(path.join(project, 'AGENTS.md'));
    expect(agentsMd).toMatch(/^# shop-api agent guide/);
    expect(agentsMd).toContain('Rate limiting is in place');
    expect(agentsMd).toContain('.agent-mem/handoffs/handoff-claude-code-7f3c2a10-cla.md');
    expect(agentsMd).not.toContain('hunter2');
    expect(fs.existsSync(path.join(project, '.agent-mem', 'handoffs', 'handoff-claude-code-7f3c2a10-cla.md'))).toBe(true);
  });

  it('uses an OpenAI-compatible LLM when configured and falls back on failure', async () => {
    const { hub, project } = await setup();
    const s = await session(hub, project, 'pi');
    hub.ctx.env.AGENT_MEM_LLM_API_KEY = 'test-key';
    hub.ctx.env.AGENT_MEM_LLM_BASE_URL = 'http://llm.local/v1';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '# Handoff: refined' } }] })));
    vi.stubGlobal('fetch', fetchMock);
    const plan = await planHandoff(hub, s, 'claude-code', { llm: true, now });
    expect(fetchMock).toHaveBeenCalledWith('http://llm.local/v1/chat/completions', expect.anything());
    expect(plan.writes[0]?.after).toBe('# Handoff: refined\n');

    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const fallback = await planHandoff(hub, s, 'claude-code', { llm: true, now });
    expect(fallback.writes[0]?.after).toContain('## Goal\nWrite a CHANGELOG entry');
    expect(fallback.notes.join(' ')).toMatch(/LLM summary unavailable/);
  });
});
