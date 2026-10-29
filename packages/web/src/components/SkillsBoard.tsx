import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { ArrowRightLeft, Blocks, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SkillItem, SkillLibrary } from '../api';
import { useI18n } from '../i18n';
import { AgentDot, AgentIcon, cx, EmptyState, formatSize, shouldMoveColumn, Tag, useColumnOrder, useRelativeTime } from '../ui';

function SkillCardBody({ skill, nameOf, dragging }: { skill: SkillItem; nameOf: (id: string) => string; dragging?: boolean }) {
  const { t } = useI18n();
  const relativeTime = useRelativeTime();
  return (
    <div
      className={
        dragging
          ? 'rotate-[0.6deg] scale-[1.02] rounded-lg bg-ink-850 px-3.5 py-3 shadow-[var(--shadow-drag)] outline outline-signal/70'
          : 'rounded-lg bg-ink-850 px-3.5 py-3 shadow-[var(--shadow-card)] transition-[background-color,box-shadow,transform] duration-150 group-hover:bg-ink-800'
      }
    >
      <p className="truncate pr-5 text-[13px] leading-snug font-medium text-paper">{skill.name}</p>
      {skill.description && <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-paper-dim">{skill.description}</p>}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {skill.scope === 'project' && <Tag>{t('common.project')}</Tag>}
        {skill.shared && (
          <Tag tone="warn" title={t('skills.sharedTitle')}>
            {t('common.shared')}
          </Tag>
        )}
        {skill.alsoReadBy.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] text-paper-mute" title={t('common.alsoReadByTitle', { names: skill.alsoReadBy.map(nameOf).join(', ') })}>
            {t('common.alsoReadBy')}
            {skill.alsoReadBy.map((a) => (
              <AgentDot key={a} agent={a} size={7} />
            ))}
          </span>
        )}
        <span className="ml-auto flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-[11px] whitespace-nowrap text-paper-mute">
          <span>{t('common.files', { count: skill.fileCount, suffix: skill.fileCount === 1 ? '' : 's' })}</span>
          <span>{formatSize(skill.sizeBytes)}</span>
          <span>{relativeTime(skill.mtimeMs)}</span>
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
  const { t } = useI18n();
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
    <li className="group relative">
      <button
        ref={setNodeRef}
        type="button"
        {...listeners}
        {...attributes}
        onClick={() => onOpen(skill)}
        aria-label={t('skills.cardAria', { name: skill.name })}
        className={cx('block w-full cursor-grab text-left select-none active:cursor-grabbing', isDragging && 'opacity-35')}
      >
        <SkillCardBody skill={skill} nameOf={nameOf} />
      </button>
      {(targets.length > 0 || !skill.shared) && (
        <div ref={menuRef} className="absolute top-2 right-2">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={t('skills.migrateDelete', { name: skill.name })}
            onClick={() => setOpen((v) => !v)}
            className="hit-target rounded-md p-1 text-ink-500 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-ink-700 hover:text-paper focus-visible:opacity-100 max-lg:opacity-100 [@media(pointer:coarse)]:opacity-100"
          >
            <ArrowRightLeft className="size-3.5" />
          </button>
          {open && (
            <div role="menu" className="absolute right-0 z-[var(--z-dropdown)] mt-1 w-56 rounded-lg border border-ink-600 bg-ink-850 p-1 shadow-[var(--shadow-menu)]">
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
                  {t('skills.migrateTo', { name: l.displayName })}
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
                <Trash2 className="size-3.5" /> {t('common.deleteEllipsis')}
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
  movingColumn,
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
  /** Library id of a column being dragged to a new position, if any. */
  movingColumn: string | null;
  emptyHint?: string;
  onClearSearch?: () => void;
  onOpen: (s: SkillItem) => void;
  onTransfer: (s: SkillItem, target: string) => void;
  onDelete: (s: SkillItem) => void;
}) {
  const { t } = useI18n();
  const disabled = !!dragged && (dragged.agent === lib.id || dragged.alsoReadBy.includes(lib.id));
  const { setNodeRef, isOver } = useDroppable({ id: lib.id, disabled });
  const { attributes: columnAttrs, listeners: columnListeners, setNodeRef: setHeaderRef } = useDraggable({
    id: `col:${lib.id}`,
    data: { kind: 'column', columnId: lib.id },
  });
  const columnDropTarget = movingColumn && movingColumn !== lib.id && isOver;
  return (
    <section
      ref={setNodeRef}
      data-skill-column={lib.id}
      aria-label={lib.displayName}
      className={cx(
        'relative flex min-w-0 flex-col border-r border-b border-ink-700 bg-ink-900 transition-[border-color,background-color] duration-200',
        movingColumn
          ? columnDropTarget
            ? 'border-signal bg-ink-950 outline-2 -outline-offset-2 outline-dashed outline-signal/50'
            : ''
          : isOver && !disabled
            ? 'border-signal bg-ink-950 outline-2 -outline-offset-2 outline-signal'
            : '',
        movingColumn === lib.id && 'opacity-70',
        dragged && disabled && 'opacity-55',
      )}
    >
      <header
        ref={setHeaderRef}
        {...columnListeners}
        {...columnAttrs}
        title={t('common.dragReorder')}
        className="flex min-h-14 shrink-0 cursor-grab items-center gap-2.5 border-b border-ink-700 px-5 py-4 select-none active:cursor-grabbing"
      >
        {lib.id === 'shared' ? <Blocks className="size-[18px] shrink-0 text-paper-mute" aria-hidden /> : <AgentIcon agent={lib.id} size={18} />}
        <h2 className="truncate text-[14px] leading-5 font-semibold">{lib.displayName}</h2>
        {lib.id === 'shared' && (
          <Tag tone="warn" title={t('skills.sharedLibraryTitle')}>
            {t('common.shared')}
          </Tag>
        )}
        <span className="ml-auto shrink-0 text-[12px] font-medium tabular-nums text-paper-dim">{items.length}</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {items.length === 0 && (
          <p className="px-1 py-2 text-[13px] text-paper-mute">
            {emptyHint ?? t('skills.noSkills')}
            {emptyHint && onClearSearch && (
              <button type="button" onClick={onClearSearch} className="ml-1 text-signal hover:underline">
                {t('common.clear')}
              </button>
            )}
          </p>
        )}
        <ul className="space-y-2.5">
          {items.map((s) => (
            <SkillCard key={`${lib.id}:${s.id}`} skill={s} libId={lib.id} libraries={libraries} onOpen={onOpen} onTransfer={onTransfer} onDelete={onDelete} />
          ))}
        </ul>
      </div>

      {dragged && !disabled && (
        <div
          className={cx(
            'pointer-events-none absolute inset-x-4 bottom-4 rounded-lg border border-dashed px-3 py-2.5 text-center text-[12px] transition-colors',
            isOver ? 'border-signal bg-signal/10 text-signal' : 'border-ink-500 bg-ink-900/95 text-paper-dim',
          )}
        >
          {t('skills.dropCopy', { name: dragged.name, library: lib.displayName })}
        </div>
      )}
      {dragged && disabled && (
        <div className="pointer-events-none absolute inset-x-4 bottom-4 rounded-lg bg-ink-800 px-3 py-2.5 text-center text-[12px] text-paper-mute">
          {t('skills.alreadyInLibrary')}
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
  const { t } = useI18n();
  const [filter, setFilter] = useState('');
  const [dragged, setDragged] = useState<SkillItem | null>(null);
  const [movingColumn, setMovingColumn] = useState<string | null>(null);
  const lastSwap = useRef<{ active?: string; over?: string }>({});
  // Library order is shared with the memory Board and persisted in localStorage.
  const [{ indexOf }, moveColumn] = useColumnOrder('agent-mem:column-order', libraries.map((l) => l.id));
  const orderedLibraries = useMemo(() => [...libraries].sort((x, y) => indexOf(x.id) - indexOf(y.id)), [libraries, indexOf]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor));
  const collision: CollisionDetection = (args) => {
    const hits = pointerWithin(args);
    return hits.length > 0 ? hits : rectIntersection(args);
  };

  if (libraries.length === 0) {
    return <EmptyState icon={Blocks} title={t('skills.noLibraries')} hint={t('skills.noLibrariesHint')} />;
  }

  const needle = filter.trim().toLowerCase();
  const visible = needle ? skills.filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(needle)) : skills;
  const searching = !!query?.trim() || !!needle;
  const emptyHint = searching
    ? t('skills.noMatches', {
        query: needle ? t('skills.forQuery', { query: filter.trim() }) : '',
        header: query?.trim() && needle ? t('skills.headerSearch') : '',
      })
    : undefined;

  const onDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as { kind?: string; columnId?: string; skill?: SkillItem } | undefined;
    if (data?.kind === 'column') {
      lastSwap.current = {};
      setMovingColumn(data.columnId ?? null);
      return;
    }
    setDragged(data?.skill ?? null);
  };
  const onDragEnd = (e: DragEndEvent) => {
    const data = e.active.data.current as { kind?: string; columnId?: string; skill?: SkillItem } | undefined;
    if (data?.kind === 'column') {
      setMovingColumn(null);
      const over = e.over?.id as string | undefined;
      const active = data.columnId;
      if (active && over && shouldMoveColumn(active, over, lastSwap.current)) moveColumn(active, over);
      return;
    }
    const skill = data?.skill;
    setDragged(null);
    const target = e.over?.id as string | undefined;
    if (skill && target && target !== skill.agent && !skill.alsoReadBy.includes(target)) onTransfer(skill, target);
  };
  /** While a column drag is held, swap columns live so the new order previews before the mouse is released. */
  const onDragOver = (e: DragOverEvent) => {
    const data = e.active.data.current as { kind?: string; columnId?: string } | undefined;
    if (data?.kind !== 'column') return;
    const over = e.over?.id as string | undefined;
    const active = data.columnId;
    if (!active || !over || over === active) return;
    // Until the droppable rects are re-measured the same pair keeps firing; a
    // second identical event would swap the columns straight back.
    if (!shouldMoveColumn(active, over, lastSwap.current)) return;
    lastSwap.current = { active, over };
    moveColumn(active, over);
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
          placeholder={t('skills.filter')}
          aria-label={t('skills.filterLabel')}
          className="h-9 w-full max-w-md rounded-full border border-ink-600 bg-ink-950 px-4 text-[13px] text-paper placeholder:text-paper-mute [&::-webkit-search-cancel-button]:hidden"
        />
        {filter && (
          <button
            type="button"
            onClick={() => setFilter('')}
            aria-label={t('skills.clearFilter')}
            className="hit-target shrink-0 rounded-md p-1 text-paper-mute hover:bg-ink-800 hover:text-paper"
          >
            <X className="size-3.5" />
          </button>
        )}
        <span className="ml-auto shrink-0 text-[12px] tabular-nums text-paper-mute" title={t('skills.matches')}>
          {visible.length}/{skills.length}
        </span>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        // Reorderings move the droppable columns themselves; keep their rects fresh.
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDragCancel={() => {
          setDragged(null);
          setMovingColumn(null);
        }}
      >
        <div className="grid min-h-0 flex-1 auto-rows-[minmax(320px,1fr)] grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] overflow-y-auto">
          {orderedLibraries.map((lib) => (
            <SkillColumn
              key={lib.id}
              lib={lib}
              libraries={libraries}
              items={visible.filter((s) => s.agent === lib.id || s.alsoReadBy.includes(lib.id))}
              dragged={dragged}
              movingColumn={movingColumn}
              emptyHint={emptyHint}
              onClearSearch={onClearSearch ?? (() => setFilter(''))}
              onOpen={onOpen}
              onTransfer={onTransfer}
              onDelete={onDelete}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }}>
          {movingColumn ? (
            <div className="pointer-events-none cursor-grabbing">
              <div className="flex items-center gap-2.5 rounded-lg border border-signal/70 bg-ink-850 px-4 py-2.5 shadow-[var(--shadow-drag)]">
                {movingColumn === 'shared' ? (
                  <Blocks className="size-[18px] text-paper-mute" aria-hidden />
                ) : (
                  <AgentIcon agent={movingColumn} size={18} />
                )}
                <span className="text-[14px] font-semibold">{libraries.find((l) => l.id === movingColumn)?.displayName}</span>
                <span className="text-[11px] text-paper-mute">{t('common.move')}</span>
              </div>
            </div>
          ) : dragged ? (
            <div className="pointer-events-none w-[300px] cursor-grabbing">
              <SkillCardBody skill={dragged} nameOf={nameOf} dragging />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
