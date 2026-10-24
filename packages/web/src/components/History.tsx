import { History as HistoryIcon, RotateCcw } from 'lucide-react';
import type { BackupEntry } from '../api';
import { Button, relativeTime, Tag, useTildify } from '../ui';

export function History({ entries, onUndo }: { entries: BackupEntry[]; onUndo: (id: string) => void }) {
  const tildify = useTildify();
  if (entries.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <HistoryIcon className="size-8 text-ink-500" aria-hidden />
        <p className="text-[13px] text-paper-dim">No changes yet.</p>
        <p className="max-w-[46ch] text-[12px] text-paper-mute">Every write agent-mem makes is recorded here and can be undone. Edit a memory or share one to see history.</p>
      </div>
    );
  }
  return (
    <div className="h-full overflow-auto p-5">
      <ol className="max-w-[920px] divide-y divide-ink-700/70 overflow-hidden rounded-xl border border-ink-700">
        {entries.map((e) => (
          <li key={e.id} className="flex items-center gap-4 bg-ink-950 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{e.reason}</p>
              <p className="truncate font-mono text-[11px] text-paper-mute">{tildify(e.filePath)}</p>
            </div>
            <span className="shrink-0 text-[12px] text-paper-mute" title={e.createdAt}>
              {relativeTime(Date.parse(e.createdAt))}
            </span>
            {e.backupPath == null && !e.wasSymlinkTo && <Tag>created file</Tag>}
            {e.undone ? (
              <Tag tone="ok">restored</Tag>
            ) : (
              <Button className="h-7" onClick={() => onUndo(e.id)}>
                <RotateCcw className="size-3.5" /> Undo
              </Button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
