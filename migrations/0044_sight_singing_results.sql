CREATE TABLE sight_singing_results (
  choir_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  id TEXT NOT NULL,
  membership_id TEXT NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  voice_id TEXT NOT NULL,
  voice_name TEXT NOT NULL,
  PRIMARY KEY (choir_id, question_id, id),
  FOREIGN KEY (choir_id, question_id, version)
    REFERENCES sight_singing_question_versions(choir_id, question_id, version) ON DELETE CASCADE
);

CREATE INDEX sight_singing_results_version_idx ON sight_singing_results(choir_id, question_id, version);
CREATE INDEX sight_singing_results_membership_idx ON sight_singing_results(membership_id);
