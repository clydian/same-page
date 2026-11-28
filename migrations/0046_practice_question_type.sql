-- Legacy questions and their result versions remain sight-singing questions.
ALTER TABLE sight_singing_questions ADD COLUMN exercise_type TEXT NOT NULL DEFAULT 'sight-singing'
  CHECK (exercise_type IN ('sight-singing', 'rhythm'));

CREATE INDEX practice_questions_by_type ON sight_singing_questions(choir_id, exercise_type, title, id);
