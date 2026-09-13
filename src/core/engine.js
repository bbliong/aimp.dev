import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { git, text, head, branch, status, names, tree, guardRepo } from './git.js';
import { fingerprint, equal, gitMode, safePath, present, hash, copy, atomicJson, syncDirectory, canonical, overlaps } from './files.js';
import { validatePlan } from './contracts.js';
import { policy, included, guardAttributes } from './policy.js';
import { stateRoot, saveJournal, loadJournal, clearJournal, saveState } from './state.js';

export const REPORT = 'AIMP_REPORT.md';
export const RULES = 'AGENTS-AIMP.md';
function reportArchivePath(branchName, id) {
  const safeBranch = branchName.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+|\.+$/g, '') || 'default';
  return path.join(stateRoot(), 'reports', safeBranch, `${new Date().toISOString().replace(/[:.]/g, '-')}_${id}.md`);
}
async function archiveReport(mirror, branchName, id) {
  const file = path.join(mirror, REPORT);
  try {
    const content = await fs.readFile(file);
    const target = reportArchivePath(branchName, id);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.writeFile(target, content, { mode: 0o600, flag: 'wx' });
    return target;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
export async function validateRepository(root) {
  if (await canonical(root) !== root || !(await present(path.join(root, '.git')))?.isDirectory()) throw new Error('A regular repository with a canonical root is required.');
  for (const name of ['rebase-apply', 'rebase-merge', 'sequencer', 'worktrees', 'objects/info/alternates']) if (await present(path.join(root, '.git', name))) throw new Error(`Unsupported Git repository state: ${name}`);
  await guardRepo(root);
}
export async function requirePair(root, state) {
  await validateRepository(root);
  const name = await branch(root), pair = state?.pairs?.[name];
  if (!pair) throw new Error('Branch is not initialized. Run /init.');
  if (overlaps(root, pair.mirror)) throw new Error('Original and mirror roots overlap.');
  await validateRepository(pair.mirror);
  if (await branch(pair.mirror) !== name) throw new Error('BRANCH_MISMATCH: run /use after resolving pending mirror work.');
  const exists = await git(pair.mirror, ['cat-file', '-e', `${pair.baselineAi}^{commit}`], { allowFailure: true });
  if (exists.code !== 0 || (await git(pair.mirror, ['merge-base', '--is-ancestor', pair.baselineAi, 'HEAD'], { allowFailure: true })).code !== 0) throw new Error('BASELINE_UNKNOWN: mirror history changed; review and reinitialize explicitly.');
  return pair;
}
export async function changes(root, pair, rules) {
  const records = await status(root);
  const byPath = new Map(records.map(record => [record.path, record]));
  if (records.some(r => /U/.test(r.code) || ['AA', 'DD'].includes(r.code))) throw new Error('Resolve Git index conflicts first.');
  const committed = await names(root, ['diff', '--no-ext-diff', '--no-renames', '--name-only', '-z', pair.baselineAi, 'HEAD']);
  const candidates = await included([...committed, ...records.map(r => r.path), ...Object.keys(pair.acknowledgements || {})], rules);
  const base = await tree(root, pair.baselineAi), result = [];
  await guardAttributes(root, candidates);
  for (const rel of candidates) {
    const st = byPath.get(rel);
    if (st && st.code[0] !== ' ' && st.code[0] !== '?' && st.code[1] !== ' ') throw new Error(`Partially staged path: ${JSON.stringify(rel)}. Stage or unstage it completely first.`);
    const current = await fingerprint(root, rel);
    const previous = Object.hasOwn(pair.acknowledgements || {}, rel) ? pair.acknowledgements[rel] : base.get(rel);
    if (!current && !previous) continue;
    if (current && previous && current.oid === previous.oid && gitMode(current) === previous.mode) continue;
    if (previous?.type === 'commit') throw new Error('Submodules are not supported.');
    result.push({ path: rel, after: current, kind: !current ? 'deleted' : !previous ? 'added' : 'modified' });
  }
  return { changes: result, records, committed: committed.length };
}
export function reportTemplate(id, name, batch) {
  return `Mirror-ID: ${id}\nBranch: ${name}\nBatch-ID: ${batch}\nStatus: draft\n\n## Summary\n<!-- Describe the changes. -->\n\n## Commit Message\n<!-- One-line subject. -->\n\n## Tests\n<!-- Commands and results, or Not run: reason. -->\n\n## Notes\n<!-- Limitations, or None. -->\n`;
}
export async function writeMetadata(mirror, id, pair, config = {}) {
  const values = {
    [REPORT]: reportTemplate(id, pair.branch, pair.batch),
    [RULES]: `# AIMP workspace\n\nAIMP (AI Mirror Project) is a local tool for reviewing and manually synchronizing a separate AI workspace. This is the mirror for branch ${pair.branch}, not the original project.\n\n- Read and edit only this workspace. Do not access the original, parent directories, or credential stores.\n- These instructions are advisory, not an OS sandbox. Load this file manually if your harness does not discover it.\n- The user runs the original application and shares errors manually.\n- Do not push, add remotes, switch branches, reset history, or run synchronization commands.\n- Keep user placeholders intact. AIMP does not sanitize credentials automatically.\n- Complete AIMP_REPORT.md and set Status: ready after each batch. Report tests honestly.\n- Auto-sync mode: ${config.autoSync?.enabled ? 'enabled; after completing AIMP_REPORT.md with Status: ready, run `aimp --sync-to-original` to create a request' : 'disabled; wait for the user to run /sync'}.\n- Approved test URLs: ${config.testUrls?.enabled && config.testUrls.allowlist?.length ? config.testUrls.allowlist.join(', ') : 'none configured'}. Do not access other URLs.\n`,
  };
  for (const [rel, content] of Object.entries(values)) {
    const target = await safePath(mirror, rel), tmp = `${target}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(tmp, content, { mode: 0o644, flag: 'wx' }); await fs.rename(tmp, target);
  }
}
export async function readReport(mirror, pair, id) {
  const file = await safePath(mirror, REPORT);
  if ((await fs.stat(file)).size > 1024 * 1024) throw new Error('Report is too large.');
  const raw = await fs.readFile(file, 'utf8');
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(raw)) throw new Error('Report contains control characters.');
  const field = name => raw.match(new RegExp(`^${name}: *(.*)$`, 'm'))?.[1].trim();
  if (field('Mirror-ID') !== id || field('Branch') !== pair.branch || field('Batch-ID') !== pair.batch) throw new Error('Report identity does not match the active branch/batch.');
  const sections = {};
  for (const match of raw.matchAll(/^## (Summary|Commit Message|Tests|Notes)\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)) sections[match[1]] = match[2].trim();
  if (field('Status') !== 'ready' || ['Summary', 'Commit Message', 'Tests', 'Notes'].some(k => !sections[k] || sections[k].includes('<!--'))) throw new Error('Complete Summary, Commit Message, Tests and Notes, then set Status: ready.');
  const message = sections['Commit Message'];
  if (message.includes('\n') || message.length > 120) throw new Error('Commit Message must be one line, at most 120 characters.');
  return { raw, hash: hash(raw), message, summary: sections.Summary };
}
export async function indexFingerprint(root) {
  const p = path.join(root, '.git/index');
  const st = await present(p);
  if (!st) return null;
  if (!st.isFile() || st.nlink !== 1) throw new Error('Unsupported Git index.');
  return hash(await fs.readFile(p));
}
async function updateIndex(root, index, entries) {
  const zero = '0'.repeat(40);
  const input = entries.map(e => e.after ? `${gitMode(e.after)} ${e.after.oid}\t${e.path}\0` : `0 ${zero}\t${e.path}\0`).join('');
  if (input) await git(root, ['update-index', '-z', '--index-info'], { env: { GIT_INDEX_FILE: index }, input });
}
export async function createCheckpoint(root, parent, entries, directory, message) {
  const index = path.join(directory, 'checkpoint-index');
  const env = { GIT_INDEX_FILE: index, GIT_AUTHOR_NAME: 'aimp', GIT_AUTHOR_EMAIL: 'aimp@local.invalid', GIT_COMMITTER_NAME: 'aimp', GIT_COMMITTER_EMAIL: 'aimp@local.invalid' };
  await git(root, parent ? ['read-tree', parent] : ['read-tree', '--empty'], { env });
  for (let i = 0; i < entries.length; i++) if (entries[i].after) {
    const oid = await text(root, ['hash-object', '-w', '--no-filters', '--', path.join(directory, 'payload', String(i))]);
    if (oid !== entries[i].after.oid) throw new Error('Payload checksum mismatch.');
  }
  await updateIndex(root, index, entries);
  const treeId = await text(root, ['write-tree'], { env });
  return text(root, ['commit-tree', treeId, ...(parent ? ['-p', parent] : [])], { env, input: `${message}\n` });
}
async function replaceIndex(root, tx, dir) {
  if (await indexFingerprint(root) === tx.finalIndexHash) return;
  const guard = path.join(root, '.git/index.lock'), handle = await fs.open(guard, 'wx', 0o600);
  let renamed = false;
  try {
    if (await indexFingerprint(root) !== tx.mirrorIndex) throw new Error('Mirror index changed; recovery requires manual review.');
    await handle.writeFile(await fs.readFile(path.join(dir, 'final-index'))); await handle.sync(); await handle.close();
    await fs.rename(guard, path.join(root, '.git/index')); renamed = true;
  } finally { if (!renamed) { await handle.close().catch(() => {}); await fs.rm(guard, { force: true }); } }
}
export async function preparePlan(root, state, direction = 'ai-to-original') {
  const pair = await requirePair(root, state), rules = await policy(root);
  if (pair.baselineNeedsReview) throw new Error('Migrated baseline needs review. Run /adopt-baseline after inspecting both repositories.');
  if (direction !== 'original-to-ai' && pair.policyHash && pair.policyHash !== rules.hash) throw new Error('Ignore policy changed. Run /adopt-policy to review and accept it first.');
  const detected = await changes(pair.mirror, pair, rules);
  let files = detected.changes;
  if (direction === 'original-to-ai') {
    if ((await status(root)).length) throw new Error('Original has uncommitted changes. Commit or resolve them before reverse sync.');
    if (files.length) throw new Error('Mirror has pending work. Sync or serialize it first.');
    const originalBase = pair.baselineOriginal;
    if (!originalBase || (await git(root, ['merge-base', '--is-ancestor', originalBase, 'HEAD'], { allowFailure: true })).code !== 0) throw new Error('Original baseline history changed. Reinitialize after review.');
    const originalPaths = await names(root, ['ls-files', '-z']);
    const mirrorPaths = await names(pair.mirror, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
    const candidates = [...new Set([...originalPaths, ...mirrorPaths, ...Object.keys(pair.applied || {})])];
    await guardAttributes(root, candidates);
    files = [];
    for (const rel of candidates) {
      const includedPath = (await included([rel], rules)).length > 0;
      const after = includedPath ? await fingerprint(root, rel) : null, before = await fingerprint(pair.mirror, rel);
      if (!equal(after, before)) files.push({ path: rel, after, kind: !after ? 'deleted' : !before ? 'added' : 'modified' });
    }
  }
  const source = direction === 'ai-to-original' ? pair.mirror : root;
  const target = direction === 'ai-to-original' ? root : pair.mirror;
  for (const file of files) file.before = await fingerprint(target, file.path);
  return { version: 3, id: crypto.randomUUID(), direction, root, source, target, branch: pair.branch,
    mirror: pair.mirror, originalHead: await head(root), originalIndex: await indexFingerprint(root),
    mirrorHead: await head(pair.mirror), mirrorIndex: await indexFingerprint(pair.mirror), policyHash: rules.hash, changes: files };
}
async function verifyPlan(tx) {
  if (await branch(tx.root) !== tx.branch || await branch(tx.mirror) !== tx.branch || await head(tx.root) !== tx.originalHead || await head(tx.mirror) !== tx.mirrorHead || await indexFingerprint(tx.root) !== tx.originalIndex || await indexFingerprint(tx.mirror) !== tx.mirrorIndex || (await policy(tx.root)).hash !== tx.policyHash) throw new Error('Repository or policy changed after preview. Review a new plan.');
  for (const file of tx.changes) {
    if (!equal(await fingerprint(tx.source, file.path), file.after) || !equal(await fingerprint(tx.target, file.path), file.before)) throw new Error(`File changed after preview: ${JSON.stringify(file.path)}`);
  }
}
export async function transact(state, plan, message, { fault = async () => {}, signal } = {}) {
  validatePlan(plan);
  if (await loadJournal(plan.root)) throw new Error('RECOVERY_REQUIRED: run /recover before another mutation.');
  await verifyPlan(plan);
  if (signal?.aborted) throw new Error('Cancelled.');
  const dir = path.join(stateRoot(), 'transactions', plan.id);
  await fs.mkdir(path.join(dir, 'payload'), { recursive: true, mode: 0o700 });
  await fs.mkdir(path.join(dir, 'backup'), { recursive: true, mode: 0o700 });
  const tx = { ...plan, stage: 'PREPARED', message, createdAt: new Date().toISOString() };
  let journaled = false;
  try {
    for (let i = 0; i < tx.changes.length; i++) {
      const file = tx.changes[i];
      if (file.after) await copy(tx.source, file.path, dir, `payload/${i}`, file.after.mode);
      if (file.before) await copy(tx.target, file.path, dir, `backup/${i}`, file.before.mode);
      if (!equal(file.after, await fingerprint(dir, `payload/${i}`)) || !equal(file.before, await fingerprint(dir, `backup/${i}`))) throw new Error('Files changed while preparing transaction.');
    }
    await fault('CHECKPOINT_PREPARE');
    tx.aiCommit = await createCheckpoint(tx.mirror, tx.mirrorHead, tx.changes, dir, message);
    const finalIndex = path.join(dir, 'final-index');
    await fs.copyFile(path.join(tx.mirror, '.git/index'), finalIndex);
    await updateIndex(tx.mirror, finalIndex, tx.changes); tx.finalIndexHash = hash(await fs.readFile(finalIndex));
    const next = structuredClone(state), pair = next.pairs[tx.branch];
    pair.batch = crypto.randomUUID(); pair.policyHash = tx.policyHash;
    if (tx.direction === 'serialize') {
      for (const file of tx.changes) (pair.acknowledgements ||= {})[file.path] = file.after ? { oid: file.after.oid, mode: gitMode(file.after), type: 'blob' } : null;
    } else {
      pair.baselineAi = tx.aiCommit; pair.baselineOriginal = tx.originalHead;
      for (const file of tx.changes) { delete (pair.acknowledgements ||= {})[file.path]; (pair.applied ||= {})[file.path] = file.after; }
    }
    next.history ||= []; next.history.push({ id: tx.id, branch: tx.branch, direction: tx.direction, ai: tx.aiCommit, originalBase: tx.originalHead, originalCommitted: false, message, at: tx.createdAt });
    // Archive overflow independently, retaining a bounded active registry.
    if (next.history.length > 200) { await atomicJson(path.join(dir, 'history-archive.json'), next.history.slice(0, -200)); next.history = next.history.slice(-200); }
    tx.nextState = next;
    await verifyPlan(tx); if (signal?.aborted) throw new Error('Cancelled.');
    await saveJournal(tx.root, tx); journaled = true; await fault('PREPARED');
    for (let i = 0; i < tx.changes.length; i++) {
      if (signal?.aborted) throw new Error('Cancelled. Run /recover.');
      const file = tx.changes[i];
      if (!equal(await fingerprint(tx.target, file.path), file.before)) throw new Error('Target changed during apply.');
      if (file.after) await copy(dir, `payload/${i}`, tx.target, file.path, file.after.mode);
      else { await fs.rm(await safePath(tx.target, file.path), { force: true }); await syncDirectory(path.dirname(path.join(tx.target, file.path))); }
      await fault(`FILE_${i}`);
    }
    tx.stage = 'ORIGINAL_APPLIED'; await saveJournal(tx.root, tx); await fault(tx.stage);
    await finalize(tx, dir, fault);
    return tx;
  } catch (error) {
    if (!journaled) await fs.rm(dir, { recursive: true, force: true });
    throw error;
  }
}
async function finalize(tx, dir, fault = async () => {}) {
  if (await branch(tx.root) !== tx.branch || await branch(tx.mirror) !== tx.branch || await head(tx.root) !== tx.originalHead || await indexFingerprint(tx.root) !== tx.originalIndex) throw new Error('Original Git state changed; review recovery.');
  for (const file of tx.changes) if (!equal(await fingerprint(tx.target, file.path), file.after)) throw new Error('Applied files changed; review recovery before finalizing.');
  const current = await head(tx.mirror);
  if (current !== tx.aiCommit) {
    if (current !== tx.mirrorHead || await indexFingerprint(tx.mirror) !== tx.mirrorIndex) throw new Error('Mirror HEAD/index changed.');
    await git(tx.mirror, ['update-ref', `refs/heads/${tx.branch}`, tx.aiCommit, tx.mirrorHead]);
  }
  await fault('REF_UPDATED'); await replaceIndex(tx.mirror, tx, dir);
  tx.stage = 'AI_CHECKPOINTED'; await saveJournal(tx.root, tx); await fault(tx.stage);
  await saveState(tx.root, tx.nextState); await fault('STATE_SAVED');
  if (tx.direction === 'ai-to-original') await archiveReport(tx.mirror, tx.branch, tx.id);
  await writeMetadata(tx.mirror, tx.nextState.projectId, tx.nextState.pairs[tx.branch], tx.nextState.config);
  tx.stage = 'FINALIZED'; await saveJournal(tx.root, tx); await fault(tx.stage);
  await clearJournal(tx.root);
  // Retain only a compact receipt and any history archive after successful finalization.
  await atomicJson(path.join(dir, 'receipt.json'), { id: tx.id, message: tx.message, aiCommit: tx.aiCommit, direction: tx.direction });
  for (const name of ['payload', 'backup', 'checkpoint-index', 'final-index']) await fs.rm(path.join(dir, name), { recursive: true, force: true });
}
export async function recover(root, action = 'resume', options = {}) {
  const tx = await loadJournal(root);
  if (!tx) return null;
  if (tx.version !== 3 || tx.root !== root || !/^[a-f0-9-]{36}$/.test(tx.id)) throw new Error('Legacy/invalid journal: automatic recovery is unavailable. Preserve backups for manual recovery.');
  validatePlan(tx);
  if (overlaps(root, tx.mirror) || tx.source !== (tx.direction === 'original-to-ai' ? root : tx.mirror) || tx.target !== (tx.direction === 'ai-to-original' ? root : tx.mirror)) throw new Error('Invalid recovery roots.');
  if (await branch(root) !== tx.branch || await head(root) !== tx.originalHead || await indexFingerprint(root) !== tx.originalIndex || await branch(tx.mirror) !== tx.branch) throw new Error('Git state changed since interruption. Review recovery.');
  if (!['resume', 'rollback'].includes(action)) throw new Error('Usage: /recover [resume|rollback]');
  await validateRepository(root); await validateRepository(tx.mirror);
  const dir = path.join(stateRoot(), 'transactions', tx.id);
  if (action === 'rollback') {
    if (await head(tx.mirror) !== tx.mirrorHead) throw new Error('Checkpoint already exists. Resume recovery instead of rolling back Git history.');
    if (await branch(root) !== tx.branch || await head(root) !== tx.originalHead || await indexFingerprint(root) !== tx.originalIndex) throw new Error('Original Git state changed since the transaction.');
    for (const file of tx.changes) { const actual = await fingerprint(tx.target, file.path); if (!equal(actual, file.before) && !equal(actual, file.after)) throw new Error(`New edits after interruption: ${JSON.stringify(file.path)}`); }
    for (let i = 0; i < tx.changes.length; i++) {
      const file = tx.changes[i];
      if (file.before) { if (!equal(await fingerprint(dir, `backup/${i}`), file.before)) throw new Error('Backup checksum mismatch.'); await copy(dir, `backup/${i}`, tx.target, file.path, file.before.mode); }
      else await fs.rm(await safePath(tx.target, file.path), { force: true });
    }
    await clearJournal(root); return { ...tx, rolledBack: true };
  }
  for (let i = 0; i < tx.changes.length; i++) {
    const file = tx.changes[i], actual = await fingerprint(tx.target, file.path);
    if (equal(actual, file.after)) continue;
    if (!equal(actual, file.before)) throw new Error(`New edits after interruption: ${JSON.stringify(file.path)}`);
    if (file.after) { if (!equal(await fingerprint(dir, `payload/${i}`), file.after)) throw new Error('Payload checksum mismatch.'); await copy(dir, `payload/${i}`, tx.target, file.path, file.after.mode); }
    else await fs.rm(await safePath(tx.target, file.path), { force: true });
  }
  await finalize(tx, dir, options.fault); return tx;
}
