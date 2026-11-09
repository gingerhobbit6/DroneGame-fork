-- Never hand a deleted user's numeric ID to another account. An in-flight request may still hold that ID.
-- A single counter avoids storing one tombstone for every account ever created.
CREATE TABLE account_sequence (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  last_id INTEGER NOT NULL
);
INSERT INTO account_sequence (singleton, last_id) SELECT 1, COALESCE(MAX(id), 0) FROM users;
