import { History as HistoryIcon, LayoutGrid, Menu, Moon, Puzzle, RefreshCw, Search, Sun, Table2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, subscribe, type AgentSummary, type BackupEntry, type Info, type MatrixRow, type MemoryItem, type ProjectInfo, type ShareStrategy, type SkillItem, type SkillLibrary } from './api';
import { Board } from './components/Board';
import { EditorDrawer } from './components/EditorDrawer';
import { History } from './components/History';
import { Matrix } from './components/Matrix';
import { PlanDialog, type PlanRequest } from './components/PlanDialog';
import { SessionDrawer } from './components/SessionDrawer';
import { Sidebar } from './components/Sidebar';
import { SkillsBoard } from './components/SkillsBoard';
import { SkillsDrawer } from './components/SkillsDrawer';
import { useToast } from './components/Toasts';
import { useI18n, type MessageKey } from './i18n';
import { Button, cx, InfoContext } from './ui';

type View = 'board' | 'skills' | 'matrix' | 'history';
type Theme = 'dark' | 'light';

function SlidingToggle({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; icon?: typeof Sun }[];
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cx('relative grid h-8 shrink-0 grid-cols-2 rounded-full border border-ink-600 bg-ink-900 p-0.5', className)}>
      <span
        aria-hidden
        className="absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%_-_0.25rem)] rounded-full bg-ink-700 transition-transform duration-150"
        style={{ transform: value === options[1]?.value ? 'translateX(calc(100% + 0.25rem))' : 'translateX(0)' }}
      />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-label={option.label}
          aria-pressed={value === option.value}
          title={option.label}
          onClick={() => onChange(option.value)}
          className={cx('relative z-10 flex items-center justify-center rounded-full text-[11px] font-medium whitespace-nowrap', value === option.value ? 'text-paper' : 'text-paper-mute hover:text-paper')}
        >
          {option.icon ? <option.icon className="size-3.5" /> : option.label}
        </button>
      ))}
    </div>
  );
}

const VIEWS: { id: View; label: MessageKey; icon: typeof LayoutGrid }[] = [
  { id: 'board', label: 'app.board', icon: LayoutGrid },
  { id: 'skills', label: 'app.skills', icon: Puzzle },
  { id: 'matrix', label: 'app.matrix', icon: Table2 },
  { id: 'history', label: 'app.history', icon: HistoryIcon },
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
  const { locale, setLocale, t } = useI18n();
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem('agent-mem:theme') === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });
  const [info, setInfo] = useState<Info>({ home: '', dataDir: '', llm: false });
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [project, setProject] = useState<string | null | undefined>(undefined);
  const [view, setView] = useState<View>('board');
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [matrix, setMatrix] = useState<MatrixRow[]>([]);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [skillData, setSkillData] = useState<{ libraries: SkillLibrary[]; skills: SkillItem[] }>({ libraries: [], skills: [] });
  const [openSkillId, setOpenSkillId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanRequest | null>(null);
  const [live, setLive] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hiddenAgents, setHiddenAgents] = useState<string[]>(() => readHiddenAgents());
  const [query, setQuery] = useState('');
  const [mobileSearch, setMobileSearch] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const overlaySearchRef = useRef<HTMLInputElement>(null);
  const sidebarTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileSidebarRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('agent-mem:theme', theme);
  }, [theme]);

  const clearSearch = useCallback(() => setQuery(''), []);

  useEffect(() => {
    setMobileSearch(false);
  }, [view]);

  useEffect(() => {
    if (mobileSearch) overlaySearchRef.current?.focus();
  }, [mobileSearch]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const panel = mobileSidebarRef.current;
    const trigger = sidebarTriggerRef.current;
    const focusable = () => [...(panel?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? [])].filter((el) => el.getClientRects().length > 0);
    focusable()[0]?.focus();
    const trapFocus = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', trapFocus);
    return () => {
      document.removeEventListener('keydown', trapFocus);
      trigger?.focus();
    };
  }, [sidebarOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? '');
      if (e.key === '/' && !typing) {
        e.preventDefault();
        // Below md the header search is hidden; open the overlay input instead.
        if (window.matchMedia('(min-width: 768px)').matches) searchRef.current?.focus();
        else setMobileSearch(true);
      }
      if (e.key === 'Escape') {
        if (document.activeElement === searchRef.current) {
          setQuery('');
          searchRef.current?.blur();
        }
        if (sidebarOpen) setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

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
      const [m, rows, b, sk] = await Promise.all([api.memories(project), api.matrix(project), api.backups(), api.skills(project)]);
      setMemories(m);
      setMatrix(rows);
      setBackups(b);
      setSkillData(sk);
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
  const openSkill = useMemo(() => skillData.skills.find((s) => s.id === openSkillId) ?? null, [skillData, openSkillId]);
  const current = projects.find((p) => p.path === project);

  const visibleSkillLibraries = useMemo(
    () => skillData.libraries.filter((l) => l.id === 'shared' || !hiddenAgents.includes(l.id)),
    [skillData.libraries, hiddenAgents],
  );
  const visibleSkills = useMemo(() => {
    const q = query.trim().toLowerCase();
    return skillData.skills.filter((s) => `${s.name} ${s.description} ${s.dirPath}`.toLowerCase().includes(q));
  }, [skillData.skills, query]);

  const openSkillTransfer = useCallback(
    (skill: SkillItem, target: string) =>
      setPlan({ kind: 'skill', load: ({ move }) => api.previewSkillTransfer(project ?? null, skill.id, target, move) }),
    [project],
  );
  const openSkillDelete = useCallback(
    (skill: SkillItem) => setPlan({ kind: 'skill', load: () => api.previewSkillDelete(project ?? null, skill.id) }),
    [project],
  );

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
      toast({ tone: 'ok', message: res.updated.length ? t('app.synced', { count: res.updated.length, suffix: res.updated.length === 1 ? 'y' : 'ies' }) : t('app.syncCurrent') });
      await reload();
    } catch (e) {
      toast({ tone: 'error', message: (e as Error).message });
    }
  }

  const viewNavigation: ReactNode = (
    <nav aria-label={t('app.views')}>
      {VIEWS.map((v) => (
        <button
          key={v.id}
          type="button"
          aria-current={view === v.id ? 'page' : undefined}
          onClick={() => setView(v.id)}
          title={t(v.label)}
          className={cx(
            'hit-target flex h-10 w-full items-center gap-2.5 border-b border-ink-700/70 px-2 text-[13px] font-medium whitespace-nowrap transition-colors active:translate-y-px',
            view === v.id ? 'text-paper' : 'text-paper-mute hover:text-paper',
          )}
        >
          <v.icon className={cx('size-4 shrink-0', view === v.id ? 'text-signal' : 'text-paper-mute')} />
          {t(v.label)}
        </button>
      ))}
    </nav>
  );

  return (
    <InfoContext.Provider value={info}>
      <div className="flex h-full flex-col">
        <header inert={sidebarOpen} className="shrink-0 border-b border-ink-700 bg-ink-950">
          <div className="flex h-16 items-center gap-2 px-3 sm:gap-3 sm:px-4 lg:px-5">
            <button
              ref={sidebarTriggerRef}
              type="button"
              aria-label={t('app.openSidebar')}
              onClick={() => setSidebarOpen(true)}
              className="hit-target rounded-md p-1.5 text-paper-dim hover:bg-ink-800 hover:text-paper lg:hidden"
            >
              <Menu className="size-4" />
            </button>
            <div className="flex shrink-0 items-center gap-2.5 md:hidden">
              <img src="/favicon.svg" alt="" className="size-6" />
              <span className="hidden text-[15px] font-semibold tracking-tight whitespace-nowrap sm:inline">agent-mem</span>
            </div>
            <label className="hidden min-w-0 flex-1 md:flex lg:hidden">
              <span className="sr-only">{t('app.project')}</span>
              <select
                className="h-9 w-full max-w-56 truncate rounded-full border border-ink-600 bg-ink-900 px-3 text-[13px]"
                value={project ?? ''}
                onChange={(e) => {
                  setProject(e.target.value || null);
                  setOpenId(null);
                  setOpenSkillId(null);
                }}
              >
                <option value="">{t('app.global')}</option>
                {projects.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="hidden min-w-0 flex-1 lg:block">
              <p className="truncate text-[14px] font-medium">{project === null ? t('app.global') : (current?.name ?? '')}</p>
            </div>
            <div className="relative ml-auto hidden w-full max-w-xs md:block lg:ml-0">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-paper-mute" aria-hidden />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('app.search')}
                aria-label={t('app.searchLabel')}
                className="h-9 w-full rounded-full border border-ink-600 bg-ink-900 pr-14 pl-9 text-[13px] text-paper placeholder:text-paper-mute [&::-webkit-search-cancel-button]:hidden"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label={t('app.searchClear')}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-paper-mute hover:text-paper"
                >
                  <X className="size-3.5" />
                </button>
              ) : (
                <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-ink-600 bg-ink-800 px-1 font-mono text-[11px] text-paper-mute">/</kbd>
              )}
            </div>
            {query.trim() && view !== 'history' && (
              <span className="shrink-0 text-[12px] text-paper-mute" title={t(view === 'skills' ? 'app.skillMatches' : 'app.memoryMatches')}>
                {view === 'skills' ? `${visibleSkills.length}/${skillData.skills.length}` : `${visibleMemories.length}/${memories.length}`}
              </span>
            )}
            <button
              type="button"
              aria-label={t('app.searchButton')}
              aria-expanded={mobileSearch}
              onClick={() => setMobileSearch((v) => !v)}
              className="hit-target rounded-md p-1.5 text-paper-dim hover:bg-ink-800 hover:text-paper md:hidden"
            >
              <Search className="size-4" />
            </button>
            <SlidingToggle
              label={t('theme.toggle')}
              value={theme}
              onChange={(value) => setTheme(value as Theme)}
              options={[
                { value: 'dark', label: t('theme.dark'), icon: Moon },
                { value: 'light', label: t('theme.light'), icon: Sun },
              ]}
              className="ml-auto w-14 md:ml-0"
            />
            <SlidingToggle
              label={t('language.toggle')}
              value={locale}
              onChange={(value) => setLocale(value as 'en' | 'zh')}
              options={[
                { value: 'en', label: 'EN' },
                { value: 'zh', label: '中' },
              ]}
              className="w-[4.25rem]"
            />
            <Button variant="quiet" aria-label={t('app.syncLabel')} onClick={syncNow} title={t('app.syncTitle')}>
              <RefreshCw className="size-3.5" /> <span className="hidden md:inline">{t('app.sync')}</span>
            </Button>
            <span className="hidden shrink-0 items-center gap-1.5 text-[12px] whitespace-nowrap text-paper-mute md:flex" title={t(live ? 'app.liveTitle' : 'app.offlineTitle')}>
              <span className={cx('size-2 rounded-full', live ? 'bg-ok' : 'bg-danger')} />
              <span className="hidden sm:inline">{t(live ? 'app.live' : 'app.offline')}</span>
            </span>
          </div>
        </header>

        {mobileSearch && (
          <div inert={sidebarOpen} className="flex items-center gap-2 border-b border-ink-700 bg-ink-900 px-4 py-2 md:hidden">
            <Search className="size-3.5 shrink-0 text-paper-mute" aria-hidden />
            <input
              ref={overlaySearchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('app.searchAll')}
              aria-label={t('app.searchAllLabel')}
              className="h-9 w-full rounded-full border border-ink-600 bg-ink-900 px-3 text-[13px] text-paper placeholder:text-paper-mute [&::-webkit-search-cancel-button]:hidden"
            />
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setMobileSearch(false);
              }}
              aria-label={t('app.searchClose')}
              className="rounded p-1 text-paper-mute hover:text-paper"
            >
              <X className="size-4" />
            </button>
          </div>
        )}

        {sidebarOpen && (
          <div ref={mobileSidebarRef} role="dialog" aria-modal="true" aria-label={t('app.workspaceNavigation')} className="fixed inset-0 z-30 lg:hidden">
            <div className="absolute inset-0 bg-backdrop" onClick={() => setSidebarOpen(false)} aria-hidden />
            <aside className="absolute inset-y-0 left-0 flex w-[280px] shadow-2xl">
              <Sidebar
                className="flex w-full"
                navigation={viewNavigation}
                projects={projects}
                selected={project ?? null}
                onSelect={(p) => {
                  setProject(p);
                  setOpenId(null);
                  setOpenSkillId(null);
                  setSidebarOpen(false);
                }}
                onProjectsChange={setProjects}
                agents={agents}
                hiddenAgents={hiddenAgents}
                onToggleAgent={toggleAgent}
                onShowAllAgents={showAllAgents}
              />
            </aside>
          </div>
        )}

        <div inert={sidebarOpen} className="relative flex min-h-0 flex-1">
          <Sidebar
            className="hidden lg:flex"
            navigation={viewNavigation}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed((collapsed) => !collapsed)}
            projects={projects}
            selected={project ?? null}
            onSelect={(p) => {
              setProject(p);
              setOpenId(null);
              setOpenSkillId(null);
            }}
            onProjectsChange={setProjects}
            agents={agents}
            hiddenAgents={hiddenAgents}
            onToggleAgent={toggleAgent}
            onShowAllAgents={showAllAgents}
          />
          <main className="min-w-0 flex-1 overflow-hidden">
            {project === undefined && !loadError && <div className="m-4 h-40 animate-pulse rounded-lg bg-ink-900" />}
            {loadError && <p className="m-4 border-l-2 border-danger bg-danger/8 px-4 py-3 text-[13px] text-danger">{t('app.loadError', { message: loadError })}</p>}
            {project !== undefined && view === 'board' && (
              <Board
                agents={visibleAgents}
                memories={visibleMemories}
                project={project}
                query={query}
                onClearSearch={clearSearch}
                onOpen={(m) => setOpenId(m.id)}
                onDrop={openTransfer}
                onCreate={createInstructions}
                onHide={hideAgent}
                onChanged={() => void reload()}
              />
            )}
            {project !== undefined && view === 'skills' && (
              <SkillsBoard libraries={visibleSkillLibraries} skills={visibleSkills} query={query} onClearSearch={clearSearch} onOpen={(s) => setOpenSkillId(s.id)} onTransfer={openSkillTransfer} onDelete={openSkillDelete} />
            )}
            {project !== undefined && view === 'matrix' && (
              <Matrix
                agents={visibleAgents}
                rows={visibleRows}
                query={query}
                onClearSearch={clearSearch}
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
                    .then((e) => toast({ tone: 'ok', message: t('app.restored', { path: e.filePath }) }))
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
          {openSkill && (
            <SkillsDrawer
              key={openSkill.id}
              skill={openSkill}
              project={project ?? null}
              onClose={() => setOpenSkillId(null)}
              onSaved={() => void reload()}
            />
          )}
        </div>
      </div>
      {plan && <PlanDialog request={plan} onClose={() => setPlan(null)} onApplied={reload} />}
    </InfoContext.Provider>
  );
}
