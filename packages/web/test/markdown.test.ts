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
});
