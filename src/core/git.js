import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

export const metrics = { calls: 0, milliseconds: 0 };
export async function git(root, args, { input, env: extra = {}, allowFailure = false } = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0', GIT_LITERAL_PATHSPECS: '1', LC_ALL: 'C', ...extra });
  const started = performance.now(); metrics.calls++;
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false',
        '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', '-c', 'core.fsmonitor=false', ...args], { cwd: root, env, shell: false });
      const stdout = [], stderr = []; let bytes = 0, timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, 120_000);
      child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 128 * 1024 * 1024) child.kill(); else stdout.push(chunk); });
      child.stderr.on('data', chunk => { if (stderr.length < 100) stderr.push(chunk); });
      child.stdin.on('error', () => {});
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => {
        clearTimeout(timer);
        const result = { code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString('utf8') };
        if (timedOut || bytes > 128 * 1024 * 1024) return reject(new Error('Git operation exceeded its time/output limit.'));
        if (code !== 0 && !allowFailure) return reject(new Error(`Git ${args[0]} failed: ${result.stderr.trim() || code}`));
        resolve(result);
      });
      child.stdin.end(input);
    });
  } finally { metrics.milliseconds += performance.now() - started; }
}
export const text = async (root, args, options) => (await git(root, args, options)).stdout.toString('utf8').trim();
export const head = root => text(root, ['rev-parse', '--verify', 'HEAD']);
export const branch = root => text(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
export function nul(buffer) {
  const value = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  if (value && !value.endsWith('\0')) throw new Error('Incomplete Git NUL output.');
  return value ? value.slice(0, -1).split('\0') : [];
}
export function parseStatus(buffer) {
  const records = nul(buffer), result = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record.length < 4 || record[2] !== ' ') throw new Error('Invalid Git status record.');
    const code = record.slice(0, 2), name = record.slice(3);
    result.push({ path: name, code });
    if (/[RC]/.test(code)) {
      if (!records[++i]) throw new Error('Incomplete Git rename record.');
      result.push({ path: records[i], code: ' D' });
    }
  }
  return result;
}
export const status = async root => parseStatus((await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none'])).stdout);
export const names = async (root, args) => nul((await git(root, args)).stdout);
export async function tree(root, ref) {
  const entries = new Map();
  for (const row of await names(root, ['ls-tree', '-r', '-z', ref])) {
    const tab = row.indexOf('\t'), [mode, type, oid] = row.slice(0, tab).split(' ');
    entries.set(row.slice(tab + 1), { mode, type, oid });
  }
  return entries;
}
export async function guardRepo(root) {
  if (await text(root, ['rev-parse', '--show-object-format']) !== 'sha1') throw new Error('Only SHA-1 Git repositories are supported in this beta.');
  await branch(root); await head(root);
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
    if ((await git(root, ['rev-parse', '--verify', marker], { allowFailure: true })).code === 0) throw new Error(`Finish the Git operation first: ${marker}`);
  }
  if ((await names(root, ['ls-files', '-u', '-z'])).length) throw new Error('Resolve Git index conflicts first.');
}
