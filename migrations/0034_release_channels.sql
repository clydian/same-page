-- Additive server-side metadata only. No business IndexedDB/schema changes.
CREATE TABLE frontend_releases (
  build_id TEXT PRIMARY KEY CHECK(length(build_id)=40),
  manifest_digest TEXT NOT NULL CHECK(length(manifest_digest)=64),
  contract TEXT NOT NULL CHECK(contract='same-page-storage-v15-sync-v1'),
  published_at INTEGER NOT NULL,
  ready INTEGER NOT NULL DEFAULT 0 CHECK(ready IN (0,1))
);
CREATE TABLE release_channels (
  id INTEGER PRIMARY KEY CHECK(id=1),
  stable TEXT NOT NULL REFERENCES frontend_releases(build_id),
  beta TEXT NOT NULL REFERENCES frontend_releases(build_id),
  revision INTEGER NOT NULL CHECK(revision>0)
);
CREATE TABLE release_operators (user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE);
CREATE TABLE release_promotions (
  id TEXT PRIMARY KEY, operator_id TEXT NOT NULL, session_id TEXT NOT NULL,
  expected_beta TEXT NOT NULL, expected_revision INTEGER NOT NULL,
  previous_stable TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TRIGGER validate_release_promotion BEFORE INSERT ON release_promotions BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM release_channels c JOIN frontend_releases r ON r.build_id=c.beta
    WHERE c.id=1 AND c.beta=NEW.expected_beta AND c.revision=NEW.expected_revision AND c.stable=NEW.previous_stable AND r.ready=1
  ) THEN RAISE(ABORT,'release_conflict') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM release_operators o JOIN session s ON s.user_id=o.user_id
    WHERE o.user_id=NEW.operator_id AND s.id=NEW.session_id AND s.expires_at>NEW.created_at
    AND NOT EXISTS(SELECT 1 FROM user_lifecycle WHERE user_id=o.user_id)
  ) THEN RAISE(ABORT,'release_forbidden') END;
END;
CREATE TRIGGER commit_release_promotion AFTER INSERT ON release_promotions BEGIN
  UPDATE release_channels SET stable=NEW.expected_beta,revision=revision+1 WHERE id=1;
END;
