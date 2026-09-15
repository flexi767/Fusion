-- Observations are global host identities, deliberately outside task lifecycle tables.
CREATE TABLE IF NOT EXISTS central.session_collectors (
  host_id text PRIMARY KEY,
  collector_version text NOT NULL,
  last_heartbeat_at text NOT NULL,
  last_acknowledgement_at text,
  diagnostics jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS central.external_sessions (
  id text PRIMARY KEY,
  host_id text NOT NULL REFERENCES central.session_collectors(host_id),
  provider text NOT NULL CHECK (provider IN ('codex', 'claude')),
  native_session_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision >= 0),
  observation jsonb NOT NULL,
  received_at text NOT NULL,
  UNIQUE (host_id, provider, native_session_id)
);
CREATE INDEX IF NOT EXISTS external_sessions_recency ON central.external_sessions(received_at DESC, id);
CREATE INDEX IF NOT EXISTS external_sessions_host ON central.external_sessions(host_id, provider);
