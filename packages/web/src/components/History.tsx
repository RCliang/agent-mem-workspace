import { History as HistoryIcon, RotateCcw } from 'lucide-react';
import type { BackupEntry } from '../api';
import { useI18n } from '../i18n';
import { Button, Tag, useRelativeTime, useTildify } from '../ui';

export function History({ entries, onUndo }: { entries: BackupEntry[]; onUndo: (id: string) => void }) {
  const tildify = useTildify();
  const { t } = useI18n();
  const relativeTime = useRelativeTime();
  if (entries.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <HistoryIcon className="mb-2 size-8 text-paper-mute" aria-hidden />
        <p className="text-[14px] font-medium text-paper">{t('history.empty')}</p>
        <p className="max-w-[46ch] text-[13px] leading-5 text-paper-mute">{t('history.emptyHint')}</p>
      </div>
    );
  }
  return (
    <div className="h-full overflow-auto p-5 sm:px-8 sm:py-8">
      <ol className="mx-auto max-w-[1040px] divide-y divide-ink-700/70 border-y border-ink-700">
        {entries.map((e) => (
          <li key={e.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-5 gap-y-3 py-4 sm:grid-cols-[minmax(0,1fr)_7rem_10rem] sm:items-center sm:gap-x-6 sm:py-5">
            <div className="min-w-0">
              <p className="truncate text-[14px] leading-5 font-medium text-paper">{e.reason}</p>
              <p className="mt-1 truncate font-mono text-[11px] leading-4 text-paper-mute">{tildify(e.filePath)}</p>
            </div>
            <span className="self-start whitespace-nowrap text-right text-[12px] leading-5 text-paper-dim sm:self-auto" title={e.createdAt}>
              {relativeTime(Date.parse(e.createdAt))}
            </span>
            <div className="col-span-2 flex min-h-8 items-center justify-end gap-2 sm:col-span-1">
              {e.backupPath == null && !e.wasSymlinkTo && <Tag>{t('history.createdFile')}</Tag>}
              {e.undone ? (
                <Tag tone="ok">{t('history.restored')}</Tag>
              ) : (
                <Button className="hit-target h-8 shrink-0" onClick={() => onUndo(e.id)}>
                  <RotateCcw className="size-3.5" /> {t('common.undo')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
