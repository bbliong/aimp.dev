import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aimp-package-'));
try {
  // npm publish --dry-run propagates npm_config_dry_run to lifecycle scripts;
  // explicitly disable it here because this smoke test must inspect a real tarball.
  const result = execFileSync('npm', ['pack', '--dry-run=false', '--json', '--pack-destination', dir], { cwd: root, encoding: 'utf8' });
  const [{ filename }] = JSON.parse(result);
  const extract = path.join(dir, 'extract'); await fs.mkdir(extract);
  execFileSync('tar', ['-xzf', path.join(dir, filename), '-C', extract]);
  const version = execFileSync(process.execPath, [path.join(extract, 'package', 'bin', 'aimp.js'), '--version'], { encoding: 'utf8' }).trim();
  const pkg = JSON.parse(await fs.readFile(path.join(extract, 'package', 'package.json'), 'utf8'));
  if (version !== `aimp ${pkg.version}`) throw new Error(`Unexpected tarball version: ${version}`);
  console.log(`package smoke test passed (${filename})`);
} finally { await fs.rm(dir, { recursive: true, force: true }); }
