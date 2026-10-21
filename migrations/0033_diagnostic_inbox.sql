-- Independent grants: existing drive owners and XML operators gain no access.
CREATE TABLE diagnostic_operators (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  can_delete INTEGER NOT NULL DEFAULT 0 CHECK(can_delete IN (0,1))
);
-- UUID only, no report content or identity; prevents deleted reports being retried into existence.
CREATE TABLE diagnostic_report_tombstones (id TEXT PRIMARY KEY NOT NULL);
-- Old in-flight Workers and code rollbacks may still use the original INSERT.
-- Enforce deletion in the database as well as in the current API.
CREATE TRIGGER diagnostic_reports_prevent_resurrection BEFORE INSERT ON diagnostic_reports
WHEN EXISTS(SELECT 1 FROM diagnostic_report_tombstones WHERE id=NEW.id)
BEGIN SELECT RAISE(IGNORE); END;
CREATE TABLE diagnostic_report_audit (
  id TEXT PRIMARY KEY NOT NULL,
  operator_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  report_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('new','investigating','resolved','delete')),
  created_at INTEGER NOT NULL
);
CREATE INDEX diagnostic_report_audit_time ON diagnostic_report_audit(created_at);
-- Existing reports deliberately retain their original expires_at (30-day promise).
