import { marked, Renderer } from 'marked';

const escapeHtml = (source: string) =>
  source.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);

const renderer = new Renderer();
renderer.html = ({ text }) => escapeHtml(text);

export function renderMarkdown(source: string): string {
  return marked.parse(source, { async: false, gfm: true, renderer }) as string;
}
