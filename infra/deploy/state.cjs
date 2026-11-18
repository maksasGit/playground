/* eslint-disable @typescript-eslint/no-require-imports -- These helpers run directly in Node without transpilation. */
/* global process, console, require, module, URL */
const path = require('node:path');
const fs = require('node:fs');

function storagePaths(root, env) {
  const data = path.resolve(root, 'data');
  for (const value of [env.DATABASE_PATH || './data/database/playground.sqlite', env.BUILDS_PATH || './data/builds']) {
    const resolved = path.resolve(root, value);
    if (!resolved.startsWith(data + path.sep)) throw new Error('Deployment backup requires all storage inside APP_DIR/data');
  }
  const origin = new URL(env.APP_ORIGIN);
  if (origin.protocol !== 'https:' || origin.origin !== env.APP_ORIGIN) throw new Error('An exact HTTPS APP_ORIGIN is required');
  return { database: path.resolve(root, env.DATABASE_PATH || './data/database/playground.sqlite'), origin: origin.origin };
}

function pauseIfIdle(db) {
  return db.transaction(() => {
    if (db.prepare("SELECT 1 FROM build_jobs WHERE status IN ('queued', 'running') LIMIT 1").get()) return false;
    db.prepare('UPDATE build_worker SET ready = 0 WHERE id = 1').run();
    return true;
  }).immediate();
}

module.exports = { storagePaths, pauseIfIdle };
if (require.main === module) {
  const [root, action] = process.argv.slice(2);
  const live = fs.realpathSync(process.env.PLAYGROUND_LIVE || root);
  const dotenv = require(path.join(live, 'apps/api/node_modules/dotenv'));
  const env = dotenv.parse(fs.readFileSync(path.join(root, '.env')));
  const paths = storagePaths(root, env);
  if (action === 'origin') console.log(paths.origin);
  else {
    const Database = require(path.join(live, 'apps/api/node_modules/better-sqlite3'));
    const db = new Database(paths.database, { fileMustExist: true, readonly: action !== 'pause' });
    db.pragma('busy_timeout = 5000');
    try {
      if (action === 'pause') process.exitCode = pauseIfIdle(db) ? 0 : 75;
      else if (action === 'ready') {
        const worker = db.prepare('SELECT ready, heartbeat FROM build_worker WHERE id = 1').get();
        process.exitCode = worker?.ready === 1 && worker.heartbeat > Date.now() - 30000 ? 0 : 1;
      } else throw new Error('Unknown deployment state command');
    } finally { db.close(); }
  }
}
