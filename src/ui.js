import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, render, useApp, useInput, useStdout } from 'ink';
import { PassThrough } from 'node:stream';
import { stdin, stdout } from 'node:process';
import { createSession, loadState, pathCompleter, localized, safeText } from './cli.js';
import { branch } from './core/git.js';
import { wrapRows, decodeMouse } from './ui-utils.js';
const h = React.createElement;
function lineColor(line) {
  if (line.startsWith('Error:')) return 'red';
  if (line.startsWith('$ ')) return 'cyan';
  if (/^(State: CLEAN|Original: clean|AI mirror: clean|No changes)/.test(line)) return 'green';
  if (/^(State:|Original dirty: yes|AI pending: yes|Warning:)/.test(line)) return 'yellow';
  if (/^(\s*[MADRCU!?]|[0-9]+\.\s+)/.test(line)) return line.includes('D') ? 'red' : line.includes('A') ? 'green' : 'yellow';
  if (/^(Branch:|AI copy:|AI branch:|Mirror:|Checkpoint AI:)/.test(line)) return 'blue';
  return undefined;
}

function App({ ctx, profile, onScroll, controller }) {
  const { exit } = useApp(), { stdout: screen } = useStdout();
  const [size, setSize] = useState({ columns: screen.columns || 80, rows: screen.rows || 24 });
  const [language, setLanguage] = useState('en'), [activeBranch, setActiveBranch] = useState('…');
  const [value, setValue] = useState(''), [logs, setLogs] = useState([]), [offset, setOffset] = useState(0);
  const [pending, setPending] = useState(null), [busy, setBusy] = useState(false), [monitor, setMonitor] = useState(null);
  const busyRef = useRef(false), pendingRef = useRef(null), completion = useRef(null), quitting = useRef(false);
  const t = (en, id) => localized(language, en, id);
  const log = message => { setLogs(old => [...old, ...safeText(message).split('\n')].slice(-5000)); setOffset(0); };
  const session = useMemo(() => createSession(ctx, {
    profile, signal: controller.signal, output: log,
    prompt: (message, options) => new Promise((resolve, reject) => {
      const abort = () => { pendingRef.current = null; setPending(null); reject(new Error('Cancelled.')); };
      const request = { message, kind: options.kind, resolve: v => { controller.signal.removeEventListener('abort', abort); resolve(v); } };
      pendingRef.current = request; setPending(request); controller.signal.addEventListener('abort', abort, { once: true });
    }),
  }), [ctx, profile, controller]);
  useEffect(() => {
    const resize = () => setSize({ columns: screen.columns || 80, rows: screen.rows || 24 });
    screen.on('resize', resize);
    Promise.all([loadState(ctx.original), branch(ctx.root)]).then(([state, name]) => { setLanguage(state?.language || 'en'); setActiveBranch(name); }).catch(e => log(e.message));
    return () => screen.off('resize', resize);
  }, [ctx, screen]);
  const rows = Math.max(6, size.rows - 1), width = Math.max(16, size.columns - 2), small = rows < 22;
  const showMonitor = Boolean(monitor && width >= 100 && rows >= 18);
  const leftWidth = showMonitor ? Math.floor(width * 0.65) : width;
  const textWidth = Math.max(10, leftWidth - 2);
  const candidates = !pending && value.startsWith('/') ? session.commands.filter(c => c.startsWith(value)) : [];
  const headerRows = small ? 3 : 7;
  const promptLabel = pending ? pending.message : ctx.mode === 'mirror' ? '$ aimp-ai> ' : '$ aimp> ';
  const inputRows = wrapRows([`${promptLabel}${value}▏`], textWidth).slice(-Math.min(4, Math.max(1, rows - headerRows - 4)));
  const suggestionRows = candidates.length ? wrapRows([candidates.join('  ')], textWidth).slice(0, 2) : [];
  const chatHeight = Math.max(1, rows - headerRows - inputRows.length - suggestionRows.length - 3);
  const wrappedLogs = wrapRows(logs, textWidth), maxOffset = Math.max(0, wrappedLogs.length - chatHeight), scroll = Math.min(offset, maxOffset);
  const visible = wrappedLogs.slice(Math.max(0, wrappedLogs.length - scroll - chatHeight), wrappedLogs.length - scroll);
  useEffect(() => { onScroll.current = amount => setOffset(old => Math.max(0, Math.min(maxOffset, old + amount))); return () => { onScroll.current = null; }; }, [maxOffset, onScroll]);
  async function submit() {
    const answer = value; setValue(''); completion.current = null;
    if (pendingRef.current) { const p = pendingRef.current; pendingRef.current = null; setPending(null); p.resolve(answer); return; }
    if (busyRef.current || !answer.trim()) return;
    busyRef.current = true; setBusy(true); setMonitor(null); log(`$ ${answer}`);
    try {
      const result = await session.execute(answer);
      if (result.exit) return exit();
      if (result.monitor) { setMonitor(result.monitor); setActiveBranch(result.monitor.branch); }
      const state = await loadState(ctx.original); setLanguage(state?.language || 'en');
    } catch (error) { log(`Error: ${error.message}`); }
    finally { busyRef.current = false; setBusy(false); if (quitting.current) exit(); }
  }
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      quitting.current = true; controller.abort();
      if (!busyRef.current) exit();
      return;
    }
    if (key.up || key.pageUp || key.home) return setOffset(old => key.home ? maxOffset : Math.min(maxOffset, old + (key.pageUp ? chatHeight : 1)));
    if (key.down || key.pageDown || key.end) return setOffset(old => key.end ? 0 : Math.max(0, old - (key.pageDown ? chatHeight : 1)));
    if (busyRef.current && !pendingRef.current) return;
    if (key.return) { void submit(); return; }
    if (key.tab) {
      if (pending && pending.kind !== 'path') return;
      if (completion.current) {
        const cycle = completion.current; cycle.index = (cycle.index + (key.shift ? -1 : 1) + cycle.matches.length) % cycle.matches.length;
        setValue(cycle.matches[cycle.index]); return;
      }
      const typed = value;
      const resolve = matches => { if (!matches.length) return; completion.current = { matches, index: 0 }; setValue(matches[0]); };
      if (pending) void pathCompleter(typed).then(([matches]) => resolve(matches)); else resolve(candidates);
      return;
    }
    completion.current = null;
    if (key.backspace || key.delete) { setValue(old => Array.from(old).slice(0, -1).join('')); return; }
    if (!key.ctrl && !key.meta && !key.escape && input) setValue(old => old + input.replace(/[\x00-\x1f\x7f]/g, ''));
  });
  const logo = small ? ['╭─ AIMP ─╮'] : ['╭────────────────────╮', '│ A I M P            │', '│ AI MIRROR PROJECT  │', '╰────────────────────╯'];
  const header = [...logo, `${ctx.mode === 'mirror' ? 'AI MIRROR' : 'ORIGINAL'} · ${activeBranch}`, ctx.root];
  const left = h(Box, { width: leftWidth, flexDirection: 'column', height: rows },
    ...header.slice(0, headerRows - 1).map((line, i) => h(Text, { key: `h${i}`, color: i < logo.length ? 'green' : undefined, wrap: 'truncate-end' }, safeText(line))),
    h(Text, { dimColor: true, wrap: 'truncate-end' }, pending ? t('Waiting for input', 'Menunggu input') : busy ? t('Processing… Ctrl+C stops safely', 'Memproses… Ctrl+C berhenti aman') : t('Ready · Ctrl+C exit', 'Siap · Ctrl+C keluar')),
    h(Box, { flexDirection: 'column', height: chatHeight, overflow: 'hidden' }, ...visible.map((line, i) => h(Text, { key: i, color: lineColor(line) }, line))),
    h(Text, { dimColor: true, wrap: 'truncate-end' }, `↑↓ PgUp/PgDn Home/End · ${scroll ? `↑ ${scroll}` : t('latest', 'terbaru')}`),
    ...suggestionRows.map((line, i) => h(Text, { key: `s${i}`, color: 'yellow' }, line)),
    h(Text, { dimColor: true, wrap: 'truncate-end' }, t('Type / · Tab/Shift+Tab selects commands or paths', 'Ketik / · Tab/Shift+Tab pilih command atau path')),
    ...inputRows.map((line, i) => h(Text, { key: `p${i}`, color: 'green' }, safeText(line)))
  );
  const right = showMonitor ? h(Box, { width: width - leftWidth, flexDirection: 'column', borderStyle: 'round', height: Math.min(rows, 18), paddingX: 1 },
    h(Text, { color: 'blue' }, '$ status --snapshot'),
    ...wrapRows([monitor.state, `Original dirty: ${monitor.originalDirty}`, `AI pending: ${monitor.aiPending}`, `Branch: ${monitor.mirrorBranch}`, `Path: ${monitor.mirror}`, ...monitor.files], width - leftWidth - 4).slice(0, 14).map((line, i) => h(Text, { key: i, color: lineColor(line) }, safeText(line)))
  ) : null;
  return h(Box, { flexDirection: 'row', height: rows, width }, left, right);
}

export async function runInk({ ctx, profile }) {
  const controller = new AbortController(), scroll = { current: null }, filtered = new PassThrough();
  filtered.isTTY = stdin.isTTY; filtered.setRawMode = enabled => stdin.setRawMode(enabled);
  filtered.ref = () => stdin.ref(); filtered.unref = () => stdin.unref();
  const decoder = decodeMouse(direction => scroll.current?.(direction));
  const onData = chunk => { const cleaned = decoder.push(chunk); if (cleaned.length) filtered.write(cleaned); };
  const stop = () => controller.abort();
  stdin.on('data', onData); process.on('SIGTERM', stop);
  stdout.write('\x1b[?1049h\x1b[?1000h\x1b[?1006h\x1b[2J\x1b[H');
  try {
    const app = render(h(App, { ctx, profile, controller, onScroll: scroll }), { stdin: filtered, stdout, exitOnCtrlC: false, patchConsole: false });
    await app.waitUntilExit();
  } finally {
    controller.abort(); stdin.off('data', onData); process.off('SIGTERM', stop); filtered.destroy();
    if (stdin.isTTY) stdin.setRawMode(false);
    stdout.write('\x1b[?1006l\x1b[?1000l\x1b[?1049l');
  }
}
