import { Loader2, Save, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type SkillDetail, type SkillItem } from '../api';
import { Button, cx, Tag, useTildify } from '../ui';

/** Side panel for one skill: read and edit its SKILL.md. */
export function SkillsDrawer({
  skill,
  project,
  onClose,
  onSaved,
}: {
  skill: SkillItem;
  project: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tildify = useTildify();

  useEffect(() => {
    setDetail(null);
    setError(null);
    api
      .skill(skill.id, project)
      .then((d) => {
        setDetail(d);
        setContent(d.skillMd.content);
      })
      .catch((e: Error) => setError(e.message));
  }, [skill.id, project]);

  const dirty = detail != null && content !== detail.skillMd.content;

  async function save() {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.saveSkill(skill.id, project, content, detail.skillMd.hash);
      setDetail({ ...detail, skillMd: { content, hash: res.hash } });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className={cx('flex min-h-0 flex-col border-l border-ink-700 bg-ink-900', '')} aria-label={`Skill ${skill.name}`}>
      <header className="flex items-start gap-3 border-b border-ink-700 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-[15px] font-semibold">{skill.name}</h2>
            {skill.shared && (
              <Tag tone="warn" title="This library is read by several agents">
                shared
              </Tag>
            )}
            <Tag>{skill.scope}</Tag>
          </div>
          <p className="mt-1 truncate font-mono text-[11px] text-paper-mute" title={skill.dirPath}>
            {tildify(skill.dirPath)} · {skill.fileCount} file{skill.fileCount === 1 ? '' : 's'}
          </p>
        </div>
        <button type="button" aria-label="Close" className="rounded p-1 text-paper-mute hover:bg-ink-800 hover:text-paper" onClick={onClose}>
          <X className="size-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden p-4">
        {error && <p className="mb-2 rounded-lg border border-danger/40 bg-danger/8 px-3 py-2 text-[13px] text-danger">{error}</p>}
        {!detail && !error && <div className="h-full animate-pulse rounded-lg bg-ink-800" />}
        {detail && (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            aria-label={`SKILL.md for ${skill.name}`}
            className="h-full w-full resize-none rounded-lg border border-ink-600 bg-ink-950 p-3 font-mono text-[12.5px] leading-relaxed text-paper focus:border-signal focus:outline-none"
          />
        )}
      </div>

      <footer className="flex items-center gap-3 border-t border-ink-700 bg-ink-850 px-5 py-3">
        <span className="flex-1 text-[12px] text-paper-mute">Edits go to SKILL.md; the folder and other files stay untouched.</span>
        <Button variant="quiet" onClick={onClose}>
          Close
        </Button>
        <Button variant="primary" disabled={!dirty || busy} onClick={() => void save()}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save
        </Button>
      </footer>
    </aside>
  );
}
