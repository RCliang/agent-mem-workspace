import { History as HistoryIcon, LayoutGrid, RefreshCw, Search, Table2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, subscribe, type AgentSummary, type BackupEntry, type Info, type MatrixRow, type MemoryItem, type ProjectInfo, type ShareStrategy } from './api';
import { Board } from './components/Board';
import { EditorDrawer } from './components/EditorDrawer';
import { History } from './components/History';
import { Matrix } from './components/Matrix';
import { PlanDialog, type PlanRequest } from './components/PlanDialog';
import { SessionDrawer } from './components/SessionDrawer';
import { Sidebar } from './components/Sidebar';
import { useToast } from './components/Toasts';
import { Button, cx, InfoContext } from './ui';

type View = 'board' | 'matrix' | 'history';

const VIEWS: { id: View; label: string; icon: typeof LayoutGrid }[] = [
  { id: 'board', label: 'Board', icon: LayoutGrid },
  { id: 'matrix', label: 'Share matrix', icon: Table2 },
  { id: 'history', label: 'History', icon: HistoryIcon },
];

const STORAGE_KEY = 'agent-mem:project';
const HIDDEN_AGENTS_KEY = 'agent-mem:hidden-agents';

function readHiddenAgents(): string[] {
  try {
    const raw = localStorage.getItem(HIDDEN_AGENTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function App() {
  const [info, setInfo] = useState<Info>({ home: '', dataDir: '', llm: false });
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [project, setProject] = useState<string | null | undefined>(undefined);
  const [view, setView] = useState<View>('board');
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [matrix, setMatrix] = useState<MatrixRow[]>([]);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanRequest | null>(null);
  const [live, setLive] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hiddenAgents, setHiddenAgents] = useState<string[]>(() => readHiddenAgents());
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? '');
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        setQuery('');
        searchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const persistHidden = useCallback((next: string[]) => {
    localStorage.setItem(HIDDEN_AGENTS_KEY, JSON.stringify(next));
  }, []);
  const hideAgent = useCallback(
    (id: string) => {
      setHiddenAgents((prev) => {
        if (prev.includes(id)) return prev;
        const next = [...prev, id];
        persistHidden(next);
        return next;
      });
    },
    [persistHidden],
  );
  const toggleAgent = useCallback(
    (id: string) => {
      setHiddenAgents((prev) => {
        const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
        persistHidden(next);
        return next;
      });
    },
    [persistHidden],
  );
  const showAllAgents = useCallback(() => {
    persistHidden([]);
    setHiddenAgents([]);
  }, [persistHidden]);
  const visibleAgents = useMemo(() => agents.filter((a) => !hiddenAgents.includes(a.id)), [agents, hiddenAgents]);
  const matchesQuery = useCallback(
    (m: MemoryItem) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return `${m.title} ${m.filePath} ${m.content}`.toLowerCase().includes(q);
    },
    [query],
  );
  const visibleMemories = useMemo(() => memories.filter(matchesQuery), [memories, matchesQuery]);
  const visibleRows = useMemo(
    () => matrix.filter((r) => matchesQuery(r.item)).map((r) => ({ ...r, cells: r.cells.filter((c) => !hiddenAgents.includes(c.agent)) })),
    [matrix, matchesQuery, hiddenAgents],
  );

  useEffect(() => {
    Promise.all([api.info(), api.agents(), api.projects()])
      .then(([i, a, p]) => {
        setInfo(i);
        setAgents(a);
        setProjects(p);
        const saved = localStorage.getItem(STORAGE_KEY);
        setProject(saved === '' ? null : saved && p.some((x) => x.path === saved) ? saved : (p[0]?.path ?? null));
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  const reload = useCallback(async () => {
    if (project === undefined) return;
    try {
      const [m, rows, b] = await Promise.all([api.memories(project), api.matrix(project), api.backups()]);
      setMemories(m);
      setMatrix(rows);
      setBackups(b);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [project]);

  useEffect(() => {
    void reload();
    if (project !== undefined) localStorage.setItem(STORAGE_KEY, project ?? '');
  }, [reload, project]);

  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void reloadRef.current();
        void api.projects().then(setProjects);
      }, 150);
    }, setLive);
  }, []);

  const openItem = useMemo(() => memories.find((m) => m.id === openId) ?? null, [memories, openId]);
  const current = projects.find((p) => p.path === project);

  const openTransfer = useCallback(
    (item: MemoryItem, targetAgent: string) =>
      setPlan({ kind: 'transfer', load: (render) => api.previewTransfer(project ?? null, item.id, targetAgent, render) }),
    [project],
  );
  const openShare = useCallback(
    (item: MemoryItem, targetAgent: string, strategy?: ShareStrategy) =>
      setPlan({ kind: 'share', load: () => api.previewShare(project ?? null, item.id, targetAgent, strategy) }),
    [project],
  );

  async function createInstructions(agent: string) {
    try {
      const res = await api.createMemory(agent, project ?? null);
      await reload();
      const created = (await api.memories(project ?? null)).find((m) => m.filePath === res.filePath && m.agent === agent);
      if (created) setOpenId(created.id);
    } catch (e) {
      toast({ tone: 'error', message: (e as Error).message });
    }
  }

  async function syncNow() {
    try {
      const res = await api.sync();
      toast({ tone: 'ok', message: res.updated.length ? `Refreshed ${res.updated.length} synced cop${res.updated.length === 1 ? 'y' : 'ies'}.` : 'All shared copies are up to date.' });
      await reload();
    } catch (e) {
      toast({ tone: 'error', message: (e as Error).message });
    }
  }

  return (
    <InfoContext.Provider value={info}>
      <div className="flex h-full flex-col">
        <header className="flex h-12 shrink-0 items-center gap-4 border-b border-ink-700 bg-ink-900 px-4">
          <div className="flex w-[232px] items-center gap-2">
            <img src="/favicon.svg" alt="" className="size-6" />
            <span className="text-[15px] font-semibold tracking-tight">agent-mem</span>
          </div>
          <label className="min-w-0 flex-1 lg:hidden">
            <span className="sr-only">Project</span>
            <select
              className="h-8 w-full max-w-56 truncate rounded-md border border-ink-600 bg-ink-950 px-2 text-[13px]"
              value={project ?? ''}
              onChange={(e) => {
                setProject(e.target.value || null);
                setOpenId(null);
              }}
            >
              <option value="">Global memory</option>
              {projects.map((p) => (
                <option key={p.path} value={p.path}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="hidden min-w-0 flex-1 lg:block">
            <p className="truncate text-[14px] font-medium">{project === null ? 'Global memory' : (current?.name ?? '')}</p>
          </div>
          <div className="relative ml-auto hidden w-full max-w-xs md:block lg:ml-0">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-paper-mute" aria-hidden />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search memories…"
              aria-label="Search memories by title, path or content"
              className="h-8 w-full rounded-md border border-ink-600 bg-ink-950 pr-14 pl-8 text-[13px] text-paper placeholder:text-paper-mute focus:border-signal focus:outline-none [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-paper-mute hover:text-paper"
              >
                <X className="size-3.5" />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-ink-600 bg-ink-800 px-1 font-mono text-[11px] text-paper-mute">/</kbd>
            )}
          </div>
          {query.trim() && (
            <span className="shrink-0 text-[12px] text-paper-mute" title="Memories matching the search">
              {visibleMemories.length}/{memories.length}
            </span>
          )}
          <nav className="flex items-center gap-1 rounded-lg bg-ink-950 p-1" aria-label="Views">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                aria-current={view === v.id ? 'page' : undefined}
                onClick={() => setView(v.id)}
                className={cx(
                  'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors',
                  view === v.id ? 'bg-ink-700 text-paper' : 'text-paper-dim hover:text-paper',
                )}
              >
                <v.icon className="size-3.5" /> <span className="hidden sm:inline">{v.label}</span>
              </button>
            ))}
          </nav>
          <Button variant="quiet" onClick={syncNow} title="Re-copy shared memories whose source changed">
            <RefreshCw className="size-3.5" /> Sync
          </Button>
          <span className="flex items-center gap-1.5 text-[12px] text-paper-mute" title={live ? 'Watching memory files for changes' : 'Not connected to the agent-mem server'}>
            <span className={cx('size-2 rounded-full', live ? 'bg-ok [animation:pulse-dot_2.4s_ease-in-out_infinite]' : 'bg-danger')} />
            {live ? 'Live' : 'Offline'}
          </span>
        </header>

        <div className="relative flex min-h-0 flex-1">
          <Sidebar
            className="hidden lg:flex"
            projects={projects}
            selected={project ?? null}
            onSelect={(p) => {
              setProject(p);
              setOpenId(null);
            }}
            onProjectsChange={setProjects}
            agents={agents}
            hiddenAgents={hiddenAgents}
            onToggleAgent={toggleAgent}
            onShowAllAgents={showAllAgents}
          />
          <main className="min-w-0 flex-1 overflow-hidden">
            {project === undefined && !loadError && <div className="m-5 h-40 animate-pulse rounded-xl bg-ink-800" />}
            {loadError && <p className="m-5 rounded-lg border border-danger/40 bg-danger/8 px-4 py-3 text-[13px] text-danger">Could not load data: {loadError}</p>}
            {project !== undefined && view === 'board' && (
              <Board
                agents={visibleAgents}
                memories={visibleMemories}
                project={project}
                onOpen={(m) => setOpenId(m.id)}
                onDrop={openTransfer}
                onCreate={createInstructions}
                onHide={hideAgent}
                onChanged={() => void reload()}
              />
            )}
            {project !== undefined && view === 'matrix' && (
              <Matrix
                agents={visibleAgents}
                rows={visibleRows}
                onShare={openShare}
                onUnshare={(id) => setPlan({ kind: 'unshare', load: () => api.previewUnshare(id) })}
                onOpen={(m) => {
                  setOpenId(m.id);
                }}
              />
            )}
            {project !== undefined && view === 'history' && (
              <History
                entries={backups}
                onUndo={(id) =>
                  void api
                    .undo(id)
                    .then((e) => toast({ tone: 'ok', message: `Restored ${e.filePath}` }))
                    .catch((e: Error) => toast({ tone: 'error', message: e.message }))
                    .finally(reload)
                }
              />
            )}
          </main>
          {openItem && openItem.kind !== 'session' && (
            <EditorDrawer
              key={openItem.id}
              className="absolute inset-0 z-20 w-full lg:static lg:z-auto lg:w-[min(720px,52vw)]"
              item={openItem}
              project={project ?? null}
              agents={visibleAgents}
              onClose={() => setOpenId(null)}
              onSaved={reload}
              onShare={(item, agent) => openShare(item, agent)}
            />
          )}
          {openItem && openItem.kind === 'session' && (
            <SessionDrawer
              key={openItem.id}
              className="absolute inset-0 z-20 w-full lg:static lg:z-auto lg:w-[min(640px,48vw)]"
              item={openItem}
              project={project ?? null}
              agents={visibleAgents}
              onClose={() => setOpenId(null)}
              onHandoff={openTransfer}
            />
          )}
        </div>
      </div>
      {plan && <PlanDialog request={plan} onClose={() => setPlan(null)} onApplied={reload} />}
    </InfoContext.Provider>
  );
}
