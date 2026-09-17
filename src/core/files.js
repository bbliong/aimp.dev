import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const MANAGED = new Set(['AIMP_REPORT.md', 'AGENTS-AIMP.md', 'AGENTS.md', '.aimpignore']);
export const hash = data => crypto.createHash('sha256').update(data).digest('hex');
export const present = async file => { try { return await fs.lstat(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
export function validatePath(rel) {
  const parts = rel.split('/');
  if (!rel || path.isAbsolute(rel) || rel.includes('\0') || rel.includes('\\') || parts.some(p => !p || p === '.' || p === '..' || ['.git', '.aimp'].includes(p.toLowerCase()))) throw new Error(`Unsafe path: ${JSON.stringify(rel)}`);
  return rel;
}
export async function safePath(root, rel) {
  validatePath(rel);
  let current = root;
  const parts = rel.split('/');
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const st = await present(current);
    if (!st) continue;
    if (st.isSymbolicLink() || (st.isFile() && st.nlink > 1)) throw new Error(`Link is not supported: ${JSON.stringify(rel)}`);
    if (i < parts.length - 1) {
      if (!st.isDirectory()) throw new Error(`Parent is not a directory: ${JSON.stringify(rel)}`);
      if (await present(path.join(current, '.git'))) throw new Error(`Nested repository: ${JSON.stringify(rel)}`);
    } else if (!st.isFile()) throw new Error(`Not a regular file: ${JSON.stringify(rel)}`);
  }
  return current;
}
export async function canonical(target) {
  const absolute = path.resolve(target), st = await present(absolute);
  if (st) { if (st.isSymbolicLink()) throw new Error('Root must not be a symlink.'); return fs.realpath(absolute); }
  return path.join(await canonical(path.dirname(absolute)), path.basename(absolute));
}
export const overlaps = (a, b) => a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
export async function mirrorTarget(original, requested, stateRoot) {
  const target = await canonical(requested), originalCanonical = await canonical(original), stateCanonical = await canonical(stateRoot), home = await fs.realpath(os.homedir());
  if (overlaps(originalCanonical, target) || overlaps(stateCanonical, target) || target === '/' || target === home || home.startsWith(target + path.sep)) throw new Error('Mirror target overlaps a protected directory.');
  return process.platform === 'darwin' ? path.resolve(requested) : target;
}
export async function fingerprint(root, rel) {
  const full = await safePath(root, rel), st = await present(full);
  if (!st) return null;
  const file = await fs.open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat(), sha = crypto.createHash('sha256'), blob = crypto.createHash('sha1').update(`blob ${before.size}\0`);
    for await (const chunk of file.createReadStream({ autoClose: false })) { sha.update(chunk); blob.update(chunk); }
    const after = await file.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw new Error(`File changed while reading: ${JSON.stringify(rel)}`);
    return { hash: sha.digest('hex'), oid: blob.digest('hex'), size: before.size, mode: before.mode & 0o777 };
  } finally { await file.close(); }
}
export const equal = (a, b) => a === b || Boolean(a && b && a.hash === b.hash && a.mode === b.mode);
export const gitMode = info => info.mode & 0o111 ? '100755' : '100644';
export async function copy(sourceRoot, sourceRel, targetRoot, targetRel, mode) {
  const source = await safePath(sourceRoot, sourceRel), target = await safePath(targetRoot, targetRel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.aimp-${crypto.randomUUID()}.tmp`;
  const src = await fs.open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  let dest;
  try {
    dest = await fs.open(tmp, 'wx', 0o600);
    const buffer = Buffer.allocUnsafe(256 * 1024);
    for (;;) {
      const { bytesRead } = await src.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      await dest.writeFile(buffer.subarray(0, bytesRead));
    }
    await dest.chmod(mode); await dest.sync(); await dest.close(); dest = null;
    await safePath(targetRoot, targetRel);
    await fs.rename(tmp, target); await syncDirectory(path.dirname(target));
  } finally { await src.close(); if (dest) await dest.close(); await fs.rm(tmp, { force: true }); }
}
export async function syncDirectory(dir) { const handle = await fs.open(dir, 'r'); try { await handle.sync(); } finally { await handle.close(); } }
export async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  if ((await present(file))?.isSymbolicLink()) throw new Error('State file is a symlink.');
  const tmp = `${file}.${crypto.randomUUID()}.tmp`, handle = await fs.open(tmp, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(tmp, file); await syncDirectory(path.dirname(file));
}
