-- Use the winning take ID so a replacement by an older worker cannot
-- inherit the previous take's written-octave badge.
ALTER TABLE sight_singing_best_results ADD COLUMN written_octave_result_id TEXT;
