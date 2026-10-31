import { spawn } from 'node:child_process';
import { constants as fsConstants, existsSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import { createTwoFilesPatch } from 'diff';
import { Command, CommanderError } from 'commander';
import {
  Hub,
  applyPlan,
  createContext,
  expandHome,
  exportBundle,
  findSkill,
  listBackups,
  listShares,
  listSkills,
  orphanBackupCount,
  planImportBundle,
  planShare,
  planSkillDelete,
  planSkillTransfer,
  planTransfer,
  planUnshare,
  pruneBackups,
  registerImportedShares,
  safeWrite,
  skillLibraries,
  syncShares,
  tildify,
  undoBackup,
  type Context,
  type MemoryBundle,
  type MemoryItem,
  type Plan,
  type ShareStrategy,
} from '@agent-mem/core';
import { startServer } from '@agent-mem/server';
import { createDemoContext } from './demo.js';

export interface Io {
  stdout(s: string): void;
  stderr(s: string): void;
}

const defaultIo: Io = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

class Exit extends Error {
  constructor(readonly code: number, message = '') {
    super(message);
  }
}

interface LocateOpts {
  project?: string;
  global?: boolean;
}

async function openHub(): Promise<Hub> {
  return Hub.create(createContext());
}

async function locate(hub: Hub, opts: LocateOpts, fallback: 'cwd' | 'required'): Promise<string | null> {
  if (opts.global && opts.project) throw new Error('Pass either --project or --global, not both');
  if (opts.global) return null;
  if (opts.project) {
    const abs = path.resolve(expandHome(hub.ctx, opts.project));
    if (!(await fs.stat(abs).catch(() => null))?.isDirectory()) throw new Error(`Not a directory: ${abs}`);
    return abs;
  }
  if (fallback === 'cwd' && (await hub.projects()).some((p) => p.path === process.cwd())) return process.cwd();
  throw new Error('Pass --project <path> (or run inside a known project). Use --global for memory outside any project.');
}

function printMemories(io: Io, ctx: Context, items: MemoryItem[]) {
  if (items.length === 0) {
    io.stdout('No memories.\n');
    return;
  }
  for (const m of items) {
    const extra = m.alsoReadBy.length ? `  also ${m.alsoReadBy.join(',')}` : '';
    io.stdout(`${m.id}  ${m.agent.padEnd(12)} ${m.scope.padEnd(8)} ${m.kind.padEnd(13)} ${m.title}${extra}\n`);
    io.stdout(`    ${tildify(ctx, m.filePath)}\n`);
  }
}

function printPlan(io: Io, ctx: Context, plan: Plan) {
  io.stdout(`\n${plan.title}\n`);
  for (const n of plan.notes) io.stdout(`  ${n}\n`);
  if (plan.findings.length) io.stdout(`  Possible secrets: ${plan.findings.map((f) => `${f.count} ${f.type}`).join(', ')}\n`);
  for (const op of plan.dirOps ?? []) {
    const how = op.op === 'copy-dir' ? `copy folder${op.destExisted ? ', replacing the existing one' : ''}${op.srcDir ? ` <- ${tildify(ctx, op.srcDir)}` : ''}` : 'delete folder';
    io.stdout(`\n${tildify(ctx, op.destDir)}  (${how})\n`);
  }
  for (const w of plan.writes) {
    const how = w.symlinkTo ? `symlink -> ${w.symlinkTo}` : w.remove ? 'delete' : w.before == null ? 'create' : 'update';
    io.stdout(`\n${tildify(ctx, w.filePath)}  (${how})\n`);
    if (!w.symlinkTo && !w.remove) {
      io.stdout(createTwoFilesPatch(w.filePath, w.filePath, w.before ?? '', w.after, '', '', { context: 2 }));
    }
  }
}

async function confirm(io: Io, yes: boolean | undefined): Promise<boolean> {
  if (yes) return true;
  if (!process.stdin.isTTY) {
    io.stderr('Nothing written. Re-run with --yes to apply.\n');
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question('Apply these changes? [y/N] ')).trim();
    return /^y(es)?$/i.test(answer);
  } finally {
    rl.close();
  }
}

async function commit(io: Io, hub: Hub, plans: Plan[], yes: boolean | undefined) {
  for (const plan of plans) printPlan(io, hub.ctx, plan);
  if (!(await confirm(io, yes))) throw new Exit(2);
  const files: string[] = [];
  for (const plan of plans) files.push(...(await applyPlan(hub.ctx, plan)).files);
  for (const f of files) await syncShares(hub, f);
  io.stdout(`\nApplied ${plans.length} change${plans.length === 1 ? '' : 's'} across ${files.length} file${files.length === 1 ? '' : 's'}.\n`);
}

function splitAgents(list: string): string[] {
  const ids = list.split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) throw new Error('Pass at least one agent to --to');
  return ids;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function addLocate(cmd: Command) {
  return cmd.option('-p, --project <path>', 'project directory').option('-g, --global', 'use global memory instead of a project');
}

export function buildProgram(io: Io): Command {
  const program = new Command();
  program
    .name('agent-mem')
    .description('Manage, share and hand off memories between coding agents')
    .version(version())
    .configureOutput({ writeOut: (s) => io.stdout(s), writeErr: (s) => io.stderr(s) })
    .exitOverride();

  program
    .command('ui')
    .description('Start the local web UI')
    .option('--port <port>', 'port to listen on', '4477')
    .option('--host <host>', 'address to bind', '127.0.0.1')
    .option('--no-open', 'do not open a browser')
    .option('--no-watch', 'do not watch memory files for changes')
    .option('--demo', 'serve sample memories from a temporary directory instead of this machine')
    .action(async (opts: { port: string; host: string; open: boolean; watch: boolean; demo?: boolean }) => {
      const demo = opts.demo ? createDemoContext() : null;
      const hub = demo ? await Hub.create(demo.ctx) : await openHub();
      const port = Number(opts.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port: ${opts.port}`);
      // The web bundle ships inside this package (packages/cli/web-dist); the
      // server's repo-layout fallback only exists in a dev checkout.
      const bundled = fileURLToPath(new URL('../web-dist', import.meta.url));
      const webDist = existsSync(bundled) ? bundled : undefined;
      const server = await startServer({ hub, port, host: opts.host, watch: opts.watch, webDist });
      if (demo) io.stdout(`Demo data lives in ${demo.root} and is not your real home directory.\n`);
      io.stdout(`agent-mem is running at ${server.url}\n`);
      if (opts.open) openBrowser(server.url);
      await new Promise<void>((resolve) => {
        const stop = () => {
          void server.close().then(resolve);
        };
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
      });
    });

  addLocate(
    program
      .command('ls')
      .description('List projects and their memories')
      .option('--json', 'print JSON'),
  ).action(async (opts: LocateOpts & { json?: boolean }) => {
    const hub = await openHub();
    const projects = await hub.projects();
    let project: string | null | undefined;
    if (opts.global) project = null;
    else if (opts.project) project = await locate(hub, opts, 'required');
    else if (projects.some((p) => p.path === process.cwd())) project = process.cwd();
    const memories = project !== undefined ? await hub.memories(project) : [];
    if (opts.json) {
      io.stdout(`${JSON.stringify({ projects, memories }, null, 2)}\n`);
      return;
    }
    if (project === undefined) {
      if (projects.length === 0) io.stdout('No projects yet. Run an agent in one, or add it with `agent-mem projects add <path>`.\n');
      for (const p of projects) io.stdout(`${p.name.padEnd(24)} ${(p.agents.join(', ') || 'no sessions').padEnd(28)} ${tildify(hub.ctx, p.path)}\n`);
      return;
    }
    io.stdout(project ? `Memories for ${tildify(hub.ctx, project)}\n` : 'Global memories\n');
    printMemories(io, hub.ctx, memories);
  });

  addLocate(
    program
      .command('link')
      .description('Let other agents read a memory, and keep it in sync')
      .argument('<memory>', 'memory id, file path, or agent:path such as codex:AGENTS.md')
      .requiredOption('--to <agents>', 'comma-separated agents, e.g. claude,pi')
      .option('--strategy <strategy>', 'import, symlink or copy (default: best available)')
      .option('-y, --yes', 'apply without asking'),
  ).action(async (ref: string, opts: LocateOpts & { to: string; strategy?: ShareStrategy; yes?: boolean }) => {
    const hub = await openHub();
    const project = await locate(hub, opts, 'cwd');
    const item = await hub.resolveMemory(ref, project);
    if (opts.strategy && !['import', 'symlink', 'copy'].includes(opts.strategy)) throw new Error('--strategy must be import, symlink or copy');
    const plans = [];
    for (const agent of splitAgents(opts.to)) plans.push(await planShare(hub, item, agent, opts.strategy));
    await commit(io, hub, plans, opts.yes);
  });

  program
    .command('unlink')
    .description('Stop sharing a memory')
    .argument('<shareId>', 'id from `agent-mem shares`')
    .option('-y, --yes', 'apply without asking')
    .action(async (shareId: string, opts: { yes?: boolean }) => {
      const hub = await openHub();
      await commit(io, hub, [await planUnshare(hub, shareId)], opts.yes);
    });

  addLocate(
    program
      .command('handoff')
      .description('Turn one agent\'s latest session into a handoff document another agent reads')
      .requiredOption('--from <agent>', 'agent whose session to summarize')
      .requiredOption('--to <agents>', 'comma-separated target agents')
      .option('--session <ref>', 'session id or file instead of the most recent one')
      .option('-y, --yes', 'apply without asking'),
  ).action(async (opts: LocateOpts & { from: string; to: string; session?: string; yes?: boolean }) => {
    const hub = await openHub();
    const project = await locate(hub, opts, 'cwd');
    if (!project) throw new Error('Handoffs belong to a project. Pass --project.');
    const from = hub.adapter(opts.from).id;
    const sessions = (await hub.memories(project)).filter((m) => m.kind === 'session' && m.agent === from).sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (sessions.length === 0) throw new Error(`No ${from} sessions found for ${project}`);
    const session = opts.session ? await hub.resolveMemory(opts.session, project) : sessions[0]!;
    if (session.kind !== 'session') throw new Error(`${opts.session} is not a session`);
    const plans = [];
    for (const agent of splitAgents(opts.to)) plans.push(await planTransfer(hub, session, agent, { render: 'summary' }));
    await commit(io, hub, plans, opts.yes);
  });

  addLocate(
    program
      .command('transfer')
      .description('Copy a memory onto another agent (sessions become a handoff)')
      .argument('<memory>', 'memory id, file path, or agent:path')
      .requiredOption('--to <agents>', 'comma-separated target agents')
      .option('--summarize', 'preview a summary instead of the original text')
      .option('-y, --yes', 'apply without asking'),
  ).action(async (ref: string, opts: LocateOpts & { to: string; summarize?: boolean; yes?: boolean }) => {
    const hub = await openHub();
    const project = await locate(hub, opts, 'cwd');
    const item = await hub.resolveMemory(ref, project);
    const plans = [];
    for (const agent of splitAgents(opts.to)) plans.push(await planTransfer(hub, item, agent, { render: opts.summarize ? 'summary' : 'verbatim' }));
    await commit(io, hub, plans, opts.yes);
  });

  addLocate(
    program
      .command('edit')
      .description('Replace a memory file with the contents of --file or stdin')
      .argument('<memory>', 'memory id, file path, or agent:path')
      .option('-f, --file <path>', 'read new contents from this file'),
  ).action(async (ref: string, opts: LocateOpts & { file?: string }) => {
    const hub = await openHub();
    const project = await locate(hub, opts, 'cwd');
    const item = await hub.resolveMemory(ref, project);
    if (item.kind === 'session') throw new Error('Sessions are read-only. Hand one off instead.');
    const content = opts.file ? await fs.readFile(opts.file, 'utf8') : await readStdin(io);
    const res = await safeWrite(hub.ctx, item.filePath, content, { expectedHash: item.hash, reason: `cli edit: ${item.title}` });
    await syncShares(hub, item.filePath);
    io.stdout(`Updated ${tildify(hub.ctx, res.filePath)} (backup ${res.backup.id})\n`);
  });

  addLocate(
    program
      .command('search')
      .description('Find memories whose title, path or content mentions a text')
      .argument('<text>', 'text to look for (case-insensitive)')
      .option('--json', 'print JSON'),
  ).action(async (text: string, opts: LocateOpts & { json?: boolean }) => {
    const hub = await openHub();
    const project = await locate(hub, opts, 'cwd');
    const q = text.toLowerCase();
    const hits: { item: MemoryItem; lines: { no: number; text: string }[] }[] = [];
    for (const m of await hub.memories(project)) {
      const lines = m.content
        .split('\n')
        .map((l, i) => ({ no: i + 1, text: l.trim() }))
        .filter((l) => l.text.toLowerCase().includes(q))
        .slice(0, 5);
      const meta = `${m.title} ${m.filePath}`.toLowerCase().includes(q);
      if (lines.length || meta) hits.push({ item: m, lines });
    }
    if (opts.json) {
      io.stdout(`${JSON.stringify(hits.map((h) => ({ id: h.item.id, agent: h.item.agent, title: h.item.title, filePath: h.item.filePath, lines: h.lines })), null, 2)}\n`);
      return;
    }
    if (hits.length === 0) {
      io.stdout(project ? `No memories in ${tildify(hub.ctx, project)} mention "${text}".\n` : `No global memories mention "${text}".\n`);
      return;
    }
    io.stdout(`${hits.length} memor${hits.length === 1 ? 'y' : 'ies'} mention "${text}":\n`);
    for (const h of hits) {
      io.stdout(`\n${h.item.id}  ${h.item.agent}  ${h.item.title}\n  ${tildify(hub.ctx, h.item.filePath)}\n`);
      for (const l of h.lines) io.stdout(`  L${l.no}: ${l.text.slice(0, 160)}\n`);
    }
  });

  const agentsCmd = program
    .command('agents')
    .description('List the coding agents agent-mem knows about, or manage custom ones');
  agentsCmd
    .command('add <id>')
    .description('Register a config-only agent that reads Markdown files')
    .requiredOption('--display <name>', 'name shown in the UI')
    .requiredOption('--home <dir>', 'directory whose existence means the agent is installed, e.g. ~/.deepseek')
    .option('--global-file <file>', 'global instruction file (default: <home>/AGENTS.md)')
    .option('--project-file <name>', 'instruction file name inside a project; repeatable', collect, [])
    .option('--imports', 'the agent understands @path imports')
    .action(async (id: string, opts: { display: string; home: string; globalFile?: string; projectFile: string[]; imports?: boolean }) => {
      const hub = await openHub();
      await hub.addAgent({
        id,
        displayName: opts.display,
        homeDir: opts.home,
        globalFile: opts.globalFile,
        projectFiles: opts.projectFile.length ? opts.projectFile : ['AGENTS.md'],
        imports: opts.imports ?? false,
      });
      io.stdout(`Added agent "${id}". It appears in \`agent-mem agents\` and the web UI once ${opts.home} exists.\n`);
    });
  agentsCmd
    .command('remove <id>')
    .description('Remove a custom agent (built-in agents cannot be removed)')
    .action(async (id: string) => {
      const hub = await openHub();
      await hub.removeAgent(id);
      io.stdout(`Removed agent "${id}".\n`);
    });
  agentsCmd
    .option('--json', 'print JSON')
    .action(async (opts: { json?: boolean }) => {
      const hub = await openHub();
      const agents = await hub.agents();
      if (opts.json) {
        io.stdout(`${JSON.stringify(agents, null, 2)}\n`);
        return;
      }
      for (const a of agents) {
        io.stdout(`${a.id.padEnd(14)} ${(a.detected ? 'installed' : 'missing').padEnd(10)} ${a.displayName.padEnd(14)} ${a.capabilities.imports ? '@imports' : 'inline'}\n`);
      }
      io.stdout('\nHide a column for an agent in the web UI, or run `agent-mem agents add` to register a custom one.\n');
    });

  const skillsCmd = program.command('skills').description('Manage the skill libraries of every coding agent');
  addLocate(skillsCmd.command('ls').description('List skills across libraries').option('--json', 'print JSON')).action(async (opts: LocateOpts & { json?: boolean }) => {
    const hub = await openHub();
    const project = await locate(hub, opts, 'cwd');
    const skills = await listSkills(hub, project);
    if (opts.json) {
      io.stdout(`${JSON.stringify(skills, null, 2)}\n`);
      return;
    }
    if (skills.length === 0) io.stdout('No skills found. Libraries are scanned per agent plus the shared ~/.agents/skills.\n');
    for (const s of skills) {
      const extra = s.shared ? '  shared' : '';
      io.stdout(`${s.name.padEnd(24)} ${s.agent.padEnd(12)} ${s.scope.padEnd(8)} ${s.fileCount} file${s.fileCount === 1 ? '' : 's'}${extra}\n`);
      io.stdout(`    ${tildify(hub.ctx, s.dirPath)}\n`);
      if (s.description) io.stdout(`    ${s.description.slice(0, 120)}\n`);
    }
  });
  skillsCmd
    .command('libraries')
    .description('List the skill libraries available here')
    .action(async () => {
      const hub = await openHub();
      for (const l of await skillLibraries(hub)) io.stdout(`${l.id.padEnd(14)} ${l.displayName}\n`);
    });
  addLocate(
    skillsCmd
      .command('migrate')
      .description('Copy or move a skill folder to another library')
      .argument('<skill>', 'skill name, or agent:name when several libraries have it')
      .requiredOption('--to <library>', 'target library id (see `skills libraries`; e.g. claude-code, codex, shared)')
      .option('--move', 'remove the skill from the source library after copying')
      .option('--overwrite', 'replace a skill with the same name in the target')
      .option('-y, --yes', 'apply without asking'),
  ).action(async (ref: string, opts: LocateOpts & { to: string; move?: boolean; overwrite?: boolean; yes?: boolean }) => {
    const hub = await openHub();
    const project = await locate(hub, opts, 'cwd');
    const skill = await findSkill(hub, ref, project);
    await commit(io, hub, [await planSkillTransfer(hub, skill, opts.to, { move: opts.move, overwrite: opts.overwrite })], opts.yes);
  });
  addLocate(
    skillsCmd
      .command('rm')
      .description('Delete a skill folder (a full backup is kept for undo)')
      .argument('<skill>', 'skill name, or agent:name')
      .option('-y, --yes', 'apply without asking'),
  ).action(async (ref: string, opts: LocateOpts & { yes?: boolean }) => {
    const hub = await openHub();
    const project = await locate(hub, opts, 'cwd');
    const skill = await findSkill(hub, ref, project);
    await commit(io, hub, [await planSkillDelete(hub, skill)], opts.yes);
  });

  program
    .command('doctor')
    .description('Check agent detection, the data directory and share consistency')
    .option('--json', 'print JSON')
    .action(async (opts: { json?: boolean }) => {
      const hub = await openHub();
      const agents = await hub.agents();
      await fs.mkdir(hub.ctx.dataDir, { recursive: true }).catch(() => {});
      const dataWritable = await fs.access(hub.ctx.dataDir, fsConstants.W_OK).then(
        () => true,
        () => false,
      );
      const shares = await listShares(hub.ctx);
      const backups = await listBackups(hub.ctx);
      const orphans = await orphanBackupCount(hub.ctx);
      const problems: string[] = [];
      if (!dataWritable) problems.push(`data directory is not writable: ${hub.ctx.dataDir}`);
      if (orphans > 0) problems.push(`${orphans} orphan backup file${orphans === 1 ? '' : 's'} (run \`agent-mem clean\`)`);
      const shareIssues: string[] = [];
      for (const s of shares) {
        if ((await fs.stat(s.sourcePath).catch(() => null)) == null) shareIssues.push(`share ${s.id}: source missing ${tildify(hub.ctx, s.sourcePath)}`);
        if ((await fs.stat(s.targetPath).catch(() => null)) == null) shareIssues.push(`share ${s.id}: target missing ${tildify(hub.ctx, s.targetPath)}`);
      }
      problems.push(...shareIssues);
      const report = {
        agents: agents.map((a) => ({ id: a.id, displayName: a.displayName, detected: a.detected, imports: a.capabilities.imports })),
        dataDir: hub.ctx.dataDir,
        dataWritable,
        shares: shares.map((s) => ({ id: s.id, strategy: s.strategy, sourceAgent: s.sourceAgent, targetAgent: s.targetAgent })),
        shareIssues,
        backups: { total: backups.length, restored: backups.filter((b) => b.undone).length },
        problems,
      };
      if (opts.json) {
        io.stdout(`${JSON.stringify(report, null, 2)}\n`);
      } else {
        io.stdout('Agents\n');
        for (const a of agents) io.stdout(`  ${a.detected ? 'ok  ' : '--  '}${a.id.padEnd(14)} ${a.displayName}${a.detected ? '' : '  (not installed)'}\n`);
        io.stdout('\nData\n');
        io.stdout(`  ${dataWritable ? 'ok  ' : '!!  '}data directory ${dataWritable ? 'writable' : 'NOT writable'}: ${tildify(hub.ctx, hub.ctx.dataDir)}\n`);
        io.stdout(`  ok  ${backups.length} backup${backups.length === 1 ? '' : 's'} recorded, ${backups.filter((b) => b.undone).length} restored\n`);
        io.stdout(`\nShares\n`);
        if (shares.length === 0) io.stdout('  --  nothing shared yet\n');
        for (const s of shares) io.stdout(`  ok  ${s.id}  ${s.strategy}  ${s.sourceAgent} -> ${s.targetAgent}\n`);
        for (const issue of shareIssues) io.stdout(`  !!  ${issue}\n`);
        io.stdout(`\nBackups\n`);
        io.stdout(`  ${orphans === 0 ? 'ok  ' : '!!  '}${orphans} orphan backup file${orphans === 1 ? '' : 's'} on disk${orphans ? ' (run `agent-mem clean`)' : ''}\n`);
        io.stdout(`\n${problems.length === 0 ? 'No problems found.' : `${problems.length} problem${problems.length === 1 ? '' : 's'} found:`}\n`);
        for (const p of problems) io.stdout(`  !!  ${p}\n`);
      }
      if (problems.length) throw new Exit(1);
    });

  addLocate(
    program
      .command('export')
      .description('Write this project\'s memory files (and their share links) to a portable JSON bundle')
      .requiredOption('-o, --out <file>', 'output file, or - for stdout'),
  ).action(async (opts: LocateOpts & { out: string }) => {
    const hub = await openHub();
    const project = await locate(hub, opts, 'required');
    if (!project) throw new Error('Exports are per project. Pass --project.');
    const bundle = await exportBundle(hub, project);
    const json = `${JSON.stringify(bundle, null, 2)}\n`;
    if (opts.out === '-') io.stdout(json);
    else {
      await fs.writeFile(opts.out, json);
      io.stdout(`Wrote ${bundle.items.length} memories and ${bundle.shares.length} share records to ${opts.out}.\n`);
    }
  });

  program
    .command('import')
    .description('Restore a bundle produced by `agent-mem export` into a project directory')
    .argument('<file>', 'bundle file, or - for stdin')
    .requiredOption('-p, --project <path>', 'project directory to restore into')
    .option('-y, --yes', 'apply without asking')
    .action(async (file: string, opts: { project: string; yes?: boolean }) => {
      const hub = await openHub();
      const project = await locate(hub, { project: opts.project }, 'required');
      const text = file === '-' ? await readStdin(io) : await fs.readFile(file, 'utf8');
      let bundle: MemoryBundle;
      try {
        bundle = JSON.parse(text) as MemoryBundle;
      } catch (e) {
        throw new Error(`Not a valid bundle file: ${(e as Error).message}`);
      }
      const { plan, shares } = await planImportBundle(hub, bundle, project!);
      await commit(io, hub, [plan], opts.yes);
      await registerImportedShares(hub, shares);
      if (shares.length) io.stdout(`Restored ${shares.length} share record${shares.length === 1 ? '' : 's'}.\n`);
    });

  program
    .command('clean')
    .description('Delete backup snapshots the history no longer references')
    .option('-y, --yes', 'delete without asking')
    .action(async (opts: { yes?: boolean }) => {
      const hub = await openHub();
      const orphans = await orphanBackupCount(hub.ctx);
      if (orphans === 0) {
        io.stdout('Nothing to clean: every backup snapshot is still referenced by the history.\n');
        return;
      }
      io.stdout(`Deleting ${orphans} orphan backup file${orphans === 1 ? '' : 's'} under ${path.join(tildify(hub.ctx, hub.ctx.dataDir), 'backups', 'files')}.\n`);
      if (!(await confirm(io, opts.yes))) throw new Exit(2);
      const { removedFiles } = await pruneBackups(hub.ctx);
      io.stdout(`Deleted ${removedFiles.length} file${removedFiles.length === 1 ? '' : 's'}.\n`);
    });

  program
    .command('shares')
    .description('List memories shared between agents')
    .option('--json', 'print JSON')
    .action(async (opts: { json?: boolean }) => {
      const hub = await openHub();
      const shares = await listShares(hub.ctx);
      if (opts.json) {
        io.stdout(`${JSON.stringify(shares, null, 2)}\n`);
        return;
      }
      if (shares.length === 0) io.stdout('Nothing is shared yet.\n');
      for (const s of shares) io.stdout(`${s.id}  ${s.strategy.padEnd(8)} ${s.sourceAgent} -> ${s.targetAgent}  ${tildify(hub.ctx, s.sourcePath)}\n`);
    });

  program
    .command('sync')
    .description('Refresh shared copies whose source changed')
    .action(async () => {
      const hub = await openHub();
      const res = await syncShares(hub);
      io.stdout(res.updated.length ? `Refreshed ${res.updated.length} shared cop${res.updated.length === 1 ? 'y' : 'ies'}.\n` : 'All shared copies are up to date.\n');
      if (res.missing.length) io.stderr(`Source missing for ${res.missing.length} share${res.missing.length === 1 ? '' : 's'}: ${res.missing.join(', ')}\n`);
    });

  program
    .command('undo')
    .description('Restore the previous contents of a file agent-mem wrote')
    .argument('[id]', 'backup id (default: the most recent change)')
    .action(async (id?: string) => {
      const hub = await openHub();
      const entry = await undoBackup(hub.ctx, id);
      const synced = await syncShares(hub, entry.filePath);
      io.stdout(`Restored ${tildify(hub.ctx, entry.filePath)}\n`);
      if (synced.updated.length) io.stdout(`Updated ${synced.updated.length} shared cop${synced.updated.length === 1 ? 'y' : 'ies'} to match.\n`);
    });

  program
    .command('history')
    .description('List recorded changes')
    .action(async () => {
      const hub = await openHub();
      const entries = await listBackups(hub.ctx);
      if (entries.length === 0) io.stdout('No changes recorded.\n');
      for (const e of entries.slice(0, 30)) io.stdout(`${e.undone ? 'restored ' : '         '}${e.id}  ${e.reason}  ${tildify(hub.ctx, e.filePath)}\n`);
    });

  program
    .command('projects')
    .description('Manage the project list')
    .argument('<action>', 'add')
    .argument('<path>', 'project directory')
    .action(async (action: string, projectPath: string) => {
      if (action !== 'add') throw new Error('Usage: agent-mem projects add <path>');
      const hub = await openHub();
      await hub.addProject(projectPath);
      io.stdout(`Added ${path.resolve(expandHome(hub.ctx, projectPath))}\n`);
    });

  return program;
}

function version(): string {
  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;
}

async function readStdin(io: Io): Promise<string> {
  if (process.stdin.isTTY) throw new Error('Pass --file <path> or pipe the new contents on stdin');
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) io.stderr('Warning: writing empty contents.\n');
  return text;
}

function openBrowser(url: string) {
  const bin = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(bin, args, { stdio: 'ignore', detached: true }).unref();
}

export async function run(argv: string[], io: Io = defaultIo): Promise<number> {
  try {
    await buildProgram(io).parseAsync(argv, { from: 'user' });
    return 0;
  } catch (e) {
    if (e instanceof CommanderError) return e.exitCode;
    if (e instanceof Exit) {
      if (e.message) io.stderr(`${e.message}\n`);
      return e.code;
    }
    io.stderr(`${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}
