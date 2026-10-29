import type { TransferRender } from '@agent-mem/core';
import { ArrowRightLeft, Copy, FileDiff, FilePlus2, FolderPlus, Link2, ShieldAlert, Sparkles, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, type Plan } from '../api';
import { useI18n } from '../i18n';
import { Button, Tag, cx, useTildify } from '../ui';
import { DiffView } from './DiffView';
import { useToast } from './Toasts';

export type PlanRequest =
  | { kind: 'transfer'; load: (render: TransferRender) => Promise<Plan> }
  | { kind: 'share'; load: () => Promise<Plan> }
  | { kind: 'unshare'; load: () => Promise<Plan> }
  | { kind: 'skill'; load: (opts: { move: boolean }) => Promise<Plan> };

export function PlanDialog({ request, onClose, onApplied }: { request: PlanRequest; onClose: () => void; onApplied: () => void }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [move, setMove] = useState(false);
  const [active, setActive] = useState(0);
  const { t } = useI18n();
  const tildify = useTildify();
  const toast = useToast();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const ticket = useRef(0);

  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
  }, []);

  const run = useCallback(
    async (opts?: { move: boolean } | TransferRender) => {
      const mine = ++ticket.current;
      setLoading(true);
      setError(null);
      try {
        const next =
          request.kind === 'transfer'
            ? await request.load((typeof opts === 'string' ? opts : 'verbatim') as TransferRender)
            : request.kind === 'skill'
              ? await request.load({ move: typeof opts === 'object' && 'move' in (opts ?? {}) ? opts.move : false })
              : await request.load();
        if (ticket.current !== mine) return;
        setPlan(next);
        setActive(0);
      } catch (e) {
        if (ticket.current === mine) setError((e as Error).message);
      } finally {
        if (ticket.current === mine) setLoading(false);
      }
    },
    [request],
  );

  useEffect(() => {
    setMove(false);
    void run(request.kind === 'transfer' ? 'verbatim' : undefined);
  }, [request, run]);

  async function apply() {
    if (!plan) return;
    setBusy(true);
    try {
      const res = await api.apply(plan);
      toast({
        tone: 'ok',
        message: t('plan.wrote', { count: res.files.length, suffix: res.files.length === 1 ? '' : 's', title: plan.title }),
        action: res.backups.length
          ? {
              label: t('common.undo'),
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
      setError(e instanceof ApiError && e.isConflict ? `${e.message}. ${t('plan.conflictRetry')}` : (e as Error).message);
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
      className="m-auto flex max-h-[86dvh] w-[min(920px,94vw)] flex-col overflow-hidden rounded-lg bg-[var(--glass)] p-0 text-paper shadow-[var(--glass-hi),var(--shadow-modal)] backdrop:bg-backdrop backdrop-blur-[var(--glass-blur)] [animation:dialog-in_260ms_var(--ease-out-expo)] open:flex"
    >
      <header className="flex items-start gap-3 border-b border-ink-700 px-5 pt-4 pb-3.5">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-balance">{plan?.title ?? (error ? t('plan.cannotPrepare') : t('plan.preparing'))}</h2>
          {plan && (
            <ul className="mt-1.5 space-y-0.5 text-[13px] text-paper-dim">
              {plan.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </div>
        <button type="button" aria-label={t('common.close')} className="hit-target rounded-md p-1.5 text-paper-mute hover:bg-ink-800 hover:text-paper" onClick={onClose}>
          <X className="size-4" />
        </button>
      </header>

      {plan && plan.findings.length > 0 && (
        <div className="flex items-start gap-2 border-b border-ink-700 bg-warn/8 px-5 py-2.5 text-[13px] text-warn">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            {t('plan.possibleSecrets', { findings: plan.findings.map((f) => `${f.count} ${f.type}`).join(', ') })}{' '}
            {plan.kind === 'handoff' ? t('plan.masked') : t('plan.reviewSecrets')}
          </span>
        </div>
      )}

      {plan && plan.writes.length > 1 && (
        <nav className="flex gap-1 overflow-x-auto border-b border-ink-700 px-4 pt-2" aria-label={t('plan.files')}>
          {plan.writes.map((w, i) => (
            <button
              key={w.filePath}
              type="button"
              onClick={() => setActive(i)}
              className={cx(
                'hit-target -mb-px truncate rounded-t-md border-b-2 px-3 py-1.5 font-mono text-[12px] whitespace-nowrap',
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
        {plan && plan.writes.length === 0 && !plan.dirOps?.length && <p className="px-5 py-4 text-[13px] text-paper-dim">{t('plan.nothing')}</p>}
        {plan && plan.writes.length === 0 && !!plan.dirOps?.length && (
          <ul className="space-y-2 px-5 py-4">
            {plan.dirOps.map((op) => (
              <li key={`${op.op}:${op.destDir}`} className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2.5 text-[13px]">
                {op.op === 'copy-dir' ? <FolderPlus className="size-4 shrink-0 text-ok" /> : <Trash2 className="size-4 shrink-0 text-danger" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[12px] text-paper-dim" title={op.destDir}>
                    {tildify(op.destDir)}
                  </span>
                  {op.op === 'copy-dir' && op.srcDir && (
                    <span className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-paper-mute">
                      <ArrowRightLeft className="size-3 shrink-0" /> {tildify(op.srcDir)}
                    </span>
                  )}
                </span>
                <Tag tone={op.op === 'copy-dir' ? 'ok' : 'warn'}>
                  {op.op === 'copy-dir' ? (op.destExisted ? t('plan.replaceFolder') : t('plan.newFolder')) : t('plan.deleteFolder')}
                </Tag>
              </li>
            ))}
          </ul>
        )}
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
                {write.symlinkTo
                  ? `${t('matrix.symlink')} -> ${write.symlinkTo}`
                  : write.remove
                    ? t('plan.delete')
                    : write.before == null
                      ? t('plan.newFile')
                      : t('plan.modified')}
              </Tag>
            </div>
            <DiffView className="flex-1 border-t border-ink-700/70" before={write.before ?? ''} after={write.remove ? '' : write.after} />
          </div>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-3 border-t border-ink-700 bg-ink-850 px-5 py-3">
        {request.kind === 'transfer' && (
          <Button variant="quiet" disabled={loading} onClick={() => void run('summary')}>
            <Sparkles className="size-3.5 text-signal" /> {t('plan.summarize')}
          </Button>
        )}
        {request.kind === 'skill' && (
          <div className="flex items-center gap-1 rounded-lg bg-ink-950 p-0.5" role="group" aria-label={t('plan.transferMode')}>
            {([false, true] as const).map((m) => (
              <button
                key={String(m)}
                type="button"
                aria-pressed={move === m}
                disabled={loading}
                onClick={() => {
                  setMove(m);
                  void run({ move: m });
                }}
                className={cx(
                  'hit-target inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium whitespace-nowrap transition-colors active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 disabled:active:translate-y-0',
                  move === m ? 'bg-ink-700 text-paper' : 'text-paper-dim hover:bg-ink-800 hover:text-paper',
                )}
              >
                {m ? <ArrowRightLeft className="size-3.5" /> : <Copy className="size-3.5" />}
                {m ? t('plan.move') : t('plan.copy')}
              </button>
            ))}
          </div>
        )}
        <span className="min-w-[220px] flex-1 text-[12px] text-paper-mute">{t('plan.backupHint')}</span>
        <Button variant="quiet" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" disabled={!plan || busy || loading || (plan.writes.length === 0 && !plan.dirOps?.length)} onClick={apply}>
          {busy ? t('plan.applying') : t('plan.apply')}
        </Button>
      </footer>
    </dialog>
  );
}
