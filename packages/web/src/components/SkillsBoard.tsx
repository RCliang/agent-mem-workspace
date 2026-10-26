import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { ArrowRightLeft, Blocks, Search, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { SkillItem, SkillLibrary } from '../api';
import { AgentDot, AgentIcon, cx, EmptyState, formatSize, relativeTime, Tag } from '../ui';

function SkillCardBody({ skill, nameOf, dragging }: { skill: SkillItem; nameOf: (id: string) => string; dragging?: boolean }) {
  return (
    <div
      className={
        dragging
          ? 'rounded-lg border border-signal/70 bg-ink-850 px-3 py-2.5 shadow-[0_16px_40px_-10px_rgba(0,0,0,0.7)]'
          : 'rounded-lg border border-ink-700 bg-ink-850 px-3 py-2.5 transition-colors group-hover:border-ink-500'
      }
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
          <span className="inline-flex items-center gap-1 text-[11px] text-paper-mute" title={`Also read by ${skill.alsoReadBy.map(nameOf).join(', ')}`}>
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
    </div>
  );
}

function SkillCard({
  skill,
  libId,
  libraries,
  onOpen,
  onTransfer,
  onDelete,
}: {
  skill: SkillItem;
  libId: string;
  libraries: SkillLibrary[];
  onOpen: (s: SkillItem) => void;
  onTransfer: (s: SkillItem, target: string) => void;
  onDelete: (s: SkillItem) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `${libId}:${skill.id}`, data: { skill } });
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const nameOf = (id: string) => libraries.find((l) => l.id === id)?.displayName ?? id;
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
        ref={setNodeRef}
        type="button"
        {...listeners}
        {...attributes}
        onClick={() => onOpen(skill)}
        aria-label={`${skill.name}. Drag it onto another library to copy it, or open to read and edit its SKILL.md.`}
        className={cx('group block w-full cursor-grab text-left select-none active:cursor-grabbing', isDragging && 'opacity-35')}
      >
        <SkillCardBody skill={skill} nameOf={nameOf} />
      </button>
      {(targets.length > 0 || !skill.shared) && (
        <div ref={menuRef} className="absolute top-2 right-2">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={`Migrate or delete ${skill.name}`}
            onClick={() => setOpen((v) => !v)}
            className="rounded p-1 text-ink-500 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-ink-800 hover:text-paper focus-visible:opacity-100"
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

function SkillColumn({
  lib,
  items,
  libraries,
  dragged,
  emptyHint,
  onClearSearch,
  onOpen,
  onTransfer,
  onDelete,
}: {
  lib: SkillLibrary;
  items: SkillItem[];
  libraries: SkillLibrary[];
  dragged: SkillItem | null;
  emptyHint?: string;
  onClearSearch?: () => void;
  onOpen: (s: SkillItem) => void;
  onTransfer: (s: SkillItem, target: string) => void;
  onDelete: (s: SkillItem) => void;
}) {
  const disabled = !!dragged && (dragged.agent === lib.id || dragged.alsoReadBy.includes(lib.id));
  const { setNodeRef, isOver } = useDroppable({ id: lib.id, disabled });
  return (
    <section
      ref={setNodeRef}
      data-skill-column={lib.id}
      aria-label={lib.displayName}
      className={cx(
        'relative flex min-w-[300px] flex-1 basis-0 flex-col rounded-xl border bg-ink-900 transition-[border-color,background-color] duration-200',
        isOver && !disabled ? 'border-signal bg-ink-850' : 'border-ink-700',
        dragged && disabled && 'opacity-55',
      )}
    >
      <header className="flex items-center gap-2.5 border-b border-ink-700 px-4 py-3">
        {lib.id === 'shared' ? <Blocks className="size-[18px] text-paper-mute" aria-hidden /> : <AgentIcon agent={lib.id} size={18} />}
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
            {emptyHint ?? 'No skills in this library yet.'}
            {emptyHint && onClearSearch && (
              <button type="button" onClick={onClearSearch} className="ml-1 text-signal hover:underline">
                clear
              </button>
            )}
          </p>
        )}
        <ul className="space-y-2">
          {items.map((s) => (
            <SkillCard key={`${lib.id}:${s.id}`} skill={s} libId={lib.id} libraries={libraries} onOpen={onOpen} onTransfer={onTransfer} onDelete={onDelete} />
          ))}
        </ul>
      </div>

      {dragged && !disabled && (
        <div
          className={cx(
            'pointer-events-none absolute inset-x-3 bottom-3 rounded-lg border border-dashed px-3 py-2.5 text-center text-[12px] transition-colors',
            isOver ? 'border-signal bg-signal/10 text-signal' : 'border-ink-500 bg-ink-900/95 text-paper-dim',
          )}
        >
          Drop to copy “{dragged.name}” into {lib.displayName}
        </div>
      )}
      {dragged && disabled && (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-lg bg-ink-800 px-3 py-2.5 text-center text-[12px] text-paper-mute">
          Already in this library
        </div>
      )}
    </section>
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
  /** Active header search query, so empty columns can say why they are empty. */
  query?: string;
  onClearSearch?: () => void;
  onOpen: (s: SkillItem) => void;
  onTransfer: (s: SkillItem, target: string) => void;
  onDelete: (s: SkillItem) => void;
}) {
  const [filter, setFilter] = useState('');
  const [dragged, setDragged] = useState<SkillItem | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor));
  const collision: CollisionDetection = (args) => {
    const hits = pointerWithin(args);
    return hits.length > 0 ? hits : rectIntersection(args);
  };

  if (libraries.length === 0) {
    return <EmptyState icon={Blocks} title="No skill libraries found" hint="Install an agent with a skills folder, or create ~/.agents/skills." />;
  }

  const needle = filter.trim().toLowerCase();
  const visible = needle ? skills.filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(needle)) : skills;
  const searching = !!query?.trim() || !!needle;
  const emptyHint = searching
    ? `No matches${needle ? ` for “${filter.trim()}”` : ''}${query?.trim() && needle ? ' (or the header search)' : ''}.`
    : undefined;

  const onDragStart = (e: DragStartEvent) => setDragged((e.active.data.current as { skill: SkillItem } | undefined)?.skill ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    const skill = (e.active.data.current as { skill: SkillItem } | undefined)?.skill;
    setDragged(null);
    const target = e.over?.id as string | undefined;
    if (skill && target && target !== skill.agent && !skill.alsoReadBy.includes(target)) onTransfer(skill, target);
  };
  const nameOf = (id: string) => libraries.find((l) => l.id === id)?.displayName ?? id;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-ink-700 px-5 py-3">
        <Search className="size-4 shrink-0 text-paper-mute" aria-hidden />
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setFilter('')}
          placeholder="Filter skills by name or description…"
          aria-label="Filter skills"
          className="h-8 w-full max-w-md rounded-md border border-ink-600 bg-ink-950 px-3 text-[13px] text-paper placeholder:text-paper-mute focus:border-signal focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {filter && (
          <button
            type="button"
            onClick={() => setFilter('')}
            aria-label="Clear skill filter"
            className="shrink-0 rounded p-1 text-paper-mute hover:text-paper"
          >
            <X className="size-3.5" />
          </button>
        )}
        <span className="ml-auto shrink-0 text-[12px] text-paper-mute" title="Skills matching the filter">
          {visible.length}/{skills.length}
        </span>
      </div>

      <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragged(null)}>
        <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto p-5">
          {libraries.map((lib) => (
            <SkillColumn
              key={lib.id}
              lib={lib}
              libraries={libraries}
              items={visible.filter((s) => s.agent === lib.id || s.alsoReadBy.includes(lib.id))}
              dragged={dragged}
              emptyHint={emptyHint}
              onClearSearch={onClearSearch ?? (() => setFilter(''))}
              onOpen={onOpen}
              onTransfer={onTransfer}
              onDelete={onDelete}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }}>
          {dragged ? (
            <div className="pointer-events-none w-[300px] cursor-grabbing">
              <SkillCardBody skill={dragged} nameOf={nameOf} dragging />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
