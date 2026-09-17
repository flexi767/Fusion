CREATE TABLE IF NOT EXISTS central.external_session_collectors (
  host_id text PRIMARY KEY,
  collector_version text NOT NULL,
  last_heartbeat_at text,
  last_acknowledgement_at text NOT NULL,
  accepted_deliveries bigint NOT NULL DEFAULT 0,
  session_count integer NOT NULL DEFAULT 0,
  stream_count integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS central.external_session_streams (
  host_id text NOT NULL,
  stream_id text NOT NULL,
  acknowledged_sequence bigint NOT NULL CHECK (acknowledged_sequence > 0),
  PRIMARY KEY (host_id, stream_id)
);
CREATE TABLE IF NOT EXISTS central.external_sessions (
  id text PRIMARY KEY,
  host_id text NOT NULL,
  provider text NOT NULL,
  native_session_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision >= 0),
  observation jsonb NOT NULL,
  observation_hash text NOT NULL,
  received_at text NOT NULL,
  UNIQUE (host_id, provider, native_session_id)
);
CREATE INDEX IF NOT EXISTS idx_external_sessions_host_provider ON central.external_sessions (host_id, provider, id);
CREATE TABLE IF NOT EXISTS central.external_session_receipts (
  host_id text NOT NULL,
  event_id text NOT NULL,
  stream_id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  payload_hash text NOT NULL,
  acknowledgement jsonb NOT NULL,
  received_at text NOT NULL,
  PRIMARY KEY (host_id, event_id),
  UNIQUE (host_id, stream_id, sequence)
);
