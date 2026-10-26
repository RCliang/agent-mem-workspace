import { ArrowRightLeft, Blocks, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { SkillItem, SkillLibrary } from '../api';
import { AgentDot, AgentIcon, EmptyState, formatSize, relativeTime, Tag } from '../ui';

function SkillCard({
  skill,
  libraries,
  onOpen,
  onTransfer,
  onDelete,
}: {
  skill: SkillItem;
  libraries: SkillLibrary[];
  onOpen: (s: SkillItem) => void;
  onTransfer: (s: SkillItem, target: string) => void;
  onDelete: (s: SkillItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const name = (id: string) => libraries.find((l) => l.id === id)?.displayName ?? id;
  const targets = libraries.filter((l) => l.id !== skill.agent);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <li className="relative">
      <button
        type="button"
        onClick={() => onOpen(skill)}
        aria-label={`${skill.name}. Open to read or edit its SKILL.md.`}
        className="group block w-full cursor-pointer rounded-lg border border-ink-700 bg-ink-850 px-3 py-2.5 text-left transition-colors hover:border-ink-500"
      >
        <p className="truncate font-mono text-[13px] font-medium">{skill.name}</p>
        {skill.description && <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-paper-dim">{skill.description}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {skill.scope === 'project' && <Tag>project</Tag>}
          {skill.shared && (
            <Tag tone="warn" title="This library is read by several agents; changes affect all of them">
              shared
            </Tag>
          )}
          {skill.alsoReadBy.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] text-paper-mute" title={`Also read by ${skill.alsoReadBy.map(name).join(', ')}`}>
              also read by
              {skill.alsoReadBy.map((a) => (
                <AgentDot key={a} agent={a} size={7} />
              ))}
            </span>
          )}
          <span className="ml-auto text-[11px] text-paper-mute">
            {skill.fileCount} file{skill.fileCount === 1 ? '' : 's'} · {formatSize(skill.sizeBytes)} · {relativeTime(skill.mtimeMs)}
          </span>
        </div>
      </button>
      {(targets.length > 0 || !skill.shared) && (
        <div ref={menuRef} className="absolute top-2 right-2">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={`Migrate or delete ${skill.name}`}
            onClick={() => setOpen((v) => !v)}
            className="rounded p-1 text-ink-500 hover:bg-ink-800 hover:text-paper"
          >
            <ArrowRightLeft className="size-3.5" />
          </button>
          {open && (
            <div role="menu" className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-ink-600 bg-ink-850 p-1 shadow-[0_16px_40px_-10px_rgba(0,0,0,0.7)]">
              {targets.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onTransfer(skill, l.id);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-ink-700"
                >
                  {l.id === 'shared' ? <Blocks className="size-3.5 shrink-0 text-paper-mute" /> : <AgentIcon agent={l.id} size={14} />}
                  Migrate to {l.displayName}
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onDelete(skill);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-danger hover:bg-danger/10"
              >
                <Trash2 className="size-3.5" /> Delete…
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function SkillsBoard({
  libraries,
  skills,
  query,
  onClearSearch,
  onOpen,
  onTransfer,
  onDelete,
}: {
  libraries: SkillLibrary[];
  skills: SkillItem[];
  /** Active search query, so empty columns can say why they are empty. */
  query?: string;
  onClearSearch?: () => void;
  onOpen: (s: SkillItem) => void;
  onTransfer: (s: SkillItem, target: string) => void;
  onDelete: (s: SkillItem) => void;
}) {
  if (libraries.length === 0) {
    return <EmptyState icon={Blocks} title="No skill libraries found" hint="Install an agent with a skills folder, or create ~/.agents/skills." />;
  }
  const searching = !!query?.trim();
  return (
    <div className="flex h-full gap-4 overflow-x-auto p-5">
      {libraries.map((lib) => {
        const items = skills.filter((s) => s.agent === lib.id || s.alsoReadBy.includes(lib.id));
        return (
          <section key={lib.id} data-skill-column={lib.id} aria-label={lib.displayName} className="flex min-w-[300px] flex-1 basis-0 flex-col rounded-xl border border-ink-700 bg-ink-900">
            <header className="flex items-center gap-2.5 border-b border-ink-700 px-4 py-3">
              {lib.id === 'shared' ? (
                <Blocks className="size-[18px] text-paper-mute" aria-hidden />
              ) : (
                <AgentIcon agent={lib.id} size={18} />
              )}
              <h2 className="text-[14px] font-semibold">{lib.displayName}</h2>
              {lib.id === 'shared' && (
                <Tag tone="warn" title="Everything here is read by every agent following the .agents convention">
                  shared
                </Tag>
              )}
              <span className="ml-auto text-[11px] text-paper-mute">{items.length}</span>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              {items.length === 0 && (
                <p className="px-1 py-2 text-[13px] text-paper-mute">
                  {searching ? `No matches for “${query!.trim()}”${onClearSearch ? ' — ' : '.'}` : 'No skills in this library yet.'}
                  {searching && onClearSearch && (
                    <button type="button" onClick={onClearSearch} className="ml-1 text-signal hover:underline">
                      clear
                    </button>
                  )}
                </p>
              )}
              <ul className="space-y-2">
                {items.map((s) => (
                  <SkillCard key={`${s.id}:${lib.id}`} skill={s} libraries={libraries} onOpen={onOpen} onTransfer={onTransfer} onDelete={onDelete} />
                ))}
              </ul>
            </div>
          </section>
        );
      })}
    </div>
  );
}
