CREATE TABLE rooms (
  code TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX rooms_updated_idx ON rooms(updated);
