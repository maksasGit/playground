import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { config, root } from './config.js';
import { openDatabase } from './database.js';
import { buildInDocker, cleanupBuild, cleanLog, prepareBuilder } from './docker-build.js';
import { acquireWorkerLease, recoverInterruptedJobs, publishRelease, type JobRow } from './builds.js';

const storage = resolve(root, config.BUILDS_PATH);
const { sqlite } = openDatabase(resolve(root, config.DATABASE_PATH));
const owner = randomUUID(); let stopping = false; let running: string | null = null; let ready = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { stopping = true; if (running) void cleanupBuild(running); });
let announced = false;
while (!stopping && !acquireWorkerLease(sqlite, owner)) {
  if (!announced) { console.log('Another worker is active; waiting in standby.'); announced = true; }
  await new Promise(resolveWait => setTimeout(resolveWait, 3000));
}
if (stopping) { sqlite.close(); process.exit(0); }
const heartbeat = setInterval(() => {
  const changed = sqlite.prepare('UPDATE build_worker SET heartbeat = ? WHERE id = 1 AND owner = ?').run(Date.now(), owner);
  if (!changed.changes) { stopping = true; if (running) void cleanupBuild(running); }
}, 5000);
try {
  await mkdir(storage, { recursive: true });
  const interrupted = sqlite.prepare("SELECT id FROM build_jobs WHERE status = 'running'").all() as { id: string }[];
  for (const job of interrupted) {
    await cleanupBuild(job.id);
    if (!sqlite.prepare('SELECT 1 FROM releases WHERE id = ?').get(job.id)) await rm(join(storage, 'releases', job.id), { recursive: true, force: true });
  }
  recoverInterruptedJobs(sqlite);
  while (!stopping) {
    if (!ready) {
      try {
        await prepareBuilder(root, text => process.stdout.write(text)); ready = true;
        sqlite.prepare("UPDATE build_worker SET ready = 1, message = 'Сборщик готов. Одновременно выполняется одна сборка.' WHERE id = 1 AND owner = ?").run(owner);
      } catch {
        sqlite.prepare("UPDATE build_worker SET ready = 0, message = 'Docker недоступен. Запустите Docker Desktop и проверьте интернет.' WHERE id = 1 AND owner = ?").run(owner);
        await new Promise(resolveWait => setTimeout(resolveWait, 5000)); continue;
      }
    }
    const job = sqlite.transaction(() => {
      if (!sqlite.prepare('SELECT 1 FROM build_worker WHERE id = 1 AND owner = ?').get(owner)) { stopping = true; return undefined; }
      const row = sqlite.prepare("SELECT * FROM build_jobs WHERE status = 'queued' ORDER BY created_at, id LIMIT 1").get() as JobRow | undefined;
      if (row) sqlite.prepare("UPDATE build_jobs SET status = 'running', started_at = ? WHERE id = ?").run(Date.now(), row.id);
      return row;
    }).immediate();
    if (!job) { await new Promise(resolveWait => setTimeout(resolveWait, 1500)); continue; }
    running = job.id;
    const log = (value: string) => sqlite.prepare('UPDATE build_jobs SET logs = substr(logs || ?, -100000) WHERE id = ?').run(cleanLog(value), job.id);
    try {
      log(`Starting ${job.id}\n`);
      const artifact = await buildInDocker({ id: job.id, repositoryUrl: job.repository_url, commitSha: job.commit_sha, buildRoot: job.build_root, releaseId: job.id }, root, storage, log);
      if (stopping) throw new Error('Worker is stopping');
      publishRelease(sqlite, job, artifact.files, artifact.size, owner);
      log('Published successfully. Previous releases remain available for rollback.\n');
    } catch (error) {
      const message = cleanLog(error instanceof Error ? error.message : 'Build failed').slice(-2000);
      sqlite.prepare("UPDATE build_jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ? AND status = 'running'").run(message, Date.now(), job.id);
      if (!sqlite.prepare('SELECT 1 FROM releases WHERE id = ?').get(job.id)) await rm(join(storage, 'releases', job.id), { recursive: true, force: true });
      log(`Build failed. Previous published release preserved.\n${message}\n`);
      ready = false;
    } finally { running = null; }
  }
} finally {
  clearInterval(heartbeat);
  sqlite.prepare('UPDATE build_worker SET ready = 0, heartbeat = 0 WHERE owner = ?').run(owner);
  sqlite.close();
}
