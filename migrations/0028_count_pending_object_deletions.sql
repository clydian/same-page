-- Keep physical free-plan usage until R2 deletion succeeds. The existing
-- deletion queue remains backward compatible with callers that omit this field.
ALTER TABLE score_object_deletions ADD COLUMN platform_bytes INTEGER NOT NULL DEFAULT 0 CHECK (platform_bytes >= 0);

DROP TRIGGER attachment_queue_object;
CREATE TRIGGER attachment_queue_object AFTER DELETE ON score_attachment_files
BEGIN
  INSERT INTO score_object_deletions (id, object_key, platform_bytes)
  VALUES (OLD.id, OLD.object_key, CASE WHEN EXISTS (SELECT 1 FROM choirs WHERE id = OLD.choir_id AND plan = 'free') THEN OLD.size_bytes ELSE 0 END)
  ON CONFLICT(object_key) DO UPDATE SET platform_bytes = MAX(platform_bytes, excluded.platform_bytes);
END;
DROP TRIGGER score_versions_queue_object_delete;
CREATE TRIGGER score_versions_queue_object_delete AFTER DELETE ON score_versions
BEGIN
  INSERT INTO score_object_deletions (id, object_key, platform_bytes)
  VALUES (lower(hex(randomblob(16))), OLD.object_key, CASE WHEN EXISTS (SELECT 1 FROM choirs WHERE id = OLD.choir_id AND plan = 'free') THEN OLD.size_bytes ELSE 0 END)
  ON CONFLICT(object_key) DO UPDATE SET platform_bytes = MAX(platform_bytes, excluded.platform_bytes);
END;
-- Capture the plan before ON DELETE CASCADE removes the parent drive row.
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

DROP TRIGGER free_platform_storage_guard;
CREATE TRIGGER free_platform_storage_guard BEFORE INSERT ON score_versions WHEN
  EXISTS (SELECT 1 FROM choirs WHERE id = NEW.choir_id AND plan = 'free') AND
  (SELECT bytes FROM free_file_storage_usage) + NEW.size_bytes > (SELECT retained_pdf_limit_bytes FROM drive_platform_limits WHERE id = 1)
BEGIN SELECT RAISE(ABORT, 'platform_storage_limit_reached'); END;
DROP TRIGGER attachment_platform_storage_guard;
CREATE TRIGGER attachment_platform_storage_guard BEFORE INSERT ON score_attachment_files WHEN
  EXISTS (SELECT 1 FROM choirs WHERE id = NEW.choir_id AND plan = 'free') AND
  (SELECT bytes FROM free_file_storage_usage) + NEW.size_bytes > (SELECT retained_pdf_limit_bytes FROM drive_platform_limits WHERE id = 1)
BEGIN SELECT RAISE(ABORT, 'platform_storage_limit_reached'); END;
