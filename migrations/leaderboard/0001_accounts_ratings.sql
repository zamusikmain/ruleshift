-- Prepared locally only. No binding or remote migration is enabled.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 3 AND 16),
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','deleted'))
);
CREATE TABLE credentials (
  credential_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  public_key BLOB NOT NULL,
  signature_counter INTEGER NOT NULL DEFAULT 0 CHECK(signature_counter >= 0),
  transports TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  expires_at INTEGER NOT NULL,
  reauthenticated_at INTEGER NOT NULL
);
CREATE INDEX sessions_account ON sessions(account_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE auth_challenges (
  challenge_hash TEXT PRIMARY KEY,
  account_id TEXT REFERENCES accounts(id),
  purpose TEXT NOT NULL CHECK(purpose IN ('register','login','add_credential','delete_account')),
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE TABLE recovery_codes (
  code_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  consumed_at INTEGER
);
CREATE TABLE seasons (
  id TEXT PRIMARY KEY,
  starts_at INTEGER NOT NULL,
  closes_at INTEGER NOT NULL CHECK(closes_at > starts_at),
  status TEXT NOT NULL CHECK(status IN ('open','closing','archived'))
);
CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK(mode IN ('classic','lastOneStanding','blitz','chaos')),
  season_id TEXT NOT NULL REFERENCES seasons(id),
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL CHECK(finished_at >= started_at),
  formula_version INTEGER NOT NULL,
  receipt_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('settled','void'))
);
CREATE TABLE participants (
  match_id TEXT NOT NULL REFERENCES matches(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  outcome TEXT NOT NULL CHECK(outcome IN ('win','loss','draw','forfeit')),
  placement INTEGER NOT NULL CHECK(placement BETWEEN 1 AND 8),
  PRIMARY KEY(match_id, account_id)
);
CREATE TABLE ratings (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  mode TEXT NOT NULL CHECK(mode IN ('overall','classic','lastOneStanding','blitz','chaos')),
  season_id TEXT NOT NULL,
  value REAL NOT NULL DEFAULT 1000,
  games INTEGER NOT NULL DEFAULT 0 CHECK(games >= 0),
  wins INTEGER NOT NULL DEFAULT 0 CHECK(wins >= 0),
  losses INTEGER NOT NULL DEFAULT 0 CHECK(losses >= 0),
  draws INTEGER NOT NULL DEFAULT 0 CHECK(draws >= 0),
  streak INTEGER NOT NULL DEFAULT 0 CHECK(streak >= 0),
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(account_id,mode,season_id),
  CHECK(games = wins + losses + draws)
);
CREATE INDEX ratings_top ON ratings(mode,season_id,value DESC,games DESC,account_id);
CREATE TABLE settlement_ledger (
  match_id TEXT NOT NULL REFERENCES matches(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  mode TEXT NOT NULL,
  season_id TEXT NOT NULL,
  delta REAL NOT NULL,
  PRIMARY KEY(match_id,account_id,mode,season_id)
);
CREATE TABLE pair_history (
  account_low TEXT NOT NULL REFERENCES accounts(id),
  account_high TEXT NOT NULL REFERENCES accounts(id),
  match_id TEXT NOT NULL REFERENCES matches(id),
  played_at INTEGER NOT NULL,
  PRIMARY KEY(account_low,account_high,match_id),
  CHECK(account_low < account_high)
);
CREATE INDEX pairs_window ON pair_history(account_low,account_high,played_at);
