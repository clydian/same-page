-- Older results have no exact scoring evidence, so their badge is inferred only from their original flags.
ALTER TABLE sight_singing_best_results ADD COLUMN badge INTEGER CHECK (badge IS NULL OR badge IN (1, 4, 5));

-- A removed question cascades to its editions, results and receipts. Release each
-- copied score only after its last reference; its existing trigger handles R2 cleanup.
CREATE TRIGGER sight_singing_version_release_snapshot AFTER DELETE ON sight_singing_question_versions
BEGIN
  DELETE FROM sight_singing_score_snapshots
  WHERE choir_id = OLD.choir_id AND id = OLD.snapshot_id AND NOT EXISTS (
    SELECT 1 FROM sight_singing_question_versions WHERE choir_id = OLD.choir_id AND snapshot_id = OLD.snapshot_id
  );
END;
