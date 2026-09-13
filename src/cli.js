#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { spawn } from 'node:child_process';
import { git, text, branch, status, metrics, names } from './core/git.js';
import { canonical } from './core/files.js';
import { loadState, saveState, stateRoot, findMirror, withLock, loadJournal, migrate, newState } from './core/state.js';
import { policy } from './core/policy.js';
import { requirePair, changes, preparePlan, readReport, transact, recover, validateRepository, writeMetadata } from './core/engine.js';
import { initialize, recoverInitialization, useBranch } from './core/projects.js';

const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
export const originalCommands = ['/init', '/reinit', '/use', '/configure', '/status', '/diff', '/sync', '/sync-original-to-ai', '/get-summary', '/get-commit-message', '/list', '/log', '/history', '/doctor', '/recover', '/migrate', '/adopt-baseline', '/adopt-policy', '/language', '/help', '/exit'];
export const mirrorCommands = ['/serialize', '/configure', '/status', '/diff', '/get-summary', '/get-commit-message', '/history', '/language', '/help', '/exit'];
export const safeText = value => String(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, c => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
const descriptions = {
  '/init': ['Create an independent mirror for the current branch.', 'Buat mirror independen untuk branch aktif.'],
  '/reinit': ['Replace or relocate the shared mirror, retaining a backup.', 'Ganti atau pindahkan mirror bersama, dengan backup.'],
  '/use': ['Explicitly switch the mirror to the original branch.', 'Pindahkan mirror ke branch original secara eksplisit.'],
  '/configure': ['Configure safe sync, test URL and history settings.', 'Atur sync aman, URL test, dan history.'],
  '/status': ['Inspect paths, branches, working changes, and pending commits.', 'Periksa folder, branch, perubahan file, dan commit pending.'],
  '/diff': ['Preview changed paths and text diff; no file writes.', 'Preview path dan diff teks; tanpa menulis file.'],
  '/sync': ['Review AI changes, apply to original, checkpoint AI only.', 'Review perubahan AI, terapkan ke original, checkpoint hanya AI.'],
  '/sync-original-to-ai': ['Refresh the mirror from a clean original.', 'Perbarui mirror dari original yang bersih.'],
  '/serialize': ['Adopt selected changes as a local mirror baseline; no sanitizing.', 'Jadikan perubahan terpilih baseline mirror lokal; tanpa sanitasi.'],
  '/recover': ['Resume an interrupted operation; /recover rollback restores backups.', 'Lanjutkan transaksi terhenti; /recover rollback memulihkan backup.'],
  '/migrate': ['Back up and migrate legacy state, then review the baseline.', 'Backup dan migrasi state lama, lalu review baseline.'],
  '/adopt-baseline': ['Acknowledge the reviewed legacy baseline without discarding changes.', 'Setujui baseline lama yang sudah ditinjau tanpa membuang perubahan.'],
  '/adopt-policy': ['Review and adopt the current .aimpignore policy.', 'Review dan setujui kebijakan .aimpignore saat ini.'],
  '/doctor': ['Check repository shape, registry, Git, branch and recovery readiness.', 'Periksa repo, registry, Git, branch, dan kesiapan recovery.'],
  '/get-summary': ['Read the ready report summary.', 'Baca ringkasan laporan yang ready.'],
  '/get-commit-message': ['Read the proposed commit subject.', 'Baca usulan pesan commit.'],
  '/list': ['List branch pairs and mirror locations.', 'Daftar pasangan branch dan lokasi mirror.'],
  '/log': ['Show recent transaction receipts.', 'Tampilkan riwayat transaksi terbaru.'],
  '/history': ['List archived AI reports for this project.', 'Tampilkan arsip laporan AI project ini.'],
  '/language': ['Set language: /language en|id.', 'Atur bahasa: /language en|id.'],
  '/help': ['Show commands available in this workspace.', 'Tampilkan command yang tersedia di workspace ini.'],
  '/exit': ['Exit and restore the previous terminal screen.', 'Keluar dan kembalikan layar terminal sebelumnya.'],
};
export const localized = (language, en, id) => language === 'id' ? id : en;
export function tokenize(value) {
  const tokens = []; let current = '', quote = null, escaped = false, started = false;
  for (const c of value) {
    if (escaped) { current += c; escaped = false; started = true; }
    else if (c === '\\' && quote !== "'") escaped = true;
    else if (quote) { if (c === quote) quote = null; else current += c; }
    else if (c === '"' || c === "'") { quote = c; started = true; }
    else if (/\s/.test(c)) { if (started) tokens.push(current); current = ''; started = false; }
    else { current += c; started = true; }
  }
  if (quote || escaped) throw new Error('Unclosed quote or escape.');
  if (started) tokens.push(current);
  return tokens;
}
export async function pathCompleter(value) {
  const expanded = value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
  const slash = expanded.lastIndexOf('/'), dir = slash < 0 ? '.' : expanded.slice(0, slash + 1), prefix = expanded.slice(slash + 1);
  try { const entries = await fs.readdir(dir, { withFileTypes: true }); return [entries.filter(e => e.isDirectory() && e.name.startsWith(prefix)).map(e => `${slash < 0 ? '' : dir}${e.name}/`).sort(), value]; }
  catch { return [[], value]; }
}
export async function context(start) {
  if (process.platform !== 'linux') throw new Error('This beta supports Linux and WSL2 Linux filesystems.');
  const root = await canonical(await text(start, ['rev-parse', '--show-toplevel']));
  const original = await findMirror(root);
  return { root, original: original || root, mode: original ? 'mirror' : 'original' };
}
export async function inspect(ctx, state) {
  const currentBranch = await branch(ctx.root), stateBranch = ctx.mode === 'mirror' ? currentBranch : await branch(ctx.original);
  const pair = state?.pairs?.[stateBranch];
  const info = { mode: ctx.mode, original: ctx.mode === 'mirror' ? null : ctx.original, mirror: pair?.mirror || null, branch: stateBranch, mirrorBranch: null, state: 'NOT_INITIALIZED', files: [], originalDirty: ctx.mode === 'mirror' ? null : false, aiPending: false, committedPaths: 0 };
  if (!pair) return info;
  info.mirrorBranch = await branch(pair.mirror);
  const active = state.pairs[info.mirrorBranch];
  if (!active) { info.state = 'BRANCH_MISMATCH'; return info; }
  const result = await changes(pair.mirror, active, await policy(ctx.original));
  info.files = result.changes.map(e => `${e.kind}\t${JSON.stringify(e.path)}`);
  info.aiPending = result.changes.length > 0; info.committedPaths = result.committed;
  if (ctx.mode !== 'mirror') info.originalDirty = (await status(ctx.original)).length > 0;
  info.state = await loadJournal(ctx.original) ? 'RECOVERY_REQUIRED' : info.mirrorBranch !== stateBranch ? 'BRANCH_MISMATCH' : pair.baselineNeedsReview ? 'BASELINE_UNKNOWN' : info.aiPending ? 'AI_PENDING' : 'CLEAN';
  return info;
}
export function createSession(ctx, { output = console.log, prompt = async () => { throw new Error('Interactive confirmation requires a TTY.'); }, signal, profile = false } = {}) {
  const emit = value => output(safeText(value));
  async function execute(command) {
    const tokens = Array.isArray(command) ? command : tokenize(command), raw = tokens.shift() || '', name = raw.startsWith('/') ? raw : `/${raw}`;
    const started = performance.now(), calls = metrics.calls, gitTime = metrics.milliseconds;
    let state = await loadState(ctx.original), language = state?.language || 'en';
    const t = (en, id) => localized(language, en, id);
    const confirm = async message => (await prompt(`${message} [y/N] `, { kind: 'confirm' })).trim().toLowerCase() === 'y';
    const allowed = ctx.mode === 'mirror' ? mirrorCommands : originalCommands;
    if (name === '/exit' || name === '/quit') return { exit: true };
    if (name === '/help') { emit(allowed.map(k => `${k.padEnd(24)} ${descriptions[k][language === 'id' ? 1 : 0]}`).join('\n')); return {}; }
    if (!allowed.includes(name)) throw new Error(name === '/resolve' ? 'Automatic merge was removed. Review and edit files manually before /sync.' : `Command unavailable in ${ctx.mode} mode: ${name}`);
    const mutating = ['/init', '/reinit', '/use', '/configure', '/sync', '/sync-original-to-ai', '/serialize', '/recover', '/migrate', '/adopt-baseline', '/adopt-policy', '/language'].includes(name) && !tokens.includes('--dry-run');
    const run = async () => {
      // Always reload after taking the project lock.
      state = await loadState(ctx.original); language = state?.language || 'en';
      if (mutating && name !== '/recover' && await loadJournal(ctx.original)) throw new Error('RECOVERY_REQUIRED: run /recover.');
      if (state?.schemaVersion === 2 && mutating && !['/migrate', '/recover'].includes(name)) throw new Error('Legacy state detected. Run /migrate first.');
      if (name === '/language') {
        if (!['en', 'id'].includes(tokens[0])) throw new Error('Usage: /language en|id');
        state ||= newState(ctx.original); state.language = tokens[0]; await saveState(ctx.original, state); emit(`Language: ${tokens[0]}`); return { language: tokens[0] };
      }
      if (name === '/configure') {
        state ||= newState(ctx.original); const defaults = newState(ctx.original).config; state.config = { ...defaults, ...state.config, mirror: { ...defaults.mirror, ...state.config?.mirror }, sync: { ...defaults.sync, ...state.config?.sync }, autoSync: { ...defaults.autoSync, ...state.config?.autoSync }, testUrls: { ...defaults.testUrls, ...state.config?.testUrls }, sandbox: { ...defaults.sandbox, ...state.config?.sandbox }, history: { ...defaults.history, ...state.config?.history }, ui: { ...defaults.ui, ...state.config?.ui }, safety: { ...defaults.safety, ...state.config?.safety } };
        emit(`CURRENT SETTINGS\n\n  Mirror\n    Branch pairing          ${state.config.mirror.branchPairing}\n  Ignore policy\n    Source                  .aimpignore\n  Sync behavior\n    Confirm overwrite       ${state.config.sync.confirmOverwrite ? 'yes' : 'no'}\n    Confirm deletion        ${state.config.sync.confirmDeletion ? 'yes' : 'no'}\n  Auto sync trigger\n    Mode                    ${state.config.autoSync.enabled ? 'request-enabled' : 'disabled'}\n  Test URLs\n    Enabled                 ${state.config.testUrls.enabled ? 'yes' : 'no'}\n    Allowlist               ${state.config.testUrls.allowlist.join(', ') || '(none)'}\n  Sandbox integration\n    Required                ${state.config.sandbox.required ? 'yes' : 'no'}\n    Detect                  ${state.config.sandbox.detect ? 'yes' : 'no'}\n  Watcher\n    Enabled                 ${state.config.autoSync.enabled ? 'yes' : 'no'}\n    Interval                ${state.config.autoSync.intervalMs} ms\n  Reports & history\n    Enabled                 ${state.config.history.enabled ? 'yes' : 'no'}\n    Retention               ${state.config.history.retention}\n  Language & interface\n    Language                ${language}\n    Color                   ${state.config.ui.color ? 'yes' : 'no'}\n  Safety checks\n    Clean original          ${state.config.safety.requireCleanOriginal ? 'required' : 'optional'}\n\n${t('Do you want to reconfigure? [y/N]', 'Apakah ingin mengatur ulang? [y/N]')}`);
        if ((await prompt('', { kind: 'confirm' })).trim().toLowerCase() !== 'y') return {};
        const ask = async (message, current) => { const value = (await prompt(`${message} [${current}] `, { kind: 'text' })).trim(); return value || current; };
        const bool = value => ['y', 'yes', 'true', '1', 'on', 'enabled'].includes(String(value).toLowerCase());
        const urls = await ask(t('Test URLs (comma-separated, blank keeps current)', 'URL test (pisahkan koma, kosong tidak mengubah)'), state.config.testUrls.allowlist.join(', '));
        if (urls !== state.config.testUrls.allowlist.join(', ')) { const parsed = urls.split(',').map(value => value.trim()).filter(Boolean); for (const value of parsed) { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`Unsupported test URL protocol: ${url.protocol}`); } state.config.testUrls.allowlist = parsed; state.config.testUrls.enabled = parsed.length > 0; }
        state.config.autoSync.enabled = bool(await ask(t('Enable request-based auto-sync? (y/n)', 'Aktifkan auto-sync berbasis request? (y/n)'), state.config.autoSync.enabled ? 'y' : 'n'));
        state.config.sync.confirmOverwrite = bool(await ask(t('Confirm overwrites? (y/n)', 'Konfirmasi overwrite? (y/n)'), state.config.sync.confirmOverwrite ? 'y' : 'n'));
        state.config.sync.confirmDeletion = bool(await ask(t('Confirm deletions? (y/n)', 'Konfirmasi penghapusan? (y/n)'), state.config.sync.confirmDeletion ? 'y' : 'n'));
        state.config.sandbox.required = bool(await ask(t('Require sandbox? (y/n)', 'Wajibkan sandbox? (y/n)'), state.config.sandbox.required ? 'y' : 'n'));
        state.config.history.retention = Number(await ask(t('History retention count', 'Jumlah history yang disimpan'), state.config.history.retention)); if (!Number.isInteger(state.config.history.retention) || state.config.history.retention < 1) throw new Error('History retention must be a positive integer.');
        language = await ask(t('Language (en/id)', 'Bahasa (en/id)'), language); if (!['en', 'id'].includes(language)) throw new Error('Language must be en or id.'); state.language = language;
        await saveState(ctx.original, state);
        const activePair = state.pairs[await branch(ctx.original)]; if (activePair) await writeMetadata(activePair.mirror, state.projectId, activePair, state.config);
        emit(t('Configuration saved. AGENTS-AIMP.md updated for the mirror.', 'Konfigurasi tersimpan. AGENTS-AIMP.md di mirror diperbarui.')); return { config: state.config };
      }
      if (name === '/migrate') {
        if (!state || state.schemaVersion === 3) { emit(t('State is current.', 'State sudah terbaru.')); return {}; }
        if (!await confirm(t('Back up legacy state (which may contain credentials) and migrate?', 'Backup state lama (mungkin berisi credential) lalu migrasikan?'))) return {};
        const result = await migrate(ctx.original, state); emit(`Backup: ${result.backup}\n/adopt-baseline`); return {};
      }
      if (name === '/recover') {
        const tx = await loadJournal(ctx.original); if (!tx) { emit(t('No recovery needed.', 'Tidak ada recovery.')); return {}; }
        if (!await confirm(t(`Recover transaction ${tx.id} (${tokens[0] || 'resume'})?`, `Pulihkan transaksi ${tx.id} (${tokens[0] || 'resume'})?`))) return {};
        if (tx.kind === 'initialize') await recoverInitialization(ctx.original, tx); else await recover(ctx.original, tokens[0]);
        emit(t('Recovery complete.', 'Recovery selesai.')); return {};
      }
      if (name === '/init' || name === '/reinit') {
        state ||= newState(ctx.original);
        const b = await branch(ctx.original), pair = state.pairs[b];
        if (pair && name === '/init') { await useBranch(ctx.original, state); emit(`Mirror: ${pair.mirror}`); return {}; }
        const existing = Object.values(state.pairs)[0];
        const fallback = existing?.mirror || path.resolve(ctx.original, '..', `${path.basename(ctx.original)}-ai`);
        const requested = tokens[0] || (await prompt(t(`Mirror folder [${fallback}]: `, `Folder mirror [${fallback}]: `), { kind: 'path' })).trim() || fallback;
        const destination = requested.startsWith('~/') ? path.join(os.homedir(), requested.slice(2)) : requested;
        if (name === '/init') {
          const existingRules = await policy(ctx.original);
          const candidates = (await names(ctx.original, ['ls-files', '-z'])).filter(rel => /(^|\/)(\.env(?:\.|$)|.*(?:credential|secret|password|private|settings_local|local_settings).*)/i.test(rel)).slice(0, 40);
          const hint = candidates.length ? `\n${candidates.map(rel => `- ${rel}`).join('\n')}` : '';
          const answer = (await prompt(t(`Ignore paths (comma-separated; blank keeps current policy):${hint}\n> `, `Path yang di-ignore (pisahkan koma; kosong mempertahankan policy):${hint}\n> `), { kind: 'text' })).trim();
          const selected = answer.split(',').map(value => value.trim()).filter(value => value && value !== 'y' && value !== 'Y');
          if (selected.length && await confirm(t(`Create/update .aimpignore with ${selected.length} path pattern(s)?`, `Buat/perbarui .aimpignore dengan ${selected.length} pola path?`))) {
            const current = existingRules.content.toString('utf8').trimEnd();
            const additions = selected.filter(value => !current.split('\n').includes(value));
            if (additions.length) await fs.writeFile(path.join(ctx.original, '.aimpignore'), `${current ? `${current}\n` : ''}${additions.join('\n')}\n`);
            emit(t(`.aimpignore updated (${additions.length} new pattern(s)).`, `.aimpignore diperbarui (${additions.length} pola baru).`));
          }
        }
        const created = await initialize(ctx.original, state, destination, { confirm, replacing: name === '/reinit', signal });
        if (created) emit(`Mirror: ${created.mirror}${created.backup ? `\nBackup: ${created.backup}` : ''}`);
        return {};
      }
      if (name === '/status') {
        const info = await inspect(ctx, state);
        emit(tokens.includes('--json') ? JSON.stringify(info) : `PROJECT\n  Original     ${ctx.mode === 'mirror' ? '[hidden in AI mirror]' : info.original}\n  AI mirror    ${info.mirror || '—'}\n  Branch       ${info.branch}\n  AI branch    ${info.mirrorBranch || '—'}\n\nHEALTH\n  Original     ${info.originalDirty === null ? '[hidden]' : info.originalDirty ? 'dirty' : 'clean'}\n  AI mirror    ${info.aiPending ? 'pending' : 'clean'}\n  Baseline     ${info.committedPaths} committed path(s)\n  State        ${info.state}\n\nCHANGES\n${info.files.length ? `  TYPE  PATH\n${info.files.map(line => `  ${line.replace('\t', '  ')}`).join('\n')}` : '  No changes'}`);
        return { monitor: info };
      }
      if (name === '/doctor') {
        const checks = { node: process.version, git: await text(ctx.root, ['--version']), stateRoot: stateRoot(), schema: state?.schemaVersion || null, platform: process.platform, sandbox: false };
        try { await validateRepository(ctx.original); checks.original = 'ok'; if (state && Object.keys(state.pairs).length) await requirePair(ctx.original, state); checks.pair = 'ok'; } catch (e) { checks.problem = e.message; }
        checks.recoveryRequired = Boolean(await loadJournal(ctx.original));
        emit(`DOCTOR\n  ${checks.original === 'ok' ? '✓' : '✗'} Original repository\n  ${checks.pair === 'ok' ? '✓' : '✗'} Mirror pairing\n  ${checks.recoveryRequired ? '!' : '✓'} Recovery journal\n  ${checks.problem ? `✗ ${checks.problem}` : '✓ Ready'}\n\nDETAILS\n  Node         ${checks.node}\n  Git          ${checks.git.trim()}\n  Schema       ${checks.schema || '—'}\n  Platform     ${checks.platform}`); return {};
      }
      if (name === '/list') { emit(Object.entries(state?.pairs || {}).map(([b, p]) => `${b}\t${p.mirror}`).join('\n') || t('No mirrors.', 'Belum ada mirror.')); return {}; }
      if (name === '/log') { emit(JSON.stringify(state?.history || [], null, 2)); return {}; }
      if (name === '/history') {
        const pair = state?.pairs?.[await branch(ctx.original)];
        if (!pair) throw new Error('Branch is not initialized. Run /init.');
        const safeBranch = pair.branch.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+|\.+$/g, '') || 'default';
        const dir = path.join(stateRoot(), 'reports', safeBranch);
        let entries = []; try { entries = (await fs.readdir(dir)).sort().reverse(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        emit(entries.join('\n') || t('No archived reports.', 'Belum ada laporan yang diarsipkan.')); return {};
      }
      if (name === '/use') { const pair = await useBranch(ctx.original, state); emit(`${pair.branch} → ${pair.mirror}`); return {}; }
      const b = await branch(ctx.root), pair = state?.pairs?.[b];
      if (!pair) throw new Error('Branch is not initialized. Run /init.');
      if (name === '/adopt-baseline') {
        await requirePair(ctx.original, state);
        emit(`Original baseline: ${pair.baselineOriginal}\nMirror baseline: ${pair.baselineAi}`);
        if (!await confirm(t('I reviewed these baselines; keep pending changes and enable sync?', 'Saya sudah memeriksa baseline; pertahankan perubahan pending dan aktifkan sync?'))) return {};
        pair.baselineNeedsReview = false; pair.policyHash = (await policy(ctx.original)).hash; await saveState(ctx.original, state); return {};
      }
      if (name === '/adopt-policy') {
        const rules = await policy(ctx.original);
        emit(rules.content.toString('utf8') || '(empty .aimpignore)');
        if (!await confirm(t('Adopt this policy? Re-included files require explicit reinit to restore skipped historical changes.', 'Setujui policy ini? File yang dimasukkan kembali membutuhkan reinit untuk perubahan historis yang pernah dilewati.'))) return {};
        pair.policyHash = rules.hash; await saveState(ctx.original, state); return {};
      }
      if (name === '/get-summary' || name === '/get-commit-message') { const report = await readReport(pair.mirror, pair, state.projectId); emit(name === '/get-summary' ? report.summary : report.message); return {}; }
      if (name === '/diff') {
        const result = await changes(pair.mirror, pair, await policy(ctx.original));
        emit(result.changes.length ? `TYPE  PATH\n${result.changes.map(e => `${e.kind.padEnd(5)} ${JSON.stringify(e.path)}`).join('\n')}` : t('No changes.', 'Tidak ada perubahan.'));
        for (const entry of result.changes) {
          if ((entry.after?.size || 0) > 1024 * 1024) { emit(`${JSON.stringify(entry.path)}: large file; review externally.`); continue; }
          emit((await git(pair.mirror, ['diff', '--no-ext-diff', '--no-textconv', pair.baselineAi, '--', entry.path])).stdout.toString('utf8'));
        }
        return {};
      }
      if (name === '/serialize') {
        if (ctx.mode !== 'mirror') throw new Error('/serialize is only available in the mirror.');
        const detected = await changes(pair.mirror, pair, await policy(ctx.original));
        let selected = detected.changes;
        emit(selected.map((f, i) => `${i + 1}. ${f.kind}\t${JSON.stringify(f.path)}`).join('\n'));
        if (!selected.length) { emit(t('No changes.', 'Tidak ada perubahan.')); return {}; }
        const selection = tokens.length ? tokens : tokenize(await prompt(t('Select exact paths (quote spaces), or * for all: ', 'Pilih path tepat (kutip spasi), atau * untuk semua: '), { kind: 'text' }));
        if (!selection.includes('*')) { const wanted = new Set(selection); if ([...wanted].some(p => !selected.some(f => f.path === p))) throw new Error('Selection contains an unchanged or excluded path.'); selected = selected.filter(f => wanted.has(f.path)); }
        if (!selected.length) return {};
        if (!await confirm(t('Adopt these paths locally? This does not protect them from future refresh; use .aimpignore for that.', 'Jadikan path ini baseline lokal? Untuk melindunginya dari refresh berikutnya, gunakan .aimpignore.'))) return {};
        const plan = await preparePlan(ctx.original, state);
        plan.changes = selected.map(f => ({ ...f, before: f.after })); plan.direction = 'serialize'; plan.source = pair.mirror; plan.target = pair.mirror;
        await transact(state, plan, `chore(aimp): serialize ${pair.branch}`, { signal }); emit(t('Local baseline adopted.', 'Baseline lokal diperbarui.')); return {};
      }
      if (name === '/sync' || name === '/sync-original-to-ai') {
        const direction = name === '/sync' ? 'ai-to-original' : 'original-to-ai';
        const plan = await preparePlan(ctx.original, state, direction);
        if (tokens.includes('--dry-run')) { emit(JSON.stringify(plan, null, 2)); return { plan }; }
        if (!plan.changes.length) { emit(t('No changes to sync.', 'Tidak ada perubahan untuk sync.')); return {}; }
        const report = direction === 'ai-to-original' ? await readReport(pair.mirror, pair, state.projectId) : null;
        const message = report ? `${report.message} (synced)` : `chore(aimp): refresh ${pair.branch}`;
        if (report) emit(report.summary);
        emit(plan.changes.map(f => `${f.kind}\t${JSON.stringify(f.path)}`).join('\n'));
        const dirtyPaths = new Set((await status(ctx.original)).map(f => f.path));
        const overlap = plan.changes.filter(f => dirtyPaths.has(f.path));
        if (overlap.length) { emit(overlap.map(f => JSON.stringify(f.path)).join('\n')); if (!await confirm(t('Overwrite these uncommitted original paths?', 'Timpa path original di atas yang belum di-commit?'))) return {}; }
        if (plan.changes.some(f => !f.after) && !await confirm(t('Approve the listed deletions?', 'Setujui penghapusan yang ditampilkan?'))) return {};
        if (!await confirm(t('Apply these files and create a local AI checkpoint? Original remains uncommitted.', 'Terapkan file ini dan buat checkpoint lokal AI? Original tetap tanpa commit.'))) return {};
        if (report && (await readReport(pair.mirror, pair, state.projectId)).hash !== report.hash) throw new Error('Report changed after preview.');
        const result = await transact(state, plan, message, { signal }); emit(`Checkpoint AI: ${result.aiCommit}`); return {};
      }
      return {};
    };
    try { return mutating ? await withLock(ctx.original, run) : await run(); }
    finally { if (profile) emit(JSON.stringify({ profile: name, machineAndPromptMs: Math.round(performance.now() - started), gitCalls: metrics.calls - calls, gitMs: Math.round(metrics.milliseconds - gitTime) })); }
  }
  return { execute, context: ctx, commands: ctx.mode === 'mirror' ? mirrorCommands : originalCommands };
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--version') || argv.includes('-v')) { console.log(`aimp ${pkg.version}`); return; }
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('aimp — manual AI project mirror\nUsage: aimp [--plain] [--profile]\n       aimp status --json\n       aimp sync --dry-run\n       aimp --watch\n       aimp --sync-to-original\n\n' + originalCommands.map(c => `${c.padEnd(24)} ${descriptions[c][0]}`).join('\n')); return;
  }
  const ctx = await context(process.cwd()), plain = argv.includes('--plain') || !stdin.isTTY || !stdout.isTTY, profile = argv.includes('--profile');
  if (argv.includes('--sync-to-original')) {
    if (ctx.mode !== 'mirror') throw new Error('--sync-to-original must be run inside the AI mirror.');
    const state = await loadState(ctx.original), pair = state?.pairs?.[await branch(ctx.root)];
    if (!pair || !state.config?.autoSync?.enabled) throw new Error('Request auto-sync is disabled. Run /configure in the original first.');
    const requestDir = path.join(ctx.root, '.aimp'); await fs.mkdir(requestDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(requestDir, 'sync-request.json'), JSON.stringify({ type: 'sync-to-original', branch: pair.branch, batchId: pair.batch, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    console.log('Sync request created. AIMP watcher in the original will process it.'); return;
  }
  if (argv.includes('--watch')) {
    if (ctx.mode === 'mirror') throw new Error('--watch must be run from the original project.');
    const state = await loadState(ctx.original); if (!state?.config?.autoSync?.enabled || !state.config.autoSync.enabled) throw new Error('Auto-sync and watcher must be enabled with /configure.');
    console.log(`AIMP watcher active (${state.config.autoSync.intervalMs}ms). Ctrl+C to stop.`);
    const controller = new AbortController(), stop = () => controller.abort(); process.on('SIGINT', stop);
    try { while (!controller.signal.aborted) { const current = await loadState(ctx.original); for (const pair of Object.values(current?.pairs || {})) { const request = path.join(pair.mirror, '.aimp', 'sync-request.json'); if (!await fs.stat(request).catch(() => null)) continue; const raw = JSON.parse(await fs.readFile(request, 'utf8')); if (raw.type !== 'sync-to-original' || raw.branch !== pair.branch || raw.batchId !== pair.batch) continue; const session = createSession(ctx, { signal: controller.signal, output: console.log, prompt: async () => 'y' }); try { console.log(`Auto-sync processing: ${pair.branch}`); const result = await session.execute('/sync'); console.log(`Auto-sync completed: ${pair.branch}${result?.aiCommit ? ` (mirror checkpoint ${result.aiCommit})` : ''}`); await fs.writeFile(path.join(pair.mirror, '.aimp', 'sync-notification'), `Auto-sync completed for ${pair.branch} at ${new Date().toISOString()}\n`, { mode: 0o600 }); } catch (error) { console.error(`Auto-sync paused: ${error.message}`); await fs.writeFile(path.join(pair.mirror, '.aimp', 'sync-notification'), `Auto-sync paused for ${pair.branch}: ${error.message}\n`, { mode: 0o600 }); } finally { await fs.rm(request, { force: true }); } } await new Promise(resolve => setTimeout(resolve, current?.config?.autoSync?.intervalMs || 2000)); } } finally { process.off('SIGINT', stop); } return;
  }
  const configuredState = await loadState(ctx.original);
  if (ctx.mode === 'original' && configuredState?.config?.autoSync?.enabled && configuredState.config.autoSync.enabled && !argv.includes('--plain')) {
    const watcher = spawn(process.execPath, [process.argv[1], '--watch'], { cwd: ctx.original, detached: true, stdio: 'ignore' }); watcher.unref();
  }
  const args = argv.filter(a => !['--plain', '--profile'].includes(a));
  if (!plain && !args.length) { const { runInk } = await import('./ui.js'); await runInk({ ctx, profile }); return; }
  const rl = stdin.isTTY ? createInterface({ input: stdin, output: stdout }) : null;
  const controller = new AbortController(); const stop = () => controller.abort(); process.on('SIGINT', stop);
  const session = createSession(ctx, { profile, signal: controller.signal, prompt: rl ? p => rl.question(p, { signal: controller.signal }) : undefined });
  try {
    if (args.length) { await session.execute(args); return; }
    if (!rl) throw new Error('Use a command in non-interactive mode, e.g. aimp status --json.');
    while (!controller.signal.aborted) {
      const command = await rl.question(ctx.mode === 'mirror' ? 'aimp-ai> ' : 'aimp> ', { signal: controller.signal });
      try { if ((await session.execute(command)).exit) break; } catch (e) { console.error(safeText(e.message)); }
    }
  } finally { rl?.close(); process.off('SIGINT', stop); }
}
export { loadState };
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(safeText(e.message)); process.exitCode = 1; });
