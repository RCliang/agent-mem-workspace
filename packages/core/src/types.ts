export type AgentId = string;

export type MemoryScope = 'global' | 'project' | 'local';

export type MemoryKind = 'instructions' | 'auto-memory' | 'session';

export interface MemoryItem {
  /** Stable id derived from agent + file path. */
  id: string;
  agent: AgentId;
  scope: MemoryScope;
  kind: MemoryKind;
  title: string;
  filePath: string;
  projectPath: string | null;
  /** Empty for sessions; session bodies are loaded on demand. */
  content: string;
  hash: string;
  mtimeMs: number;
  size: number;
  /** Other agents that natively read this exact file (e.g. AGENTS.md for Codex and Pi). */
  alsoReadBy: AgentId[];
  isWriteTarget: boolean;
  isSymlink: boolean;
}

export interface ProjectInfo {
  path: string;
  name: string;
  agents: AgentId[];
  lastActivityMs: number;
}

export type ShareStrategy = 'import' | 'symlink' | 'copy';

export interface AgentCapabilities {
  /** Supports `@path` imports inside its instruction files. */
  imports: boolean;
}

export interface WriteTarget {
  filePath: string;
  scope: MemoryScope;
}

/** One-shot headless invocation of a coding agent's own CLI, used for local LLM tasks. */
export interface AgentCli {
  /** Binary expected on PATH, e.g. `claude`. */
  command: string;
  /** Arguments for a single prompt that must print its answer to stdout and exit. */
  args: (prompt: string) => string[];
}

export interface AgentAdapter {
  id: AgentId;
  displayName: string;
  capabilities: AgentCapabilities;
  /** Non-interactive CLI invocation for local summarization; absent when the agent has none. */
  cli?: AgentCli;
  detect(): Promise<boolean>;
  /** Directories whose changes can affect this agent's memories, for file watching. */
  watchRoots?(): string[];
  listProjects(): Promise<ProjectInfo[]>;
  /** Pass `null` to read only global memories. */
  readMemories(projectPath: string | null): Promise<MemoryItem[]>;
  /** Instruction file the agent reads for the given scope. */
  instructionFile(projectPath: string | null): WriteTarget;
  /** Location for a handoff document plus the file that should reference it. */
  handoffTarget(projectPath: string, name: string): { docPath: string; referenceFile: string };
  /** Body to place in `referenceFile` so the agent picks up a handoff document. */
  formatReference(ref: { docPath: string; referenceFile: string; title: string; content: string }): string;
  /** Turn foreign memory content into something this agent reads correctly. */
  renderFor(items: Pick<MemoryItem, 'agent' | 'filePath' | 'content' | 'title'>[]): string;
  parseSession?(filePath: string): Promise<ParsedSession>;
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  toolCalls: { name: string; target?: string }[];
  timestamp?: string;
}

export interface ParsedSession {
  agent: AgentId;
  filePath: string;
  sessionId: string;
  cwd: string | null;
  startedAt?: string;
  messages: SessionMessage[];
}
