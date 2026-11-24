CREATE TABLE sight_singing_best_results_next (
  choir_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  membership_id TEXT NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  scoring_rule INTEGER NOT NULL CHECK (scoring_rule IN (1, 2)),
  id TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  voice_id TEXT NOT NULL,
  voice_name TEXT NOT NULL,
  speed REAL CHECK (speed IN (0.5, 0.75, 1, 1.25, 1.5)),
  achieved_order INTEGER NOT NULL,
  PRIMARY KEY (choir_id, question_id, scoring_rule, version, membership_id),
  FOREIGN KEY (choir_id, question_id, version)
    REFERENCES sight_singing_question_versions(choir_id, question_id, version) ON DELETE CASCADE
);

INSERT INTO sight_singing_best_results_next
  (choir_id, question_id, version, membership_id, scoring_rule, id, score, voice_id, voice_name, speed, achieved_order)
SELECT choir_id, question_id, version, membership_id, 1, id, score, voice_id, voice_name, speed, achieved_order
FROM sight_singing_best_results;

DROP TABLE sight_singing_best_results;
ALTER TABLE sight_singing_best_results_next RENAME TO sight_singing_best_results;
CREATE INDEX sight_singing_best_membership_idx ON sight_singing_best_results(membership_id);
