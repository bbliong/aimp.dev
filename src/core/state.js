import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { atomicJson, canonical, hash, present, syncDirectory } from './files.js';

export const stateRoot = () => path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'aimp');
export const projectId = root => hash(root).slice(0, 16);
export const stateFile = root => path.join(stateRoot(), `${projectId(root)}.json`);
export const journalFile = root => path.join(stateRoot(), `${projectId(root)}.transaction.json`);
export async function readJson(file) { if (!await present(file)) return null; if ((await present(file)).isSymbolicLink()) throw new Error('Refusing linked state.'); return JSON.parse(await fs.readFile(file, 'utf8')); }
export async function loadState(root) {
  const state = await readJson(stateFile(root));
  if (!state) return null;
  if (![2, 3].includes(state.schemaVersion) || !state.pairs || !state.original || state.projectId !== projectId(root) || path.resolve(state.original) !== root) throw new Error('Invalid or unsupported AIMP state. Restore a state backup before continuing.');
  for (const [name, pair] of Object.entries(state.pairs)) {
    if (pair.branch !== name || typeof pair.mirror !== 'string' || !path.isAbsolute(pair.mirror) || !/^[a-f0-9]{40}$/.test(pair.baselineAi || '')) throw new Error('Invalid branch state.');
  }
  return state;
}
export const saveState = (root, state) => atomicJson(stateFile(root), state);
export const loadJournal = root => readJson(journalFile(root));
export const saveJournal = (root, tx) => atomicJson(journalFile(root), tx);
export async function clearJournal(root) { await fs.rm(journalFile(root), { force: true }); await syncDirectory(stateRoot()); }
export function newState(root) { return { schemaVersion: 3, projectId: projectId(root), original: root, language: 'en', pairs: {}, history: [] }; }
export async function migrate(root, old) {
  if (old.schemaVersion === 3) return old;
  if (await loadJournal(root)) throw new Error('Legacy recovery journal exists. Preserve its backup; finish legacy recovery before migration.');
  const backup = `${stateFile(root)}.v2-${Date.now()}.bak`;
  await fs.copyFile(stateFile(root), backup); await fs.chmod(backup, 0o600);
  const next = { ...old, schemaVersion: 3 };
  next.pairs = Object.fromEntries(Object.entries(old.pairs).map(([name, pair]) => [name, {
    branch: name, mirror: pair.mirror, baselineAi: pair.baselineAi, baselineOriginal: pair.baselineOriginal,
    batch: pair.batch, policyHash: null, acknowledgements: {}, applied: {}, baselineNeedsReview: true,
  }]));
  await saveState(root, next);
  return { state: next, backup };
}
async function processIdentity(pid) {
  try { const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8'); return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]; }
  catch { return null; }
}
async function alive(owner) {
  if (!Number.isSafeInteger(owner?.pid) || owner.pid <= 0) return true;
  try { process.kill(owner.pid, 0); } catch (e) { return e.code !== 'ESRCH'; }
  const identity = await processIdentity(owner.pid);
  return !owner.start || !identity || identity === owner.start;
}
export async function withLock(root, operation) {
  await fs.mkdir(stateRoot(), { recursive: true, mode: 0o700 });
  if (await canonical(stateRoot()) !== path.resolve(stateRoot())) throw new Error('State directory must not contain symlinks.');
  const lock = path.join(stateRoot(), `${projectId(root)}.lock`), token = crypto.randomUUID();
  async function acquire() {
    try { await fs.mkdir(lock); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const reap = `${lock}.reap`;
      try { await fs.mkdir(reap); } catch { throw new Error('Project is locked by another AIMP process.'); }
      try {
        let owner;
        try { owner = await readJson(path.join(lock, 'owner.json')); } catch { /* Unknown owner is never stolen. */ }
        if (!owner || await alive(owner)) throw new Error('Project is locked by another AIMP process.', { cause: e });
        await fs.rm(lock, { recursive: true });
        await fs.mkdir(lock);
      } finally { await fs.rmdir(reap); }
    }
    await atomicJson(path.join(lock, 'owner.json'), { pid: process.pid, start: await processIdentity(process.pid), token });
  }
  await acquire();
  try { return await operation(); }
  finally {
    const owner = await readJson(path.join(lock, 'owner.json'));
    if (owner?.token === token) await fs.rm(lock, { recursive: true });
  }
}
export async function findMirror(root) {
  let entries; try { entries = await fs.readdir(stateRoot()); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const matches = [];
  for (const name of entries.filter(n => /^[a-f0-9]{16}\.json$/.test(n))) {
    const state = await readJson(path.join(stateRoot(), name));
    for (const pair of Object.values(state?.pairs || {})) if (path.resolve(pair.mirror) === root) matches.push({ original: state.original, pair });
  }
  if (new Set(matches.map(m => m.original)).size > 1) throw new Error('Mirror belongs to multiple original projects. Resolve the registry first.');
  return matches[0]?.original || null;
}
