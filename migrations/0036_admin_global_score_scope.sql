-- Authorized product operators cover all current scores, independent of legacy
-- pilot records. Preserve those records, grants, contents, quota and audit data.
-- Recreate only the final atomic guard; old Workers remain compatible.
DROP TRIGGER xml_publication_guard;
CREATE TRIGGER xml_publication_guard BEFORE INSERT ON xml_publications BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM product_operators o JOIN session se ON se.user_id=o.user_id
    WHERE o.user_id=NEW.operator_id AND o.view_scores=1 AND o.review_xml=1 AND o.publish_xml=1
      AND se.id=NEW.session_id AND se.expires_at>NEW.created_at
      AND NOT EXISTS(SELECT 1 FROM user_lifecycle WHERE user_id=o.user_id)
  ) THEN RAISE(ABORT,'admin_access_revoked') END;
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM xml_candidates r JOIN scores s ON s.id=r.score_id AND s.choir_id=r.choir_id
    JOIN choirs c ON c.id=s.choir_id
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
