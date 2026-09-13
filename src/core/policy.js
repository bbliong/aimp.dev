import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git, names, nul } from './git.js';
import { MANAGED, safePath, present, hash, validatePath } from './files.js';

export async function policy(root) {
  const file = await safePath(root, '.aimpignore');
  const content = await present(file) ? await fs.readFile(file) : Buffer.alloc(0);
  if (content.length > 1024 * 1024) throw new Error('.aimpignore is too large.');
  return { content, hash: hash(content) };
}
export async function included(paths, rules, { includeManaged = false } = {}) {
  const candidates = [...new Set(paths)].filter(rel => { validatePath(rel); return includeManaged || !MANAGED.has(rel); });
  if (!candidates.length || !rules.content.length) return candidates;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'aimp-policy-'));
  try {
    await git(temp, ['init', '--quiet']);
    const excludes = path.join(temp, 'rules'); await fs.writeFile(excludes, rules.content, { mode: 0o600 });
    const result = await git(temp, ['-c', `core.excludesFile=${excludes}`, 'check-ignore', '--no-index', '-z', '--stdin'], {
      input: Buffer.from(candidates.map(p => `./${p}`).join('\0') + '\0'), allowFailure: true,
      env: { GIT_LITERAL_PATHSPECS: '0' },
    });
    if (![0, 1].includes(result.code)) throw new Error(`Invalid ignore policy: ${result.stderr}`);
    const ignored = new Set(nul(result.stdout).map(p => p.replace(/^\.\//, '')));
    return candidates.filter(rel => !ignored.has(rel));
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}
export async function projectFiles(root, rules) {
  return included(await names(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']), rules);
}
export async function guardAttributes(root, paths) {
  if (!paths.length) return;
  const result = await git(root, ['check-attr', '-z', '--stdin', 'filter', 'working-tree-encoding'], { input: Buffer.from(paths.join('\0') + '\0') });
  const values = nul(result.stdout);
  for (let i = 0; i < values.length; i += 3) if (!['unspecified', 'unset'].includes(values[i + 2])) throw new Error(`Unsupported Git attribute ${values[i + 1]}: ${JSON.stringify(values[i])}`);
}
