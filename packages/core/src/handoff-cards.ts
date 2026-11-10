import path from 'node:path';
import { fileItem } from './adapters/common.js';
import { idFor, readText, safeJson } from './fsutil.js';
import type { Hub } from './hub.js';
import type { MemoryItem } from './types.js';

/** Discover handoffs through their managed references so undo also removes cards. */
export async function handoffCards(hub: Hub, projectPath: string): Promise<MemoryItem[]> {
  const cards: MemoryItem[] = [];
  for (const target of hub.adapters) {
    const location = target.handoffTarget(projectPath, 'placeholder');
    const references = await readText(location.referenceFile);
    if (!references) continue;
    const blocks = references.matchAll(/<!-- agent-mem:begin (handoff-\S+) handoff from (\S+) ([^\n]*?) -->\r?\n([\s\S]*?)<!-- agent-mem:end \1 -->/g);
    for (const [, blockId = '', sourceAgent = '', sourceLabel = '', body = ''] of blocks) {
      const marker = /<!-- agent-mem:handoff (.*?) -->/.exec(body);
      let filename: string;
      let title: string;
      if (marker) {
        const record = safeJson(marker[1] ?? '');
        if (!record || typeof record !== 'object' || !('target' in record) || record.target !== target.id ||
            !('file' in record) || typeof record.file !== 'string' || !('title' in record) || typeof record.title !== 'string') continue;
        filename = record.file;
        title = record.title;
      } else {
        // Older releases put provenance in the block label and a link in its body.
        const sourcePath = /^~[/\\]/.test(sourceLabel) ? path.join(hub.ctx.home, sourceLabel.slice(2)) : sourceLabel;
        if (blockId !== `handoff-${idFor(sourcePath, target.id)}`) continue;
        const link = /\b(handoff-[^\s/\\`\])]+\.md)/.exec(body);
        if (!link?.[1]) continue;
        filename = link[1];
        title = /^#\s+(.+)$/m.exec(body)?.[1] ?? filename.replace(/\.md$/, '');
      }
      if (!/^handoff-[\w-]+\.md$/.test(filename)) continue;
      const filePath = path.join(path.dirname(location.docPath), filename);
      const card = await fileItem(target.id, filePath, 'project', 'handoff', projectPath, title);
      if (card) cards.push({ ...card, sourceAgent });
    }
  }
  return cards;
}
