import { spawn } from 'node:child_process';
import { mkdir, open, rm, statfs, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { buildRootSchema, commitShaSchema, repositoryUrlSchema } from '@playground/shared';
import { extractArtifact } from './artifacts.js';
import { config } from './config.js';

const image = 'playground-builder:node22-v1';
export function cleanLog(value: string) {
  // eslint-disable-next-line no-control-regex -- Strip terminal control bytes from untrusted build logs.
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
    .replace(/(?:github_pat_|gh[pousr]_)[a-zA-Z0-9_]+/g, '[redacted]').replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1[redacted]@');
}
export function docker(args: string[], log?: (text: string) => void, timeout = 60_000): Promise<string> {
  return new Promise((resolveRun, reject) => {
    const child = spawn('docker', args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let bytes = 0;
    const timer = setTimeout(() => { child.kill(); reject(new Error('Docker command timed out')); }, timeout);
    const collect = (chunk: Buffer) => {
      bytes += chunk.length;
      const value = cleanLog(chunk.toString('utf8'));
      if (bytes < 2 * 1024 * 1024) { output = (output + value).slice(-200_000); log?.(value); }
      if (bytes > 8 * 1024 * 1024) { child.kill(); }
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); if (code === 0) resolveRun(output.trim()); else reject(new Error(output.slice(-1000) || 'Docker command failed')); });
  });
}
export async function prepareBuilder(root: string, log: (text: string) => void) {
  await docker(['info', '--format', '{{.ServerVersion}}']);
  try { await docker(['image', 'inspect', image]); }
  catch { await docker(['build', '--tag', image, resolve(root, 'infra/builder')], log, 300_000); }
}
export async function cleanupBuild(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid job ID');
  for (const name of [`pg-build-${id}`, `pg-proxy-${id}`]) await docker(['rm', '-f', name]).catch(() => {});
  await docker(['network', 'rm', `pg-net-${id}`]).catch(() => {});
}
export interface BuildInput { id: string; repositoryUrl: string; commitSha: string; buildRoot: string; releaseId: string }
export async function buildInDocker(input: BuildInput, root: string, storage: string, log: (text: string) => void) {
  const repository = repositoryUrlSchema.parse(input.repositoryUrl).slice('https://github.com/'.length);
  const sha = commitShaSchema.parse(input.commitSha); const buildRoot = buildRootSchema.parse(input.buildRoot);
  if (![input.id, input.releaseId].every(id => /^[0-9a-f-]{36}$/.test(id))) throw new Error('Invalid build identifier');
  const jobPath = join(storage, 'jobs', input.id); const destination = join(storage, 'releases', input.releaseId);
  await mkdir(jobPath, { recursive: true }); await mkdir(join(storage, 'releases'), { recursive: true });
  const free = await statfs(storage);
  if (free.bavail * free.bsize < 1024 * 1024 * 1024) throw new Error('At least 1 GiB of free disk space is required');
  try { await lstat(destination); throw new Error('Release destination already exists'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const archive = join(jobPath, 'source.tgz');
  const container = `pg-build-${input.id}`; const proxy = `pg-proxy-${input.id}`; const network = `pg-net-${input.id}`;
  const deadline = Date.now() + 10 * 60_000;
  const run = (args: string[]) => docker(args, args[0] === 'exec' && !args.includes('cat') ? log : undefined, Math.max(1, deadline - Date.now()));
  let completed = false;
  try {
    log(`Downloading immutable commit ${sha}\n`);
    const response = await fetch(`https://codeload.github.com/${repository}/tar.gz/${sha}`, { redirect: 'error', signal: AbortSignal.timeout(60_000) });
    if (!response.ok || !response.body) throw new Error('Cannot download the selected public commit');
    const file = await open(archive, 'wx'); let bytes = 0;
    try {
      for await (const chunk of Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)) {
        bytes += chunk.length; if (bytes > 100 * 1024 * 1024) throw new Error('Source archive exceeds 100 MiB');
        await file.writeFile(chunk);
      }
    } finally { await file.close(); }
    await run(['network', 'create', '--internal', network]);
    const runner = resolve(root, 'infra/builder');
    const limits = ['--user', '1000:1000', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128'];
    await run(['run', '-d', '--name', proxy, ...limits, '--memory=128m', '--cpus=0.25', '--mount', `type=bind,source=${join(runner, 'proxy.mjs')},target=/proxy.mjs,readonly`, image, 'node', '/proxy.mjs']);
    await run(['network', 'connect', '--alias', 'registry-proxy', network, proxy]);
    const clearProxy = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'].flatMap(name => ['--env', `${name}=`]);
    const memoryBytes = config.BUILD_MEMORY_MB * 1024 ** 2;
    const nanoCpus = config.BUILD_CPUS * 1_000_000_000;
    await run(['create', '--name', container, ...limits, ...clearProxy, `--cpus=${config.BUILD_CPUS}`, `--memory=${config.BUILD_MEMORY_MB}m`, `--memory-swap=${config.BUILD_MEMORY_MB}m`, '--network', network,
      '--tmpfs', '/work:rw,exec,nosuid,nodev,size=1073741824,uid=1000,gid=1000,mode=0700', '--tmpfs', '/tmp:rw,nosuid,nodev,size=67108864,mode=1777',
      '--mount', `type=bind,source=${archive},target=/input/source.tgz,readonly`, '--mount', `type=bind,source=${runner},target=/runner,readonly`, image]);
    await run(['start', container]);
    const inspected = JSON.parse(await run(['inspect', '--format', '{{json .}}', container]));
    const host = inspected.HostConfig;
    if (host.Privileged || !host.ReadonlyRootfs || host.Memory !== memoryBytes || host.MemorySwap !== memoryBytes || host.NanoCpus !== nanoCpus || host.PidsLimit !== 128 || inspected.Config.User !== '1000:1000'
      || !host.CapDrop?.includes('ALL') || !host.SecurityOpt?.includes('no-new-privileges')
      || inspected.Mounts.some((mount: { Type: string; Destination: string; RW: boolean }) => mount.Type === 'bind' && (mount.RW || !['/runner', '/input/source.tgz'].includes(mount.Destination)))) throw new Error('Build container isolation verification failed');
    log(`Isolation verified: non-root, read-only root, ${config.BUILD_CPUS} CPUs, ${config.BUILD_MEMORY_MB} MiB, 128 processes, no host secrets or socket mounts.\n`);
    log('Installing lockfile dependencies through the registry proxy; scripts disabled.\n');
    await run(['exec', container, 'node', '/runner/runner.mjs', 'install', buildRoot]);
    const actualRoot = buildRootSchema.parse(await run(['exec', container, 'cat', '/work/project-root']));
    log(`Project directory: ${actualRoot}\n`);
    await run(['network', 'disconnect', network, container]);
    const networks = await run(['inspect', '--format', '{{json .NetworkSettings.Networks}}', container]);
    if (networks.trim() !== '{}') throw new Error('Build container must be disconnected from all networks');
    log('Network disconnected. Building production files.\n');
    await run(['exec', container, 'node', '/runner/runner.mjs', 'build', actualRoot]);
    log('Validating immutable release artifacts.\n');
    const directory = actualRoot === '.' ? '/work/source/dist' : `/work/source/${actualRoot}/dist`;
    const child = spawn('docker', ['exec', container, 'tar', '-cf', '-', '-C', directory, '.'], { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill(), Math.max(1, deadline - Date.now()));
    let stderr = '';
    child.stderr.on('data', value => { stderr = (stderr + cleanLog(value.toString())).slice(-1000); });
    const finished = new Promise<void>((resolveExport, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolveExport() : reject(new Error(stderr || 'Artifact export failed'))); });
    // Attach rejection immediately while the archive is being validated.
    finished.catch(() => {});
    let artifact;
    try { artifact = await extractArtifact(child.stdout, destination); await finished; }
    finally { clearTimeout(timer); child.kill(); }
    completed = true; return artifact;
  } finally {
    await cleanupBuild(input.id);
    await rm(jobPath, { recursive: true, force: true });
    if (!completed) await rm(destination, { recursive: true, force: true });
  }
}
