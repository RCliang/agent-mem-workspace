import { ArrowRightLeft, Wrench, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type AgentSummary, type MemoryItem, type ParsedSession } from '../api';
import { renderMarkdown } from '../markdown';
import { AgentDot, cx, useTildify } from '../ui';

export function SessionDrawer({
  item,
  project,
  agents,
  onClose,
  onHandoff,
  className,
}: {
  item: MemoryItem;
  project: string | null;
  agents: AgentSummary[];
  onClose: () => void;
  onHandoff: (item: MemoryItem, agent: string) => void;
  className?: string;
}) {
  const [session, setSession] = useState<ParsedSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tildify = useTildify();

  useEffect(() => {
    let cancelled = false;
    setSession(null);
    api
      .session(item.id, project)
      .then((s) => !cancelled && setSession(s))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [item.id, item.hash, project]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('dialog[open]') && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const visible = session?.messages.filter((m) => m.role !== 'tool' && m.role !== 'system') ?? [];

  return (
    <aside aria-label="Session transcript" className={cx('flex shrink-0 flex-col border-l border-ink-700 bg-ink-900 [animation:drawer-in_280ms_var(--ease-out-expo)]', className)}>
      <header className="border-b border-ink-700 px-5 pt-4 pb-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <AgentDot agent={item.agent} />
              <h2 className="line-clamp-2 text-[15px] font-semibold">{item.title}</h2>
            </div>
            <p className="mt-0.5 truncate font-mono text-[12px] text-paper-mute">{tildify(item.filePath)}</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 text-paper-mute hover:bg-ink-800 hover:text-paper">
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <ArrowRightLeft className="size-3.5 text-paper-mute" />
          <span className="text-[12px] text-paper-mute">Hand off this working memory to</span>
          {agents
            .filter((a) => a.id !== item.agent)
            .map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onHandoff(item, a.id)}
                className="inline-flex items-center gap-1.5 rounded-md border border-ink-600 px-2 py-0.5 text-[12px] text-paper-dim hover:border-ink-500 hover:text-paper"
              >
                <AgentDot agent={a.id} size={7} /> {a.displayName}
              </button>
            ))}
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {error && <p className="text-[13px] text-danger">{error}</p>}
        {!session && !error && <div className="h-32 animate-pulse rounded-lg bg-ink-800" />}
        {session && visible.length === 0 && <p className="text-[13px] text-paper-mute">This session has no readable messages.</p>}
        {visible.map((m, i) => (
          <article key={i} className={cx('rounded-lg px-3.5 py-2.5', m.role === 'user' ? 'bg-ink-800' : 'border border-ink-700')}>
            <h3 className="mb-1 text-[11px] font-medium text-paper-mute">{m.role === 'user' ? 'User' : 'Agent'}</h3>
            {m.text && (
              <div className="md-preview max-w-[72ch] text-[13px] leading-relaxed" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }} />
            )}
            {m.toolCalls.length > 0 && (
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {m.toolCalls.map((t, j) => (
                  <li key={j} className="inline-flex max-w-full items-center gap-1 rounded bg-ink-950 px-1.5 py-0.5 font-mono text-[11px] text-paper-dim">
                    <Wrench className="size-3 shrink-0" />
                    <span className="shrink-0 text-paper">{t.name}</span>
                    {t.target && <span className="truncate">{t.target}</span>}
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </aside>
  );
}
