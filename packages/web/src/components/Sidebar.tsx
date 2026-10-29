import { Bot, ChevronRight, FolderGit2, FolderPlus, Globe2, Loader2, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { api, type AgentSummary, type ProjectInfo } from '../api';
import { useI18n } from '../i18n';
import { AgentDot, AgentIcon, cx, useRelativeTime, useTildify } from '../ui';
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
  navigation,
  collapsed = false,
  onToggleCollapse,
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
  navigation?: ReactNode;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const agentsListId = useId();
  const projectsListId = useId();
  const tildify = useTildify();
  const toast = useToast();
  const { t } = useI18n();
  const relativeTime = useRelativeTime();

  async function add() {
    setAdding(true);
    try {
      const result = await api.pickProject();
      onProjectsChange(result.projects);
      if (result.path) onSelect(result.path);
    } catch (e) {
      toast({ tone: 'error', message: (e as Error).message });
    } finally {
      setAdding(false);
    }
  }

  async function remove(projectPath: string) {
    setRemoving(projectPath);
    try {
      onProjectsChange(await api.removeProject(projectPath));
      if (selected === projectPath) onSelect(null);
    } catch (e) {
      toast({ tone: 'error', message: (e as Error).message });
    } finally {
      setRemoving(null);
    }
  }

  if (collapsed) {
    return (
      <aside className={cx('w-12 shrink-0 flex-col border-r border-ink-700 bg-ink-950', className)}>
        <div className="flex h-16 shrink-0 items-center justify-center">
          <button
            type="button"
            aria-label={t('sidebar.expand')}
            title={t('sidebar.expand')}
            onClick={onToggleCollapse}
            className="hit-target flex size-8 items-center justify-center rounded-md text-paper-mute hover:bg-ink-800 hover:text-paper"
          >
            <PanelLeftOpen className="size-4" />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className={cx('w-[256px] shrink-0 flex-col border-r border-ink-700 bg-ink-950', className)}>
      <div className="flex h-16 shrink-0 items-center gap-2.5 px-5">
        <img src="/favicon.svg" alt="" className="size-6" />
        <span className="text-[16px] font-semibold tracking-tight">agent-mem</span>
        {onToggleCollapse && (
          <button
            type="button"
            aria-label={t('sidebar.collapse')}
            title={t('sidebar.collapse')}
            onClick={onToggleCollapse}
            className="hit-target ml-auto flex size-8 items-center justify-center rounded-md text-paper-mute hover:bg-ink-800 hover:text-paper"
          >
            <PanelLeftClose className="size-4" />
          </button>
        )}
      </div>
      {navigation && <div className="shrink-0 px-3 pb-3">{navigation}</div>}
      <div className="px-3 pt-2">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={cx(
            'hit-target flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors active:translate-y-px',
            selected === null ? 'bg-ink-800 text-paper' : 'text-paper-dim hover:bg-ink-850 hover:text-paper',
          )}
        >
          <Globe2 className="size-4 shrink-0" />
          <span className="font-medium">{t('app.global')}</span>
        </button>
      </div>

      <h2 className="shrink-0 px-3 pt-3 pb-1.5 text-[12px] font-medium text-paper-mute">
        <button
          type="button"
          aria-expanded={agentsOpen}
          aria-controls={agentsListId}
          onClick={() => setAgentsOpen((open) => !open)}
          className="hit-target flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-ink-850 hover:text-paper"
        >
          <ChevronRight className={cx('size-3.5 shrink-0 transition-transform', agentsOpen && 'rotate-90')} />
          {t('sidebar.agents')}
          <span className="ml-auto tabular-nums">{agents.length - hiddenAgents.length}/{agents.length}</span>
        </button>
      </h2>
      {agentsOpen && (
        <div id={agentsListId} className="max-h-[45%] min-h-0 overflow-y-auto px-3" role="group" aria-label={t('sidebar.showHide')}>
          {agents.map((a) => {
            const checked = !hiddenAgents.includes(a.id);
            return (
              <label
                key={a.id}
                className="hit-target flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors hover:bg-ink-850"
                title={t(checked ? 'sidebar.hideAgent' : 'sidebar.showAgent', { name: a.displayName })}
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
                  <span className="shrink-0 rounded bg-warn/15 px-1.5 py-px text-[11px] font-medium leading-4 text-warn" title={t('sidebar.notDetected')}>
                    n/a
                  </span>
                )}
              </label>
            );
          })}
          {hiddenAgents.length > 0 && (
            <button type="button" onClick={onShowAllAgents} className="hit-target mt-0.5 flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] text-paper-mute hover:bg-ink-850 hover:text-paper">
              <Bot className="size-3.5" /> {t('sidebar.showAll', { shown: agents.length - hiddenAgents.length, total: agents.length })}
            </button>
          )}
        </div>
      )}

      <h2 className="shrink-0 px-3 pt-3 pb-1.5 text-[12px] font-medium text-paper-mute">
        <button
          type="button"
          aria-expanded={projectsOpen}
          aria-controls={projectsListId}
          onClick={() => setProjectsOpen((open) => !open)}
          className="hit-target flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-ink-850 hover:text-paper"
        >
          <ChevronRight className={cx('size-3.5 shrink-0 transition-transform', projectsOpen && 'rotate-90')} />
          {t('sidebar.projects')}
          <span className="ml-auto tabular-nums">{projects.length}</span>
        </button>
      </h2>
      {projectsOpen && (
        <nav id={projectsListId} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" aria-label={t('sidebar.projects')}>
          {projects.length === 0 && (
            <p className="px-2.5 py-2 text-[13px] text-paper-mute">{t('sidebar.noProjects')}</p>
          )}
          {projects.map((p) => (
            <div key={p.path} className="group/row relative">
              <button
                type="button"
                onClick={() => onSelect(p.path)}
                title={p.path}
                className={cx(
                  'group hit-target flex min-h-12 w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors active:translate-y-px',
                  selected === p.path ? 'bg-ink-800' : 'hover:bg-ink-850',
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
              <button
                type="button"
                aria-label={t('sidebar.removeProject')}
                title={t('sidebar.removeProject')}
                disabled={removing !== null}
                onClick={() => void remove(p.path)}
                className="hit-target absolute right-1.5 top-2 z-10 flex size-6 items-center justify-center rounded-md bg-ink-900 text-paper-mute opacity-0 shadow-sm transition-opacity hover:bg-ink-700 hover:text-paper focus-visible:opacity-100 group-hover/row:opacity-100 disabled:cursor-wait"
              >
                {removing === p.path ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
              </button>
            </div>
          ))}
        </nav>
      )}

      <div className="border-t border-ink-700 p-3">
        <button
          type="button"
          disabled={adding}
          onClick={() => void add()}
          className="hit-target flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] text-paper-dim hover:bg-ink-850 hover:text-paper disabled:cursor-wait disabled:opacity-60"
        >
          {adding ? <Loader2 className="size-4 animate-spin" /> : <FolderPlus className="size-4" />}
          {t(adding ? 'sidebar.selectingProject' : 'sidebar.addProject')}
        </button>
      </div>
    </aside>
  );
}
