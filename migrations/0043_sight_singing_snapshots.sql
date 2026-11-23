-- Keep the published metadata and decouple its optional provenance from live attachments.
CREATE TABLE sight_singing_questions_next (
  choir_id TEXT NOT NULL REFERENCES choirs(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  score_id TEXT,
  attachment_id TEXT,
  attachment_revision INTEGER CHECK (attachment_revision > 0),
  first_visit INTEGER NOT NULL CHECK (first_visit >= 0),
  last_visit INTEGER NOT NULL CHECK (last_visit >= first_visit),
  version INTEGER NOT NULL CHECK (version > 0),
  write_id TEXT,
  CHECK ((score_id IS NULL AND attachment_id IS NULL AND attachment_revision IS NULL)
    OR (score_id IS NOT NULL AND attachment_id IS NOT NULL AND attachment_revision IS NOT NULL)),
  PRIMARY KEY (choir_id, id)
);
INSERT INTO sight_singing_questions_next(choir_id, id, title, score_id, attachment_id, attachment_revision, first_visit, last_visit, version)
  SELECT choir_id, id, title, score_id, attachment_id, attachment_revision, first_visit, last_visit, version FROM sight_singing_questions;
DROP TABLE sight_singing_questions;
ALTER TABLE sight_singing_questions_next RENAME TO sight_singing_questions;

CREATE TABLE sight_singing_score_snapshots (
  choir_id TEXT NOT NULL REFERENCES choirs(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
  content_type TEXT NOT NULL,
  etag TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (choir_id, id)
);
CREATE INDEX sight_singing_snapshot_created_idx ON sight_singing_score_snapshots(created_at);

CREATE TABLE sight_singing_question_versions (
  choir_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  snapshot_id TEXT NOT NULL,
  title TEXT NOT NULL,
  first_visit INTEGER NOT NULL CHECK (first_visit >= 0),
  last_visit INTEGER NOT NULL CHECK (last_visit >= first_visit),
  fingerprint TEXT NOT NULL,
  PRIMARY KEY (choir_id, question_id, version),
  FOREIGN KEY (choir_id, question_id) REFERENCES sight_singing_questions(choir_id, id) ON DELETE CASCADE,
  FOREIGN KEY (choir_id, snapshot_id) REFERENCES sight_singing_score_snapshots(choir_id, id) ON DELETE CASCADE
);
CREATE INDEX sight_singing_versions_snapshot_idx ON sight_singing_question_versions(choir_id, snapshot_id);

-- Reuse the existing drive reservation and platform limits. A reused snapshot has one physical object.
DROP VIEW free_file_storage_usage;
CREATE VIEW free_file_storage_usage AS SELECT
  (SELECT COALESCE(sum(v.size_bytes), 0) FROM score_versions v JOIN choirs c ON c.id = v.choir_id WHERE c.plan = 'free') +
  (SELECT COALESCE(sum(f.size_bytes), 0) FROM score_attachment_files f JOIN choirs c ON c.id = f.choir_id WHERE c.plan = 'free') +
  (SELECT COALESCE(sum(s.size_bytes), 0) FROM sight_singing_score_snapshots s JOIN choirs c ON c.id = s.choir_id WHERE c.plan = 'free') +
  (SELECT COALESCE(sum(d.platform_bytes), 0) FROM score_object_deletions d
    WHERE NOT EXISTS (SELECT 1 FROM score_versions WHERE object_key = d.object_key)
      AND NOT EXISTS (SELECT 1 FROM score_attachment_files WHERE object_key = d.object_key)
      AND NOT EXISTS (SELECT 1 FROM sight_singing_score_snapshots WHERE object_key = d.object_key)) AS bytes;

CREATE TRIGGER sight_singing_snapshot_platform_guard BEFORE INSERT ON sight_singing_score_snapshots WHEN
  EXISTS (SELECT 1 FROM choirs WHERE id = NEW.choir_id AND plan = 'free') AND
  (SELECT bytes FROM free_file_storage_usage) + NEW.size_bytes > (SELECT retained_pdf_limit_bytes FROM drive_platform_limits WHERE id = 1)
BEGIN SELECT RAISE(ABORT, 'platform_storage_limit_reached'); END;

CREATE TRIGGER sight_singing_snapshot_reserve BEFORE INSERT ON sight_singing_score_snapshots
BEGIN UPDATE choirs SET storage_used_bytes = storage_used_bytes + NEW.size_bytes WHERE id = NEW.choir_id; END;

CREATE TRIGGER sight_singing_snapshot_release AFTER DELETE ON sight_singing_score_snapshots
BEGIN
  UPDATE choirs SET storage_used_bytes = MAX(0, storage_used_bytes - OLD.size_bytes) WHERE id = OLD.choir_id;
  INSERT INTO score_object_deletions(id, object_key, platform_bytes)
  VALUES (OLD.id, OLD.object_key, CASE WHEN EXISTS (SELECT 1 FROM choirs WHERE id = OLD.choir_id AND plan = 'free') THEN OLD.size_bytes ELSE 0 END)
  ON CONFLICT(object_key) DO UPDATE SET platform_bytes = MAX(platform_bytes, excluded.platform_bytes);
END;

CREATE TRIGGER sight_singing_snapshot_drive_cleanup BEFORE DELETE ON choirs WHEN OLD.plan = 'free'
BEGIN
  INSERT INTO score_object_deletions(id, object_key, platform_bytes)
  SELECT id, object_key, size_bytes FROM sight_singing_score_snapshots WHERE choir_id = OLD.id
  ON CONFLICT(object_key) DO UPDATE SET platform_bytes = MAX(platform_bytes, excluded.platform_bytes);
END;
