import { promises as fs } from 'node:fs';
const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
for (const key of ['name', 'version', 'description', 'repository', 'bugs', 'homepage', 'license', 'bin', 'files', 'engines']) if (!pkg[key]) throw new Error(`Missing package field: ${key}`);
if (pkg.repository.url !== 'git+https://github.com/bbliong/aimp.dev.git') throw new Error('Repository URL does not match the release repository.');
if (pkg.name !== '@bbliong/aimp') throw new Error('Package must use the @bbliong/aimp scope.');
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) throw new Error(`Invalid version: ${pkg.version}`);
for (const file of [...pkg.files, 'package-lock.json']) if (!await fs.stat(file).catch(() => null)) throw new Error(`Missing package file: ${file}`);
if (pkg.publishConfig?.access !== 'public') throw new Error('Scoped package must publish publicly.');
console.log(`release metadata OK: ${pkg.name}@${pkg.version}`);
