-- Accounts, their sign-in sessions and their deployment packs. Times used for expiry are Unix seconds, so they compare as numbers.

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  rank TEXT NOT NULL DEFAULT '',
  organisation TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,      -- scrypt, with its own salt and cost
  recovery_hash TEXT NOT NULL,      -- the one-time recovery code, hashed the same way
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_sign_in TEXT
);

-- Only a SHA-256 of each session token is kept, so a copy of the database cannot be used to sign in.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

-- A deployment pack is a military unit: the sensors, effectors, vehicles and people assigned to it.
CREATE TABLE units (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  echelon TEXT NOT NULL,
  callsign TEXT,
  assets TEXT NOT NULL CHECK (json_valid(assets)),  -- systems, vehicles and people, validated by the API
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX units_user ON units (user_id, updated_at DESC);
