import type { TransferRender } from '@agent-mem/core';
import { FileDiff, FilePlus2, Link2, ShieldAlert, Sparkles, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, type Plan } from '../api';
import { Button, Tag, cx, useTildify } from '../ui';
import { DiffView } from './DiffView';
import { useToast } from './Toasts';

export type PlanRequest =
  | { kind: 'transfer'; load: (render: TransferRender) => Promise<Plan> }
  | { kind: 'share'; load: () => Promise<Plan> }
  | { kind: 'unshare'; load: () => Promise<Plan> };

export function PlanDialog({ request, onClose, onApplied }: { request: PlanRequest; onClose: () => void; onApplied: () => void }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const tildify = useTildify();
  const toast = useToast();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const ticket = useRef(0);

  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
  }, []);

  const run = useCallback(
    async (render?: TransferRender) => {
      const mine = ++ticket.current;
      setPlan(null);
      setError(null);
      try {
        const next = request.kind === 'transfer' ? await request.load(render ?? 'verbatim') : await request.load();
        if (ticket.current !== mine) return;
        setPlan(next);
        setActive(0);
      } catch (e) {
        if (ticket.current === mine) setError((e as Error).message);
      }
    },
    [request],
  );

  useEffect(() => {
    void run(request.kind === 'transfer' ? 'verbatim' : undefined);
  }, [request, run]);

  async function apply() {
    if (!plan) return;
    setBusy(true);
    try {
      const res = await api.apply(plan);
      toast({
        tone: 'ok',
        message: `${plan.title} - wrote ${res.files.length} file${res.files.length === 1 ? '' : 's'}.`,
        action: res.backups.length
          ? {
              label: 'Undo',
              run: async () => {
                for (const b of res.backups) await api.undo(b.id).catch(() => {});
                onApplied();
              },
            }
          : undefined,
      });
      onApplied();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError && e.isConflict ? `${e.message}. Close and try again to preview against the latest version.` : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const write = plan?.writes[active];

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => e.target === dialogRef.current && onClose()}
      className="m-auto flex max-h-[86vh] w-[min(920px,94vw)] flex-col overflow-hidden rounded-xl border border-ink-600 bg-ink-900 p-0 text-paper shadow-[0_24px_64px_-12px_rgba(0,0,0,0.75)] backdrop:bg-black/55 [animation:dialog-in_260ms_var(--ease-out-expo)] open:flex"
    >
      <header className="flex items-start gap-3 border-b border-ink-700 px-5 pt-4 pb-3.5">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-balance">{plan?.title ?? (error ? 'Cannot prepare this change' : 'Preparing preview...')}</h2>
          {plan && (
            <ul className="mt-1.5 space-y-0.5 text-[13px] text-paper-dim">
              {plan.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </div>
        <button type="button" aria-label="Close" className="rounded p-1 text-paper-mute hover:bg-ink-800 hover:text-paper" onClick={onClose}>
          <X className="size-4" />
        </button>
      </header>

      {plan && plan.findings.length > 0 && (
        <div className="flex items-start gap-2 border-b border-ink-700 bg-warn/8 px-5 py-2.5 text-[13px] text-warn">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            Possible secrets: {plan.findings.map((f) => `${f.count} ${f.type}`).join(', ')}.{' '}
            {plan.kind === 'handoff' ? 'They are masked in the handoff.' : 'Review the diff before applying.'}
          </span>
        </div>
      )}

      {plan && plan.writes.length > 1 && (
        <nav className="flex gap-1 border-b border-ink-700 px-4 pt-2" aria-label="Files">
          {plan.writes.map((w, i) => (
            <button
              key={w.filePath}
              type="button"
              onClick={() => setActive(i)}
              className={cx(
                '-mb-px truncate rounded-t-md border-b-2 px-3 py-1.5 font-mono text-[12px]',
                i === active ? 'border-signal text-paper' : 'border-transparent text-paper-mute hover:text-paper',
              )}
            >
              {w.filePath.split('/').pop()}
            </button>
          ))}
        </nav>
      )}

      <div className="min-h-[200px] flex-1 overflow-hidden">
        {error && <p className="px-5 py-4 text-[13px] text-danger">{error}</p>}
        {!plan && !error && <div className="m-5 h-40 animate-pulse rounded-lg bg-ink-800" />}
        {plan && plan.writes.length === 0 && <p className="px-5 py-4 text-[13px] text-paper-dim">Nothing to write.</p>}
        {write && (
          <div className="flex h-full max-h-[56vh] flex-col">
            <div className="flex items-center gap-2 px-5 py-2 text-[12px]">
              {write.symlinkTo ? (
                <Link2 className="size-3.5 text-signal" />
              ) : write.remove ? (
                <Trash2 className="size-3.5 text-danger" />
              ) : write.before == null ? (
                <FilePlus2 className="size-3.5 text-ok" />
              ) : (
                <FileDiff className="size-3.5 text-paper-dim" />
              )}
              <span className="truncate font-mono text-paper-dim">{tildify(write.filePath)}</span>
              <Tag tone={write.before == null ? 'ok' : write.remove ? 'warn' : 'plain'}>
                {write.symlinkTo ? `symlink -> ${write.symlinkTo}` : write.remove ? 'delete' : write.before == null ? 'new file' : 'modified'}
              </Tag>
            </div>
            <DiffView className="flex-1 border-t border-ink-700/70" before={write.before ?? ''} after={write.remove ? '' : write.after} />
          </div>
        )}
      </div>

      <footer className="flex items-center gap-3 border-t border-ink-700 bg-ink-850 px-5 py-3">
        {request.kind === 'transfer' && (
          <Button variant="quiet" onClick={() => void run('summary')}>
            <Sparkles className="size-3.5 text-signal" /> Summarize
          </Button>
        )}
        <span className="flex-1 text-[12px] text-paper-mute">Every write is backed up first and can be undone from History.</span>
        <Button variant="quiet" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!plan || busy || plan.writes.length === 0} onClick={apply}>
          {busy ? 'Applying...' : 'Apply'}
        </Button>
      </footer>
    </dialog>
  );
}
