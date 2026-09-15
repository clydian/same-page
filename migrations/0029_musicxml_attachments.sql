-- Expand MusicXML type without invoking live deletion/quota triggers.
-- D1 executes migration atomically. Preserve child rows before dropping their parent.
PRAGMA defer_foreign_keys = ON;

DROP TRIGGER attachment_parent_guard;

DROP TRIGGER attachment_count_guard;

DROP TRIGGER attachment_file_parent_guard;

DROP TRIGGER attachment_reserve_storage;

DROP TRIGGER attachment_release_storage;

DROP TRIGGER attachment_file_soft_delete;

DROP TRIGGER attachment_soft_delete;

DROP TRIGGER score_attachment_soft_delete;

DROP TRIGGER attachment_current_file_guard;

DROP TRIGGER attachment_replace_file;

DROP TRIGGER attachment_touch_score_insert;

DROP TRIGGER attachment_touch_score_update;

DROP TRIGGER attachment_queue_object;

DROP TRIGGER drive_queue_physical_files;

DROP VIEW free_file_storage_usage;

DROP TRIGGER free_platform_storage_guard;

DROP TRIGGER attachment_platform_storage_guard;

CREATE TABLE migration_0029_score_attachments AS SELECT * FROM score_attachments;

CREATE TABLE migration_0029_score_attachment_files AS SELECT * FROM score_attachment_files;

DROP TABLE score_attachment_files;

DROP TABLE score_attachments;

CREATE TABLE score_attachments (
  id TEXT PRIMARY KEY NOT NULL,
  choir_id TEXT NOT NULL REFERENCES choirs(id) ON DELETE CASCADE,
  score_id TEXT NOT NULL REFERENCES scores(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('link','audio','pdf','markdown','musicxml')),
  name TEXT NOT NULL,
  url TEXT,
  current_file_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  trashed_at INTEGER,
  trash_expires_at INTEGER,
  purged_at INTEGER,
  CHECK ((kind = 'link' AND url IS NOT NULL AND current_file_id IS NULL) OR (kind <> 'link' AND url IS NULL))
);

CREATE TABLE score_attachment_files (
  id TEXT PRIMARY KEY NOT NULL,
  attachment_id TEXT NOT NULL REFERENCES score_attachments(id) ON DELETE CASCADE,
  choir_id TEXT NOT NULL REFERENCES choirs(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0 AND size_bytes <= 52428800),
  content_type TEXT NOT NULL,
  etag TEXT,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','ready')),
  created_at INTEGER NOT NULL,
  purged_at INTEGER
);

INSERT INTO score_attachments SELECT * FROM migration_0029_score_attachments;

DROP TABLE migration_0029_score_attachments;

INSERT INTO score_attachment_files SELECT * FROM migration_0029_score_attachment_files;

DROP TABLE migration_0029_score_attachment_files;

CREATE INDEX attachments_score_idx ON score_attachments(score_id, trashed_at, purged_at);

CREATE INDEX attachments_drive_idx ON score_attachments(choir_id, trashed_at, purged_at);

CREATE INDEX attachment_files_parent_idx ON score_attachment_files(attachment_id);

CREATE INDEX attachment_files_cleanup_idx ON score_attachment_files(state, created_at);

CREATE TRIGGER attachment_parent_guard BEFORE INSERT ON score_attachments WHEN NOT EXISTS (
 SELECT 1 FROM scores WHERE id = NEW.score_id AND choir_id = NEW.choir_id AND trashed_at IS NULL AND purged_at IS NULL AND current_version_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'resource_deleted'); END;

CREATE TRIGGER attachment_count_guard BEFORE INSERT ON score_attachments WHEN
 (SELECT count(*) FROM score_attachments WHERE score_id = NEW.score_id AND purged_at IS NULL) >= 100
BEGIN SELECT RAISE(ABORT, 'attachment_limit_reached'); END;

CREATE TRIGGER attachment_file_parent_guard BEFORE INSERT ON score_attachment_files WHEN NOT EXISTS (
 SELECT 1 FROM score_attachments a JOIN scores s ON s.id = a.score_id WHERE a.id = NEW.attachment_id AND a.choir_id = NEW.choir_id
 AND a.purged_at IS NULL AND a.trashed_at IS NULL AND s.purged_at IS NULL AND s.trashed_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'resource_deleted'); END;

CREATE TRIGGER attachment_reserve_storage BEFORE INSERT ON score_attachment_files
BEGIN UPDATE choirs SET storage_used_bytes = storage_used_bytes + NEW.size_bytes WHERE id = NEW.choir_id; END;

CREATE TRIGGER attachment_release_storage AFTER DELETE ON score_attachment_files WHEN OLD.purged_at IS NULL
BEGIN UPDATE choirs SET storage_used_bytes = MAX(0, storage_used_bytes - OLD.size_bytes) WHERE id = OLD.choir_id; END;

CREATE TRIGGER attachment_file_soft_delete AFTER UPDATE OF purged_at ON score_attachment_files WHEN OLD.purged_at IS NULL AND NEW.purged_at IS NOT NULL
BEGIN UPDATE choirs SET storage_used_bytes = MAX(0, storage_used_bytes - OLD.size_bytes) WHERE id = OLD.choir_id; END;

CREATE TRIGGER attachment_soft_delete AFTER UPDATE OF purged_at ON score_attachments WHEN OLD.purged_at IS NULL AND NEW.purged_at IS NOT NULL
BEGIN UPDATE score_attachment_files SET purged_at = NEW.purged_at WHERE attachment_id = NEW.id AND purged_at IS NULL; END;

CREATE TRIGGER score_attachment_soft_delete AFTER UPDATE OF purged_at ON scores WHEN OLD.purged_at IS NULL AND NEW.purged_at IS NOT NULL
BEGIN UPDATE score_attachments SET purged_at = NEW.purged_at WHERE score_id = NEW.id AND purged_at IS NULL; END;

CREATE TRIGGER attachment_current_file_guard BEFORE UPDATE OF current_file_id ON score_attachments WHEN NEW.current_file_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM score_attachment_files WHERE id = NEW.current_file_id AND attachment_id = NEW.id AND state = 'ready' AND purged_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'attachment_file_unavailable'); END;

CREATE TRIGGER attachment_replace_file AFTER UPDATE OF current_file_id ON score_attachments WHEN OLD.current_file_id IS NOT NULL AND OLD.current_file_id IS NOT NEW.current_file_id
BEGIN DELETE FROM score_attachment_files WHERE id = OLD.current_file_id; END;

CREATE TRIGGER attachment_touch_score_insert AFTER INSERT ON score_attachments WHEN NEW.kind = 'link'
BEGIN UPDATE scores SET updated_at = NEW.updated_at WHERE id = NEW.score_id; END;

CREATE TRIGGER attachment_touch_score_update AFTER UPDATE OF name, url, current_file_id, trashed_at ON score_attachments
BEGIN UPDATE scores SET updated_at = NEW.updated_at WHERE id = NEW.score_id AND purged_at IS NULL; END;

CREATE TRIGGER attachment_queue_object AFTER DELETE ON score_attachment_files
BEGIN
  INSERT INTO score_object_deletions (id, object_key, platform_bytes)
  VALUES (OLD.id, OLD.object_key, CASE WHEN EXISTS (SELECT 1 FROM choirs WHERE id = OLD.choir_id AND plan = 'free') THEN OLD.size_bytes ELSE 0 END)
  ON CONFLICT(object_key) DO UPDATE SET platform_bytes = MAX(platform_bytes, excluded.platform_bytes);
END;

CREATE TRIGGER drive_queue_physical_files BEFORE DELETE ON choirs WHEN OLD.plan = 'free'
BEGIN
  INSERT INTO score_object_deletions (id, object_key, platform_bytes)
  SELECT lower(hex(randomblob(16))), object_key, size_bytes FROM score_versions WHERE choir_id = OLD.id
  ON CONFLICT(object_key) DO UPDATE SET platform_bytes = MAX(platform_bytes, excluded.platform_bytes);
  INSERT INTO score_object_deletions (id, object_key, platform_bytes)
  SELECT id, object_key, size_bytes FROM score_attachment_files WHERE choir_id = OLD.id
  ON CONFLICT(object_key) DO UPDATE SET platform_bytes = MAX(platform_bytes, excluded.platform_bytes);
END;

CREATE VIEW free_file_storage_usage AS SELECT
  (SELECT COALESCE(sum(v.size_bytes), 0) FROM score_versions v JOIN choirs c ON c.id = v.choir_id WHERE c.plan = 'free') +
  (SELECT COALESCE(sum(f.size_bytes), 0) FROM score_attachment_files f JOIN choirs c ON c.id = f.choir_id WHERE c.plan = 'free') +
  (SELECT COALESCE(sum(d.platform_bytes), 0) FROM score_object_deletions d
    WHERE NOT EXISTS (SELECT 1 FROM score_versions WHERE object_key = d.object_key)
      AND NOT EXISTS (SELECT 1 FROM score_attachment_files WHERE object_key = d.object_key)) AS bytes;

CREATE TRIGGER free_platform_storage_guard BEFORE INSERT ON score_versions WHEN
  EXISTS (SELECT 1 FROM choirs WHERE id = NEW.choir_id AND plan = 'free') AND
  (SELECT bytes FROM free_file_storage_usage) + NEW.size_bytes > (SELECT retained_pdf_limit_bytes FROM drive_platform_limits WHERE id = 1)
BEGIN SELECT RAISE(ABORT, 'platform_storage_limit_reached'); END;

CREATE TRIGGER attachment_platform_storage_guard BEFORE INSERT ON score_attachment_files WHEN
  EXISTS (SELECT 1 FROM choirs WHERE id = NEW.choir_id AND plan = 'free') AND
  (SELECT bytes FROM free_file_storage_usage) + NEW.size_bytes > (SELECT retained_pdf_limit_bytes FROM drive_platform_limits WHERE id = 1)
BEGIN SELECT RAISE(ABORT, 'platform_storage_limit_reached'); END;

PRAGMA defer_foreign_keys = OFF;
