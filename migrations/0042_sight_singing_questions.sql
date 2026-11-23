CREATE TABLE sight_singing_questions (
  choir_id TEXT NOT NULL REFERENCES choirs(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  score_id TEXT NOT NULL REFERENCES scores(id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL REFERENCES score_attachments(id) ON DELETE CASCADE,
  attachment_revision INTEGER NOT NULL CHECK (attachment_revision > 0),
  first_visit INTEGER NOT NULL CHECK (first_visit >= 0),
  last_visit INTEGER NOT NULL CHECK (last_visit >= first_visit),
  version INTEGER NOT NULL CHECK (version > 0),
  PRIMARY KEY (choir_id, id)
);
CREATE INDEX sight_singing_questions_attachment_idx ON sight_singing_questions(attachment_id);
CREATE INDEX sight_singing_questions_score_idx ON sight_singing_questions(score_id);
