import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { claudeCodeAdapter } from './adapters/claude-code.js';
import { codexAdapter } from './adapters/codex.js';
import { cursorAdapter } from './adapters/cursor.js';
import { declarativeAdapter, type DeclarativeAgentSpec } from './adapters/declarative.js';
import { geminiAdapter } from './adapters/gemini.js';
import { opencodeAdapter } from './adapters/opencode.js';
import { piAdapter } from './adapters/pi.js';
import { expandHome, type Context } from './context.js';
import { readState, writeState } from './store.js';
import type { AgentAdapter, AgentId, MemoryItem, ProjectInfo } from './types.js';

export interface HubConfig {
  /** Projects added manually in addition to the ones discovered from session logs. */
  projects?: string[];
  agents?: DeclarativeAgentSpec[];
  /** ESM modules whose default export is `(ctx) => AgentAdapter`. */
  plugins?: string[];
}

export interface AgentSummary {
  id: AgentId;
  displayName: string;
  detected: boolean;
  capabilities: AgentAdapter['capabilities'];
}

const AGENT_ALIASES: Record<string, AgentId> = {
  claude: 'claude-code',
  cc: 'claude-code',
  'pi-agent': 'pi',
  'gemini-cli': 'gemini',
  oc: 'opencode',
};

export class Hub {
  private constructor(
    readonly ctx: Context,
    readonly adapters: AgentAdapter[],
  ) {}

  static async create(ctx: Context, extra: AgentAdapter[] = []): Promise<Hub> {
    const config = await readConfig(ctx);
    const adapters: AgentAdapter[] = [claudeCodeAdapter(ctx), codexAdapter(ctx), piAdapter(ctx), geminiAdapter(ctx), cursorAdapter(ctx), opencodeAdapter(ctx)];
    for (const spec of config.agents ?? []) adapters.push(declarativeAdapter(ctx, spec));
    for (const p of config.plugins ?? []) {
      const mod = (await import(pathToFileURL(expandHome(ctx, p)).href)) as { default: (c: Context) => AgentAdapter };
      adapters.push(mod.default(ctx));
    }
    adapters.push(...extra);
    return new Hub(ctx, adapters);
  }

  adapter(id: AgentId): AgentAdapter {
    const resolved = AGENT_ALIASES[id] ?? id;
    const a = this.adapters.find((x) => x.id === resolved);
    if (!a) throw new Error(`Unknown agent "${id}". Known: ${this.adapters.map((x) => x.id).join(', ')}`);
    return a;
  }

  async agents(): Promise<AgentSummary[]> {
    return Promise.all(
      this.adapters.map(async (a) => ({ id: a.id, displayName: a.displayName, detected: await a.detect(), capabilities: a.capabilities })),
    );
  }

  async projects(): Promise<ProjectInfo[]> {
    const merged = new Map<string, ProjectInfo>();
    for (const a of this.adapters) {
      for (const p of await a.listProjects()) {
        const cur = merged.get(p.path);
        if (cur) {
          cur.agents = [...new Set([...cur.agents, ...p.agents])];
          cur.lastActivityMs = Math.max(cur.lastActivityMs, p.lastActivityMs);
        } else {
          merged.set(p.path, { ...p });
        }
      }
    }
    for (const p of (await readConfig(this.ctx)).projects ?? []) {
      const abs = expandHome(this.ctx, p);
      if (!merged.has(abs)) merged.set(abs, { path: abs, name: path.basename(abs), agents: [], lastActivityMs: 0 });
    }
    return [...merged.values()].sort((a, b) => b.lastActivityMs - a.lastActivityMs || a.name.localeCompare(b.name));
  }

  async addProject(projectPath: string): Promise<void> {
    const abs = path.resolve(expandHome(this.ctx, projectPath));
    const st = await fs.stat(abs).catch(() => null);
    if (!st?.isDirectory()) throw new Error(`Not a directory: ${abs}`);
    const config = await readConfig(this.ctx);
    config.projects = [...new Set([...(config.projects ?? []), abs])];
    await writeState(this.ctx, 'config.json', config);
  }

  /** All memories visible to every agent for a project (or only globals when `projectPath` is null). */
  async memories(projectPath: string | null): Promise<MemoryItem[]> {
    const items = (await Promise.all(this.adapters.map((a) => a.readMemories(projectPath)))).flat();
    const byReal = new Map<string, MemoryItem[]>();
    for (const item of items) {
      if (item.kind === 'session') continue;
      const real = await fs.realpath(item.filePath).catch(() => item.filePath);
      byReal.set(real, [...(byReal.get(real) ?? []), item]);
    }
    for (const group of byReal.values()) {
      for (const item of group) {
        item.alsoReadBy = [...new Set(group.map((g) => g.agent).filter((a) => a !== item.agent))];
      }
    }
    return items;
  }

  async findMemory(id: string, projectPath: string | null): Promise<MemoryItem> {
    const item = (await this.memories(projectPath)).find((m) => m.id === id);
    if (!item) throw new Error(`Memory ${id} not found${projectPath ? ` in ${projectPath}` : ''}`);
    return item;
  }

  /** Resolve a CLI-style reference: an id, an absolute/relative file path, or `agent:path`. */
  async resolveMemory(ref: string, projectPath: string | null): Promise<MemoryItem> {
    const items = await this.memories(projectPath);
    const byId = items.find((m) => m.id === ref);
    if (byId) return byId;
    let agent: string | undefined;
    let p = ref;
    const m = /^([a-z][\w-]*):(.+)$/.exec(ref);
    if (m && !/^[A-Za-z]:[\\/]/.test(ref)) {
      agent = AGENT_ALIASES[m[1]!] ?? m[1];
      p = m[2]!;
    }
    const abs = path.resolve(projectPath ?? process.cwd(), expandHome(this.ctx, p));
    const matches = items.filter((i) => i.filePath === abs && (!agent || i.agent === agent));
    if (matches.length === 0) throw new Error(`No memory matches "${ref}"`);
    return matches[0]!;
  }
}

export async function readConfig(ctx: Context): Promise<HubConfig> {
  return readState<HubConfig>(ctx, 'config.json', {});
}
