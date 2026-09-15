CREATE TABLE IF NOT EXISTS central.external_session_details (
  session_id text PRIMARY KEY REFERENCES central.external_sessions(id) ON DELETE CASCADE,
  notes text NOT NULL DEFAULT '',
  notes_revision bigint NOT NULL DEFAULT 0,
  summary jsonb,
  summary_hash text,
  summary_lease_until text,
  summary_retry_at text,
  summary_failures integer NOT NULL DEFAULT 0,
  last_summary_error text
);
CREATE TABLE IF NOT EXISTS central.external_session_commands (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES central.external_sessions(id) ON DELETE CASCADE,
  host_id text NOT NULL,
  native_session_id text NOT NULL,
  generation text NOT NULL,
  operation text NOT NULL CHECK(operation IN ('feedback','stop','resume')),
  text text,
  status text NOT NULL CHECK(status IN ('queued','delivered','applied','failed','expired')),
  created_at text NOT NULL,
  expires_at text NOT NULL,
  updated_at text NOT NULL,
  failure text
);
CREATE INDEX IF NOT EXISTS external_session_commands_host_queue ON central.external_session_commands(host_id, status, created_at);
CREATE TABLE IF NOT EXISTS central.external_session_runtimes (
  session_id text PRIMARY KEY REFERENCES central.external_sessions(id) ON DELETE CASCADE,
  generation text NOT NULL,
  capabilities jsonb NOT NULL,
  expires_at text NOT NULL
);
