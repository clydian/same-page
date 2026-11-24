-- Match the marker to its winning take. An older worker can still replace
-- the row's result ID without inheriting the previous take's marker.
ALTER TABLE sight_singing_best_results ADD COLUMN all_notes_matched_result_id TEXT;
