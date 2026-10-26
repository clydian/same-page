-- Additive, independent of existing session and client storage formats.
CREATE TABLE connection_exchanges (
  id TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  target_origin TEXT NOT NULL,
  session_id TEXT REFERENCES session(id) ON DELETE CASCADE,
  code_hash TEXT,
  expires_at INTEGER NOT NULL
);
CREATE INDEX connection_exchanges_expiry ON connection_exchanges(expires_at);
