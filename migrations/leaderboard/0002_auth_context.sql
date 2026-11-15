ALTER TABLE auth_challenges ADD COLUMN context TEXT NOT NULL DEFAULT '{}';
CREATE TABLE request_limits (key TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, count INTEGER NOT NULL);
CREATE INDEX request_limits_expiry ON request_limits(expires_at);
CREATE TRIGGER active_credential_insert BEFORE INSERT ON credentials
WHEN NOT EXISTS (SELECT 1 FROM accounts WHERE id=NEW.account_id AND status='active')
BEGIN SELECT RAISE(ABORT,'inactive_account'); END;
CREATE TRIGGER active_session_insert BEFORE INSERT ON sessions
WHEN NOT EXISTS (SELECT 1 FROM accounts WHERE id=NEW.account_id AND status='active')
BEGIN SELECT RAISE(ABORT,'inactive_account'); END;
