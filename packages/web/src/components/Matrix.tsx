import { Check, ChevronDown, Link2, Plus, Table2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AgentSummary, MatrixRow, MemoryItem, ShareStrategy } from '../api';
import { useI18n } from '../i18n';
import { agentColor, AgentIcon, Button, cx, EmptyState, useTildify } from '../ui';

const STRATEGY_LABEL = {
  import: 'matrix.import',
  symlink: 'matrix.symlink',
  copy: 'matrix.copy',
} as const;

const STRATEGY_HELP = {
  import: 'matrix.importHelp',
  symlink: 'matrix.symlinkHelp',
  copy: 'matrix.copyHelp',
} as const;

function StrategyMenu({ agent, onPick, onClose }: { agent: AgentSummary; onPick: (s?: ShareStrategy) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
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
    <div ref={ref} role="menu" className="absolute top-full left-1/2 z-20 mt-1 w-64 -translate-x-1/2 rounded-lg border border-ink-600 bg-ink-850 p-1 text-left shadow-[var(--shadow-menu)]">
      {options.map((s) => (
        <button
          key={s ?? 'auto'}
          role="menuitem"
          type="button"
          autoFocus={s === undefined}
          onClick={() => onPick(s)}
          className="block w-full rounded-md px-2.5 py-1.5 text-left hover:bg-ink-700 focus:bg-ink-700 active:bg-ink-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="block text-[13px] font-medium">{t(s ? STRATEGY_LABEL[s] : 'matrix.bestAvailable')}</span>
          <span className="block text-[11px] leading-snug text-paper-mute">
            {s ? t(STRATEGY_HELP[s]) : t('matrix.bestAvailableHelp', { name: agent.displayName })}
          </span>
        </button>
      ))}
    </div>
  );
}

export function Matrix({
  agents,
  rows,
  query,
  onClearSearch,
  onShare,
  onUnshare,
  onOpen,
}: {
  agents: AgentSummary[];
  rows: MatrixRow[];
  /** Active search query, so the empty state can say why nothing matches. */
  query?: string;
  onClearSearch?: () => void;
  onShare: (item: MemoryItem, agent: string, strategy?: ShareStrategy) => void;
  onUnshare: (shareId: string) => void;
  onOpen: (item: MemoryItem) => void;
}) {
  const [menu, setMenu] = useState<string | null>(null);
  const tildify = useTildify();
  const { t } = useI18n();

  if (rows.length === 0) {
    const searching = !!query?.trim();
    return (
      <EmptyState
        icon={Table2}
        title={searching ? t('matrix.noMatches', { query: query!.trim() }) : t('matrix.empty')}
        hint={t(searching ? 'matrix.searchHint' : 'matrix.emptyHint')}
        action={searching && onClearSearch ? <Button variant="ghost" onClick={onClearSearch}>{t('common.clearSearch')}</Button> : undefined}
      />
    );
  }

  return (
    <div className="h-full overflow-auto p-3 sm:p-5">
      <p className="mb-5 max-w-[72ch] text-[13px] text-paper-dim">
        {t('matrix.intro')}
      </p>
      <table className="w-full min-w-[560px] table-fixed border-separate border-spacing-0 font-sans text-[13px] sm:min-w-[720px]">
        <thead>
          <tr className="bg-ink-900">
            <th scope="col" className="sticky left-0 z-20 w-40 border-r border-b border-ink-700 bg-ink-900 px-2 py-3 text-left text-[12px] font-medium text-paper-mute sm:w-72 sm:px-4">
              {t('matrix.memory')}
            </th>
            {agents.map((a) => (
              <th key={a.id} scope="col" className="w-36 border-b border-ink-700 px-3 py-3 text-center align-middle text-[12px] font-medium text-paper-dim">
                <span className="inline-flex max-w-full items-center justify-center gap-1.5 whitespace-nowrap">
                  <AgentIcon agent={a.id} size={14} /> {a.displayName}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.item.id} className="group/row bg-ink-950 hover:bg-ink-900">
              <th scope="row" className="sticky left-0 z-10 h-14 border-r border-b border-ink-700/70 bg-ink-950 px-2 py-2.5 text-left font-normal group-hover/row:bg-ink-900 sm:px-4">
                <button type="button" onClick={() => onOpen(r.item)} className="block max-w-full text-left hover:underline active:text-paper-dim disabled:cursor-not-allowed disabled:opacity-40">
                  <span className="block truncate font-medium">{r.item.title}</span>
                </button>
                <span className="block truncate font-mono text-[11px] text-paper-mute" title={r.item.filePath}>
                  {tildify(r.item.filePath)}
                </span>
              </th>
              {r.cells.map((c) => {
                const agent = agents.find((a) => a.id === c.agent)!;
                const key = `${r.item.id}:${c.agent}`;
                return (
                  <td key={c.agent} className="relative h-14 border-b border-ink-700/70 px-3 py-2 text-center align-middle">
                    {c.state === 'native' && (
                      <span className="inline-flex size-7 items-center justify-center rounded-md" style={{ background: agentColor(c.agent) }} title={t('matrix.nativeTitle', { name: agent.displayName })}>
                        <Check className="size-4 text-ink-950" strokeWidth={3} />
                        <span className="sr-only">{t('matrix.readsNatively')}</span>
                      </span>
                    )}
                    {c.state === 'shared' && (
                      <button
                        type="button"
                        onClick={() => onUnshare(c.shareId!)}
                        title={t('matrix.sharedVia', { strategy: t(STRATEGY_LABEL[c.strategy!]) })}
                        className="group hit-target inline-flex min-h-8 flex-col items-center justify-center gap-0.5 rounded-md px-1.5 py-0.5 hover:bg-ink-800 active:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <span className="inline-flex size-6 items-center justify-center rounded-md border-2" style={{ borderColor: agentColor(c.agent) }}>
                          {c.strategy === 'symlink' ? <Link2 className="size-3.5" /> : <Check className="size-3.5" strokeWidth={3} style={{ color: agentColor(c.agent) }} />}
                        </span>
                        <span className="text-[11px] leading-4 text-paper-mute group-hover:text-danger">{t(STRATEGY_LABEL[c.strategy!])}</span>
                      </button>
                    )}
                    {c.state === 'available' && (
                      <>
                        <button
                          type="button"
                          aria-haspopup="menu"
                          aria-expanded={menu === key}
                          aria-label={t('matrix.shareWith', { name: agent.displayName })}
                          onClick={() => setMenu(menu === key ? null : key)}
                          className="hit-target inline-flex h-8 min-w-12 items-center justify-center gap-1 rounded-md border border-dashed border-ink-600 px-2 text-paper-mute hover:border-ink-500 hover:bg-ink-800 hover:text-paper active:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-40"
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
      <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-1 border-t border-ink-700/70 pt-4 text-[12px] text-paper-mute">
        {(['import', 'symlink', 'copy'] as const).map((s) => (
          <div key={s} className={cx('flex gap-1.5')}>
            <dt className="font-medium text-paper-dim">{t(STRATEGY_LABEL[s])}</dt>
            <dd>{t(STRATEGY_HELP[s])}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
