import { Loader2, Save, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type SkillDetail, type SkillItem } from '../api';
import { useI18n } from '../i18n';
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
  const { t } = useI18n();
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
    <aside
      className={cx(
        'absolute inset-0 z-20 flex min-h-0 w-full shrink-0 flex-col border-l border-ink-700 bg-ink-900 [animation:drawer-in_280ms_var(--ease-out-expo)] lg:static lg:z-auto lg:w-[min(640px,48vw)]',
        '',
      )}
      aria-label={t('skillDrawer.label', { name: skill.name })}
    >
      <header className="flex shrink-0 items-start gap-3 border-b border-ink-700 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 truncate text-[15px] leading-snug font-semibold">{skill.name}</h2>
            {skill.shared && (
              <Tag tone="warn" title={t('skillDrawer.sharedTitle')}>
                {t('common.shared')}
              </Tag>
            )}
            <Tag>{t(skill.scope === 'global' ? 'common.global' : 'common.project')}</Tag>
          </div>
          <div className="mt-1.5 flex items-center gap-3 text-[11px] text-paper-mute">
            <p className="min-w-0 flex-1 truncate font-mono" title={skill.dirPath}>
              {tildify(skill.dirPath)}
            </p>
            <span className="shrink-0 whitespace-nowrap">
              {t('common.files', { count: skill.fileCount, suffix: skill.fileCount === 1 ? '' : 's' })}
            </span>
          </div>
        </div>
        <button type="button" aria-label={t('common.close')} className="icon-hit shrink-0 rounded-md p-1 text-paper-mute hover:bg-ink-800 hover:text-paper" onClick={onClose}>
          <X className="size-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden p-4">
        {error && <p className="mb-2 rounded-md border border-danger/40 bg-danger/8 px-3 py-2 text-[13px] text-danger">{error}</p>}
        {!detail && !error && <div className="h-full rounded-lg bg-ink-800 motion-safe:animate-pulse" />}
        {detail && (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            aria-label={t('skillDrawer.editorLabel', { name: skill.name })}
            className="h-full w-full resize-none rounded-md border border-ink-600 bg-ink-950 p-3 font-mono text-[12.5px] leading-relaxed text-paper"
          />
        )}
      </div>

      <footer className="flex shrink-0 items-center gap-3 border-t border-ink-700 bg-ink-850 px-5 py-3">
        <span className="min-w-0 flex-1 text-[12px] leading-snug text-paper-mute">{t('skillDrawer.hint')}</span>
        <Button variant="quiet" onClick={onClose}>
          {t('common.close')}
        </Button>
        <Button variant="primary" disabled={!dirty || busy} onClick={() => void save()}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} {t('common.save')}
        </Button>
      </footer>
    </aside>
  );
}
