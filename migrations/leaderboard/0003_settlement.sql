-- Serializes optimistic settlements inside a single atomic D1 batch.
CREATE TABLE settlement_revision (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
INSERT INTO settlement_revision VALUES(1,0);
CREATE TABLE settlement_guard (id TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid=1));
