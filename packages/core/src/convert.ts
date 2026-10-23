import path from 'node:path';
import { stripBlocks } from './blocks.js';
import { expandHome, type Context } from './context.js';
import { readText } from './fsutil.js';
import type { AgentAdapter, MemoryItem } from './types.js';

const IMPORT_LINE = /^[ \t]*@((?:~\/|\.{1,2}\/|\/)?[\w./~-]+)[ \t]*$/gm;
const MAX_IMPORT_DEPTH = 5;

/**
 * Inline Claude-style `@path` imports (one per line) for agents that cannot follow them.
 * Imports inside fenced code blocks are left alone.
 */
export async function resolveImports(ctx: Context, content: string, baseDir: string, depth = 0, seen = new Set<string>()): Promise<string> {
  if (depth >= MAX_IMPORT_DEPTH) return content;
  const segments = content.split(/(^```[\s\S]*?^```[ \t]*$)/m);
  const out: string[] = [];
  for (const seg of segments) {
    if (seg.startsWith('```')) {
      out.push(seg);
      continue;
    }
    let result = '';
    let last = 0;
    for (const m of seg.matchAll(IMPORT_LINE)) {
      const ref = m[1]!;
      const abs = path.resolve(baseDir, expandHome(ctx, ref));
      const text = seen.has(abs) ? null : await readText(abs);
      result += seg.slice(last, m.index);
      if (text == null) {
        result += m[0];
      } else {
        const inner = await resolveImports(ctx, stripBlocks(text), path.dirname(abs), depth + 1, new Set([...seen, abs]));
        result += `<!-- imported from ${ref} -->\n${inner.trim()}`;
      }
      last = m.index! + m[0].length;
    }
    out.push(result + seg.slice(last));
  }
  return out.join('');
}

/** Produce the text `target` should read in place of `item`. */
export async function convertForTarget(ctx: Context, item: MemoryItem, target: AgentAdapter): Promise<string> {
  let content = stripBlocks(item.content);
  if (!target.capabilities.imports) content = await resolveImports(ctx, content, path.dirname(item.filePath));
  return target.renderFor([{ agent: item.agent, filePath: item.filePath, title: item.title, content }]);
}
