import type { AgentSummary, BackupEntry, MatrixRow, MemoryItem, ParsedSession, Plan, ProjectInfo, Share, ShareStrategy, SkillItem, TransferRender } from '@agent-mem/core';

export type { AgentSummary, BackupEntry, MatrixRow, MemoryItem, ParsedSession, Plan, ProjectInfo, Share, ShareStrategy, SkillItem };

export interface SkillLibrary {
  id: string;
  displayName: string;
  detected: boolean;
}

export type SkillDetail = SkillItem & { skillMd: { content: string; hash: string } };

export interface Info {
  home: string;
  dataDir: string;
  /** A summarizer is available: a local agent CLI or the configured API. */
  llm: boolean;
  /** Agent ids installed here whose own CLI can refine summaries. */
  llmLocal?: string[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: { error?: string; conflict?: { filePath: string } },
  ) {
    super(message);
  }
  get isConflict() {
    return this.status === 409;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((json as { error?: string }).error ?? `${res.status} ${res.statusText}`, res.status, json as ApiError['body']);
  return json as T;
}

const q = (project: string | null) => (project ? `?project=${encodeURIComponent(project)}` : '');

export const api = {
  info: () => request<Info>('GET', '/api/info'),
  agents: () => request<AgentSummary[]>('GET', '/api/agents'),
  projects: () => request<ProjectInfo[]>('GET', '/api/projects'),
  addProject: (path: string) => request<ProjectInfo[]>('POST', '/api/projects', { path }),
  memories: (project: string | null) => request<MemoryItem[]>('GET', `/api/memories${q(project)}`),
  saveMemory: (id: string, project: string | null, content: string, expectedHash: string) =>
    request<{ hash: string; backupId: string }>('PUT', `/api/memory/${id}${q(project)}`, { content, expectedHash }),
  createMemory: (agent: string, project: string | null) => request<{ filePath: string }>('POST', '/api/memory', { agent, project }),
  session: (id: string, project: string | null) => request<ParsedSession>('GET', `/api/session/${id}${q(project)}`),
  matrix: (project: string | null) => request<MatrixRow[]>('GET', `/api/matrix${q(project)}`),
  skills: (project: string | null) => request<{ libraries: SkillLibrary[]; skills: SkillItem[] }>('GET', `/api/skills${q(project)}`),
  skill: (id: string, project: string | null) => request<SkillDetail>('GET', `/api/skill/${id}${q(project)}`),
  saveSkill: (id: string, project: string | null, content: string, expectedHash: string) =>
    request<{ hash: string; backupId: string }>('PUT', `/api/skill/${id}${q(project)}`, { content, expectedHash }),
  previewSkillTransfer: (project: string | null, skillId: string, targetAgent: string, move: boolean) =>
    request<Plan>('POST', '/api/skill/transfer/preview', { project, skillId, targetAgent, move }),
  previewSkillDelete: (project: string | null, skillId: string) => request<Plan>('POST', '/api/skill/delete/preview', { project, skillId }),
  shares: () => request<Share[]>('GET', '/api/shares'),
  previewShare: (project: string | null, memoryId: string, targetAgent: string, strategy?: ShareStrategy) =>
    request<Plan>('POST', '/api/share/preview', { project, memoryId, targetAgent, strategy }),
  previewUnshare: (shareId: string) => request<Plan>('POST', '/api/unshare/preview', { shareId }),
  previewTransfer: (project: string | null, memoryId: string, targetAgent: string, render: TransferRender) =>
    request<Plan>('POST', '/api/transfer/preview', { project, memoryId, targetAgent, render }),
  deleteMemory: (id: string, project: string | null, expectedHash: string) =>
    request<{ backupId: string | null }>('DELETE', `/api/memory/${id}${q(project)}`, { expectedHash }),
  revealMemory: (id: string, project: string | null) => request<{ ok: boolean }>('POST', `/api/memory/${id}/reveal${q(project)}`),
  apply: (plan: Plan) => request<{ backups: BackupEntry[]; files: string[] }>('POST', '/api/apply', { plan }),
  sync: () => request<{ updated: string[]; missing: string[] }>('POST', '/api/sync', {}),
  backups: () => request<BackupEntry[]>('GET', '/api/backups'),
  undo: (id?: string) => request<BackupEntry>('POST', '/api/undo', { id }),
};

/** Subscribe to file-change events; reconnects automatically (EventSource does). */
export function subscribe(onChange: () => void, onStatus: (live: boolean) => void): () => void {
  const es = new EventSource('/api/events');
  es.addEventListener('hello', () => onStatus(true));
  es.onerror = () => onStatus(false);
  for (const type of ['changed', 'synced', 'applied']) es.addEventListener(type, onChange);
  return () => es.close();
}
