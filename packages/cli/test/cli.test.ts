import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { run, type Io } from '@agent-mem/cli';
import { encodeClaudeProject, writeState } from '@agent-mem/core';
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
    const prevMode = process.env.AGENT_MEM_LLM_MODE;
    const prevKey = process.env.AGENT_MEM_LLM_API_KEY;
    process.env.AGENT_MEM_LLM_MODE = 'api';
    delete process.env.AGENT_MEM_LLM_API_KEY;
    const cap = capture();
    try {
      expect(await run(['handoff', '--from', 'codex', '--to', 'claude', '-p', project, '--yes'], cap.io)).toBe(0);
      const doc = path.join(home, '.claude', 'projects', encodeClaudeProject(project), 'memory', 'handoff-codex-0199c1d2-cod.md');
      expect(read(doc)).toContain('# Handoff: shop-api (from Codex)');
      expect(read(path.join(path.dirname(doc), 'MEMORY.md'))).toContain('handoff-codex-0199c1d2-cod.md');
    } finally {
      if (prevMode === undefined) delete process.env.AGENT_MEM_LLM_MODE;
      else process.env.AGENT_MEM_LLM_MODE = prevMode;
      if (prevKey === undefined) delete process.env.AGENT_MEM_LLM_API_KEY;
      else process.env.AGENT_MEM_LLM_API_KEY = prevKey;
    }
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

  it('lists agents with detection status', async () => {
    await withHome();
    const cap = capture();
    expect(await run(['agents'], cap.io)).toBe(0);
    const out = cap.text().out;
    expect(out).toContain('claude-code');
    expect(out).toContain('gemini');
    expect(out).toMatch(/cursor\s+installed/);
    expect(out).toContain('@imports');

    const json = capture();
    expect(await run(['agents', '--json'], json.io)).toBe(0);
    const parsed = JSON.parse(json.text().out) as { id: string; detected: boolean }[];
    expect(parsed.map((a) => a.id)).toEqual(['claude-code', 'codex', 'pi', 'gemini', 'cursor', 'opencode']);
    expect(parsed.every((a) => a.detected)).toBe(true);
  });

  it('searches memories across agents with line numbers', async () => {
    const { project } = await withHome();
    const cap = capture();
    expect(await run(['search', 'pnpm', '-p', project], cap.io)).toBe(0);
    const out = cap.text().out;
    expect(out).toMatch(/memories mention "pnpm"/);
    expect(out).toContain('L3: - Prefer pnpm over npm.');
    expect(out).toContain('claude-code');

    const none = capture();
    expect(await run(['search', 'there-is-no-such-text', '-p', project], none.io)).toBe(0);
    expect(none.text().out).toMatch(/No memories/);

    const json = capture();
    expect(await run(['search', 'pnpm', '-p', project, '--json'], json.io)).toBe(0);
    const parsed = JSON.parse(json.text().out) as { agent: string; lines: { no: number }[] }[];
    expect(parsed.length).toBeGreaterThanOrEqual(4);
    expect(parsed.every((h) => h.lines.length > 0)).toBe(true);
    expect(new Set(parsed.map((h) => h.agent)).size).toBeGreaterThanOrEqual(3);
  });

  it('doctor reports a healthy setup and flags orphan shares', async () => {
    const env = await withHome();
    const ok = capture();
    expect(await run(['doctor'], ok.io)).toBe(0);
    expect(ok.text().out).toContain('gemini');
    expect(ok.text().out).toContain('No problems found.');

    await writeState(env.ctx, 'shares.json', [
      {
        id: 'orphan',
        projectPath: env.project,
        sourceAgent: 'codex',
        sourcePath: path.join(env.project, 'gone.md'),
        targetAgent: 'claude-code',
        targetPath: path.join(env.project, 'CLAUDE.md'),
        strategy: 'copy',
        createdAt: new Date().toISOString(),
      },
    ]);
    const bad = capture();
    expect(await run(['doctor'], bad.io)).toBe(1);
    expect(bad.text().out).toContain('source missing');

    const json = capture();
    expect(await run(['doctor', '--json'], json.io)).toBe(1);
    const report = JSON.parse(json.text().out) as { problems: string[]; shareIssues: string[] };
    expect(report.problems.length + report.shareIssues.length).toBeGreaterThan(0);
  });

  it('adds, lists and removes a custom agent', async () => {
    const env = await withHome();
    const home = path.join(env.home, '.deepseek');
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'AGENTS.md'), '# DeepSeek rules\n');

    const add = capture();
    expect(await run(['agents', 'add', 'deepseek', '--display', 'DeepSeek harness', '--home', '~/.deepseek', '--project-file', 'AGENTS.md'], add.io)).toBe(0);
    expect(add.text().out).toContain('Added agent "deepseek"');

    const list = capture();
    expect(await run(['agents'], list.io)).toBe(0);
    expect(list.text().out).toContain('deepseek');
    expect(list.text().out).toContain('DeepSeek harness');

    const memories = capture();
    await run(['ls', '--json', '-p', env.project], memories.io);
    const json = JSON.parse(memories.text().out) as { memories: { agent: string }[] };
    expect(json.memories.some((m) => m.agent === 'deepseek')).toBe(true);

    expect(await run(['agents', 'remove', 'deepseek'], capture().io)).toBe(0);
    const builtin = capture();
    expect(await run(['agents', 'remove', 'codex'], builtin.io)).toBe(1);
    expect(builtin.text().err).toContain('built in');
  });

  it('cleans orphan backup snapshots', async () => {
    const env = await withHome();
    // Produce a real backup: its snapshot file is still referenced by the journal.
    const tmp = path.join(env.root, 'new-content.md');
    fs.writeFileSync(tmp, '# replaced\n');
    expect(await run(['edit', 'claude:CLAUDE.md', '-p', env.project, '--file', tmp], capture().io)).toBe(0);
    const files = path.join(env.dataDir, 'backups', 'files');
    expect(fs.readdirSync(files)).toHaveLength(1);

    const none = capture();
    expect(await run(['clean'], none.io)).toBe(0);
    expect(none.text().out).toContain('Nothing to clean');

    // Drop the journal entry: the snapshot becomes an orphan doctor warns about.
    const { writeState } = await import('@agent-mem/core');
    await writeState(env.ctx, 'backups/journal.json', []);
    const doctor = capture();
    expect(await run(['doctor'], doctor.io)).toBe(1);
    expect(doctor.text().out).toContain('orphan backup');

    const clean = capture();
    expect(await run(['clean', '--yes'], clean.io)).toBe(0);
    expect(clean.text().out).toContain('Deleted 1 file');
    expect(fs.readdirSync(files)).toHaveLength(0);
    expect(await run(['doctor'], capture().io)).toBe(0);
  });

  it('exports a project bundle and imports it into another directory', async () => {
    const env = await withHome();
    const bundleFile = path.join(env.root, 'bundle.json');
    const cap = capture();
    expect(await run(['export', '-p', env.project, '-o', bundleFile], cap.io)).toBe(0);
    expect(cap.text().out).toContain('Wrote');
    const bundle = JSON.parse(fs.readFileSync(bundleFile, 'utf8')) as { items: { relPath: string }[] };
    expect(bundle.items.some((i) => i.relPath === 'CLAUDE.md')).toBe(true);

    const target = path.join(env.root, 'work', 'migrated');
    fs.mkdirSync(target, { recursive: true });
    const imp = capture();
    expect(await run(['import', bundleFile, '-p', target, '--yes'], imp.io)).toBe(0);
    expect(fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8')).toBe(fs.readFileSync(path.join(env.project, 'CLAUDE.md'), 'utf8'));
    expect(fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8')).toContain('shop-api agent guide');
  });

  it('fails clearly for an unknown memory', async () => {
    const { project } = await withHome();
    const cap = capture();
    expect(await run(['link', 'nope.md', '--to', 'pi', '-p', project, '--yes'], cap.io)).toBe(1);
    expect(cap.text().err).toMatch(/No memory/);
  });
});
