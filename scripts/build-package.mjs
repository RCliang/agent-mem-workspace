import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'packages/cli');
const manifest = JSON.parse(readFileSync(path.join(cli, 'package.json'), 'utf8'));
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const run = (args) => execFileSync(pnpm, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });

rmSync(path.join(cli, 'dist'), { recursive: true, force: true });
run(['-r', '--filter', './packages/core', '--filter', './packages/server', '--filter', './packages/cli', 'run', 'build']);
run(['--filter', '@agent-mem/web', 'run', 'build']);

// Ship workspace modules inside the CLI, leaving registry dependencies external.
await build({
  absWorkingDir: root,
  entryPoints: ['packages/cli/src/run.ts'],
  outfile: 'packages/cli/dist/run.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22.13',
  sourcemap: true,
  external: Object.keys(manifest.dependencies),
});

rmSync(path.join(cli, 'web-dist'), { recursive: true, force: true });
cpSync(path.join(root, 'packages/web/dist'), path.join(cli, 'web-dist'), { recursive: true });
for (const name of ['README.md', 'README.zh-CN.md', 'LICENSE']) {
  cpSync(path.join(root, name), path.join(cli, name));
}
