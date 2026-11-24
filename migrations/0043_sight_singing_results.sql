CREATE TABLE sight_singing_best_results (
  choir_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  membership_id TEXT NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  score_hundredths INTEGER NOT NULL CHECK (typeof(score_hundredths) = 'integer' AND score_hundredths BETWEEN 0 AND 10000),
  voice_id TEXT NOT NULL,
  voice_name TEXT NOT NULL,
  speed REAL NOT NULL CHECK (speed IN (0.5, 0.75, 1, 1.25, 1.5)),
  perfect INTEGER NOT NULL CHECK (perfect IN (0, 1)),
  written_octave INTEGER NOT NULL CHECK (written_octave IN (0, 1) AND written_octave <= perfect),
  achieved_order INTEGER NOT NULL,
  PRIMARY KEY (choir_id, question_id, version, membership_id, voice_id),
  FOREIGN KEY (choir_id, question_id, version)
    REFERENCES sight_singing_question_versions(choir_id, question_id, version) ON DELETE CASCADE
);

CREATE INDEX sight_singing_best_membership_idx ON sight_singing_best_results(membership_id);

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
