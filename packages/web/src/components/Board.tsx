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
import { ArrowRightLeft, BrainCircuit, FilePlus2, FileText, Link2, MessagesSquare } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiError, api, type AgentSummary, type MemoryItem } from '../api';
import { AgentDot, cx, relativeTime, Tag, useTildify } from '../ui';
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
const KIND_LABEL: Record<MemoryItem['kind'], string> = { instructions: 'Instructions', 'auto-memory': 'Auto memory', session: 'Sessions' };
const SCOPE_LABEL: Record<MemoryItem['scope'], string> = { global: 'global', project: 'project', local: 'private' };

function KindIcon({ kind, className }: { kind: MemoryItem['kind']; className?: string }) {
  if (kind === 'session') return <MessagesSquare className={className} />;
  if (kind === 'auto-memory') return <BrainCircuit className={className} />;
  return <FileText className={className} />;
}

function formatSize(n: number) {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function CardBody({ item, agents, dragging }: { item: MemoryItem; agents: AgentSummary[]; dragging?: boolean }) {
  const tildify = useTildify();
  const name = (id: string) => agents.find((a) => a.id === id)?.displayName ?? id;
  return (
    <div
      className={cx(
        'rounded-lg border bg-ink-850 px-3 py-2.5 transition-[border-color,box-shadow,transform] duration-150',
        dragging ? 'rotate-[0.6deg] border-signal/70 shadow-[0_16px_40px_-10px_rgba(0,0,0,0.7)]' : 'border-ink-700 group-hover:border-ink-500',
      )}
    >
      <div className="flex items-start gap-2">
        <KindIcon kind={item.kind} className="mt-0.5 size-4 shrink-0 text-paper-mute" />
        <div className="min-w-0 flex-1">
          <p className={cx('text-[13px] leading-snug font-medium', item.kind === 'session' ? 'line-clamp-2' : 'truncate')}>{item.title}</p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-paper-mute" title={item.filePath}>
            {tildify(item.filePath)}
          </p>
        </div>
        <span className="size-4 shrink-0" aria-hidden />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Tag>{SCOPE_LABEL[item.scope]}</Tag>
        {item.isSymlink && (
          <Tag title="This file is a symlink">
            <Link2 className="size-3" /> link
          </Tag>
        )}
        {item.alsoReadBy.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] text-paper-mute" title={`Also read by ${item.alsoReadBy.map(name).join(', ')}`}>
            also read by
            {item.alsoReadBy.map((a) => (
              <AgentDot key={a} agent={a} size={7} />
            ))}
          </span>
        )}
        <span className="ml-auto text-[11px] text-paper-mute">
          {item.kind === 'session' ? `${formatSize(item.size)} · ` : ''}
          {relativeTime(item.mtimeMs)}
        </span>
      </div>
    </div>
  );
}

function deleteArmedLabel(item: MemoryItem, agents: AgentSummary[]) {
  if (item.alsoReadBy.length === 0) return 'Delete this file?';
  const names = item.alsoReadBy.map((id) => agents.find((a) => a.id === id)?.displayName ?? id);
  return `Delete? Also read by ${names.join(', ')}`;
}

function HideHandle({ agentId }: { agentId: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `hide:${agentId}`, data: { kind: 'hide', agentId } });
  return (
    <button
      ref={setNodeRef}
      type="button"
      aria-label="Drag off this column to hide the agent"
      {...listeners}
      {...attributes}
      className={cx('cursor-grab rounded-full active:cursor-grabbing', isDragging && 'opacity-40')}
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
        aria-label={`${item.title}. Drag it onto another agent, or use Send to. Enter opens it.`}
        className={cx('group block w-full cursor-grab text-left select-none active:cursor-grabbing', isDragging && 'opacity-35')}
      >
        <CardBody item={item} agents={agents} />
      </button>
      {item.kind === 'instructions' && (
        <div className="mt-1 flex items-center justify-end gap-1">
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-[11px] text-paper-mute hover:bg-ink-800 hover:text-paper"
            onClick={() => onReveal(item)}
          >
            Reveal
          </button>
          <ArmedAction label="Delete" armedLabel={deleteArmedLabel(item, agents)} onConfirm={() => onDelete(item)} />
        </div>
      )}
      {targets.length > 0 && (
        <div ref={menuRef} className="absolute top-2 right-2">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={`Send ${item.title} to another agent`}
            onClick={() => setOpen((v) => !v)}
            className="rounded p-1 text-ink-500 hover:bg-ink-800 hover:text-paper"
          >
            <ArrowRightLeft className="size-3.5" />
          </button>
          {open && (
            <div role="menu" className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-ink-600 bg-ink-850 p-1 shadow-[0_16px_40px_-10px_rgba(0,0,0,0.7)]">
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
                  <AgentDot agent={a.id} size={7} />
                  {item.kind === 'session' ? 'Hand off to' : 'Copy to'} {a.displayName}
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

function Column({
  agent,
  items,
  agents,
  dragged,
  project,
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
  onOpen: (m: MemoryItem) => void;
  onSend: (item: MemoryItem, agent: string) => void;
  onCreate: (agent: string) => void;
  onReveal: (item: MemoryItem) => void;
  onDelete: (item: MemoryItem) => void;
}) {
  const hint = hintFor(dragged, agent.id);
  const disabled = hint?.kind === 'source' || hint?.kind === 'native';
  const { setNodeRef, isOver } = useDroppable({ id: agent.id, disabled });
  const scope = project ? 'project' : 'global';
  const hasWriteTarget = items.some((i) => i.isWriteTarget && i.scope === scope && i.agent === agent.id);
  const groups = KIND_ORDER.map((k) => [k, items.filter((i) => i.kind === k)] as const).filter(([, xs]) => xs.length > 0);

  return (
    <section
      ref={setNodeRef}
      data-agent-column={agent.id}
      aria-label={agent.displayName}
      className={cx(
        'relative flex min-w-[300px] flex-1 basis-0 flex-col rounded-xl border bg-ink-900 transition-[border-color,background-color] duration-200',
        isOver && !disabled ? 'border-signal bg-ink-850' : 'border-ink-700',
        dragged && disabled && 'opacity-55',
      )}
    >
      <header data-agent-header={agent.id} className="flex items-center gap-2.5 border-b border-ink-700 px-4 py-3">
        <HideHandle agentId={agent.id} />
        <h2 className="text-[14px] font-semibold">{agent.displayName}</h2>
        {!agent.detected && <Tag tone="warn">not installed</Tag>}
        <span className="ml-auto text-[11px] text-paper-mute" title={agent.capabilities.imports ? 'Reads @path imports' : 'Shared content is inlined'}>
          {agent.capabilities.imports ? '@imports' : 'inline'}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {groups.length === 0 && <p className="px-1 py-2 text-[13px] text-paper-mute">No memory files for this agent here yet.</p>}
        {groups.map(([kind, xs]) => (
          <div key={kind} className="mb-4 last:mb-0">
            <h3 className="mb-1.5 px-1 text-[12px] font-medium text-paper-mute">
              {KIND_LABEL[kind]} <span className="text-ink-500">{xs.length}</span>
            </h3>
            <ul className="space-y-2">
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
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-ink-600 py-2.5 text-[12px] text-paper-dim hover:border-ink-500 hover:text-paper"
          >
            <FilePlus2 className="size-3.5" /> Create {project ? 'project' : 'global'} instructions
          </button>
        )}
      </div>

      {hint && !disabled && (
        <div
          className={cx(
            'pointer-events-none absolute inset-x-3 bottom-3 rounded-lg border border-dashed px-3 py-2.5 text-center text-[12px] transition-colors',
            isOver ? 'border-signal bg-signal/10 text-signal' : 'border-ink-500 bg-ink-900/95 text-paper-dim',
          )}
        >
          {hint.kind === 'handoff' ? `Drop to hand off this session to ${agent.displayName}` : `Drop to copy into ${agent.displayName}`}
        </div>
      )}
      {hint?.kind === 'native' && (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-lg bg-ink-800 px-3 py-2.5 text-center text-[12px] text-paper-mute">
          Already reads this file
        </div>
      )}
    </section>
  );
}

export function Board({
  agents,
  memories,
  project,
  onOpen,
  onDrop,
  onCreate,
  onHide,
  onChanged,
}: {
  agents: AgentSummary[];
  memories: MemoryItem[];
  project: string | null;
  onOpen: (m: MemoryItem) => void;
  onDrop: (item: MemoryItem, targetAgent: string) => void;
  onCreate: (agent: string) => void;
  onHide: (agentId: string) => void;
  onChanged: () => void;
}) {
  const [dragged, setDragged] = useState<MemoryItem | null>(null);
  const [hiding, setHiding] = useState<string | null>(null);
  const toast = useToast();
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
    const data = e.active.data.current as { kind?: string; agentId?: string; item?: MemoryItem } | undefined;
    if (data?.kind === 'hide') {
      setHiding(data.agentId ?? null);
      return;
    }
    setDragged(data?.item ?? null);
  };
  const onDragEnd = (e: DragEndEvent) => {
    const data = e.active.data.current as { kind?: string; agentId?: string; item?: MemoryItem } | undefined;
    if (data?.kind === 'hide') {
      setHiding(null);
      const header = document.elementFromPoint(pointer.current.x, pointer.current.y)?.closest('[data-agent-header]');
      const under = header instanceof HTMLElement ? header.dataset.agentHeader : undefined;
      if (data.agentId && under !== data.agentId) onHide(data.agentId);
      return;
    }
    const item = data?.item;
    setDragged(null);
    if (!item) return;
    const column = document.elementFromPoint(pointer.current.x, pointer.current.y)?.closest('[data-agent-column]');
    const underPointer = column instanceof HTMLElement ? column.dataset.agentColumn : undefined;
    const target = underPointer ?? (e.over?.id as string | undefined);
    if (target && target !== item.agent && !item.alsoReadBy.includes(target)) onDrop(item, target);
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
      toast({ tone: 'ok', message: res.backupId ? `Deleted ${item.title}` : `${item.title} is already gone` });
      onChanged();
    } catch (e) {
      toast({ tone: 'error', message: e instanceof ApiError ? e.message : (e as Error).message });
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDragged(null);
        setHiding(null);
      }}
    >
      <div className="flex h-full gap-4 overflow-x-auto p-5">
        {agents.length === 0 && (
          <p className="m-auto rounded-xl border border-dashed border-ink-600 px-6 py-8 text-center text-[13px] text-paper-mute">
            Every agent column is hidden. Tick at least one agent in the sidebar to see its memories.
          </p>
        )}
        {agents.map((a) => (
          <Column
            key={a.id}
            agent={a}
            agents={agents}
            items={memories.filter((m) => m.agent === a.id)}
            dragged={dragged}
            project={project}
            onOpen={onOpen}
            onSend={onDrop}
            onCreate={onCreate}
            onReveal={(item) => void reveal(item)}
            onDelete={(item) => void remove(item)}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }} style={{ pointerEvents: 'none' }}>
        {hiding ? (
          <div className="pointer-events-none">
            <AgentDot agent={hiding} size={12} />
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
