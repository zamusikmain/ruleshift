-- Additive only: existing account UUIDs, passkeys, matches and ratings are preserved.
CREATE TABLE auth_identities (
 provider TEXT NOT NULL CHECK(provider IN ('google','email')),
 subject TEXT NOT NULL,
 account_id TEXT NOT NULL REFERENCES accounts(id),
 PRIMARY KEY(provider,subject),
 UNIQUE(account_id,provider)
);
CREATE INDEX auth_identity_account ON auth_identities(account_id);
CREATE TABLE login_flows (
 id_hash TEXT PRIMARY KEY,
 purpose TEXT NOT NULL CHECK(purpose IN ('google','email')),
 context TEXT NOT NULL,
 code_hash TEXT,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 expires_at INTEGER NOT NULL
);
CREATE INDEX login_flow_expiry ON login_flows(expires_at);
CREATE TABLE account_nickname_choices (
 account_id TEXT PRIMARY KEY REFERENCES accounts(id),
 chosen_at INTEGER NOT NULL
);
