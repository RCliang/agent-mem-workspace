import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { createContext, useContext } from 'react';
import type { Info } from './api';

export const AGENT_COLORS: Record<string, string> = {
  'claude-code': 'var(--color-agent-claude)',
  codex: 'var(--color-agent-codex)',
  pi: 'var(--color-agent-pi)',
  gemini: 'var(--color-agent-gemini)',
  cursor: 'var(--color-agent-cursor)',
  opencode: 'var(--color-agent-opencode)',
};

export const agentColor = (id: string) => AGENT_COLORS[id] ?? 'var(--color-agent-other)';

export function cx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(' ');
}

export const InfoContext = createContext<Info>({ home: '', dataDir: '', llm: false });

export function useTildify() {
  const { home } = useContext(InfoContext);
  return (p: string) => (home && (p === home || p.startsWith(home + '/')) ? '~' + p.slice(home.length) : p);
}

export function relativeTime(ms: number): string {
  if (!ms) return '';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
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
        'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45',
        variant === 'primary' && 'bg-signal text-signal-ink hover:bg-[#f0bf63]',
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
        'inline-flex items-center gap-1 rounded px-1.5 py-px text-[11px] font-medium leading-4',
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
