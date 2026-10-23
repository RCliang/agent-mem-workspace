import { upsertBlock } from './blocks.js';
import { tildify } from './context.js';
import { convertForTarget } from './convert.js';
import { idFor, readText } from './fsutil.js';
import { planHandoff, type HandoffOptions } from './handoff.js';
import type { Hub } from './hub.js';
import { plannedWrite, type Plan } from './plan.js';
import { redact } from './redact.js';
import { targetFileFor } from './share.js';
import type { AgentId, MemoryItem } from './types.js';

/**
 * What happens when a card is dragged onto another agent's column:
 * instruction files become a one-time converted copy, sessions become a handoff document.
 */
export async function planTransfer(hub: Hub, item: MemoryItem, targetAgent: AgentId, opts: HandoffOptions = {}): Promise<Plan> {
  if (item.kind === 'session') return planHandoff(hub, item, targetAgent, opts);
  const target = hub.adapter(targetAgent);
  if (item.agent === target.id) throw new Error('Source and target agent are the same');
  if (item.alsoReadBy.includes(target.id)) throw new Error(`${target.displayName} already reads this file natively`);

  const targetPath = targetFileFor(target, item);
  const body = await convertForTarget(hub.ctx, item, target);
  const label = `transferred from ${item.agent} ${tildify(hub.ctx, item.filePath)} on ${new Date().toISOString().slice(0, 10)}`;
  // Stable id: dragging the same memory again refreshes the block instead of duplicating it.
  const blockId = `xfer-${idFor(item.filePath, target.id)}`;
  const write = await plannedWrite(targetPath, upsertBlock(await readText(targetPath), blockId, label, body));
  const findings = redact(body).findings;
  return {
    kind: 'transfer',
    title: `Copy ${item.title} to ${target.displayName}`,
    writes: [write],
    notes: [
      `One-time copy into ${tildify(hub.ctx, targetPath)}. Use the share matrix instead if you want it to stay in sync.`,
      ...(findings.length ? ['The content looks like it contains secrets; review before applying.'] : []),
    ],
    findings,
  };
}
