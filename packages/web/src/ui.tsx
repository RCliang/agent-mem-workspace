import type { ButtonHTMLAttributes, ComponentType, ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Info } from './api';
import { useI18n } from './i18n';

export const AGENT_COLORS: Record<string, string> = {
  'claude-code': 'var(--color-agent-claude)',
  codex: 'var(--color-agent-codex)',
  pi: 'var(--color-agent-pi)',
  gemini: 'var(--color-agent-gemini)',
  cursor: 'var(--color-agent-cursor)',
  opencode: 'var(--color-agent-opencode)',
  'deepseek-harness': 'var(--color-agent-deepseek)',
};

export const agentColor = (id: string) => AGENT_COLORS[id] ?? 'var(--color-agent-other)';

/** Official logomarks shipped in public/agents (artwork owned by each vendor). */
const AGENT_ICONS: Record<string, string> = {
  'claude-code': '/agents/claude-code.svg',
  codex: '/agents/codex.svg',
  pi: '/agents/pi.svg',
  gemini: '/agents/gemini.svg',
  cursor: '/agents/cursor.svg',
  opencode: '/agents/opencode.svg',
  zcode: '/agents/zcode.png',
  qoder: '/agents/qoder.svg',
  'deepseek-harness': '/agents/deepseek-harness.svg',
};

export function AgentIcon({ agent, size = 16, className }: { agent: string; size?: number; className?: string }) {
  const src = AGENT_ICONS[agent];
  if (!src) return <AgentDot agent={agent} size={Math.max(size, 8)} />;
  return <img src={src} alt="" width={size} height={size} aria-hidden className={cx('shrink-0 object-contain', className)} />;
}

export function cx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(' ');
}

export const InfoContext = createContext<Info>({ home: '', dataDir: '', llm: false });

export function useTildify() {
  const { home } = useContext(InfoContext);
  return (p: string) => (home && (p === home || p.startsWith(home + '/')) ? '~' + p.slice(home.length) : p);
}

export function useRelativeTime() {
  const { t } = useI18n();
  return (ms: number): string => {
    if (!ms) return '';
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return t('time.now');
    const m = Math.round(s / 60);
    if (m < 60) return t('time.minutes', { count: m });
    const h = Math.round(m / 60);
    if (h < 48) return t('time.hours', { count: h });
    return t('time.days', { count: Math.round(h / 24) });
  };
}

export function formatSize(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Shared centred empty state with icon, line and optional action. */
export function EmptyState({ icon: Icon, title, hint, action }: { icon?: ComponentType<{ className?: string }>; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      {Icon && <Icon className="size-8 text-ink-500" aria-hidden />}
      <p className="text-[13px] text-paper-dim">{title}</p>
      {hint && <p className="max-w-[46ch] text-[12px] text-paper-mute">{hint}</p>}
      {action}
    </div>
  );
}

export type ColumnSwap = { active?: string; over?: string };

export function shouldMoveColumn(activeId: string | undefined, overId: string | undefined, previous?: ColumnSwap) {
  if (!activeId || !overId || activeId === overId) return false;
  return previous?.active !== activeId || previous?.over !== overId;
}

/**
 * Column order shared by the Board and Skills views, persisted in localStorage.
 * Unknown ids (newly installed agents) keep their default position at the end.
 */
export function useColumnOrder(storageKey: string, ids: string[]): [{ order: string[]; indexOf: (id: string) => number }, (activeId: string, overId: string) => void] {
  const [stored, setStored] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(stored));
  }, [storageKey, stored]);

  const order = useMemo(() => {
    const rank = new Map(stored.map((id, i) => [id, i]));
    return [...ids].sort((a, b) => (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER) || ids.indexOf(a) - ids.indexOf(b));
  }, [stored, ids]);

  const move = (activeId: string, overId: string) => {
    if (activeId === overId) return;
    const merged = [...new Set([...order, ...stored])];
    const from = merged.indexOf(activeId);
    const to = merged.indexOf(overId);
    if (from === -1 || to === -1) return;
    merged.splice(to, 0, ...merged.splice(from, 1));
    setStored(merged);
  };

  const indexOf = (id: string) => order.indexOf(id);
  return [{ order, indexOf }, move];
}

export function AgentDot({ agent, size = 8 }: { agent: string; size?: number }) {
  return <span aria-hidden className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: agentColor(agent) }} />;
}

type Variant = 'primary' | 'ghost' | 'quiet' | 'danger';

export function Button({ variant = 'ghost', className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'hit-target inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full px-4 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 disabled:active:translate-y-0',
        variant === 'primary' && 'bg-signal text-signal-ink shadow-[var(--shadow-primary)] hover:bg-signal-hover',
        variant === 'ghost' && 'border border-ink-600 text-paper hover:border-ink-500 hover:bg-ink-800',
        variant === 'quiet' && 'text-paper-dim hover:bg-ink-800 hover:text-paper',
        variant === 'danger' && 'border border-danger/50 text-danger hover:bg-danger/10',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Tag({ children, tone = 'plain', title }: { children: ReactNode; tone?: 'plain' | 'warn' | 'ok'; title?: string }) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2 py-px text-[11px] font-medium whitespace-nowrap leading-4',
        tone === 'plain' && 'bg-ink-700 text-paper-dim',
        tone === 'warn' && 'bg-warn/15 text-warn',
        tone === 'ok' && 'bg-ok/15 text-ok',
      )}
    >
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-ink-600 bg-ink-800 px-1 font-mono text-[11px] text-paper-dim">{children}</kbd>;
}
