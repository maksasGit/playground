ALTER TABLE games ADD COLUMN active_release_id TEXT REFERENCES releases(id);
CREATE TABLE releases (
  id TEXT PRIMARY KEY NOT NULL,
  game_id TEXT NOT NULL REFERENCES games(id),
  commit_sha TEXT NOT NULL,
  repository_url TEXT NOT NULL,
  files_json TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX releases_game ON releases(game_id, created_at DESC);
CREATE TABLE build_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  game_id TEXT NOT NULL REFERENCES games(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  connection_id TEXT NOT NULL,
  repository_url TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  build_root TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  release_id TEXT REFERENCES releases(id),
  logs TEXT NOT NULL DEFAULT '',
  error TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);
CREATE UNIQUE INDEX build_jobs_one_active ON build_jobs(game_id) WHERE status IN ('queued', 'running');
CREATE TABLE build_worker (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  owner TEXT NOT NULL,
  heartbeat INTEGER NOT NULL,
  ready INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT ''
);
CREATE TABLE play_tickets (
  token_hash TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  release_id TEXT NOT NULL REFERENCES releases(id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX play_tickets_expiry ON play_tickets(expires_at);
