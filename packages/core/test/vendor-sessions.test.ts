import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createContext, cursorAdapter, deepseekHarnessAdapter, geminiAdapter, opencodeAdapter, qoderAdapter, zcodeAdapter } from '@agent-mem/core';
import { encodeCursorProject, cursorComposerPath } from '../src/adapters/cursor-sessions.js';
import { dshSessionPath } from '../src/adapters/deepseek-harness.js';
import { encodeQoderProject } from '../src/adapters/qoder.js';
import { zcodeSessionPath } from '../src/adapters/zcode-sessions.js';

const roots: string[] = [];

function homeFor(name: string): { home: string; project: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `agent-mem-${name}-`));
  roots.push(root);
  const home = path.join(root, 'home');
  const project = path.join(root, 'work', 'shop');
  fs.mkdirSync(project, { recursive: true });
  return { home, project };
}

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('vendor sessions', () => {
  it('lists a Cursor agent transcript and a Composer chat', async () => {
    const { home, project } = homeFor('cursor');
    const transcriptId = '11111111-1111-1111-1111-111111111111';
    const transcript = path.join(home, '.cursor', 'projects', encodeCursorProject(project), 'agent-transcripts', transcriptId, `${transcriptId}.jsonl`);
    fs.mkdirSync(path.dirname(transcript), { recursive: true });
    fs.writeFileSync(
      transcript,
      [
        JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text: 'Fix the login redirect' }] } }),
        JSON.stringify({
          role: 'assistant',
          message: { content: [{ type: 'text', text: 'Updated the route.' }, { type: 'tool_use', name: 'read', input: { file_path: 'src/app.ts' } }] },
        }),
      ].join('\n'),
    );

    const workspaceId = 'ws-shop';
    const support = path.join(home, 'Library', 'Application Support', 'Cursor', 'User');
    fs.mkdirSync(path.join(support, 'workspaceStorage', workspaceId), { recursive: true });
    fs.writeFileSync(
      path.join(support, 'workspaceStorage', workspaceId, 'workspace.json'),
      JSON.stringify({ folder: `file://${project}` }),
    );
    const dbFile = path.join(support, 'globalStorage', 'state.vscdb');
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    const db = new DatabaseSync(dbFile);
    db.exec(`
      CREATE TABLE composerHeaders (
        composerId TEXT PRIMARY KEY,
        workspaceId TEXT,
        createdAt INTEGER,
        lastUpdatedAt INTEGER,
        isArchived INTEGER,
        isSubagent INTEGER,
        value TEXT
      );
      CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT);
    `);
    const composerId = '22222222-2222-2222-2222-222222222222';
    const insertHeader = db.prepare(
      'INSERT INTO composerHeaders (composerId, workspaceId, createdAt, lastUpdatedAt, isArchived, isSubagent, value) VALUES (?, ?, ?, ?, 0, 0, ?)',
    );
    insertHeader.run(composerId, workspaceId, 1_700_000_000_000, 1_700_000_100_000, JSON.stringify({ name: 'Board layout' }));
    insertHeader.run(transcriptId, workspaceId, 1_700_000_200_000, 1_700_000_300_000, JSON.stringify({ name: 'Login redirect' }));
    db.prepare('INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)').run(
      `composerConvHeaders:${composerId}:000000`,
      JSON.stringify([{ bubbleId: 'b1', type: 1 }, { bubbleId: 'b2', type: 2 }]),
    );
    db.prepare('INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)').run(
      `bubbleId:${composerId}:b1`,
      JSON.stringify({ type: 1, text: 'Where are the sessions?' }),
    );
    db.prepare('INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)').run(
      `bubbleId:${composerId}:b2`,
      JSON.stringify({ type: 2, text: 'They are in the database.' }),
    );
    db.close();

    const ctx = createContext({ home, dataDir: path.join(home, '.agent-mem'), env: {} });
    const adapter = cursorAdapter(ctx);
    const sessions = (await adapter.readMemories(project)).filter((item) => item.kind === 'session');
    expect(sessions.map((item) => item.title).sort()).toEqual(['Board layout', 'Login redirect']);
    expect(sessions.find((item) => item.title === 'Login redirect')?.filePath).toBe(cursorComposerPath(home, transcriptId));
    expect((await adapter.listProjects()).map((item) => item.path)).toEqual([project]);

    const parsedTranscript = await adapter.parseSession!(transcript);
    expect(parsedTranscript.messages.map((message) => message.text)).toEqual(['Fix the login redirect', 'Updated the route.']);
    expect(parsedTranscript.messages[1]?.toolCalls).toEqual([{ name: 'read', target: 'src/app.ts' }]);

    const composer = await adapter.parseSession!(cursorComposerPath(home, composerId));
    expect(composer.messages.map((message) => [message.role, message.text])).toEqual([
      ['user', 'Where are the sessions?'],
      ['assistant', 'They are in the database.'],
    ]);
    expect(composer.cwd).toBe(project);
  });

  it('lists a Gemini CLI chat through the projects.json index', async () => {
    const { home, project } = homeFor('gemini');
    const dir = 'g-4f2a91';
    fs.mkdirSync(path.join(home, '.gemini', 'tmp', dir, 'chats'), { recursive: true });
    fs.writeFileSync(path.join(home, '.gemini', 'projects.json'), JSON.stringify({ projects: { [project]: dir } }));
    const chat = path.join(home, '.gemini', 'tmp', dir, 'chats', 'session-20261020T100000-abc.jsonl');
    fs.writeFileSync(
      chat,
      [
        JSON.stringify({ kind: 'session', sessionId: 'gem-demo', projectHash: dir, startTime: '2026-10-20T10:00:00.000Z', directories: [project] }),
        JSON.stringify({ id: 'u1', type: 'user', timestamp: '2026-10-20T10:00:01.000Z', content: 'Add a dark theme toggle to the settings page' }),
        JSON.stringify({ id: 'g1', type: 'gemini', timestamp: '2026-10-20T10:01:00.000Z', content: '', thoughts: [{ subject: 'Theme state', description: 'Store the preference in localStorage' }], toolCalls: [{ name: 'write_file', description: 'src/theme.ts' }] }),
        JSON.stringify({ id: 'i1', type: 'info', content: 'noise that must be skipped' }),
      ].join('\n'),
    );

    const ctx = createContext({ home, dataDir: path.join(home, '.agent-mem'), env: {} });
    const adapter = geminiAdapter(ctx);
    const sessions = (await adapter.readMemories(project)).filter((item) => item.kind === 'session');
    expect(sessions.map((item) => item.title)).toEqual(['Add a dark theme toggle to the settings page']);
    expect((await adapter.listProjects()).map((item) => item.path)).toEqual([project]);
    const parsed = await adapter.parseSession!(sessions[0]!.filePath);
    expect(parsed.sessionId).toBe('gem-demo');
    expect(parsed.cwd).toBe(project);
    expect(parsed.messages.map((message) => [message.role, message.text])).toEqual([
      ['user', 'Add a dark theme toggle to the settings page'],
      ['assistant', 'Theme state'],
    ]);
    expect(parsed.messages[1]?.toolCalls).toEqual([{ name: 'write_file', target: 'src/theme.ts' }]);
  });

  it('lists an opencode session and stitches its message parts', async () => {
    const { home, project } = homeFor('opencode');
    const storage = path.join(home, '.local', 'share', 'opencode', 'storage');
    const sessionId = 'ses_demo01';
    fs.mkdirSync(path.join(storage, 'session'), { recursive: true });
    fs.mkdirSync(path.join(storage, 'message', sessionId.slice(0, 2)), { recursive: true });
    fs.writeFileSync(
      path.join(storage, 'session', `${sessionId}.json`),
      JSON.stringify({ id: sessionId, directory: project, title: '', time: { created: '2026-10-21T08:00:00.000Z', updated: '2026-10-21T08:02:00.000Z' } }),
    );
    fs.writeFileSync(
      path.join(storage, 'message', sessionId.slice(0, 2), 'msg_1.json'),
      JSON.stringify({ id: 'msg_1', sessionID: sessionId, role: 'user', time: { created: '2026-10-21T08:00:01.000Z' }, parts: [{ type: 'text', text: 'Wire up the export button' }] }),
    );
    fs.writeFileSync(
      path.join(storage, 'message', sessionId.slice(0, 2), 'msg_2.json'),
      JSON.stringify({
        id: 'msg_2',
        sessionID: sessionId,
        role: 'assistant',
        time: { created: '2026-10-21T08:01:00.000Z' },
        parts: [{ type: 'step-start' }, { type: 'text', text: 'Export now writes a bundle.' }, { type: 'tool', tool: 'write', state: { input: { filePath: 'src/export.ts' } } }],
      }),
    );

    const ctx = createContext({ home, dataDir: path.join(home, '.agent-mem'), env: {} });
    const adapter = opencodeAdapter(ctx);
    const sessions = (await adapter.readMemories(project)).filter((item) => item.kind === 'session');
    expect(sessions.map((item) => item.title)).toEqual(['Wire up the export button']);
    expect((await adapter.listProjects()).map((item) => item.path)).toEqual([project]);
    expect(adapter.skillRoots!(null)).toEqual([{ dir: path.join(home, '.config', 'opencode', 'skill'), scope: 'global' }]);
    const parsed = await adapter.parseSession!(sessions[0]!.filePath);
    expect(parsed.sessionId).toBe(sessionId);
    expect(parsed.cwd).toBe(project);
    expect(parsed.messages.map((message) => [message.role, message.text])).toEqual([
      ['user', 'Wire up the export button'],
      ['assistant', 'Export now writes a bundle.'],
    ]);
    expect(parsed.messages[1]?.toolCalls).toEqual([{ name: 'write', target: 'src/export.ts' }]);
  });

  it('lists a DeepSeek Harness session for the project', async () => {
    const { home, project } = homeFor('dsh');
    const enc = project.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-');
    const file = path.join(home, '.dsh', 'sessions', enc, '2026-10-22T06-00-00_dsh-7a1b.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      [
        JSON.stringify({ type: 'user', cwd: project, sessionId: 'dsh-7a1b', timestamp: '2026-10-22T06:00:00.000Z', message: { role: 'user', content: 'Set up the release pipeline' } }),
        JSON.stringify({ type: 'assistant', cwd: project, sessionId: 'dsh-7a1b', timestamp: '2026-10-22T06:01:00.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'write', input: { file_path: 'release.md' } }] } }),
        JSON.stringify({ type: 'assistant', cwd: project, sessionId: 'dsh-7a1b', timestamp: '2026-10-22T06:02:00.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Pipeline ready.' }] } }),
      ].join('\n'),
    );
    const ctx = createContext({ home, dataDir: path.join(home, '.agent-mem'), env: {} });
    const adapter = deepseekHarnessAdapter(ctx);
    const sessions = (await adapter.readMemories(project)).filter((item) => item.kind === 'session');
    expect(sessions.map((item) => item.title)).toEqual(['Set up the release pipeline']);
    expect(sessions[0]?.filePath).toBe(dshSessionPath(home, '2026-10-22T06-00-00_dsh-7a1b', project));
    expect((await adapter.listProjects()).map((item) => item.path)).toEqual([project]);
    const parsed = await adapter.parseSession!(file);
    expect(parsed.sessionId).toBe('dsh-7a1b');
    expect(parsed.cwd).toBe(project);
    expect(parsed.messages.flatMap((m) => m.toolCalls)).toEqual([{ name: 'write', target: 'release.md' }]);
    expect(parsed.messages.at(-1)?.text).toBe('Pipeline ready.');
  });

  it('lists a Qoder jsonl session for the project', async () => {
    const { home, project } = homeFor('qoder');
    const file = path.join(home, '.qoder', 'projects', encodeQoderProject(project), 'session-q.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      [
        JSON.stringify({
          type: 'user',
          cwd: project,
          sessionId: 'q1',
          timestamp: '2026-10-24T00:00:00.000Z',
          message: { role: 'user', content: [{ type: 'text', text: 'Open the Qoder session' }] },
        }),
        JSON.stringify({
          type: 'assistant',
          timestamp: '2026-10-24T00:01:00.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Here is the answer.' }] },
        }),
      ].join('\n'),
    );
    const ctx = createContext({ home, dataDir: path.join(home, '.agent-mem'), env: {} });
    const adapter = qoderAdapter(ctx);
    const sessions = (await adapter.readMemories(project)).filter((item) => item.kind === 'session');
    expect(sessions.map((item) => item.title)).toEqual(['Open the Qoder session']);
    expect((await adapter.listProjects()).map((item) => item.path)).toEqual([project]);
    const parsed = await adapter.parseSession!(sessions[0]!.filePath);
    expect(parsed.messages.map((message) => message.text)).toEqual(['Open the Qoder session', 'Here is the answer.']);
    expect(parsed.cwd).toBe(project);
  });

  it('lists a ZCode sqlite session and joins its text parts', async () => {
    const { home, project } = homeFor('zcode');
    const dbFile = path.join(home, '.zcode', 'cli', 'db', 'db.sqlite');
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    const db = new DatabaseSync(dbFile);
    db.exec(`
      CREATE TABLE session (id TEXT, directory TEXT, title TEXT, time_created INTEGER, time_updated INTEGER, time_deleted INTEGER);
      CREATE TABLE message (id TEXT, session_id TEXT, data TEXT, sequence INTEGER, time_created INTEGER);
      CREATE TABLE part (message_id TEXT, session_id TEXT, data TEXT, sequence INTEGER);
    `);
    db.prepare('INSERT INTO session (id, directory, title, time_created, time_updated, time_deleted) VALUES (?, ?, ?, ?, ?, 0)').run(
      'sess-1',
      project,
      '查一下会话',
      1_700_000_000_000,
      1_700_000_200_000,
    );
    db.prepare('INSERT INTO message (id, session_id, data, sequence, time_created) VALUES (?, ?, ?, ?, ?)').run(
      'm1',
      'sess-1',
      JSON.stringify({ role: 'user' }),
      1,
      1_700_000_000_000,
    );
    db.prepare('INSERT INTO message (id, session_id, data, sequence, time_created) VALUES (?, ?, ?, ?, ?)').run(
      'm2',
      'sess-1',
      JSON.stringify({ role: 'assistant' }),
      2,
      1_700_000_100_000,
    );
    db.prepare('INSERT INTO part (message_id, session_id, data, sequence) VALUES (?, ?, ?, ?)').run(
      'm1',
      'sess-1',
      JSON.stringify({ type: 'text', text: '会话正文在哪' }),
      1,
    );
    db.prepare('INSERT INTO part (message_id, session_id, data, sequence) VALUES (?, ?, ?, ?)').run(
      'm2',
      'sess-1',
      JSON.stringify({ type: 'text', text: '在 cli 数据库里。' }),
      1,
    );
    db.prepare('INSERT INTO part (message_id, session_id, data, sequence) VALUES (?, ?, ?, ?)').run(
      'm2',
      'sess-1',
      JSON.stringify({ type: 'tool', tool: 'read', state: { input: { file_path: 'db.sqlite' } } }),
      2,
    );
    db.close();

    const ctx = createContext({ home, dataDir: path.join(home, '.agent-mem'), env: {} });
    const adapter = zcodeAdapter(ctx);
    const sessions = (await adapter.readMemories(project)).filter((item) => item.kind === 'session');
    expect(sessions.map((item) => item.title)).toEqual(['查一下会话']);
    expect(sessions[0]?.filePath).toBe(zcodeSessionPath(home, 'sess-1'));
    expect((await adapter.listProjects()).map((item) => item.path)).toEqual([project]);
    const parsed = await adapter.parseSession!(sessions[0]!.filePath);
    expect(parsed.messages.map((message) => [message.role, message.text])).toEqual([
      ['user', '会话正文在哪'],
      ['assistant', '在 cli 数据库里。'],
    ]);
    expect(parsed.messages[1]?.toolCalls).toEqual([{ name: 'read', target: 'db.sqlite' }]);
    expect(parsed.cwd).toBe(project);
  });
});
