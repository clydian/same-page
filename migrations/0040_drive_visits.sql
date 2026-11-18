-- Additive only: no historical access can be inferred from existing timestamps.
ALTER TABLE choirs ADD COLUMN last_member_visit_at INTEGER;
CREATE TABLE drive_visit_collection (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  started_at INTEGER NOT NULL
);
INSERT INTO drive_visit_collection VALUES (1, CAST(unixepoch('subsecond') * 1000 AS INTEGER));
CREATE TABLE drive_member_visits (
  membership_id TEXT PRIMARY KEY REFERENCES memberships(id) ON DELETE CASCADE,
  choir_id TEXT NOT NULL REFERENCES choirs(id) ON DELETE CASCADE,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX drive_member_visits_drive_time ON drive_member_visits(choir_id, last_seen_at);
CREATE INDEX drive_member_visits_expiry ON drive_member_visits(last_seen_at);
CREATE TRIGGER drive_member_visit_insert AFTER INSERT ON drive_member_visits
BEGIN
  UPDATE choirs SET last_member_visit_at = MAX(COALESCE(last_member_visit_at, 0), NEW.last_seen_at) WHERE id = NEW.choir_id;
END;
CREATE TRIGGER drive_member_visit_update AFTER UPDATE OF last_seen_at ON drive_member_visits
BEGIN
  UPDATE choirs SET last_member_visit_at = MAX(COALESCE(last_member_visit_at, 0), NEW.last_seen_at) WHERE id = NEW.choir_id;
END;
