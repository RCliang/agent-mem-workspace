import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPlan, findSkill, listSkills, planSkillDelete, planSkillTransfer, skillLibraries, undoBackup } from '@agent-mem/core';
import { read, setup } from './helpers.js';

describe('skills discovery', () => {
  it('lists skills per library with shared markers and parsed descriptions', async () => {
    const { hub, project } = await setup();
    const skills = await listSkills(hub, project);
    const summary = skills.map((s) => `${s.agent}|${s.scope}|${s.name}|${s.shared ? 'shared' : 'own'}`).sort();
    expect(summary).toEqual([
      'claude-code|global|browse|own',
      'claude-code|project|shop-helper|own',
      'codex|global|browse|own',
      'shared|global|agent-reach|shared',
      'shared|project|akshare|shared',
    ]);
    const browse = skills.find((s) => s.agent === 'claude-code' && s.name === 'browse')!;
    expect(browse.description).toMatch(/Fast headless browser for QA testing/);
    expect(browse.fileCount).toBe(2);
    expect(browse.sizeBytes).toBeGreaterThan(100);
  });

  it('only lists globals when no project is given', async () => {
    const { hub } = await setup();
    const skills = await listSkills(hub, null);
    expect(skills.map((s) => s.name).sort()).toEqual(['agent-reach', 'browse', 'browse']);
  });

  it('exposes the library columns including shared', async () => {
    const { hub } = await setup();
    const libs = await skillLibraries(hub);
    expect(libs.map((l) => l.id)).toContain('claude-code');
    expect(libs.map((l) => l.id)).toContain('shared');
  });

  it('resolves skills by name and disambiguates with agent:name', async () => {
    const { hub, project } = await setup();
    expect((await findSkill(hub, 'agent-reach', project)).agent).toBe('shared');
    expect((await findSkill(hub, 'codex:browse', project)).agent).toBe('codex');
    await expect(findSkill(hub, 'browse', project)).rejects.toThrow(/exists in 2 libraries/);
    await expect(findSkill(hub, 'nope', project)).rejects.toThrow(/No skill matches/);
  });
});

describe('skill transfer and delete', () => {
  it('copies a skill folder, nested files included, and repeats as overwrite', async () => {
    const { hub, project } = await setup();
    const browse = await findSkill(hub, 'claude-code:browse', project);
    const plan = await planSkillTransfer(hub, browse, 'pi');
    expect(plan.kind).toBe('skill-transfer');
    await applyPlan(hub.ctx, plan);
    const dest = path.join(hub.ctx.home, '.pi', 'agent', 'skills', 'browse');
    expect(read(path.join(dest, 'SKILL.md'))).toMatch(/headless browser/);
    expect(fs.existsSync(path.join(dest, 'references', 'commands.md'))).toBe(true);
    expect(fs.existsSync(browse.dirPath)).toBe(true); // copy leaves the source

    await expect(planSkillTransfer(hub, browse, 'pi')).rejects.toThrow(/already has a skill named/);
    await applyPlan(hub.ctx, await planSkillTransfer(hub, browse, 'pi', { overwrite: true }));
    expect(fs.existsSync(path.join(dest, 'references', 'commands.md'))).toBe(true);
  });

  it('moves a skill away from a shared library with a warning, and undo restores it', async () => {
    const { hub, project } = await setup();
    const reach = await findSkill(hub, 'agent-reach', project);
    const plan = await planSkillTransfer(hub, reach, 'zcode', { move: true });
    expect(plan.notes.join(' ')).toMatch(/shared \.agents library/);
    const res = await applyPlan(hub.ctx, plan);
    expect(fs.existsSync(path.join(hub.ctx.home, '.zcode', 'skills', 'agent-reach', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(reach.dirPath)).toBe(false);

    await undoBackup(hub.ctx, res.backups.at(-1)!.id);
    expect(read(path.join(reach.dirPath, 'SKILL.md'))).toMatch(/MUST USE/);
    expect(fs.existsSync(path.join(reach.dirPath, 'references', 'engines.md'))).toBe(true);
  });

  it('deletes with a full-folder backup and shared caution note', async () => {
    const { hub, project } = await setup();
    const akshare = await findSkill(hub, 'akshare', project);
    const plan = await planSkillDelete(hub, akshare);
    expect(plan.notes.join(' ')).toMatch(/shared \.agents library/);
    const res = await applyPlan(hub.ctx, plan);
    expect(fs.existsSync(akshare.dirPath)).toBe(false);
    await undoBackup(hub.ctx, res.backups[0]!.id);
    expect(read(path.join(akshare.dirPath, 'SKILL.md'))).toMatch(/akshare/);
  });

  it('refuses a transfer that would change nothing and detects on-disk drift', async () => {
    const { hub, project } = await setup();
    const browse = await findSkill(hub, 'claude-code:browse', project);
    await expect(planSkillTransfer(hub, browse, 'claude-code')).rejects.toThrow(/same/);

    const reach = await findSkill(hub, 'agent-reach', project);
    const plan = await planSkillTransfer(hub, reach, 'codex');
    fs.rmSync(reach.dirPath, { recursive: true });
    await expect(applyPlan(hub.ctx, plan)).rejects.toThrow(/changed on disk/i);
  });
});
