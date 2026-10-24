import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyPlan, declarativeAdapter, encodeClaudeProject, llmLocalSummarizers, planHandoff, planTransfer, type AgentAdapter, type AgentCli, type Context } from '@agent-mem/core';
import { read, setup } from './helpers.js';

const now = new Date('2026-10-23T08:00:00Z');

/** Config-only agent whose "CLI" is a deterministic node script, standing in for claude/codex/pi. */
function stubAgent(ctx: Context, id: string, cli?: AgentCli): AgentAdapter {
  const base = declarativeAdapter(ctx, { id, displayName: `Stub ${id}`, homeDir: ctx.home, projectFiles: ['AGENTS.md'] });
  return cli ? { ...base, cli } : base;
}

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

  it('refines a handoff through a local agent CLI by default', async () => {
    const script = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mem-cli-')), 'refine.mjs');
    fs.writeFileSync(script, "process.stdout.write('# Handoff: refined by the stub CLI\\n')\n");
    const { hub, project, ctx } = await setup();
    // Attach the stub as the target agent so it is the first summarizer candidate.
    const stub = stubAgent(ctx, 'stub', { command: process.execPath, args: () => [script] });
    hub.adapters.push(stub);

    const s = await session(hub, project, 'pi');
    const plan = await planHandoff(hub, s, 'stub', { llm: true, now });
    expect(plan.writes[0]?.after).toBe('# Handoff: refined by the stub CLI\n');
    expect(plan.notes.join(' ')).toMatch(/running locally through its own CLI/);
    expect(await llmLocalSummarizers(hub)).toContain('stub');
  });

  it('skips local CLIs and says why when AGENT_MEM_LLM_MODE=api without a key', async () => {
    const { hub, project } = await setup();
    hub.ctx.env.AGENT_MEM_LLM_MODE = 'api';
    const s = await session(hub, project, 'pi');
    const plan = await planHandoff(hub, s, 'claude-code', { llm: true, now });
    expect(plan.writes[0]?.after).toContain('## Goal\nWrite a CHANGELOG entry');
    expect(plan.notes.join(' ')).toMatch(/AGENT_MEM_LLM_MODE=api/);
  });

  it('lists only agents that declare a CLI', async () => {
    const { hub } = await setup();
    const ids = await llmLocalSummarizers(hub);
    expect(ids).toContain('claude-code');
    expect(ids).toContain('pi');
    expect(ids).not.toContain('cursor');
  });

  it('uses an OpenAI-compatible LLM when configured and falls back on failure', async () => {
    const { hub, project } = await setup();
    const s = await session(hub, project, 'pi');
    hub.ctx.env.AGENT_MEM_LLM_API_KEY = 'test-key';
    hub.ctx.env.AGENT_MEM_LLM_BASE_URL = 'http://llm.local/v1';
    // Keep the test off whatever coding-agent CLIs happen to be installed on this machine.
    hub.ctx.env.AGENT_MEM_LLM_MODE = 'api';
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
