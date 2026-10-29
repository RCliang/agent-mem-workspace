import { diffLines } from 'diff';
import { useMemo } from 'react';
import { useI18n } from '../i18n';
import { cx } from '../ui';

interface Row {
  kind: 'add' | 'del' | 'ctx' | 'gap';
  text: string;
  oldNo?: number;
  newNo?: number;
}

const CONTEXT = 3;

function buildRows(before: string, after: string): Row[] {
  const rows: Row[] = [];
  let o = 1;
  let n = 1;
  for (const part of diffLines(before, after)) {
    const lines = part.value.replace(/\n$/, '').split('\n');
    for (const line of lines) {
      if (part.added) rows.push({ kind: 'add', text: line, newNo: n++ });
      else if (part.removed) rows.push({ kind: 'del', text: line, oldNo: o++ });
      else rows.push({ kind: 'ctx', text: line, oldNo: o++, newNo: n++ });
    }
  }
  // Collapse long unchanged runs so the change is what you see.
  const keep = rows.map((r, i) => r.kind !== 'ctx' || rows.slice(Math.max(0, i - CONTEXT), i + CONTEXT + 1).some((x) => x.kind !== 'ctx'));
  const out: Row[] = [];
  rows.forEach((r, i) => {
    if (keep[i]) out.push(r);
    else if (out.at(-1)?.kind !== 'gap') out.push({ kind: 'gap', text: '' });
  });
  return out;
}

export function DiffView({ before, after, className }: { before: string; after: string; className?: string }) {
  const rows = useMemo(() => buildRows(before, after), [before, after]);
  const { t } = useI18n();
  const changed = rows.some((r) => r.kind === 'add' || r.kind === 'del');
  if (!changed) return <p className="px-4 py-3 text-[13px] text-paper-mute">{t('diff.noChanges')}</p>;
  return (
    <div className={cx('overflow-auto font-mono text-[12.5px] leading-[1.6]', className)}>
      <table className="w-full min-w-max border-collapse">
        <tbody>
          {rows.map((r, i) =>
            r.kind === 'gap' ? (
              <tr key={i}>
                <td colSpan={3} className="bg-ink-800/60 px-3 py-0.5 font-sans text-[12px] text-paper-mute">
                  {t('diff.unchanged')}
                </td>
              </tr>
            ) : (
              <tr key={i} className={cx(r.kind === 'add' && 'bg-ok/10', r.kind === 'del' && 'bg-danger/10')}>
                <td className="sticky left-0 w-10 select-none bg-inherit px-2 text-right align-top text-paper-mute/70">{r.oldNo ?? ''}</td>
                <td className="w-10 select-none px-2 text-right align-top text-paper-mute/70">{r.newNo ?? ''}</td>
                <td className="whitespace-pre pr-4 align-top">
                  <span className={cx('mr-2 select-none', r.kind === 'add' ? 'text-ok' : r.kind === 'del' ? 'text-danger' : 'text-transparent')}>
                    {r.kind === 'add' ? '+' : r.kind === 'del' ? '-' : ' '}
                  </span>
                  <span className={cx(r.kind === 'ctx' && 'text-paper-dim')}>{r.text || ' '}</span>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
