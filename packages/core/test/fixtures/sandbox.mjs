// Builds a fake home directory with Claude Code, Codex and Pi memories for tests and demos.
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
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

  write(path.join(home, '.zcode', 'AGENTS.md'), '# ZCode global instructions\n\n- Keep the public API small.\n');
  write(path.join(home, '.qoder', 'AGENTS.md'), '# Qoder global instructions\n\n- Name the write target explicitly.\n');
  write(path.join(home, '.dsh', 'AGENTS.md'), '# DeepSeek Harness global instructions\n\n- Keep tool calls explicit.\n');
  write(path.join(project, 'AGENTS.local.md'), '# shop-api local notes\n\n- Do not commit this file.\n');
  write(path.join(project, '.qoder', 'rules', 'style.md'), '# Style\n\n- Prefer named exports.\n');

  write(
    path.join(home, '.claude', 'skills', 'browse', 'SKILL.md'),
    '---\nname: browse\ndescription: |\n  Fast headless browser for QA testing. Navigate a URL, take screenshots\n  and verify page state.\n---\n\n## Usage\n\n- browse open <url>\n',
  );
  write(path.join(home, '.claude', 'skills', 'browse', 'references', 'commands.md'), '# Commands\n\n- open, click, screenshot\n');
  write(
    path.join(home, '.codex', 'skills', 'browse', 'SKILL.md'),
    '---\nname: browse\ndescription: Open pages and assert on them from Codex.\n---\n\nbody\n',
  );
  write(
    path.join(home, '.dsh', 'skills', 'harness-check', 'SKILL.md'),
    '---\nname: harness-check\ndescription: Validate a DeepSeek Harness workspace.\n---\n\nusage\n',
  );
  write(
    path.join(home, '.agents', 'skills', 'agent-reach', 'SKILL.md'),
    '---\nname: agent-reach\ndescription: >\n  MUST USE when the user wants to research or search anything on the internet.\n---\n\nreach out\n',
  );
  write(path.join(home, '.agents', 'skills', 'agent-reach', 'references', 'engines.md'), '# Engines\n');
  write(
    path.join(project, '.agents', 'skills', 'akshare', 'SKILL.md'),
    '---\nname: akshare\ndescription: Query A-share market data through akshare.\n---\n\nusage\n',
  );
  write(
    path.join(project, '.claude', 'skills', 'shop-helper', 'SKILL.md'),
    '---\nname: shop-helper\ndescription: Project-specific helpers for shop-api.\n---\n\nusage\n',
  );
  write(
    path.join(project, '.dsh', 'skills', 'release-check', 'SKILL.md'),
    '---\nname: release-check\ndescription: Check shop-api releases with DeepSeek Harness.\n---\n\nusage\n',
  );

  // DeepSeek Harness session in the Claude-Code-compatible jsonl shape.
  const dshEnc = project.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-');
  write(
    path.join(home, '.dsh', 'sessions', dshEnc, '2026-10-22T06-00-00_dsh-7a1b.jsonl'),
    [
      JSON.stringify({ type: 'user', cwd: project, sessionId: 'dsh-7a1b', message: { role: 'user', content: 'Set up the release pipeline for tags' }, timestamp: '2026-10-22T06:00:00.000Z' }),
      JSON.stringify({ type: 'assistant', cwd: project, sessionId: 'dsh-7a1b', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'write', input: { file_path: `${project}/.dsh/release.md` } }] }, timestamp: '2026-10-22T06:01:00.000Z' }),
      JSON.stringify({ type: 'assistant', cwd: project, sessionId: 'dsh-7a1b', message: { role: 'assistant', content: [{ type: 'text', text: 'Release pipeline configured. Tag pushing still manual.' }] }, timestamp: '2026-10-22T06:02:00.000Z' }),
    ].join('\n') + '\n',
  );

  // Qoder jsonl session (encodeQoderProject keeps the leading dash).
  const qoderEnc = project.replace(/[/\\:]/g, '-');
  write(
    path.join(home, '.qoder', 'projects', qoderEnc, 'session-q.jsonl'),
    [
      JSON.stringify({ type: 'user', cwd: project, sessionId: 'q1', timestamp: '2026-10-23T00:00:00.000Z', message: { role: 'user', content: [{ type: 'text', text: 'Open the Qoder session' }] } }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-10-23T00:01:00.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Here is the answer.' }] } }),
    ].join('\n') + '\n',
  );

  // Cursor agent transcript (no composer db needed for listing and parsing).
  const cursorEnc = project.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-');
  const cursorId = '33333333-3333-3333-3333-333333333333';
  write(
    path.join(home, '.cursor', 'projects', cursorEnc, 'agent-transcripts', cursorId, `${cursorId}.jsonl`),
    [
      JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text: 'Fix the login redirect' }] } }),
      JSON.stringify({ role: 'assistant', message: { content: [{ type: 'text', text: 'Updated the route.' }, { type: 'tool_use', name: 'read', input: { file_path: 'src/app.ts' } }] } }),
    ].join('\n') + '\n',
  );

  // ZCode sqlite session.
  {
    const dbFile = path.join(home, '.zcode', 'cli', 'db', 'db.sqlite');
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    const db = new DatabaseSync(dbFile);
    db.exec(`
      CREATE TABLE session (id TEXT, directory TEXT, title TEXT, time_created INTEGER, time_updated INTEGER, time_deleted INTEGER);
      CREATE TABLE message (id TEXT, session_id TEXT, data TEXT, sequence INTEGER, time_created INTEGER);
      CREATE TABLE part (message_id TEXT, session_id TEXT, data TEXT, sequence INTEGER);
    `);
    db.prepare('INSERT INTO session (id, directory, title, time_created, time_updated, time_deleted) VALUES (?, ?, ?, ?, ?, 0)').run('zsess-1', project, '查看会话列表', 1_700_000_000_000, 1_700_000_200_000);
    db.prepare('INSERT INTO message (id, session_id, data, sequence, time_created) VALUES (?, ?, ?, ?, ?)').run('zm1', 'zsess-1', JSON.stringify({ role: 'user' }), 1, 1_700_000_000_000);
    db.prepare('INSERT INTO message (id, session_id, data, sequence, time_created) VALUES (?, ?, ?, ?, ?)').run('zm2', 'zsess-1', JSON.stringify({ role: 'assistant' }), 2, 1_700_000_100_000);
    db.prepare('INSERT INTO part (message_id, session_id, data, sequence) VALUES (?, ?, ?, ?)').run('zm1', 'zsess-1', JSON.stringify({ type: 'text', text: '会话在哪里' }), 1);
    db.prepare('INSERT INTO part (message_id, session_id, data, sequence) VALUES (?, ?, ?, ?)').run('zm2', 'zsess-1', JSON.stringify({ type: 'text', text: '在 cli 数据库里。' }), 1);
    db.close();
  }

  // Gemini CLI: projects.json maps the project root to its tmp directory name.
  write(path.join(home, '.gemini', 'projects.json'), JSON.stringify({ projects: { [project]: 'g-4f2a91' } }));
  write(
    path.join(home, '.gemini', 'tmp', 'g-4f2a91', 'chats', 'session-20261020T100000-abc.jsonl'),
    [
      JSON.stringify({ kind: 'session', sessionId: 'gem-demo', projectHash: 'g-4f2a91', startTime: '2026-10-20T10:00:00.000Z', directories: [project] }),
      JSON.stringify({ id: 'u1', type: 'user', timestamp: '2026-10-20T10:00:01.000Z', content: 'Add a dark theme toggle to the settings page' }),
      JSON.stringify({ id: 'g1', type: 'gemini', timestamp: '2026-10-20T10:01:00.000Z', content: '', thoughts: [{ subject: 'Theme state', description: 'Store the preference in localStorage' }], toolCalls: [{ name: 'write_file', description: 'src/theme.ts' }] }),
    ].join('\n') + '\n',
  );

  // opencode: session metadata plus per-message JSON files sharded by session id.
  const ocStorage = path.join(home, '.local', 'share', 'opencode', 'storage');
  write(
    path.join(ocStorage, 'session', 'ses_demo01.json'),
    JSON.stringify({ id: 'ses_demo01', directory: project, title: '', time: { created: '2026-10-21T08:00:00.000Z', updated: '2026-10-21T08:02:00.000Z' } }),
  );
  write(
    path.join(ocStorage, 'message', 'se', 'msg_1.json'),
    JSON.stringify({ id: 'msg_1', sessionID: 'ses_demo01', role: 'user', time: { created: '2026-10-21T08:00:01.000Z' }, parts: [{ type: 'text', text: 'Wire up the export button' }] }),
  );
  write(
    path.join(ocStorage, 'message', 'se', 'msg_2.json'),
    JSON.stringify({
      id: 'msg_2',
      sessionID: 'ses_demo01',
      role: 'assistant',
      time: { created: '2026-10-21T08:01:00.000Z' },
      parts: [{ type: 'step-start' }, { type: 'text', text: 'Export now writes a bundle and the button is wired.' }, { type: 'tool', tool: 'write', state: { input: { filePath: 'src/export.ts' } } }],
    }),
  );

  return { home, dataDir, project, otherProject };
}
