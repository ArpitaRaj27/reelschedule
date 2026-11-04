-- 002: append-only audit trail and the persisted change-event log used for live-update replay.
CREATE TABLE audit_events (
  id          bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_sub   text NOT NULL,                 -- subject from the validated token (no names or emails stored)
  via         text NOT NULL CHECK (via IN ('rest', 'mcp', 'system')),
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  request_id  text
);
CREATE INDEX audit_events_entity_idx ON audit_events (entity_type, entity_id, occurred_at);

CREATE FUNCTION audit_events_forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END
$$;
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_forbid_change();

-- Every published schedule change gets a monotonically increasing id.
-- SSE clients send Last-Event-ID on reconnect and the server replays rows with a larger id.
CREATE TABLE change_events (
  id           bigserial PRIMARY KEY,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  type         text NOT NULL,
  screening_id uuid,
  room_id      uuid,
  payload      jsonb NOT NULL
);
