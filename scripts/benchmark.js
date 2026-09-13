import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { metrics } from '../src/core/git.js';
import { createSession } from '../src/cli.js';

const root = process.cwd();
const session = createSession({ root, original: root, mode: 'original' }, { output: () => {} });
const started = performance.now();
try { await session.execute(['/status', '--json']); } catch (error) { console.error(error.message); process.exitCode = 1; }
console.log(JSON.stringify({ elapsedMs: Math.round(performance.now() - started), gitCalls: metrics.calls, gitMs: Math.round(metrics.milliseconds) }));
