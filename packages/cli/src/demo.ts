import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createContext, type Context } from '@agent-mem/core';

function write(p: string, content: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

/**
 * A throwaway home directory with sample memories for every built-in agent,
 * so `agent-mem ui --demo` works on a machine where none of them are installed.
 */
export function createDemoContext(): { ctx: Context; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mem-demo-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'work', 'shop-api');
  const enc = project.replace(/[^a-zA-Z0-9]/g, '-');
  const piEnc = `--${project.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;

  write(path.join(home, '.claude', 'CLAUDE.md'), '# Personal preferences\n\n- Prefer pnpm over npm.\n- Keep answers short.\n');
  write(path.join(project, 'CLAUDE.md'), '# shop-api\n\n@docs/conventions.md\n\n## Commands\n\n- `pnpm test` runs the unit tests.\n');
  write(path.join(project, 'docs', 'conventions.md'), '# Conventions\n\n- Validate request bodies with zod.\n');
  write(path.join(project, 'AGENTS.md'), '# shop-api agent guide\n\n- Run `pnpm lint` before committing.\n');
  write(
    path.join(home, '.claude', 'projects', enc, 'memory', 'MEMORY.md'),
    '# Memory index\n\n- Redis runs on port 6380 locally.\n',
  );
  write(
    path.join(home, '.claude', 'projects', enc, 'session.jsonl'),
    [
      JSON.stringify({ type: 'user', cwd: project, sessionId: 'demo-claude', message: { role: 'user', content: 'Add rate limiting to /api/upload.' }, timestamp: '2026-10-21T09:00:00.000Z' }),
      JSON.stringify({ type: 'assistant', cwd: project, sessionId: 'demo-claude', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: { file_path: `${project}/src/routes/upload.ts` } }] }, timestamp: '2026-10-21T09:01:00.000Z' }),
      JSON.stringify({ type: 'assistant', cwd: project, sessionId: 'demo-claude', message: { role: 'assistant', content: [{ type: 'text', text: 'Rate limiting is in place. Still to do: cover /api/download.' }] }, timestamp: '2026-10-21T09:05:00.000Z' }),
    ].join('\n') + '\n',
  );

  write(path.join(home, '.codex', 'AGENTS.md'), '# Codex global rules\n\n- Never run `git push` without asking.\n');
  write(
    path.join(home, '.codex', 'sessions', '2026', '10', '22', 'rollout.jsonl'),
    [
      JSON.stringify({ timestamp: '2026-10-22T02:10:00.000Z', type: 'session_meta', payload: { id: 'demo-codex', cwd: project } }),
      JSON.stringify({ timestamp: '2026-10-22T02:10:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Migrate the settings page from class components to hooks.' }] } }),
      JSON.stringify({ timestamp: '2026-10-22T02:13:00.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Settings is now a function component. ProfileForm is still a class; migrate it next.' }] } }),
    ].join('\n') + '\n',
  );

  write(path.join(home, '.pi', 'agent', 'AGENTS.md'), '# Pi global context\n\n- Use conventional commits.\n');
  write(
    path.join(home, '.pi', 'agent', 'sessions', piEnc, 'session.jsonl'),
    [
      JSON.stringify({ type: 'session', id: 'demo-pi', cwd: project, timestamp: '2026-10-22T08:00:00.000Z' }),
      JSON.stringify({ type: 'message', timestamp: '2026-10-22T08:00:01.000Z', message: { role: 'user', content: [{ type: 'text', text: 'Write a CHANGELOG entry for v1.4 and bump the version.' }] } }),
      JSON.stringify({ type: 'message', timestamp: '2026-10-22T08:00:30.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Added the 1.4.0 changelog entry and bumped package.json. Not yet tagged.' }] } }),
    ].join('\n') + '\n',
  );

  write(path.join(home, '.gemini', 'GEMINI.md'), '# Gemini global context\n\n- Explain retries before using them.\n');
  write(path.join(project, 'GEMINI.md'), '# shop-api Gemini context\n\n- Follow the TypeScript strictness config.\n');
  write(path.join(home, '.cursor', 'rules', 'core.mdc'), '---\ndescription: Core conventions\n---\n\n- Use pnpm scripts only.\n');
  write(path.join(project, '.cursor', 'rules', 'backend.mdc'), '---\ndescription: Backend rules\n---\n\n- Validate inputs at the router layer.\n');
  write(path.join(home, '.config', 'opencode', 'AGENTS.md'), '# opencode global instructions\n\n- Prefer small, focused modules.\n');
  write(path.join(home, '.zcode', 'AGENTS.md'), '# ZCode global instructions\n\n- Keep the public API small.\n');
  write(path.join(home, '.qoder', 'AGENTS.md'), '# Qoder global instructions\n\n- Name the write target explicitly.\n');
  write(path.join(project, 'AGENTS.local.md'), '# shop-api local notes\n\n- Do not commit this file.\n');
  write(path.join(project, '.qoder', 'rules', 'style.md'), '# Style\n\n- Prefer named exports.\n');

  return { ctx: createContext({ home, dataDir: path.join(home, '.agent-mem'), env: {} }), root };
}
