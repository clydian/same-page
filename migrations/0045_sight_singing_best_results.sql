CREATE TABLE sight_singing_best_results (
  choir_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  membership_id TEXT NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  voice_id TEXT NOT NULL,
  voice_name TEXT NOT NULL,
  speed REAL CHECK (speed IN (0.5, 0.75, 1, 1.25, 1.5)),
  achieved_order INTEGER NOT NULL,
  PRIMARY KEY (choir_id, question_id, version, membership_id),
  FOREIGN KEY (choir_id, question_id, version)
    REFERENCES sight_singing_question_versions(choir_id, question_id, version) ON DELETE CASCADE
);

CREATE INDEX sight_singing_best_membership_idx ON sight_singing_best_results(membership_id);

INSERT INTO sight_singing_best_results
    (choir_id, question_id, version, membership_id, id, score, voice_id, voice_name, achieved_order)
SELECT choir_id, question_id, version, membership_id, id, score, voice_id, voice_name, achieved_order
FROM (
  SELECT *, rowid - (SELECT COALESCE(MAX(rowid), 0) FROM sight_singing_results) - 1 AS achieved_order,
    ROW_NUMBER() OVER (PARTITION BY choir_id, question_id, version, membership_id ORDER BY score DESC, rowid) AS position
  FROM sight_singing_results
)
WHERE position = 1;

-- Keep deduplication after a withdrawal without storing discarded submissions.
CREATE TABLE sight_singing_result_receipts (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  choir_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  membership_id TEXT NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  claim TEXT NOT NULL,
  UNIQUE (choir_id, question_id, id),
  FOREIGN KEY (choir_id, question_id, version)
    REFERENCES sight_singing_question_versions(choir_id, question_id, version) ON DELETE CASCADE
);

CREATE INDEX sight_singing_receipt_membership_idx ON sight_singing_result_receipts(membership_id);
