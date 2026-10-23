import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { run, type Io } from '@agent-mem/cli';
import { encodeClaudeProject } from '@agent-mem/core';
import { read, setup } from '../../core/test/helpers.js';

function capture() {
  let out = '';
  let err = '';
  const io: Io = {
    stdout: (s) => {
      out += s;
    },
    stderr: (s) => {
      err += s;
    },
  };
  return { io, text: () => ({ out, err }) };
}

async function withHome() {
  const env = await setup();
  process.env.AGENT_MEM_HOME = env.home;
  process.env.AGENT_MEM_DATA_DIR = env.dataDir;
  return env;
}

afterEach(() => {
  delete process.env.AGENT_MEM_HOME;
  delete process.env.AGENT_MEM_DATA_DIR;
});

describe('agent-mem cli', () => {
  it('prints help', async () => {
    const cap = capture();
    expect(await run(['--help'], cap.io)).toBe(0);
    expect(cap.text().out).toContain('handoff');
    expect(cap.text().out).toContain('link');
  });

  it('lists projects as json', async () => {
    const { project } = await withHome();
    const cap = capture();
    expect(await run(['ls', '--json'], cap.io)).toBe(0);
    const json = JSON.parse(cap.text().out) as { projects: { path: string }[] };
    expect(json.projects.some((p) => p.path === project)).toBe(true);
  });

  it('previews a link without writing, then applies it with --yes', async () => {
    const { project } = await withHome();
    const claudeMd = path.join(project, 'CLAUDE.md');
    const before = read(claudeMd);
    const preview = capture();
    expect(await run(['link', 'codex:AGENTS.md', '--to', 'claude', '-p', project], preview.io)).toBe(2);
    expect(preview.text().err).toMatch(/--yes/);
    expect(preview.text().out).toContain('@AGENTS.md');
    expect(read(claudeMd)).toBe(before);

    const apply = capture();
    expect(await run(['link', 'codex:AGENTS.md', '--to', 'claude', '-p', project, '--yes'], apply.io)).toBe(0);
    expect(read(claudeMd)).toContain('@AGENTS.md');
    expect(read(claudeMd).startsWith('# shop-api')).toBe(true);

    const shares = capture();
    expect(await run(['shares'], shares.io)).toBe(0);
    expect(shares.text().out).toContain('import');
  });

  it('edits a file, syncs copies, and undoes the edit', async () => {
    const { project, home } = await withHome();
    expect(await run(['link', `claude:${path.join(project, 'CLAUDE.md')}`, '--to', 'codex', '-p', project, '--yes'], capture().io)).toBe(0);

    const file = path.join(os.tmpdir(), `agent-mem-edit-${process.pid}.md`);
    fs.writeFileSync(file, '# shop-api\n\n- edited from the cli\n');
    const cap = capture();
    expect(await run(['edit', 'claude:CLAUDE.md', '-p', project, '--file', file], cap.io)).toBe(0);
    const backupId = /backup ([^)\s]+)/.exec(cap.text().out)?.[1];
    expect(backupId).toBeTruthy();
    expect(read(path.join(project, 'AGENTS.md'))).toContain('edited from the cli');

    expect(await run(['undo', backupId!], capture().io)).toBe(0);
    expect(read(path.join(project, 'CLAUDE.md'))).not.toContain('edited from the cli');
    expect(read(path.join(project, 'AGENTS.md'))).not.toContain('edited from the cli');
    expect(home).toBeTruthy();
  });

  it('hands a codex session off to claude code', async () => {
    const { project, home } = await withHome();
    const cap = capture();
    expect(await run(['handoff', '--from', 'codex', '--to', 'claude', '-p', project, '--yes'], cap.io)).toBe(0);
    const doc = path.join(home, '.claude', 'projects', encodeClaudeProject(project), 'memory', 'handoff-codex-0199c1d2-cod.md');
    expect(read(doc)).toContain('# Handoff: shop-api (from Codex)');
    expect(read(path.join(path.dirname(doc), 'MEMORY.md'))).toContain('handoff-codex-0199c1d2-cod.md');
  });

  it('adds a project folder', async () => {
    const { root } = await withHome();
    const extra = path.join(root, 'work', 'manual');
    fs.mkdirSync(extra, { recursive: true });
    expect(await run(['projects', 'add', extra], capture().io)).toBe(0);
    const cap = capture();
    await run(['ls', '--json'], cap.io);
    expect(JSON.parse(cap.text().out).projects.some((p: { path: string }) => p.path === extra)).toBe(true);
  });

  it('fails clearly for an unknown memory', async () => {
    const { project } = await withHome();
    const cap = capture();
    expect(await run(['link', 'nope.md', '--to', 'pi', '-p', project, '--yes'], cap.io)).toBe(1);
    expect(cap.text().err).toMatch(/No memory/);
  });
});
