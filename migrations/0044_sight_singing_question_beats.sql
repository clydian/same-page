ALTER TABLE sight_singing_question_versions ADD COLUMN first_beat INTEGER
  CHECK (first_beat IS NULL OR (typeof(first_beat) = 'integer' AND first_beat >= 1));
ALTER TABLE sight_singing_question_versions ADD COLUMN last_beat INTEGER
  CHECK (last_beat IS NULL OR (typeof(last_beat) = 'integer' AND last_beat >= 1
    AND (first_visit < last_visit OR last_beat >= COALESCE(first_beat, 1))));
