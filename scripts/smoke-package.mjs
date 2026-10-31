import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const archive = process.argv[2];
if (!archive) throw new Error('Usage: node scripts/smoke-package.mjs /absolute/path/to/package.tgz');
const temporary = mkdtempSync(path.join(os.tmpdir(), 'agent-mem-install-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let child;
try {
  execFileSync(npm, [
    'install', '--prefix', temporary, '--omit=dev', '--no-audit', '--no-fund',
    '--registry=https://registry.npmjs.org', '--fetch-retries=1', '--fetch-timeout=15000', '--cache', path.join(temporary, 'cache'), path.resolve(archive),
  ], { stdio: 'inherit', shell: process.platform === 'win32' });
  const bin = path.join(temporary, 'node_modules/@liangstech/agent-mem/dist/index.js');
  const command = path.join(temporary, 'node_modules/.bin', process.platform === 'win32' ? 'agent-mem.cmd' : 'agent-mem');
  const version = execFileSync(command, ['--version'], { cwd: temporary, encoding: 'utf8', shell: process.platform === 'win32' }).trim();
  assert.equal(execFileSync(process.execPath, [bin, '--version'], { encoding: 'utf8' }).trim(), version);
  assert.match(version, /^\d+\.\d+\.\d+$/);

  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  child = spawn(process.execPath, [bin, 'ui', '--demo', '--no-open', '--no-watch', '--port', String(port)], {
    cwd: temporary, stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('UI startup timed out')), 15_000);
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`UI exited during startup: ${code}`)); });
    child.stdout.on('data', (data) => {
      if (data.toString().includes('agent-mem is running at')) { clearTimeout(timeout); resolve(); }
    });
    child.stderr.on('data', (data) => process.stderr.write(data));
  });
  const base = `http://127.0.0.1:${port}`;
  const html = await fetch(base).then((response) => { assert.equal(response.status, 200); return response.text(); });
  assert.match(html, /<div id="root">/);
  for (const [, asset] of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) {
    const response = await fetch(base + asset);
    assert.equal(response.status, 200, `missing ${asset}`);
    assert.doesNotMatch(response.headers.get('content-type') ?? '', /text\/html/, `asset returned the HTML fallback: ${asset}`);
  }
  const projects = await fetch(`${base}/api/projects`).then((response) => response.json());
  assert.ok(projects.length > 0, 'demo project missing');
  const memories = await fetch(`${base}/api/memories?project=${encodeURIComponent(projects[0].path)}`).then((response) => response.json());
  assert.ok(memories.length > 0, 'demo memories missing');
  console.log(`Installed @liangstech/agent-mem ${version} on ${process.version}; CLI, UI assets, projects, and memories work outside the repository.`);
} finally {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await once(child, 'exit');
  }
  rmSync(temporary, { recursive: true, force: true });
}
