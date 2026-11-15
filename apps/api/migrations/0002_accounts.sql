CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Admin', 'Tester', 'Viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  must_change_password INTEGER NOT NULL DEFAULT 1 CHECK (must_change_password IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE games (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover TEXT,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE game_access (
  user_id TEXT NOT NULL REFERENCES users(id),
  game_id TEXT NOT NULL REFERENCES games(id),
  granted_by TEXT NOT NULL REFERENCES users(id),
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, game_id)
);
CREATE INDEX game_access_game ON game_access(game_id);

CREATE TABLE user_permissions (
  user_id TEXT NOT NULL REFERENCES users(id),
  permission TEXT NOT NULL CHECK (permission IN ('vault:read', 'vault:upload', 'vault:manage')),
  granted_by TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (user_id, permission)
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_events_timestamp ON audit_events(timestamp);
