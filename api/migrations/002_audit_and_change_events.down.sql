DROP TABLE IF EXISTS change_events;
DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
DROP TABLE IF EXISTS audit_events;
DROP FUNCTION IF EXISTS audit_events_forbid_change();
