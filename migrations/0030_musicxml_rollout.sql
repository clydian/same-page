-- Controlled per-drive release. Existing files stay readable when uploads/playback UI are disabled.
ALTER TABLE choirs ADD COLUMN musicxml_enabled INTEGER NOT NULL DEFAULT 0 CHECK (musicxml_enabled IN (0, 1));
