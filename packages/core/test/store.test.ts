import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConflictError, listBackups, safeWrite, sha, undoBackup } from '@agent-mem/core';
import { read, setup } from './helpers.js';

describe('safeWrite and backups', () => {
  it('writes with a matching hash and can undo', async () => {
    const { ctx, project } = await setup();
    const file = path.join(project, 'AGENTS.md');
    const original = read(file);
    await safeWrite(ctx, file, 'changed\n', { expectedHash: sha(original), reason: 'test' });
    expect(read(file)).toBe('changed\n');
    const [entry] = await listBackups(ctx);
    expect(entry?.filePath).toBe(file);
    await undoBackup(ctx);
    expect(read(file)).toBe(original);
    await expect(undoBackup(ctx, entry!.id)).rejects.toThrow(/already restored/);
  });

  it('rejects writes when the file changed since it was read', async () => {
    const { ctx, project } = await setup();
    const file = path.join(project, 'AGENTS.md');
    const stale = sha(read(file));
    fs.appendFileSync(file, 'agent wrote this\n');
    await expect(safeWrite(ctx, file, 'x', { expectedHash: stale, reason: 'test' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('undo deletes files that did not exist before', async () => {
    const { ctx, project } = await setup();
    const file = path.join(project, 'NEW.md');
    await safeWrite(ctx, file, 'hi', { expectedHash: null, reason: 'create' });
    expect(fs.existsSync(file)).toBe(true);
    await undoBackup(ctx);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('writes through symlinks to their target', async () => {
    const { ctx, project } = await setup();
    const link = path.join(project, 'LINK.md');
    fs.symlinkSync('AGENTS.md', link);
    await safeWrite(ctx, link, 'via link\n', { reason: 'test' });
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(read(path.join(project, 'AGENTS.md'))).toBe('via link\n');
  });
});
