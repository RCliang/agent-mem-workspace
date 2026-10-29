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
import { ArrowRightLeft, BrainCircuit, FilePlus2, FileText, Link2, MessagesSquare } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api, type AgentSummary, type MemoryItem } from '../api';
import { useI18n, type MessageKey } from '../i18n';
import { AgentDot, AgentIcon, cx, formatSize, shouldMoveColumn, Tag, useColumnOrder, useRelativeTime, useTildify } from '../ui';
import { ArmedAction } from './ArmedAction';
import { useToast } from './Toasts';

/**
 * PointerSensor ignores events whose `isPrimary` flag is false. Remote desktops
 * and some automation stacks synthesize the only pointer that way, so a drag
 * never starts and the browser selects text instead. Accept any primary button.
 */
class AnyPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent: event }: { nativeEvent: PointerEvent }, { onActivation }: { onActivation?: (args: { event: Event }) => void }) => {
        if (event.button !== 0) return false;
        onActivation?.({ event });
        return true;
      },
    },
  ] as typeof PointerSensor.activators;
}

const KIND_ORDER: MemoryItem['kind'][] = ['instructions', 'auto-memory', 'session'];
const KIND_LABEL: Record<MemoryItem['kind'], MessageKey> = { instructions: 'board.instructions', 'auto-memory': 'board.autoMemory', session: 'board.sessions' };
const SCOPE_LABEL: Record<MemoryItem['scope'], MessageKey> = { global: 'common.global', project: 'common.project', local: 'common.private' };

function KindIcon({ kind, className }: { kind: MemoryItem['kind']; className?: string }) {
  if (kind === 'session') return <MessagesSquare className={className} />;
  if (kind === 'auto-memory') return <BrainCircuit className={className} />;
  return <FileText className={className} />;
}

function CardBody({ item, agents, dragging }: { item: MemoryItem; agents: AgentSummary[]; dragging?: boolean }) {
  const { t } = useI18n();
  const relativeTime = useRelativeTime();
  const tildify = useTildify();
  const name = (id: string) => agents.find((a) => a.id === id)?.displayName ?? id;
  return (
    <div
      className={cx(
        'rounded-lg bg-ink-850 px-3.5 py-3 transition-[background-color,box-shadow,transform] duration-150',
        dragging ? 'rotate-[0.6deg] scale-[1.02] shadow-[var(--shadow-drag)] outline outline-signal/70' : 'shadow-[var(--shadow-card)] group-hover:bg-ink-800',
      )}
    >
      <div className="flex items-start gap-2.5">
        <KindIcon kind={item.kind} className="mt-0.5 size-4 shrink-0 text-paper-dim" />
        <div className="min-w-0 flex-1">
          <p className={cx('text-[13px] leading-5 font-medium', item.kind === 'session' ? 'line-clamp-2' : 'truncate')}>{item.title}</p>
          <p className="mt-1 truncate font-mono text-[11px] leading-4 text-paper-mute" title={item.filePath}>
            {tildify(item.filePath)}
          </p>
        </div>
        <span className="size-4 shrink-0" aria-hidden />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Tag>{t(SCOPE_LABEL[item.scope])}</Tag>
        {item.isSymlink && (
          <Tag title={t('board.symlinkTitle')}>
            <Link2 className="size-3" /> {t('board.link')}
          </Tag>
        )}
        {item.alsoReadBy.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] text-paper-mute" title={t('common.alsoReadByTitle', { names: item.alsoReadBy.map(name).join(', ') })}>
            {t('common.alsoReadBy')}
            {item.alsoReadBy.map((a) => (
              <AgentDot key={a} agent={a} size={7} />
            ))}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2 text-[11px] whitespace-nowrap text-paper-mute">
          {item.kind === 'session' && <span>{formatSize(item.size)}</span>}
          <span>{relativeTime(item.mtimeMs)}</span>
        </span>
      </div>
    </div>
  );
}

function deleteArmedLabel(item: MemoryItem, agents: AgentSummary[], t: ReturnType<typeof useI18n>['t']) {
  if (item.alsoReadBy.length === 0) return t('board.deleteFile');
  const names = item.alsoReadBy.map((id) => agents.find((a) => a.id === id)?.displayName ?? id);
  return t('board.deleteShared', { names: names.join(', ') });
}

/** Pill that follows the cursor while a column header is being dragged. */
function ColumnGhost({ agent }: { agent: AgentSummary }) {
  const { t } = useI18n();
  return (
    <div className="flex cursor-grabbing items-center gap-2.5 rounded-lg border border-signal/70 bg-ink-850 px-4 py-2.5 shadow-[var(--shadow-drag)]">
      <AgentIcon agent={agent.id} size={18} />
      <span className="text-[14px] font-semibold">{agent.displayName}</span>
      <span className="text-[11px] text-paper-mute">{t('common.move')}</span>
    </div>
  );
}

function HideHandle({ agentId }: { agentId: string }) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `hide:${agentId}`, data: { kind: 'hide', agentId } });
  return (
    <button
      ref={setNodeRef}
      type="button"
      aria-label={t('board.dragHide')}
      {...listeners}
      {...attributes}
      className={cx('inline-flex cursor-grab items-center justify-center rounded-md p-1 hover:bg-ink-800 active:cursor-grabbing', isDragging && 'opacity-40')}
    >
      <AgentDot agent={agentId} size={10} />
    </button>
  );
}

function DraggableCard({
  item,
  agents,
  onOpen,
  onSend,
  onReveal,
  onDelete,
}: {
  item: MemoryItem;
  agents: AgentSummary[];
  onOpen: (m: MemoryItem) => void;
  onSend: (item: MemoryItem, agent: string) => void;
  onReveal: (item: MemoryItem) => void;
  onDelete: (item: MemoryItem) => void;
}) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `${item.agent}:${item.id}`, data: { item } });
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const targets = agents.filter((a) => a.id !== item.agent && !item.alsoReadBy.includes(a.id));
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
        onClick={() => onOpen(item)}
        aria-label={t('board.cardAria', { title: item.title })}
        className={cx('group block w-full cursor-grab rounded-lg text-left select-none active:cursor-grabbing', isDragging && 'opacity-35')}
      >
        <CardBody item={item} agents={agents} />
      </button>
      {item.kind === 'instructions' && (
        <div className="mt-1 flex items-center justify-end gap-1 px-1">
          <button
            type="button"
            className="rounded-md px-1.5 py-0.5 text-[11px] text-paper-mute hover:bg-ink-800 hover:text-paper"
            onClick={() => onReveal(item)}
          >
            {t('board.reveal')}
          </button>
          <ArmedAction label={t('common.delete')} armedLabel={deleteArmedLabel(item, agents, t)} onConfirm={() => onDelete(item)} />
        </div>
      )}
      {targets.length > 0 && (
        <div ref={menuRef} className="absolute top-2 right-2">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={t('board.sendAria', { title: item.title })}
            onClick={() => setOpen((v) => !v)}
            className="rounded-md p-1 text-paper-mute hover:bg-ink-800 hover:text-paper"
          >
            <ArrowRightLeft className="size-3.5" />
          </button>
          {open && (
            <div role="menu" className="absolute right-0 z-[var(--z-dropdown)] mt-1 w-48 rounded-lg border border-ink-600 bg-ink-850 p-1 shadow-[var(--shadow-menu)]">
              {targets.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onSend(item, a.id);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-ink-700"
                >
                  <AgentIcon agent={a.id} size={14} />
                  {t(item.kind === 'session' ? 'board.handoffTo' : 'board.copyTo', { name: a.displayName })}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

type DropHint = { kind: 'source' } | { kind: 'native' } | { kind: 'copy' } | { kind: 'handoff' };

function hintFor(item: MemoryItem | null, agent: string): DropHint | null {
  if (!item) return null;
  if (item.agent === agent) return { kind: 'source' };
  if (item.alsoReadBy.includes(agent)) return { kind: 'native' };
  return item.kind === 'session' ? { kind: 'handoff' } : { kind: 'copy' };
}

function SharedLayer({
  items,
  agents,
  onOpen,
  onSend,
  onReveal,
  onDelete,
}: {
  items: MemoryItem[];
  agents: AgentSummary[];
  onOpen: (m: MemoryItem) => void;
  onSend: (item: MemoryItem, agent: string) => void;
  onReveal: (item: MemoryItem) => void;
  onDelete: (item: MemoryItem) => void;
}) {
  const { t } = useI18n();
  const groups = KIND_ORDER.map((kind) => [kind, items.filter((item) => item.kind === kind)] as const).filter(([, xs]) => xs.length > 0);
  return (
    <section aria-label={t('board.sharedBy')} className="max-h-[45%] shrink-0 overflow-y-auto border-b border-ink-700 bg-ink-950">
      <header className="sticky top-0 z-10 flex min-h-12 items-center gap-2.5 border-b border-ink-700 bg-ink-950 px-5 py-3">
        <Link2 className="size-4 shrink-0 text-signal" aria-hidden />
        <h2 className="text-[13px] font-semibold">{t('board.sharedBy')}</h2>
        <span className="text-[12px] tabular-nums text-paper-mute">{items.length}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {agents.map((agent) => (
            <span key={agent.id} title={agent.displayName}>
              <AgentIcon agent={agent.id} size={15} />
            </span>
          ))}
        </div>
      </header>
      <div className="px-5 py-4">
        {groups.map(([kind, xs]) => (
          <div key={kind} className="mb-4 last:mb-0">
            <h3 className="mb-3! flex items-baseline gap-1.5 px-1 text-[12px] font-medium text-paper-dim">
              {t(KIND_LABEL[kind])} <span className="text-paper-mute">{xs.length}</span>
            </h3>
            <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-2.5">
              {xs.map((item) => (
                <DraggableCard key={item.id} item={item} agents={agents} onOpen={onOpen} onSend={onSend} onReveal={onReveal} onDelete={onDelete} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function Column({
  agent,
  items,
  agents,
  dragged,
  project,
  hasWriteTarget,
  emptyHint,
  onClearSearch,
  movingColumn,
  onOpen,
  onSend,
  onCreate,
  onReveal,
  onDelete,
}: {
  agent: AgentSummary;
  items: MemoryItem[];
  agents: AgentSummary[];
  dragged: MemoryItem | null;
  project: string | null;
  hasWriteTarget: boolean;
  /** Shown instead of the default text when a search emptied the column. */
  emptyHint?: string;
  onClearSearch?: () => void;
  /** Agent id of a column being dragged to a new position, if any. */
  movingColumn: string | null;
  onOpen: (m: MemoryItem) => void;
  onSend: (item: MemoryItem, agent: string) => void;
  onCreate: (agent: string) => void;
  onReveal: (item: MemoryItem) => void;
  onDelete: (item: MemoryItem) => void;
}) {
  const { t } = useI18n();
  const hint = hintFor(dragged, agent.id);
  const disabled = hint?.kind === 'source' || hint?.kind === 'native';
  const { setNodeRef, isOver } = useDroppable({ id: agent.id, disabled });
  const { attributes: columnAttrs, listeners: columnListeners, setNodeRef: setHeaderRef } = useDraggable({
    id: `col:${agent.id}`,
    data: { kind: 'column', columnId: agent.id },
  });
  const groups = KIND_ORDER.map((k) => [k, items.filter((i) => i.kind === k)] as const).filter(([, xs]) => xs.length > 0);
  const columnDropTarget = movingColumn && movingColumn !== agent.id && isOver;

  return (
    <section
      ref={setNodeRef}
      data-agent-column={agent.id}
      aria-label={agent.displayName}
      className={cx(
        'relative flex min-w-0 flex-col border-r border-b border-ink-700 bg-ink-900 transition-[border-color,background-color] duration-200',
        movingColumn
          ? columnDropTarget
            ? 'border-signal bg-ink-950 outline-2 -outline-offset-2 outline-dashed outline-signal/50'
            : ''
          : isOver && !disabled
            ? 'border-signal bg-ink-950 outline-2 -outline-offset-2 outline-signal'
            : '',
        movingColumn === agent.id && 'opacity-70',
        dragged && disabled && 'opacity-55',
      )}
    >
      <header
        ref={setHeaderRef}
        data-agent-header={agent.id}
        {...columnListeners}
        {...columnAttrs}
        title={t('common.dragReorder')}
        className="flex min-h-14 shrink-0 cursor-grab items-center gap-2.5 border-b border-ink-700 px-5 py-4 select-none active:cursor-grabbing"
      >
        <span onPointerDown={(e) => e.stopPropagation()}>
          <HideHandle agentId={agent.id} />
        </span>
        <AgentIcon agent={agent.id} size={18} />
        <h2 className="text-[14px] font-semibold">{agent.displayName}</h2>
        {!agent.detected && <Tag tone="warn">{t('board.notInstalled')}</Tag>}
        <span className="ml-auto text-[11px] text-paper-mute" title={t(agent.capabilities.imports ? 'board.readsImports' : 'board.inlined')}>
          {t(agent.capabilities.imports ? 'board.readsImports' : 'board.inlined')}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {groups.length === 0 && (
          <p className="px-1 py-2 text-[13px] text-paper-mute">
            {emptyHint ?? t('board.noIndividual')}
            {emptyHint && onClearSearch && (
              <button type="button" onClick={onClearSearch} className="ml-1 text-signal hover:underline">
                {t('common.clear')}
              </button>
            )}
          </p>
        )}
        {groups.map(([kind, xs]) => (
          <div key={kind} className="mb-5 last:mb-0">
            <h3 className="mb-3! flex items-baseline gap-1.5 px-1 text-[12px] font-medium text-paper-dim">
              {t(KIND_LABEL[kind])} <span className="text-paper-mute">{xs.length}</span>
            </h3>
            <ul className="space-y-2.5">
              {xs.map((item) => (
                <DraggableCard key={item.id} item={item} agents={agents} onOpen={onOpen} onSend={onSend} onReveal={onReveal} onDelete={onDelete} />
              ))}
            </ul>
          </div>
        ))}
        {!hasWriteTarget && (
          <button
            type="button"
            onClick={() => onCreate(agent.id)}
            className="mt-3 flex min-h-9 w-full items-center justify-center gap-2 rounded-md border border-dashed border-ink-600 px-3 py-2 text-[12px] text-paper-dim hover:border-ink-500 hover:bg-ink-850 hover:text-paper"
          >
            <FilePlus2 className="size-3.5" /> {t('board.createInstructions', { scope: t(project ? 'common.project' : 'common.global') })}
          </button>
        )}
      </div>

      {hint && !disabled && (
        <div
          className={cx(
            'pointer-events-none absolute inset-x-4 bottom-4 rounded-lg border border-dashed px-3 py-2.5 text-center text-[12px] transition-colors',
            isOver ? 'border-signal bg-signal/10 text-signal' : 'border-ink-500 bg-ink-900/95 text-paper-dim',
          )}
        >
          {t(hint.kind === 'handoff' ? 'board.dropHandoff' : 'board.dropCopy', { name: agent.displayName })}
        </div>
      )}
      {hint?.kind === 'native' && (
        <div className="pointer-events-none absolute inset-x-4 bottom-4 rounded-lg bg-ink-800 px-3 py-2.5 text-center text-[12px] text-paper-mute">
          {t('board.alreadyReads')}
        </div>
      )}
    </section>
  );
}

export function Board({
  agents,
  memories,
  project,
  query,
  onClearSearch,
  onOpen,
  onDrop,
  onCreate,
  onHide,
  onChanged,
}: {
  agents: AgentSummary[];
  memories: MemoryItem[];
  project: string | null;
  /** Active search query, so empty columns can say why they are empty. */
  query?: string;
  onClearSearch?: () => void;
  onOpen: (m: MemoryItem) => void;
  onDrop: (item: MemoryItem, targetAgent: string) => void;
  onCreate: (agent: string) => void;
  onHide: (agentId: string) => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [dragged, setDragged] = useState<MemoryItem | null>(null);
  const [hiding, setHiding] = useState<string | null>(null);
  const toast = useToast();
  // Column order is shared with the Skills view and persisted in localStorage.
  const [{ indexOf }, moveColumn] = useColumnOrder('agent-mem:column-order', agents.map((a) => a.id));
  const orderedAgents = useMemo(() => [...agents].sort((x, y) => indexOf(x.id) - indexOf(y.id)), [agents, indexOf]);
  const [movingColumn, setMovingColumn] = useState<string | null>(null);
  // dnd-kit drops at the last pointermove. A pointer that jumps (remote desktop,
  // some automation) only reports the final position on pointerup, so remember it.
  const pointer = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const track = (e: PointerEvent | MouseEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    for (const type of ['pointermove', 'pointerup', 'mousemove', 'mouseup'] as const) {
      window.addEventListener(type, track, true);
    }
    return () => {
      for (const type of ['pointermove', 'pointerup', 'mousemove', 'mouseup'] as const) window.removeEventListener(type, track, true);
    };
  }, []);
  const sensors = useSensors(useSensor(AnyPointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor));
  const collision: CollisionDetection = (args) => {
    const hits = pointerWithin(args);
    return hits.length > 0 ? hits : rectIntersection(args);
  };

  const onDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current as { kind?: string; agentId?: string; columnId?: string; item?: MemoryItem } | undefined;
    if (data?.kind === 'hide') {
      setHiding(data.agentId ?? null);
      return;
    }
    if (data?.kind === 'column') {
      lastSwap.current = {};
      setMovingColumn(data.columnId ?? null);
      return;
    }
    setDragged(data?.item ?? null);
  };
  const onDragEnd = (e: DragEndEvent) => {
    const data = e.active.data.current as { kind?: string; agentId?: string; columnId?: string; item?: MemoryItem } | undefined;
    if (data?.kind === 'hide') {
      setHiding(null);
      const header = document.elementFromPoint(pointer.current.x, pointer.current.y)?.closest('[data-agent-header]');
      const under = header instanceof HTMLElement ? header.dataset.agentHeader : undefined;
      if (data.agentId && under !== data.agentId) onHide(data.agentId);
      return;
    }
    if (data?.kind === 'column') {
      setMovingColumn(null);
      const over = e.over?.id as string | undefined;
      const active = data.columnId;
      if (active && over && shouldMoveColumn(active, over, lastSwap.current)) moveColumn(active, over);
      return;
    }
    const item = data?.item;    setDragged(null);
    if (!item) return;
    const column = document.elementFromPoint(pointer.current.x, pointer.current.y)?.closest('[data-agent-column]');
    const underPointer = column instanceof HTMLElement ? column.dataset.agentColumn : undefined;
    const target = underPointer ?? (e.over?.id as string | undefined);
    if (target && target !== item.agent && !item.alsoReadBy.includes(target)) onDrop(item, target);
  };

  /** While a column drag is held, swap columns live so the new order previews before the mouse is released. */
  const lastSwap = useRef<{ active?: string; over?: string }>({});
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

  async function reveal(item: MemoryItem) {
    try {
      await api.revealMemory(item.id, project);
    } catch (e) {
      toast({ tone: 'error', message: (e as Error).message });
    }
  }

  async function remove(item: MemoryItem) {
    try {
      const res = await api.deleteMemory(item.id, project, item.hash);
      toast({ tone: 'ok', message: t(res.backupId ? 'board.deleted' : 'board.alreadyGone', { title: item.title }) });
      onChanged();
    } catch (e) {
      toast({ tone: 'error', message: e instanceof ApiError ? e.message : (e as Error).message });
    }
  }

  const { sharedItems, sharedIds } = useMemo(() => {
    if (agents.length < 2) return { sharedItems: [], sharedIds: new Set<string>() };
    const candidates = memories.filter((item) => {
      if (item.kind !== 'instructions' && item.kind !== 'session') return false;
      const readers = new Set([item.agent, ...item.alsoReadBy]);
      return agents.filter((agent) => readers.has(agent.id)).length >= 2;
    });
    const seen = new Set<string>();
    const sharedItems = candidates.filter((item) => {
      const key = `${item.kind}:${item.filePath}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { sharedItems, sharedIds: new Set(candidates.map((item) => item.id)) };
  }, [agents, memories]);

  return (
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
        setHiding(null);
        setMovingColumn(null);
      }}
    >
      <div className="flex h-full min-h-0 flex-col">
        {sharedItems.length > 0 && (
          <SharedLayer
            items={sharedItems}
            agents={orderedAgents}
            onOpen={onOpen}
            onSend={onDrop}
            onReveal={(item) => void reveal(item)}
            onDelete={(item) => void remove(item)}
          />
        )}
        <div className="grid min-h-0 flex-1 auto-rows-[minmax(360px,1fr)] grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] overflow-y-auto">
          {agents.length === 0 && (
            <p className="m-auto max-w-lg px-6 py-8 text-center text-[13px] text-paper-mute">{t('board.allHidden')}</p>
          )}
          {orderedAgents.map((a) => (
            <Column
              key={a.id}
              agent={a}
              agents={agents}
              items={memories.filter((m) => m.agent === a.id && !sharedIds.has(m.id))}
              dragged={dragged}
              movingColumn={movingColumn}
              project={project}
              hasWriteTarget={memories.some((i) => i.isWriteTarget && i.scope === (project ? 'project' : 'global') && i.agent === a.id)}
              emptyHint={query?.trim() ? t('board.noMatches', { query: query.trim() }) : undefined}
              onClearSearch={onClearSearch}
              onOpen={onOpen}
              onSend={onDrop}
              onCreate={onCreate}
              onReveal={(item) => void reveal(item)}
              onDelete={(item) => void remove(item)}
            />
          ))}
        </div>
      </div>
      <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }} style={{ pointerEvents: 'none' }}>
        {hiding ? (
          <div className="pointer-events-none">
            <AgentDot agent={hiding} size={12} />
          </div>
        ) : movingColumn ? (
          <div className="pointer-events-none cursor-grabbing">
            <ColumnGhost agent={agents.find((a) => a.id === movingColumn)!} />
          </div>
        ) : dragged ? (
          <div className="pointer-events-none w-[320px] cursor-grabbing">
            <CardBody item={dragged} agents={agents} dragging />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
