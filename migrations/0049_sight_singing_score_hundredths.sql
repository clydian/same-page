-- Existing attempts were recorded as whole points. Older workers can still
-- write the integer field while newer workers retain the full precision.
ALTER TABLE sight_singing_best_results ADD COLUMN score_hundredths INTEGER
  CHECK (score_hundredths IS NULL OR (typeof(score_hundredths) = 'integer' AND score_hundredths BETWEEN 0 AND 10000));

CREATE TRIGGER sight_singing_clear_stale_score_hundredths
AFTER UPDATE OF score ON sight_singing_best_results
WHEN NEW.score <> OLD.score AND NEW.score_hundredths IS OLD.score_hundredths AND OLD.score_hundredths IS NOT NULL
BEGIN
  UPDATE sight_singing_best_results SET score_hundredths = NULL WHERE rowid = NEW.rowid;
END;
