import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { git, branch, head, status } from './git.js';
import { mirrorTarget, present, copy, fingerprint, equal, safePath, atomicJson } from './files.js';
import { stateRoot, saveState, saveJournal, clearJournal, findMirror } from './state.js';
import { policy, projectFiles, guardAttributes } from './policy.js';
import { changes, createCheckpoint, writeMetadata, validateRepository } from './engine.js';

export async function initialize(root, state, target, { confirm, replacing = false, signal } = {}) {
  await validateRepository(root);
  if ((await status(root)).length) throw new Error('Original must be clean before initialization.');
  const name = await branch(root), originalHead = await head(root);
  target = await mirrorTarget(root, target, stateRoot());
  const owner = await findMirror(target);
  if (owner && owner !== root) throw new Error('Target belongs to another original project.');
  if (await present(target)) {
    if (!(await fs.stat(target)).isDirectory()) throw new Error('Mirror target is not a directory.');
    if ((await fs.readdir(target)).length && !replacing) throw new Error('Target is not empty. Use /reinit to review replacement.');
  }
  // A shared mirror is relocated as a unit, preserving other branches.
  const existing = Object.values(state.pairs)[0];
  if (existing && existing.mirror !== target && !replacing) target = existing.mirror;
  if (existing) {
    await validateRepository(existing.mirror);
    const active = state.pairs[await branch(existing.mirror)];
    if (!active || (await changes(existing.mirror, active, await policy(root))).changes.length) throw new Error('Active mirror branch has pending work. Sync or serialize it before initialization.');
  }
  const rules = await policy(root), files = await projectFiles(root, rules);
  await guardAttributes(root, files);
  const id = crypto.randomUUID(), stage = `${target}.aimp-stage-${id}`, payload = path.join(stateRoot(), 'initializations', id);
  await fs.mkdir(path.join(payload, 'payload'), { recursive: true, mode: 0o700 });
  await fs.mkdir(path.dirname(stage), { recursive: true });
  await fs.mkdir(stage, { recursive: false });
  let journaled = false;
  try {
    const entries = [];
    for (const rel of files) {
      if (signal?.aborted) throw new Error('Cancelled.');
      const after = await fingerprint(root, rel);
      if (!after) continue;
      await copy(root, rel, payload, `payload/${entries.length}`, after.mode);
      await copy(root, rel, stage, rel, after.mode);
      entries.push({ path: rel, after });
    }
    await git(stage, ['init', '--quiet', '--initial-branch', name]);
    await git(stage, ['config', 'user.name', 'aimp']); await git(stage, ['config', 'user.email', 'aimp@local.invalid']);
    const commit = await createCheckpoint(stage, null, entries, payload, `chore(aimp): initialize ${name}`);
    await git(stage, ['update-ref', `refs/heads/${name}`, commit]); await git(stage, ['read-tree', commit]);
    const pair = { branch: name, mirror: target, baselineAi: commit, baselineOriginal: originalHead,
      policyHash: rules.hash, batch: crypto.randomUUID(), acknowledgements: {}, applied: {} };
    await writeMetadata(stage, state.projectId, pair);
    await fs.writeFile(path.join(stage, '.git/info/exclude'), '/AIMP_REPORT.md\n/AGENTS-AIMP.md\n/.aimpignore\n');
    if (rules.content.length) await fs.writeFile(path.join(stage, '.aimpignore'), rules.content);
    if (existing && !replacing) {
      // Transfer only the freshly created mirror commit, never original Git history.
      if ((await git(existing.mirror, ['show-ref', '--verify', `refs/heads/${name}`], { allowFailure: true })).code === 0) throw new Error('Mirror branch already exists. Use /use.');
      await git(existing.mirror, ['fetch', '--quiet', '--no-tags', stage, `refs/heads/${name}`]);
      await git(existing.mirror, ['switch', '-c', name, 'FETCH_HEAD']);
      pair.mirror = existing.mirror;
      await writeMetadata(existing.mirror, state.projectId, pair);
      state.pairs[name] = pair; await saveState(root, state); return pair;
    }
    if (existing && replacing) {
      // Retain all old branch histories in the replacement; only the active branch is rebuilt.
      for (const other of Object.keys(state.pairs).filter(b => b !== name)) {
        await git(stage, ['fetch', '--quiet', '--no-tags', existing.mirror, `refs/heads/${other}:refs/heads/${other}`]);
      }
    }
    if (await head(root) !== originalHead || (await policy(root)).hash !== rules.hash) throw new Error('Original changed during initialization.');
    for (const e of entries) if (!equal(await fingerprint(root, e.path), e.after)) throw new Error('Original file changed during initialization.');
    const occupied = await present(target) && (await fs.readdir(target)).length > 0;
    if (occupied && !await confirm(`Replace ${target}? Its current contents will be retained in a backup folder.`)) return null;
    if (signal?.aborted) throw new Error('Cancelled.');
    const backup = `${target}.aimp-backup-${id}`;
    const next = structuredClone(state);
    for (const p of Object.values(next.pairs)) p.mirror = target;
    next.pairs[name] = pair;
    const tx = { version: 3, kind: 'initialize', id, root, target, stagePath: stage, backup, nextState: next };
    await saveJournal(root, tx); journaled = true;
    if (await present(target)) await fs.rename(target, backup);
    await fs.rename(stage, target); await saveState(root, next); await clearJournal(root); journaled = false;
    await atomicJson(path.join(payload, 'receipt.json'), { target, backup: occupied ? backup : null });
    return { ...pair, backup: occupied ? backup : null };
  } finally {
    if (!journaled) { await fs.rm(stage, { recursive: true, force: true }); await fs.rm(path.join(payload, 'payload'), { recursive: true, force: true }); }
  }
}
export async function recoverInitialization(root, tx) {
  if (tx.root !== root || tx.kind !== 'initialize') throw new Error('Invalid initialization journal.');
  await mirrorTarget(root, tx.target, stateRoot());
  if (!/^[a-f0-9-]{36}$/.test(tx.id) || tx.stagePath !== `${tx.target}.aimp-stage-${tx.id}` || tx.backup !== `${tx.target}.aimp-backup-${tx.id}`) throw new Error('Invalid initialization recovery paths.');
  if (await present(tx.stagePath)) {
    if (await present(tx.target)) {
      if (await present(tx.backup)) throw new Error('Both destination and backup exist; review reinit recovery manually.');
      await fs.rename(tx.target, tx.backup);
    }
    await fs.rename(tx.stagePath, tx.target);
  }
  await validateRepository(tx.target);
  await saveState(root, tx.nextState); await clearJournal(root);
}
export async function useBranch(root, state) {
  const name = await branch(root), pair = state.pairs[name];
  if (!pair) throw new Error('Branch is not initialized. Run /init.');
  await validateRepository(pair.mirror);
  const active = state.pairs[await branch(pair.mirror)];
  if (!active) throw new Error('Unregistered mirror branch.');
  if ((await changes(pair.mirror, active, await policy(root))).changes.length) throw new Error('Mirror has pending changes, including commits. Finish that branch first.');
  await git(pair.mirror, ['switch', name]);
  await safePath(pair.mirror, 'AIMP_REPORT.md');
  await writeMetadata(pair.mirror, state.projectId, pair);
  return pair;
}
