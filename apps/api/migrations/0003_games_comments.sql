CREATE TABLE game_covers (
  game_id TEXT PRIMARY KEY NOT NULL REFERENCES games(id),
  bytes BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE comments (
  id TEXT PRIMARY KEY NOT NULL,
  game_id TEXT NOT NULL REFERENCES games(id),
  author_user_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at INTEGER NOT NULL,
  edited_at INTEGER,
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden')),
  moderated_at INTEGER,
  moderated_by TEXT REFERENCES users(id)
);
CREATE INDEX comments_game_page ON comments(game_id, status, created_at DESC, id DESC);
CREATE INDEX comments_author ON comments(author_user_id);
