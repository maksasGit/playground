CREATE TABLE platform_metadata (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
INSERT INTO platform_metadata (key, value) VALUES ('schema', 'foundation');
