import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodeClaudeProject, encodePiProject, parseSessionFile } from '@agent-mem/core';
import { setup } from './helpers.js';

describe('adapters', () => {
  it('detects installed agents', async () => {
    const { hub } = await setup();
    const agents = await hub.agents();
    expect(agents.map((a) => [a.id, a.detected])).toEqual([
      ['claude-code', true],
      ['codex', true],
      ['pi', true],
      ['gemini', true],
      ['cursor', true],
      ['opencode', true],
      ['zcode', true],
      ['qoder', true],
      ['deepseek-harness', true],
    ]);
  });

  it('discovers projects from session logs and merges them across agents', async () => {
    const { hub, project, otherProject } = await setup();
    const projects = await hub.projects();
    const shop = projects.find((p) => p.path === project);
    expect(shop?.agents.sort()).toEqual(['claude-code', 'codex', 'deepseek-harness', 'gemini', 'opencode', 'pi', 'qoder', 'zcode']);
    expect(projects.find((p) => p.path === otherProject)?.agents).toEqual(['codex']);
  });

  it('includes manually added projects', async () => {
    const { hub, root } = await setup();
    const extra = path.join(root, 'work', 'manual');
    fs.mkdirSync(extra, { recursive: true });
    await hub.addProject(extra);
    expect((await hub.projects()).some((p) => p.path === extra)).toBe(true);
  });

  it('reads memories for every agent with scope and kind', async () => {
    const { hub, project } = await setup();
    const items = await hub.memories(project);
    const summary = items.map((i) => `${i.agent}|${i.scope}|${i.kind}|${path.basename(i.filePath)}`).sort();
    expect(summary).toEqual([
      'claude-code|global|instructions|CLAUDE.md',
      'claude-code|local|auto-memory|MEMORY.md',
      'claude-code|local|session|7f3c2a10-claude.jsonl',
      'claude-code|project|instructions|CLAUDE.md',
      'codex|global|instructions|AGENTS.md',
      'codex|local|session|rollout-2026-10-22T02-10-00-0199c1d2.jsonl',
      'codex|project|instructions|AGENTS.md',
      'cursor|global|instructions|core.mdc',
      'cursor|local|session|33333333-3333-3333-3333-333333333333.jsonl',
      'cursor|project|instructions|backend.mdc',
      'deepseek-harness|global|instructions|AGENTS.md',
      'deepseek-harness|local|instructions|AGENTS.local.md',
      'deepseek-harness|local|session|2026-10-22T06-00-00_dsh-7a1b.jsonl',
      'deepseek-harness|project|instructions|AGENTS.md',
      'deepseek-harness|project|instructions|CLAUDE.md',
      'gemini|global|instructions|GEMINI.md',
      'gemini|local|session|session-20261020T100000-abc.jsonl',
      'gemini|project|instructions|GEMINI.md',
      'opencode|global|instructions|AGENTS.md',
      'opencode|local|session|ses_demo01.json',
      'opencode|project|instructions|AGENTS.md',
      'pi|global|instructions|AGENTS.md',
      'pi|local|session|2026-10-22T08-00-00_pi-5e8a91.jsonl',
      'pi|project|instructions|AGENTS.md',
      'pi|project|instructions|CLAUDE.md',
      'qoder|global|instructions|AGENTS.md',
      'qoder|local|instructions|AGENTS.local.md',
      'qoder|local|session|session-q.jsonl',
      'qoder|project|instructions|AGENTS.md',
      'qoder|project|instructions|style.md',
      'zcode|global|instructions|AGENTS.md',
      'zcode|local|session|zsess-1',
      'zcode|project|instructions|AGENTS.md',
    ]);
  });

  it('marks files that several agents read natively', async () => {
    const { hub, project } = await setup();
    const items = await hub.memories(project);
    const codexAgents = items.find((i) => i.agent === 'codex' && i.filePath === path.join(project, 'AGENTS.md'));
    expect(codexAgents?.alsoReadBy).toEqual(['pi', 'opencode', 'zcode', 'qoder', 'deepseek-harness']);
    const claudeMd = items.find((i) => i.agent === 'claude-code' && i.filePath === path.join(project, 'CLAUDE.md'));
    expect(claudeMd?.alsoReadBy).toEqual(['pi', 'deepseek-harness']);
  });

  it('reads the extra built-in agents (Gemini CLI, Cursor, opencode)', async () => {
    const { hub, home, project } = await setup();
    const items = await hub.memories(project);

    const geminiGlobal = items.find((i) => i.agent === 'gemini' && i.scope === 'global');
    expect(geminiGlobal?.filePath).toBe(path.join(home, '.gemini', 'GEMINI.md'));
    expect(hub.adapter('gemini').capabilities.imports).toBe(true);
    expect(hub.adapter('gemini').instructionFile(project).filePath).toBe(path.join(project, 'GEMINI.md'));

    const rules = items.filter((i) => i.agent === 'cursor' && i.kind === 'instructions').map((i) => path.basename(i.filePath)).sort();
    expect(rules).toEqual(['backend.mdc', 'core.mdc']);
    expect(hub.adapter('cursor').instructionFile(project).filePath).toBe(path.join(project, '.cursor', 'rules', 'agent-mem.mdc'));
    expect(hub.adapter('cursor').instructionFile(null).filePath).toBe(path.join(home, '.cursor', 'rules', 'agent-mem.mdc'));

    const openGlobal = items.find((i) => i.agent === 'opencode' && i.scope === 'global');
    expect(openGlobal?.filePath).toBe(path.join(home, '.config', 'opencode', 'AGENTS.md'));
    expect(hub.adapter('opencode').instructionFile(null).filePath).toBe(path.join(home, '.config', 'opencode', 'AGENTS.md'));

    expect(hub.adapter('zcode').instructionFile(project).filePath).toBe(path.join(project, 'AGENTS.md'));
    expect(hub.adapter('zcode').instructionFile(null).filePath).toBe(path.join(home, '.zcode', 'AGENTS.md'));
    expect(hub.adapter('zcode').cli).toBeUndefined();
    expect(hub.adapter('qoder').instructionFile(project).filePath).toBe(path.join(project, 'AGENTS.md'));
    expect(hub.adapter('qoder').cli).toBeUndefined();
  });

  it('reads the DeepSeek Harness instruction chain and uses its write targets', async () => {
    const { hub, home, project } = await setup();
    fs.writeFileSync(path.join(home, '.agents', 'AGENTS.md'), '# Shared Harness instructions\n');
    fs.writeFileSync(path.join(project, 'CLAUDE.local.md'), '# Local Harness instructions\n');
    const adapter = hub.adapter('dsh');
    expect(adapter.id).toBe('deepseek-harness');
    expect(adapter.capabilities.imports).toBe(false);
    expect(adapter.cli).toBeUndefined();
    expect(adapter.instructionFile(null).filePath).toBe(path.join(home, '.dsh', 'AGENTS.md'));
    expect(adapter.instructionFile(project).filePath).toBe(path.join(project, 'AGENTS.md'));
    const items = (await hub.memories(project)).filter((i) => i.agent === 'deepseek-harness' && i.kind === 'instructions');
    expect(items.map((i) => i.filePath)).toEqual([
      path.join(home, '.dsh', 'AGENTS.md'),
      path.join(home, '.agents', 'AGENTS.md'),
      path.join(project, 'AGENTS.md'),
      path.join(project, 'CLAUDE.md'),
      path.join(project, 'AGENTS.local.md'),
      path.join(project, 'CLAUDE.local.md'),
    ]);
    // Sessions sit alongside the instructions and parse through the shared jsonl reader.
    const session = (await hub.memories(project)).find((i) => i.agent === 'deepseek-harness' && i.kind === 'session');
    expect(session?.title).toBe('Set up the release pipeline for tags');
  });

  it('marks the instruction file as the write target and leaves Qoder rules false', async () => {
    const { hub, project } = await setup();
    const items = await hub.memories(project);
    const agentsMd = items.filter((i) => i.filePath === path.join(project, 'AGENTS.md'));
    expect(agentsMd.map((i) => i.agent)).toEqual(['codex', 'pi', 'opencode', 'zcode', 'qoder', 'deepseek-harness']);
    expect(agentsMd.every((i) => i.isWriteTarget)).toBe(true);
    const rule = items.find((i) => i.agent === 'qoder' && i.filePath === path.join(project, '.qoder', 'rules', 'style.md'));
    expect(rule?.kind).toBe('instructions');
    expect(rule?.scope).toBe('project');
    expect(rule?.isWriteTarget).toBe(false);
    const local = items.find((i) => i.agent === 'qoder' && i.filePath === path.join(project, 'AGENTS.local.md'));
    expect(local?.scope).toBe('local');
    expect(local?.isWriteTarget).toBe(false);
    expect(items.filter((i) => i.kind === 'session').every((i) => i.isWriteTarget === false)).toBe(true);
  });

  it('resolves agent aliases for the extra agents', async () => {
    const { hub } = await setup();
    expect(hub.adapter('gemini-cli').id).toBe('gemini');
    expect(hub.adapter('oc').id).toBe('opencode');
  });

  it('titles sessions with the first real user prompt', async () => {
    const { hub, project } = await setup();
    const sessions = (await hub.memories(project)).filter((i) => i.kind === 'session');
    expect(sessions.map((s) => s.title).sort()).toEqual([
      'Add a dark theme toggle to the settings page',
      'Add rate limiting to the /api/upload endpoint, 10 requests per minute per user.',
      'Fix the login redirect',
      'Migrate the settings page from class components to hooks and keep the existin...',
      'Open the Qoder session',
      'Set up the release pipeline for tags',
      'Wire up the export button',
      'Write a CHANGELOG entry for v1.4 and bump the version in package.json.',
      '查看会话列表',
    ]);
  });

  it('resolves memory references by id, path and agent:path', async () => {
    const { hub, project } = await setup();
    const items = await hub.memories(project);
    const first = items[0]!;
    expect((await hub.resolveMemory(first.id, project)).id).toBe(first.id);
    expect((await hub.resolveMemory('CLAUDE.md', project)).filePath).toBe(path.join(project, 'CLAUDE.md'));
    expect((await hub.resolveMemory('pi:AGENTS.md', project)).agent).toBe('pi');
    await expect(hub.resolveMemory('nope.md', project)).rejects.toThrow(/No memory/);
  });

  it('encodes project directories like the agents do', () => {
    expect(encodeClaudeProject('/Users/me/my.app')).toBe('-Users-me-my-app');
    expect(encodePiProject('/Users/me/my.app')).toBe('--Users-me-my.app--');
  });
});

describe('session parsing', () => {
  it('normalizes Claude Code transcripts', async () => {
    const { home, project } = await setup();
    const s = await parseSessionFile('claude-code', path.join(home, '.claude', 'projects', encodeClaudeProject(project), '7f3c2a10-claude.jsonl'));
    expect(s.sessionId).toBe('7f3c2a10-claude');
    expect(s.cwd).toBe(project);
    const users = s.messages.filter((m) => m.role === 'user').map((m) => m.text);
    expect(users).toHaveLength(2);
    expect(s.messages.flatMap((m) => m.toolCalls).map((t) => t.name)).toEqual(['Read', 'Edit', 'Write', 'Bash']);
  });

  it('normalizes Codex rollouts, skipping injected context and parsing apply_patch', async () => {
    const { home } = await setup();
    const s = await parseSessionFile('codex', path.join(home, '.codex', 'sessions', '2026', '10', '22', 'rollout-2026-10-22T02-10-00-0199c1d2.jsonl'));
    expect(s.sessionId).toBe('0199c1d2-codex-session');
    expect(s.messages.filter((m) => m.role === 'user')).toHaveLength(1);
    const calls = s.messages.flatMap((m) => m.toolCalls);
    expect(calls).toContainEqual({ name: 'shell', target: "rg -n 'class Settings' src" });
    expect(calls).toContainEqual({ name: 'apply_patch', target: 'src/pages/Settings.tsx' });
  });

  it('normalizes Pi sessions', async () => {
    const { home, project } = await setup();
    const s = await parseSessionFile('pi', path.join(home, '.pi', 'agent', 'sessions', encodePiProject(project), '2026-10-22T08-00-00_pi-5e8a91.jsonl'));
    expect(s.sessionId).toBe('pi-5e8a91');
    expect(s.cwd).toBe(project);
    expect(s.messages.flatMap((m) => m.toolCalls)).toEqual([
      { name: 'read', target: 'CHANGELOG.md' },
      { name: 'edit', target: 'CHANGELOG.md' },
      { name: 'edit', target: 'package.json' },
    ]);
    expect(s.messages.at(-1)?.text).toMatch(/Not yet tagged/);
  });
});
