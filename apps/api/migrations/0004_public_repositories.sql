ALTER TABLE games ADD COLUMN deployed_commit_sha TEXT;
CREATE TABLE game_repositories (
  game_id TEXT PRIMARY KEY NOT NULL REFERENCES games(id),
  connection_id TEXT NOT NULL UNIQUE,
  revision INTEGER NOT NULL DEFAULT 1,
  repository_id INTEGER NOT NULL,
  repository_url TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT 'main' CHECK (branch = 'main'),
  latest_commit_sha TEXT NOT NULL,
  commit_message TEXT NOT NULL,
  commit_date TEXT,
  checked_at INTEGER NOT NULL
);
