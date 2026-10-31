import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

test('the npm archive includes a standalone CLI, web UI, and usable documentation', () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'agent-mem-package-'));
  try {
    const output = execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary, '--cache', path.join(temporary, 'cache')], {
      cwd: path.join(root, 'packages/cli'), encoding: 'utf8', shell: process.platform === 'win32',
    });
    const [archive] = JSON.parse(output);
    const tarball = path.join(temporary, archive.filename);
    const read = (file) => execFileSync('tar', ['-xOf', tarball, `package/${file}`], { encoding: 'utf8' });
    const manifest = JSON.parse(read('package.json'));
    assert.equal(manifest.engines?.node, '>=22.13.0');
    assert.ok(manifest.scripts.prepack, 'packing must rebuild the release');
    assert.ok(!Object.keys(manifest.dependencies).some((name) => name.startsWith('@agent-mem/')), 'internal modules must ship inside the CLI');
    const files = new Set(archive.files.map((file) => file.path));
    for (const required of ['dist/index.js', 'dist/run.js', 'web-dist/index.html', 'README.md', 'README.zh-CN.md', 'LICENSE']) {
      assert.ok(files.has(required), `missing ${required}`);
    }
    assert.doesNotMatch(read('dist/run.js'), /from ['"]@agent-mem\//);
    for (const name of ['README.md', 'README.zh-CN.md']) {
      const markdown = read(name);
      assert.doesNotMatch(markdown, /(?:href|src)="packages\//, 'repository paths break on npm');
      assert.match(markdown, /npx agent-mem ui/);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
