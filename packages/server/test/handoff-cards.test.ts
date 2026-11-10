import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPlan, Hub, planTransfer, undoBackup, upsertBlock, type MemoryItem, type ParsedSession, type Plan } from '@agent-mem/core';
import { createApp, EventBus } from '@agent-mem/server';
import { fileItem } from '../../core/src/adapters/common.js';
import { idFor } from '../../core/src/fsutil.js';
import { tildify } from '../../core/src/context.js';
import { setup } from '../../core/test/helpers.js';

async function fixture() {
  const env = await setup();
  const transcript = path.join(env.root, 'cursor-session.jsonl');
  fs.writeFileSync(transcript, JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text: 'Finish the upload tests.' }] } }));
  const item = await fileItem('cursor', transcript, 'local', 'session', env.project, 'Upload tests --> review');
  if (!item) throw new Error('Missing fixture transcript');
  return { ...env, item };
}

describe('received handoff cards', () => {
  it('discovers, opens and forwards a handoff after restart, with one card per target', async () => {
    const { hub, ctx, project, item } = await fixture();
    const plan = await planTransfer(hub, item, 'zcode', { render: 'verbatim' });
    await applyPlan(ctx, plan);
    await applyPlan(ctx, await planTransfer(hub, item, 'zcode', { render: 'verbatim' }));
    const reloaded = await Hub.create(ctx);
    const cards = (await reloaded.memories(project)).filter((memory) => memory.kind === 'handoff');
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card).toMatchObject({ agent: 'zcode', sourceAgent: 'cursor', title: item.title, alsoReadBy: [] });
    expect(card.content).toContain('Finish the upload tests.');

    const app = createApp({ hub: reloaded, bus: new EventBus() });
    const response = await app.request(`/api/session/${card.id}?project=${encodeURIComponent(project)}`, { headers: { host: '127.0.0.1:4477' } });
    expect(response.status).toBe(200);
    expect((await response.json()).messages[0].text).toBe(card.content);

    const other = await planTransfer(reloaded, item, 'codex', { render: 'verbatim' });
    expect(other.writes[0]?.filePath).not.toBe(card.filePath);
    await applyPlan(ctx, other);
    expect((await reloaded.memories(project)).filter((memory) => memory.kind === 'handoff').map((memory) => memory.agent).sort()).toEqual(['codex', 'zcode']);

    const forwarded = await planTransfer(reloaded, card, 'pi', { render: 'verbatim' });
    expect(forwarded.writes[0]?.after).toBe(card.content);
    const result = await applyPlan(ctx, forwarded);
    expect((await reloaded.memories(project)).some((memory) => memory.kind === 'handoff' && memory.agent === 'pi')).toBe(true);
    for (const backup of result.backups.toReversed()) await undoBackup(ctx, backup.id);
    expect((await reloaded.memories(project)).some((memory) => memory.kind === 'handoff' && memory.agent === 'pi')).toBe(false);
  });

  it('finds legacy handoffs only in their intended target column', async () => {
    const { hub, project, item } = await fixture();
    const doc = path.join(project, '.agent-mem', 'handoffs', 'handoff-cursor-legacy.md');
    fs.mkdirSync(path.dirname(doc), { recursive: true });
    fs.writeFileSync(doc, '# Legacy handoff\nContinue the upload tests.');
    const ref = path.join(project, 'AGENTS.md');
    const block = `handoff-${idFor(item.filePath, 'zcode')}`;
    fs.writeFileSync(ref, upsertBlock('', block, `handoff from cursor ${tildify(hub.ctx, item.filePath)}`, '# Legacy handoff\n\n_Full handoff document: `.agent-mem/handoffs/handoff-cursor-legacy.md`_'));
    expect((await hub.memories(project)).filter((memory) => memory.kind === 'handoff')).toMatchObject([
      { agent: 'zcode', sourceAgent: 'cursor', title: 'Legacy handoff', filePath: doc },
    ]);
  });
});

const sampleText = {
  'claude-code': ['Add rate limiting to the /api/upload endpoint', 'Rate limiting is in place'],
  codex: ['Migrate the settings page from class components to hooks', 'Settings is now a function component'],
  pi: ['Write a CHANGELOG entry for v1.4', 'Added the 1.4.0 changelog entry'],
  cursor: ['Fix the login redirect', 'Updated the route.'],
  qoder: ['Open the Qoder session', 'Here is the answer.'],
  zcode: ['会话在哪里', '在 cli 数据库里。'],
  gemini: ['Add a dark theme toggle to the settings page'],
  opencode: ['Wire up the export button', 'Export now writes a bundle'],
  'deepseek-harness': ['Set up the release pipeline for tags', 'Release pipeline configured'],
} as const;

describe.each(['verbatim', 'summary'] as const)('%s handoff matrix', (render) => {
  it.each(Object.keys(sampleText) as (keyof typeof sampleText)[])('transfers %s to all other built-in targets', async (source) => {
    const { hub, ctx, project } = await setup();
    ctx.env.AGENT_MEM_LLM_MODE = 'api'; // No key: exercise deterministic rule summaries without any model call.
    const app = createApp({ hub, bus: new EventBus() });
    const query = `?project=${encodeURIComponent(project)}`;
    const post = (route: string, body: unknown) => app.request(route, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const items: MemoryItem[] = await (await app.request(`/api/memories${query}`)).json();
    const session = items.find((item) => item.kind === 'session' && item.agent === source);
    if (!session) throw new Error(`No session discovered for ${source}`);
    const docs = new Map<string, { file: string; text: string }>();
    const targets = hub.adapters.filter((target) => target.id !== source);
    expect(targets).toHaveLength(8);
    for (const target of targets) {
      const route = `${source} → ${target.id}`;
      const preview = await post('/api/transfer/preview', { project, memoryId: session.id, targetAgent: target.id, render });
      expect(preview.status, route).toBe(200);
      const plan: Plan = await preview.json();
      expect(plan.kind, route).toBe('handoff');
      expect(plan.writes, route).toHaveLength(2);
      const [doc, reference] = plan.writes;
      if (!doc || !reference) throw new Error(`Missing handoff writes for ${route}`);
      expect(doc.after, route).toContain(sampleText[source][0]);
      if (render === 'verbatim') {
        for (const message of sampleText[source]) expect(doc.after, route).toContain(message);
      } else {
        expect(doc.after, route).toContain('## Goal');
      }
      expect(fs.existsSync(doc.filePath), route).toBe(false);
      const applied = await post('/api/apply', { plan });
      expect(applied.status, route).toBe(200);
      expect(fs.readFileSync(doc.filePath, 'utf8'), route).toBe(doc.after);
      expect(fs.readFileSync(reference.filePath, 'utf8'), route).toContain(path.basename(doc.filePath));
      docs.set(target.id, { file: doc.filePath, text: doc.after });
    }

    const reloaded = createApp({ hub: await Hub.create(ctx), bus: new EventBus() });
    const memories: MemoryItem[] = await (await reloaded.request(`/api/memories${query}`)).json();
    const cards = memories.filter((item) => item.kind === 'handoff');
    expect(cards.map((card) => card.agent).sort()).toEqual([...docs.keys()].sort());
    expect(new Set(cards.map((card) => card.filePath)).size).toBe(targets.length);
    expect(memories.find((item) => item.id === session.id)).toMatchObject({ kind: 'session', hash: session.hash });
    for (const card of cards) {
      expect(card).toMatchObject({ sourceAgent: source, filePath: docs.get(card.agent)?.file });
      const response = await reloaded.request(`/api/session/${card.id}${query}`);
      expect(response.status, card.agent).toBe(200);
      const opened: ParsedSession = await response.json();
      expect(opened.messages[0]?.text, card.agent).toBe(docs.get(card.agent)?.text);
    }
  }, 20_000);
});
