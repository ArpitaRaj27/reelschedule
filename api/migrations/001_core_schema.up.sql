-- 001: venues, rooms, film references and screenings.
-- btree_gist lets one exclusion constraint combine "same room" (=) with "time ranges overlap" (&&).
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE venues (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  city text NOT NULL
);

CREATE TABLE rooms (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
  name     text NOT NULL,
  seats    integer NOT NULL CHECK (seats > 0),
  UNIQUE (venue_id, name)
);

-- Reference metadata. Rows from TMDB keep their tmdb_id; synthetic rows exist for local/offline work.
-- runtime_minutes may be NULL: a missing runtime is a validation problem at scheduling time, never "0".
CREATE TABLE film_references (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source          text NOT NULL CHECK (source IN ('tmdb', 'synthetic')),
  tmdb_id         integer UNIQUE,
  title           text NOT NULL,
  runtime_minutes integer CHECK (runtime_minutes IS NULL OR runtime_minutes > 0),
  genres          text[] NOT NULL DEFAULT '{}',
  release_year    integer,
  poster_path     text,
  fetched_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (source <> 'tmdb' OR tmdb_id IS NOT NULL)
);

CREATE TYPE screening_status AS ENUM ('scheduled', 'canceled');

CREATE TABLE screenings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  film_id         uuid NOT NULL REFERENCES film_references(id) ON DELETE RESTRICT,
  room_id         uuid NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  starts_at       timestamptz NOT NULL,
  -- Snapshot of the runtime used when the screening was scheduled, so a later
  -- metadata change at the provider cannot silently move an approved schedule.
  runtime_minutes integer NOT NULL CHECK (runtime_minutes > 0),
  buffer_minutes  integer NOT NULL CHECK (buffer_minutes BETWEEN 0 AND 120),
  ends_at         timestamptz NOT NULL,  -- starts_at + runtime (when the film ends)
  occupied_until  timestamptz NOT NULL,  -- ends_at + turnaround buffer (when the room is free)
  status          screening_status NOT NULL DEFAULT 'scheduled',
  version         integer NOT NULL DEFAULT 1,   -- optimistic concurrency token
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT screenings_end_matches_runtime CHECK (ends_at = starts_at + make_interval(mins => runtime_minutes)),
  CONSTRAINT screenings_occupied_matches_buffer CHECK (occupied_until = ends_at + make_interval(mins => buffer_minutes)),
  -- The database itself rejects two scheduled screenings whose [start, occupied_until)
  -- ranges overlap in the same room. Half-open ranges allow a 20:00 start right after
  -- a screening occupying the room until 20:00. Canceled screenings free the slot.
  CONSTRAINT screenings_no_overlap EXCLUDE USING gist (
    room_id WITH =,
    tstzrange(starts_at, occupied_until, '[)') WITH &&
  ) WHERE (status = 'scheduled')
);

-- Justified index: the public catalog filters by date range and status and orders by start time.
CREATE INDEX screenings_start_status_idx ON screenings (starts_at, status);
-- Room schedule pages list one room's screenings in start order.
CREATE INDEX screenings_room_start_idx ON screenings (room_id, starts_at);
CREATE INDEX film_references_title_idx ON film_references (lower(title));
