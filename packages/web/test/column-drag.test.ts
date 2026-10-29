import { describe, expect, it } from 'vitest';
import { shouldMoveColumn } from '../src/ui';

describe('column drag completion', () => {
  it('does not repeat the live swap that moved the second column to first', () => {
    const active = 'codex';
    const over = 'claude-code';

    expect(shouldMoveColumn(active, over, { active, over })).toBe(false);
  });

  it('still completes a drop on a different column', () => {
    expect(shouldMoveColumn('codex', 'pi', { active: 'codex', over: 'claude-code' })).toBe(true);
  });
});
