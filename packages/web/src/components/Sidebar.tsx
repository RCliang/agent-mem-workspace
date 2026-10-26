import { Bot, FolderGit2, FolderPlus, Globe2 } from 'lucide-react';
import { useState } from 'react';
import { api, type AgentSummary, type ProjectInfo } from '../api';
import { AgentDot, AgentIcon, cx, relativeTime, useTildify } from '../ui';
import { useToast } from './Toasts';

export function Sidebar({
  projects,
  selected,
  onSelect,
  onProjectsChange,
  agents,
  hiddenAgents,
  onToggleAgent,
  onShowAllAgents,
  className,
}: {
  projects: ProjectInfo[];
  selected: string | null;
  onSelect: (p: string | null) => void;
  onProjectsChange: (ps: ProjectInfo[]) => void;
  agents: AgentSummary[];
  hiddenAgents: string[];
  onToggleAgent: (id: string) => void;
  onShowAllAgents: () => void;
  className?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');
  const tildify = useTildify();
  const toast = useToast();

  async function add() {
    try {
      const ps = await api.addProject(value.trim());
      onProjectsChange(ps);
      const added = ps.find((p) => tildify(p.path) === value.trim() || p.path === value.trim());
      if (added) onSelect(added.path);
      setValue('');
      setAdding(false);
    } catch (e) {
      toast({ tone: 'error', message: (e as Error).message });
    }
  }

  return (
    <aside className={cx('w-[264px] shrink-0 flex-col border-r border-ink-700 bg-ink-900', className)}>
      <div className="px-3 pt-3">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={cx(
            'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors',
            selected === null ? 'bg-ink-700 text-paper' : 'text-paper-dim hover:bg-ink-800 hover:text-paper',
          )}
        >
          <Globe2 className="size-4 shrink-0" />
          <span className="font-medium">Global memory</span>
        </button>
      </div>

      <h2 className="px-5 pt-5 pb-1.5 text-[12px] font-medium text-paper-mute">Agents</h2>
      <div className="px-3" role="group" aria-label="Show or hide agents">
        {agents.map((a) => {
          const checked = !hiddenAgents.includes(a.id);
          return (
            <label
              key={a.id}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors hover:bg-ink-800"
              title={checked ? `Hide ${a.displayName} columns` : `Show ${a.displayName} columns`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggleAgent(a.id)}
                className="size-3.5 shrink-0 accent-[var(--color-signal)]"
              />
              <AgentIcon agent={a.id} size={16} />
              <span className={cx('min-w-0 flex-1 truncate', checked ? 'text-paper-dim' : 'text-paper-mute line-through decoration-ink-500')}>{a.displayName}</span>
              {!a.detected && (
                <span className="shrink-0 rounded bg-warn/15 px-1.5 py-px text-[11px] font-medium leading-4 text-warn" title="Not detected on this machine">
                  n/a
                </span>
              )}
            </label>
          );
        })}
        {hiddenAgents.length > 0 && (
          <button type="button" onClick={onShowAllAgents} className="mt-0.5 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] text-paper-mute hover:bg-ink-800 hover:text-paper">
            <Bot className="size-3.5" /> Show all {agents.length - hiddenAgents.length}/{agents.length} shown
          </button>
        )}
      </div>

      <h2 className="px-5 pt-5 pb-1.5 text-[12px] font-medium text-paper-mute">Projects</h2>
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" aria-label="Projects">
        {projects.length === 0 && (
          <p className="px-2.5 py-2 text-[13px] text-paper-mute">No projects found yet. Projects appear once an agent has run in them, or add one below.</p>
        )}
        {projects.map((p) => (
          <button
            key={p.path}
            type="button"
            onClick={() => onSelect(p.path)}
            title={p.path}
            className={cx(
              'group flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors',
              selected === p.path ? 'bg-ink-700' : 'hover:bg-ink-800',
            )}
          >
            <FolderGit2 className={cx('mt-0.5 size-4 shrink-0', selected === p.path ? 'text-signal' : 'text-paper-mute')} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className={cx('truncate text-[13px] font-medium', selected === p.path ? 'text-paper' : 'text-paper-dim group-hover:text-paper')}>{p.name}</span>
                <span className="ml-auto flex shrink-0 gap-1">
                  {p.agents.map((a) => (
                    <AgentDot key={a} agent={a} size={7} />
                  ))}
                </span>
              </span>
              <span className="block truncate font-mono text-[11px] text-paper-mute">{tildify(p.path)}</span>
              {p.lastActivityMs > 0 && <span className="block text-[11px] text-paper-mute">{relativeTime(p.lastActivityMs)}</span>}
            </span>
          </button>
        ))}
      </nav>

      <div className="border-t border-ink-700 p-3">
        {adding ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
            className="space-y-2"
          >
            <label htmlFor="add-project" className="block text-[12px] text-paper-dim">
              Project folder
            </label>
            <input
              id="add-project"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setAdding(false)}
              placeholder="~/code/my-app"
              className="h-8 w-full rounded-md border border-ink-600 bg-ink-950 px-2.5 font-mono text-[12px] text-paper placeholder:text-paper-mute focus:border-signal focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="text-[12px] text-paper-dim hover:text-paper" onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button type="submit" disabled={!value.trim()} className="text-[12px] font-medium text-signal hover:underline disabled:opacity-40">
                Add project
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-paper-dim hover:bg-ink-800 hover:text-paper"
          >
            <FolderPlus className="size-4" /> Add project folder
          </button>
        )}
      </div>
    </aside>
  );
}
