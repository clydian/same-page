-- Closed by default: operational grants and pilot scopes are provisioned explicitly.
CREATE TABLE product_operators (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  view_scores INTEGER NOT NULL DEFAULT 1 CHECK(view_scores IN (0,1)),
  review_xml INTEGER NOT NULL DEFAULT 1 CHECK(review_xml IN (0,1)),
  publish_xml INTEGER NOT NULL DEFAULT 0 CHECK(publish_xml IN (0,1))
);
CREATE TABLE product_admin_drives (
  choir_id TEXT PRIMARY KEY REFERENCES choirs(id) ON DELETE CASCADE
);
CREATE TABLE product_admin_limits (id INTEGER PRIMARY KEY CHECK(id=1), storage_limit_bytes INTEGER NOT NULL CHECK(storage_limit_bytes>0));
INSERT INTO product_admin_limits VALUES(1,1073741824);
CREATE TABLE xml_candidates (
  id TEXT PRIMARY KEY, choir_id TEXT NOT NULL REFERENCES choirs(id) ON DELETE CASCADE,
  score_id TEXT NOT NULL REFERENCES scores(id) ON DELETE CASCADE,
  source_version_id TEXT NOT NULL REFERENCES score_versions(id) ON DELETE CASCADE,
  source_sha256 TEXT NOT NULL, name TEXT NOT NULL, size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 20971520),
  sha256 TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE, etag TEXT,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready','failed')),
  tool TEXT NOT NULL DEFAULT '', parameters TEXT NOT NULL DEFAULT '',
  imported_by TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  review TEXT NOT NULL DEFAULT 'pending' CHECK(review IN ('pending','approved','rejected')),
  review_revision INTEGER NOT NULL DEFAULT 0, reviewed_by TEXT, reviewed_at INTEGER,
  review_note TEXT NOT NULL DEFAULT '', technical_passed INTEGER NOT NULL DEFAULT 0 CHECK(technical_passed IN (0,1))
);
CREATE INDEX xml_candidates_score ON xml_candidates(score_id, created_at DESC, id);
CREATE INDEX xml_candidates_expiry ON xml_candidates(expires_at);
CREATE TABLE xml_publish_staging (id TEXT PRIMARY KEY, object_key TEXT NOT NULL UNIQUE, size_bytes INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TRIGGER xml_candidate_capacity BEFORE INSERT ON xml_candidates WHEN
  NEW.size_bytes + (SELECT COALESCE(sum(size_bytes),0) FROM xml_candidates) + (SELECT COALESCE(sum(size_bytes),0) FROM xml_publish_staging) > (SELECT storage_limit_bytes FROM product_admin_limits WHERE id=1)
BEGIN SELECT RAISE(ABORT,'admin_storage_limit_reached'); END;
CREATE TRIGGER xml_staging_capacity BEFORE INSERT ON xml_publish_staging WHEN
  NEW.size_bytes + (SELECT COALESCE(sum(size_bytes),0) FROM xml_candidates) + (SELECT COALESCE(sum(size_bytes),0) FROM xml_publish_staging) > (SELECT storage_limit_bytes FROM product_admin_limits WHERE id=1)
BEGIN SELECT RAISE(ABORT,'admin_storage_limit_reached'); END;
CREATE TRIGGER xml_candidate_delete AFTER DELETE ON xml_candidates BEGIN
  INSERT INTO score_object_deletions(id,object_key,platform_bytes) VALUES(OLD.id,OLD.object_key,0)
  ON CONFLICT(object_key) DO UPDATE SET id=excluded.id;
END;
CREATE TRIGGER xml_staging_delete AFTER DELETE ON xml_publish_staging
WHEN NOT EXISTS(SELECT 1 FROM score_attachment_files WHERE object_key=OLD.object_key)
BEGIN
  INSERT INTO score_object_deletions(id,object_key,platform_bytes) VALUES(OLD.id,OLD.object_key,0)
  ON CONFLICT(object_key) DO UPDATE SET id=excluded.id;
END;
ALTER TABLE score_attachments ADD COLUMN source_pdf_version_id TEXT;
CREATE TABLE xml_publications (
  id TEXT PRIMARY KEY, candidate_id TEXT REFERENCES xml_candidates(id) ON DELETE SET NULL,
  choir_id TEXT NOT NULL, score_id TEXT NOT NULL, source_version_id TEXT NOT NULL,
  operator_id TEXT NOT NULL, session_id TEXT NOT NULL, attachment_id TEXT NOT NULL,
  expected_attachment_revision INTEGER NOT NULL, expected_review_revision INTEGER NOT NULL,
  file_id TEXT NOT NULL, etag TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE product_admin_audit (
  id TEXT PRIMARY KEY, operator_id TEXT NOT NULL, choir_id TEXT, score_id TEXT, candidate_id TEXT,
  action TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX product_admin_audit_time ON product_admin_audit(created_at DESC,id);
-- One SQL statement owns authorization, freshness, user choice, review CAS,
-- attachment quota, pointer update, staging consumption and durable publication.
CREATE TRIGGER xml_publication_guard BEFORE INSERT ON xml_publications BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM product_operators o JOIN session se ON se.user_id=o.user_id
    WHERE o.user_id=NEW.operator_id AND o.view_scores=1 AND o.review_xml=1 AND o.publish_xml=1
      AND se.id=NEW.session_id AND se.expires_at>NEW.created_at
      AND NOT EXISTS(SELECT 1 FROM user_lifecycle WHERE user_id=o.user_id)
  ) THEN RAISE(ABORT,'admin_access_revoked') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM xml_candidates r JOIN scores s ON s.id=r.score_id AND s.choir_id=r.choir_id
    JOIN choirs c ON c.id=s.choir_id JOIN product_admin_drives d ON d.choir_id=c.id
    JOIN score_versions v ON v.id=r.source_version_id AND v.score_id=s.id AND v.choir_id=c.id
    WHERE r.id=NEW.candidate_id AND r.choir_id=NEW.choir_id AND r.score_id=NEW.score_id
      AND r.source_version_id=NEW.source_version_id AND r.state='ready' AND r.expires_at>NEW.created_at
      AND r.review='approved' AND r.technical_passed=1 AND r.review_revision=NEW.expected_review_revision
      AND s.current_version_id=r.source_version_id AND s.generated_xml_disabled=0
      AND s.trashed_at IS NULL AND s.purged_at IS NULL AND c.purged_at IS NULL
      AND v.purged_at IS NULL AND v.state='ready' AND v.sha256=r.source_sha256
  ) THEN RAISE(ABORT,'xml_publication_conflict') END;
  SELECT CASE WHEN (NEW.expected_attachment_revision=0 AND EXISTS(
    SELECT 1 FROM score_attachments WHERE score_id=NEW.score_id AND source='generated' AND purged_at IS NULL
  )) OR (NEW.expected_attachment_revision<>0 AND NOT EXISTS(
    SELECT 1 FROM score_attachments WHERE id=NEW.attachment_id AND score_id=NEW.score_id AND choir_id=NEW.choir_id
      AND source='generated' AND revision=NEW.expected_attachment_revision AND trashed_at IS NULL AND purged_at IS NULL
  )) THEN RAISE(ABORT,'attachment_conflict') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM xml_publish_staging WHERE id=NEW.file_id)
    THEN RAISE(ABORT,'xml_publication_conflict') END;
END;
CREATE TRIGGER xml_publication_commit AFTER INSERT ON xml_publications BEGIN
  INSERT INTO score_attachments(id,choir_id,score_id,kind,name,source,created_at,updated_at)
    SELECT NEW.attachment_id,NEW.choir_id,NEW.score_id,'musicxml',r.name,'generated',NEW.created_at,NEW.created_at
    FROM xml_candidates r WHERE r.id=NEW.candidate_id AND NEW.expected_attachment_revision=0;
  INSERT INTO score_attachment_files(id,attachment_id,choir_id,object_key,size_bytes,content_type,state,etag,created_at)
    SELECT NEW.file_id,NEW.attachment_id,NEW.choir_id,st.object_key,st.size_bytes,
      CASE WHEN lower(r.name) LIKE '%.mxl' THEN 'application/vnd.recordare.musicxml' ELSE 'application/vnd.recordare.musicxml+xml' END,
      'ready',NEW.etag,NEW.created_at FROM xml_publish_staging st JOIN xml_candidates r ON r.id=NEW.candidate_id WHERE st.id=NEW.file_id;
  UPDATE score_attachments SET current_file_id=NEW.file_id,
    name=(SELECT name FROM xml_candidates WHERE id=NEW.candidate_id),
    source_pdf_version_id=NEW.source_version_id,revision=revision+CASE WHEN NEW.expected_attachment_revision=0 THEN 0 ELSE 1 END,
    updated_at=NEW.created_at WHERE id=NEW.attachment_id;
  DELETE FROM xml_publish_staging WHERE id=NEW.file_id;
  INSERT INTO product_admin_audit(id,operator_id,choir_id,score_id,candidate_id,action,created_at)
    VALUES(NEW.id,NEW.operator_id,NEW.choir_id,NEW.score_id,NEW.candidate_id,'publish',NEW.created_at);
END;
-- File identity/provenance are immutable; review changes remain revisioned.
CREATE TRIGGER xml_candidate_immutable BEFORE UPDATE OF choir_id,score_id,source_version_id,source_sha256,name,size_bytes,sha256,object_key,tool,parameters,imported_by,created_at ON xml_candidates
BEGIN SELECT RAISE(ABORT,'candidate_immutable'); END;
CREATE TRIGGER xml_candidate_state_audit AFTER UPDATE OF state ON xml_candidates WHEN NEW.state<>OLD.state AND NEW.state IN ('ready','failed') BEGIN
  INSERT INTO product_admin_audit(id,operator_id,choir_id,score_id,candidate_id,action,created_at)
  VALUES(lower(hex(randomblob(16))),NEW.imported_by,NEW.choir_id,NEW.score_id,NEW.id,CASE WHEN NEW.state='ready' THEN 'import' ELSE 'import-failed' END,cast(unixepoch('subsecond')*1000 AS INTEGER));
END;
CREATE TRIGGER xml_candidate_review_audit AFTER UPDATE OF review_revision ON xml_candidates WHEN NEW.review_revision<>OLD.review_revision BEGIN
  INSERT INTO product_admin_audit(id,operator_id,choir_id,score_id,candidate_id,action,created_at)
  VALUES(lower(hex(randomblob(16))),NEW.reviewed_by,NEW.choir_id,NEW.score_id,NEW.id,NEW.review,NEW.reviewed_at);
END;
