import { describe, expect, it } from 'vitest';
import { readBlock, redact, removeBlock, stripBlocks, upsertBlock } from '@agent-mem/core';

describe('managed blocks', () => {
  it('appends, replaces and removes a block without touching user text', () => {
    const a = upsertBlock('# Mine\n\nhello\n', 'b1', 'from x', 'one');
    expect(a).toBe('# Mine\n\nhello\n\n<!-- agent-mem:begin b1 from x -->\none\n<!-- agent-mem:end b1 -->\n');
    const b = upsertBlock(a, 'b1', 'from x', 'two');
    expect(readBlock(b, 'b1')).toBe('two');
    expect(b.match(/agent-mem:begin/g)).toHaveLength(1);
    expect(removeBlock(b, 'b1')).toBe('# Mine\n\nhello\n');
  });

  it('creates a file body when there was no file', () => {
    expect(upsertBlock(null, 'b', 'l', 'x')).toBe('<!-- agent-mem:begin b l -->\nx\n<!-- agent-mem:end b -->\n');
  });

  it('strips every managed block', () => {
    const t = upsertBlock(upsertBlock('top\n', 'a', 'l', 'A'), 'b', 'l', 'B') + '\nbottom\n';
    expect(stripBlocks(t)).toBe('top\n\nbottom');
  });

  it('keeps labels from closing the HTML comment early', () => {
    expect(upsertBlock(null, 'b', 'evil --> label', 'x')).toContain('evil - -> label -->');
  });
});

describe('redact', () => {
  it('masks common credential formats and counts them', () => {
    const input = [
      'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456',
      'token ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'aws AKIAIOSFODNN7EXAMPLE',
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz.1234',
      'postgres://admin:s3cretpass@db:5432/app',
      'REDIS_PASSWORD=hunter2hunter2',
    ].join('\n');
    const { text, findings } = redact(input);
    expect(text).not.toMatch(/abcdefghijklmnopqrstuvwxyz123456|hunter2|s3cretpass|IOSFODNN7/);
    expect(text).toContain('postgres://admin:[REDACTED]@db');
    expect(findings.map((f) => f.type).sort()).toEqual(
      ['aws-access-key', 'bearer-token', 'github-token', 'openai-key', 'secret-assignment', 'url-credentials'].sort(),
    );
  });

  it('leaves ordinary prose alone', () => {
    const s = 'Use the token bucket algorithm; password resets go through /reset.';
    expect(redact(s)).toEqual({ text: s, findings: [] });
  });
});
