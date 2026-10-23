/**
 * Managed blocks let agent-mem own a region of a file that the user also edits by hand:
 *
 *   <!-- agent-mem:begin <id> <label> -->
 *   ...
 *   <!-- agent-mem:end <id> -->
 */
const BEGIN = (id: string) => new RegExp(`<!-- agent-mem:begin ${escape(id)}(?: [^\\n]*)? -->`);
const END = (id: string) => `<!-- agent-mem:end ${id} -->`;
const ANY_BLOCK = /\n?<!-- agent-mem:begin (\S+)[^\n]* -->\n[\s\S]*?<!-- agent-mem:end \1 -->\n?/g;

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeLabel(label: string) {
  return label.replace(/-->/g, '- ->').replace(/\n/g, ' ');
}

export function hasBlock(text: string, id: string): boolean {
  return BEGIN(id).test(text);
}

export function readBlock(text: string, id: string): string | null {
  const begin = BEGIN(id).exec(text);
  if (!begin) return null;
  const start = begin.index + begin[0].length + 1;
  const end = text.indexOf(END(id), start);
  if (end < 0) return null;
  return text.slice(start, end).replace(/\n$/, '');
}

export function upsertBlock(text: string | null, id: string, label: string, body: string): string {
  const block = `<!-- agent-mem:begin ${id} ${sanitizeLabel(label)} -->\n${body.trim()}\n${END(id)}`;
  const src = text ?? '';
  const begin = BEGIN(id).exec(src);
  if (begin) {
    const endIdx = src.indexOf(END(id), begin.index);
    if (endIdx >= 0) return src.slice(0, begin.index) + block + src.slice(endIdx + END(id).length);
  }
  if (!src.trim()) return `${block}\n`;
  return `${src.replace(/\s*$/, '')}\n\n${block}\n`;
}

export function removeBlock(text: string, id: string): string {
  const begin = BEGIN(id).exec(text);
  if (!begin) return text;
  const endIdx = text.indexOf(END(id), begin.index);
  if (endIdx < 0) return text;
  const before = text.slice(0, begin.index).replace(/\n+$/, '');
  const after = text.slice(endIdx + END(id).length).replace(/^\n+/, '');
  if (!before) return after;
  if (!after) return `${before}\n`;
  return `${before}\n\n${after}`;
}

/** Remove every managed block so copied content never re-copies other agents' blocks. */
export function stripBlocks(text: string): string {
  return text.replace(ANY_BLOCK, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
