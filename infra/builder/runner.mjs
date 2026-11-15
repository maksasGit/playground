import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const [phase, root] = process.argv.slice(2);
if (!root || (root !== '.' && (!/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(root) || root.split('/').some(part => part === '.' || part === '..')))) throw new Error('Invalid project directory');
let cwd = path.join('/work/source', root);
const run = (command, args, env = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, env: { ...process.env, NPM_CONFIG_CACHE: '/work/npm-cache', ...env }, stdio: 'inherit', shell: false });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
});
const candidates = [];
async function validateSource(directory, budget = { files: 0, bytes: 0 }) {
  for (const name of await readdir(directory)) {
    const file = path.join(directory, name); const stat = await lstat(file);
    if (stat.isSymbolicLink()) throw new Error('Source symlinks are not supported');
    if (['.npmrc', '.pnpmfile.cjs', 'pnpmfile.cjs', 'pnpm-workspace.yaml'].includes(name)) throw new Error('Custom npm configuration / pnpm workspaces are not supported by this preset');
    if (stat.isDirectory()) await validateSource(file, budget);
    else if (stat.isFile()) {
      budget.files++; budget.bytes += stat.size;
      if (name === 'package.json' && stat.size < 1024 * 1024) {
        const value = JSON.parse(await readFile(file, 'utf8'));
        if (typeof value.scripts?.build === 'string') {
          const names = await readdir(directory);
          if (names.includes('package-lock.json') || names.includes('pnpm-lock.yaml')) candidates.push(directory);
        }
      }
    }
    else throw new Error('Unsupported source entry');
    if (budget.files > 50000 || budget.bytes > 600 * 1024 * 1024) throw new Error('Source exceeds build limits');
  }
}
if (phase === 'install') {
  await mkdir('/work/source', { recursive: true });
  const extract = spawn('tar', ['-xzf', '/input/source.tgz', '--strip-components=1', '--no-same-owner', '--no-same-permissions', '-C', '/work/source'], { stdio: 'inherit', shell: false });
  await new Promise((resolve, reject) => { extract.on('error', reject); extract.on('exit', code => code === 0 ? resolve() : reject(new Error('Source extraction failed'))); });
  await validateSource('/work/source');
  if (root === '.') {
    try { await lstat(path.join(cwd, 'package.json')); }
    catch { if (candidates.length !== 1) throw new Error('Specify the project directory: cannot select a unique lockfile-backed build project'); cwd = candidates[0]; }
  }
  await writeFile('/work/project-root', path.relative('/work/source', cwd) || '.');
  const packageJson = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8'));
  if (typeof packageJson.scripts?.build !== 'string') throw new Error('package.json must contain a build script');
  const proxy = 'http://registry-proxy:3128';
  let manager;
  try { await lstat(path.join(cwd, 'package-lock.json')); manager = 'npm'; }
  catch { try { await lstat(path.join(cwd, 'pnpm-lock.yaml')); manager = 'pnpm'; } catch { throw new Error('A package-lock.json or pnpm-lock.yaml is required'); } }
  if (manager === 'npm') {
    const lock = JSON.parse(await readFile(path.join(cwd, 'package-lock.json'), 'utf8'));
    for (const item of Object.values(lock.packages ?? {})) {
      if (item.resolved && !String(item.resolved).startsWith('https://registry.npmjs.org/')) throw new Error('Only npm registry lockfile dependencies are supported');
    }
    await run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org', `--https-proxy=${proxy}`]);
  } else await run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts', '--ignore-pnpmfile', '--store-dir=/work/pnpm-store', '--registry=https://registry.npmjs.org', `--https-proxy=${proxy}`]);
  process.stdout.write('Dependencies installed without lifecycle scripts.\n');
} else if (phase === 'build') {
  // The worker must disconnect the container network before entering this phase.
  let npm = true;
  try { await lstat(path.join(cwd, 'package-lock.json')); } catch { npm = false; }
  await run(npm ? 'npm' : 'pnpm', npm ? ['run', 'build', '--', '--base=./'] : ['run', 'build', '--base=./']);
  const stat = await lstat(path.join(cwd, 'dist/index.html'));
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('dist/index.html is required');
} else throw new Error('Unknown build phase');
