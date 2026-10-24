// Builds a fake home directory with Claude Code, Codex and Pi memories for tests and demos.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function write(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function session(name, cwd) {
  return fs.readFileSync(path.join(here, 'sessions', `${name}.jsonl`), 'utf8').replaceAll('{{CWD}}', cwd);
}

const enc = (p) => p.replace(/[^a-zA-Z0-9]/g, '-');
const piEnc = (p) => `--${p.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;

/**
 * @param {string} root
 * @returns {{ home: string, dataDir: string, project: string, otherProject: string }}
 */
export function createSandbox(root) {
  const home = path.join(root, 'home');
  const project = path.join(root, 'work', 'shop-api');
  const otherProject = path.join(root, 'work', 'web-app');
  const dataDir = path.join(home, '.agent-mem');

  write(path.join(home, '.claude', 'CLAUDE.md'), '# Personal preferences\n\n- Prefer pnpm over npm.\n- Keep answers short.\n');
  write(path.join(project, 'CLAUDE.md'), '# shop-api\n\n@docs/conventions.md\n\n## Commands\n\n- `pnpm test` runs the unit tests.\n');
  write(path.join(project, 'docs', 'conventions.md'), '# Conventions\n\n- Validate request bodies with zod.\n- Never log request bodies.\n');
  write(path.join(project, 'AGENTS.md'), '# shop-api agent guide\n\n- Run `pnpm lint` before committing.\n');
  write(path.join(project, 'src', 'routes', 'upload.ts'), 'export async function upload() {}\n');
  write(path.join(home, '.claude', 'projects', enc(project), 'memory', 'MEMORY.md'), '# Memory index\n\n- Redis runs on port 6380 locally.\n');
  write(path.join(home, '.claude', 'projects', enc(project), '7f3c2a10-claude.jsonl'), session('claude-code', project));

  write(path.join(home, '.codex', 'AGENTS.md'), '# Codex global rules\n\n- Never run `git push` without asking.\n');
  write(path.join(home, '.codex', 'sessions', '2026', '10', '22', 'rollout-2026-10-22T02-10-00-0199c1d2.jsonl'), session('codex', project));
  write(path.join(home, '.codex', 'sessions', '2026', '10', '23', 'rollout-2026-10-23T01-00-00-0199c1d3.jsonl'), session('codex', otherProject).replace('0199c1d2-codex-session', '0199c1d3-codex-session'));
  write(path.join(otherProject, 'AGENTS.md'), '# web-app\n\n- React 19 + Vite.\n');

  write(path.join(home, '.pi', 'agent', 'AGENTS.md'), '# Pi global context\n\n- Use conventional commits.\n');
  write(path.join(home, '.pi', 'agent', 'sessions', piEnc(project), '2026-10-22T08-00-00_pi-5e8a91.jsonl'), session('pi', project));

  write(path.join(home, '.gemini', 'GEMINI.md'), '# Gemini global context\n\n- Explain retries before using them.\n');
  write(path.join(project, 'GEMINI.md'), '# shop-api Gemini context\n\n- Follow the TypeScript strictness config.\n');

  write(path.join(home, '.cursor', 'rules', 'core.mdc'), '---\ndescription: Core conventions\n---\n\n- Use pnpm scripts only.\n');
  write(path.join(project, '.cursor', 'rules', 'backend.mdc'), '---\ndescription: Backend rules\n---\n\n- Validate inputs at the router layer.\n');

  write(path.join(home, '.config', 'opencode', 'AGENTS.md'), '# opencode global instructions\n\n- Prefer small, focused modules.\n');

  return { home, dataDir, project, otherProject };
}
