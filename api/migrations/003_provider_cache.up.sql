-- 003: shared cache for third-party responses (TMDB), so every API instance reuses
-- results and stale copies are available as a labelled fallback during an outage.
CREATE TABLE provider_cache (
  cache_key  text PRIMARY KEY,
  provider   text NOT NULL,
  value      jsonb NOT NULL,
  fetched_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX provider_cache_expires_idx ON provider_cache (expires_at);
