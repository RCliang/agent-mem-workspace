import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { AlertTriangle, Share2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiError, api, type AgentSummary, type MemoryItem } from '../api';
import { renderMarkdown } from '../markdown';
import { AgentDot, Button, Kbd, Tag, cx, useTildify } from '../ui';
import { ArmedAction } from './ArmedAction';
import { DiffView } from './DiffView';
import { useToast } from './Toasts';

const editorTheme = EditorView.theme(
  {
    '&': { backgroundColor: 'var(--color-ink-950)', color: 'var(--color-paper)' },
    '.cm-content': { caretColor: 'var(--color-signal)', padding: '14px 0' },
    '.cm-cursor': { borderLeftColor: 'var(--color-signal)', borderLeftWidth: '2px' },
    '.cm-gutters': { backgroundColor: 'var(--color-ink-950)', color: 'var(--color-ink-500)', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.025)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--color-paper-mute)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(232,176,75,0.28) !important' },
    '.cm-line': { padding: '0 18px' },
  },
  { dark: true },
);

const extensions = [markdown(), EditorView.lineWrapping, editorTheme];

export function EditorDrawer({
  item,
  project,
  agents,
  onClose,
  onSaved,
  onShare,
  className,
}: {
  item: MemoryItem;
  project: string | null;
  agents: AgentSummary[];
  onClose: () => void;
  onSaved: () => void;
  onShare: (item: MemoryItem, agent: string) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(item.content);
  const [base, setBase] = useState({ content: item.content, hash: item.hash });
  const [tab, setTab] = useState<'edit' | 'diff'>('edit');
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const tildify = useTildify();
  const toast = useToast();
  const dirty = draft !== base.content;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Follow changes made on disk by agents while the file is open, unless the user has edits.
  useEffect(() => {
    if (item.hash === base.hash) return;
    if (!dirtyRef.current) {
      setBase({ content: item.content, hash: item.hash });
      setDraft(item.content);
    } else {
      setConflict(true);
    }
  }, [item.hash, item.content, base.hash]);

  async function save(force = false) {
    setSaving(true);
    try {
      const expected = force ? (await api.memories(project)).find((m) => m.id === item.id)?.hash ?? item.hash : base.hash;
      const res = await api.saveMemory(item.id, project, draft, expected);
      setBase({ content: draft, hash: res.hash });
      setConflict(false);
      setTab('edit');
      toast({
        tone: 'ok',
        message: `Saved ${tildify(item.filePath)}`,
        action: { label: 'Undo', run: () => void api.undo(res.backupId).then(onSaved) },
      });
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.isConflict) setConflict(true);
      else toast({ tone: 'error', message: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    try {
      await api.deleteMemory(item.id, project, base.hash);
      toast({ tone: 'ok', message: `Deleted ${tildify(item.filePath)}` });
      onSaved();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.isConflict) setConflict(true);
      else toast({ tone: 'error', message: (e as Error).message });
    }
  }

  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void saveRef.current();
      }
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const shareTargets = agents.filter((a) => a.id !== item.agent && !item.alsoReadBy.includes(a.id));

  return (
    <aside
      aria-label={`Edit ${item.title}`}
      className={cx('flex shrink-0 flex-col border-l border-ink-700 bg-ink-900 [animation:drawer-in_280ms_var(--ease-out-expo)]', className)}
    >
      <header className="border-b border-ink-700 px-5 pt-4 pb-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <AgentDot agent={item.agent} />
              <h2 className="truncate text-[15px] font-semibold">{item.title}</h2>
            </div>
            <p className="mt-0.5 truncate font-mono text-[12px] text-paper-mute" title={item.filePath}>
              {tildify(item.filePath)}
            </p>
          </div>
          <button type="button" aria-label="Close editor" onClick={onClose} className="rounded p-1 text-paper-mute hover:bg-ink-800 hover:text-paper">
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-3 flex items-center gap-1">
          {(['edit', 'diff'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cx('rounded-md px-2.5 py-1 text-[12px] font-medium', tab === t ? 'bg-ink-700 text-paper' : 'text-paper-dim hover:text-paper')}
            >
              {t === 'edit' ? 'Edit' : 'Review changes'}
              {t === 'diff' && dirty && <span className="ml-1.5 inline-block size-1.5 rounded-full bg-signal align-middle" />}
            </button>
          ))}
          {shareTargets.length > 0 && (
            <div className="ml-auto flex items-center gap-1.5">
              <Share2 className="size-3.5 text-paper-mute" />
              <span className="text-[12px] text-paper-mute">Share with</span>
              {shareTargets.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onShare(item, a.id)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-ink-600 px-2 py-0.5 text-[12px] text-paper-dim hover:border-ink-500 hover:text-paper"
                >
                  <AgentDot agent={a.id} size={7} /> {a.displayName}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {conflict && (
        <div className="flex items-start gap-2.5 border-b border-warn/30 bg-warn/8 px-5 py-2.5 text-[13px]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
          <p className="flex-1 text-paper">This file changed on disk after you started editing. Keep your version or load the one on disk.</p>
          <Button
            variant="quiet"
            className="h-7"
            onClick={() => {
              setDraft(item.content);
              setBase({ content: item.content, hash: item.hash });
              setConflict(false);
            }}
          >
            Load disk version
          </Button>
          <Button variant="danger" className="h-7" onClick={() => void save(true)}>
            Overwrite
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'edit' ? (
          <div className="flex h-full min-h-0 flex-col">
            <article
              className="md-preview max-h-[40%] shrink-0 overflow-y-auto border-b border-ink-700 px-5 py-4 text-[13px] leading-relaxed"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(draft) }}
            />
            <div className="min-h-0 flex-1">
              <CodeMirror value={draft} onChange={setDraft} extensions={extensions} theme="none" height="100%" className="h-full" basicSetup={{ foldGutter: false }} />
            </div>
          </div>
        ) : (
          <DiffView className="h-full bg-ink-950 py-2" before={base.content} after={draft} />
        )}
      </div>

      <footer className="flex items-center gap-3 border-t border-ink-700 bg-ink-850 px-5 py-3">
        {item.kind === 'instructions' && (
          <ArmedAction
            label="Delete"
            armedLabel={
              item.alsoReadBy.length === 0
                ? 'Delete this file?'
                : `Delete? Also read by ${item.alsoReadBy.map((id) => agents.find((a) => a.id === id)?.displayName ?? id).join(', ')}`
            }
            onConfirm={() => void remove()}
          />
        )}
        <Tag>{item.scope === 'local' ? 'private' : item.scope}</Tag>
        <span className="flex-1 text-[12px] text-paper-mute">
          {dirty ? 'Unsaved changes' : 'Saved'} · <Kbd>Ctrl</Kbd> <Kbd>S</Kbd> to save
        </span>
        <Button variant="quiet" disabled={draft === base.content} onClick={() => setDraft(base.content)}>
          Revert
        </Button>
        <Button variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </footer>
    </aside>
  );
}
