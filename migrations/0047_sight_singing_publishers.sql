ALTER TABLE sight_singing_questions
  ADD COLUMN publication TEXT NOT NULL DEFAULT 'official' CHECK (publication IN ('official', 'member'));
ALTER TABLE sight_singing_questions
  ADD COLUMN publisher_membership_id TEXT REFERENCES memberships(id) ON DELETE SET NULL;
ALTER TABLE sight_singing_questions ADD COLUMN publisher_name TEXT;

CREATE INDEX sight_singing_questions_publisher_idx ON sight_singing_questions(publisher_membership_id);
