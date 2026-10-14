-- Additive rollout: preserve version IDs, objects, quota, and legacy APIs.
ALTER TABLE score_versions ADD COLUMN replaced_file_name TEXT;
ALTER TABLE score_versions ADD COLUMN replaced_at INTEGER;
ALTER TABLE score_versions ADD COLUMN replaced_from_score_id TEXT;
ALTER TABLE scores ADD COLUMN generated_xml_disabled INTEGER NOT NULL DEFAULT 0 CHECK (generated_xml_disabled IN (0, 1));
ALTER TABLE score_attachments ADD COLUMN source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'generated'));

-- Existing retained PDFs become recoverable files without restarting retention.
UPDATE score_versions SET
  replaced_file_name = (SELECT file_name FROM scores WHERE id = score_versions.score_id),
  replaced_at = retention_expires_at - 2592000000, replaced_from_score_id = score_id
WHERE state = 'ready' AND candidate_expires_at IS NULL AND retention_expires_at IS NOT NULL;

CREATE UNIQUE INDEX score_generated_xml_slot ON score_attachments(score_id)
WHERE source = 'generated' AND purged_at IS NULL;
CREATE TRIGGER generated_xml_kind_insert BEFORE INSERT ON score_attachments
WHEN NEW.source = 'generated' AND (NEW.kind <> 'musicxml' OR EXISTS (
  SELECT 1 FROM scores WHERE id = NEW.score_id AND generated_xml_disabled = 1))
BEGIN SELECT RAISE(ABORT, 'generated_xml_unavailable'); END;
CREATE TRIGGER attachment_source_immutable BEFORE UPDATE OF source ON score_attachments
WHEN NEW.source <> OLD.source
BEGIN SELECT RAISE(ABORT, 'attachment_source_immutable'); END;
-- User removal survives cleanup, so a later generation does not undo it.
CREATE TRIGGER generated_xml_trash_choice AFTER UPDATE OF trashed_at ON score_attachments
WHEN NEW.source = 'generated'
BEGIN UPDATE scores SET generated_xml_disabled = CASE WHEN NEW.trashed_at IS NULL THEN 0 ELSE 1 END WHERE id = NEW.score_id; END;

DROP TRIGGER scores_publish_version;
CREATE TRIGGER scores_publish_version
AFTER UPDATE OF current_version_id ON scores
WHEN OLD.current_version_id IS NOT NULL AND NEW.current_version_id <> OLD.current_version_id
BEGIN
  UPDATE scores SET version_revision = OLD.version_revision + 1 WHERE id = NEW.id;
  UPDATE score_versions SET retention_expires_at = NEW.updated_at + 2592000000,
    replaced_file_name = OLD.file_name, replaced_at = NEW.updated_at, replaced_from_score_id = OLD.id WHERE id = OLD.current_version_id;
  UPDATE score_versions SET retention_expires_at = NULL, candidate_expires_at = NULL,
    replaced_file_name = NULL, replaced_at = NULL, replaced_from_score_id = NULL WHERE id = NEW.current_version_id;
  UPDATE score_attachments SET trashed_at = NEW.updated_at, trash_expires_at = NEW.updated_at + 2592000000,
    revision = revision + 1, updated_at = NEW.updated_at
  WHERE score_id = NEW.id AND source = 'generated' AND trashed_at IS NULL AND purged_at IS NULL
    AND NEW.generated_xml_disabled = 1;
END;
