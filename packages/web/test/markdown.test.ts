import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/markdown.js';

describe('renderMarkdown', () => {
  it('renders the draft and escapes raw html', () => {
    const html = renderMarkdown('# Title\n\n<script>alert(1)</script>\n\n- one');
    expect(html).toContain('<h1');
    expect(html).toContain('Title');
    expect(html).toContain('<li');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders tables and quotes from a handoff', () => {
    const html = renderMarkdown('> note\n\n| 档位 | 效果 |\n| --- | --- |\n| low | 快 |');
    expect(html).toContain('<blockquote');
    expect(html).toContain('<table');
    expect(html).toContain('<td');
  });
});
