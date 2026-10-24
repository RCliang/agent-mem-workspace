import { Check, ChevronDown, Link2, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AgentSummary, MatrixRow, MemoryItem, ShareStrategy } from '../api';
import { AgentDot, agentColor, cx, useTildify } from '../ui';

const STRATEGY_HELP: Record<ShareStrategy, string> = {
  import: 'Add an @import line. Stays in sync, Claude Code only.',
  symlink: 'Make the target file a symlink. Only when the target file does not exist.',
  copy: 'Write a synced copy into a managed block. Works for every agent.',
};

function StrategyMenu({ agent, onPick, onClose }: { agent: AgentSummary; onPick: (s?: ShareStrategy) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  const options: (ShareStrategy | undefined)[] = [undefined, ...(agent.capabilities.imports ? (['import'] as const) : []), 'symlink', 'copy'];
  return (
    <div ref={ref} role="menu" className="absolute top-full left-1/2 z-20 mt-1 w-64 -translate-x-1/2 rounded-lg border border-ink-600 bg-ink-850 p-1 text-left shadow-[0_16px_40px_-10px_rgba(0,0,0,0.7)]">
      {options.map((s) => (
        <button
          key={s ?? 'auto'}
          role="menuitem"
          type="button"
          autoFocus={s === undefined}
          onClick={() => onPick(s)}
          className="block w-full rounded-md px-2.5 py-1.5 text-left hover:bg-ink-700 focus:bg-ink-700 focus:outline-none"
        >
          <span className="block text-[13px] font-medium">{s ? s[0]!.toUpperCase() + s.slice(1) : 'Best available'}</span>
          <span className="block text-[11px] leading-snug text-paper-mute">{s ? STRATEGY_HELP[s] : `Picks import, symlink or copy for ${agent.displayName}.`}</span>
        </button>
      ))}
    </div>
  );
}

export function Matrix({
  agents,
  rows,
  onShare,
  onUnshare,
  onOpen,
}: {
  agents: AgentSummary[];
  rows: MatrixRow[];
  onShare: (item: MemoryItem, agent: string, strategy?: ShareStrategy) => void;
  onUnshare: (shareId: string) => void;
  onOpen: (item: MemoryItem) => void;
}) {
  const [menu, setMenu] = useState<string | null>(null);
  const tildify = useTildify();

  if (rows.length === 0) return <p className="p-8 text-[13px] text-paper-mute">No memory files here yet. Create one from the board first.</p>;

  return (
    <div className="h-full overflow-auto p-5">
      <p className="mb-4 max-w-[72ch] text-[13px] text-paper-dim">
        Each row is a memory file, each column an agent. A filled check means the agent already reads the file. Click an empty cell to share the file with that agent; click a shared cell to stop sharing.
      </p>
      <table className="w-full min-w-[720px] border-separate border-spacing-0 overflow-hidden rounded-xl border border-ink-700 text-[13px]">
        <thead>
          <tr className="bg-ink-900">
            <th scope="col" className="border-b border-ink-700 px-4 py-2.5 text-left text-[12px] font-medium text-paper-mute">
              Memory
            </th>
            {agents.map((a) => (
              <th key={a.id} scope="col" className="w-36 border-b border-l border-ink-700 px-3 py-2.5 text-center text-[12px] font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <AgentDot agent={a.id} /> {a.displayName}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.item.id} className="bg-ink-950 hover:bg-ink-900/70">
              <th scope="row" className="border-b border-ink-700/70 px-4 py-2.5 text-left font-normal">
                <button type="button" onClick={() => onOpen(r.item)} className="block max-w-full text-left hover:underline">
                  <span className="block truncate font-medium">{r.item.title}</span>
                </button>
                <span className="block truncate font-mono text-[11px] text-paper-mute">{tildify(r.item.filePath)}</span>
              </th>
              {r.cells.map((c) => {
                const agent = agents.find((a) => a.id === c.agent)!;
                const key = `${r.item.id}:${c.agent}`;
                return (
                  <td key={c.agent} className="relative border-b border-l border-ink-700/70 px-3 py-2.5 text-center">
                    {c.state === 'native' && (
                      <span className="inline-flex size-6 items-center justify-center rounded-md" style={{ background: agentColor(c.agent) }} title={`${agent.displayName} reads this file natively`}>
                        <Check className="size-4 text-ink-950" strokeWidth={3} />
                        <span className="sr-only">reads natively</span>
                      </span>
                    )}
                    {c.state === 'shared' && (
                      <button
                        type="button"
                        onClick={() => onUnshare(c.shareId!)}
                        title={`Shared via ${c.strategy}. Click to stop sharing.`}
                        className="group inline-flex flex-col items-center gap-0.5"
                      >
                        <span className="inline-flex size-6 items-center justify-center rounded-md border-2" style={{ borderColor: agentColor(c.agent) }}>
                          {c.strategy === 'symlink' ? <Link2 className="size-3.5" /> : <Check className="size-3.5" strokeWidth={3} style={{ color: agentColor(c.agent) }} />}
                        </span>
                        <span className="text-[11px] text-paper-mute group-hover:text-danger">{c.strategy}</span>
                      </button>
                    )}
                    {c.state === 'available' && (
                      <>
                        <button
                          type="button"
                          aria-haspopup="menu"
                          aria-expanded={menu === key}
                          aria-label={`Share with ${agent.displayName}`}
                          onClick={() => setMenu(menu === key ? null : key)}
                          className="inline-flex h-6 items-center gap-0.5 rounded-md border border-dashed border-ink-600 px-1.5 text-paper-mute hover:border-ink-500 hover:text-paper"
                        >
                          <Plus className="size-3.5" />
                          <ChevronDown className="size-3" />
                        </button>
                        {menu === key && (
                          <StrategyMenu
                            agent={agent}
                            onClose={() => setMenu(null)}
                            onPick={(s) => {
                              setMenu(null);
                              onShare(r.item, c.agent, s);
                            }}
                          />
                        )}
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-paper-mute">
        {(['import', 'symlink', 'copy'] as const).map((s) => (
          <div key={s} className={cx('flex gap-1.5')}>
            <dt className="font-medium text-paper-dim">{s}</dt>
            <dd>{STRATEGY_HELP[s]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
