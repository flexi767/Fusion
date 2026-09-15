CREATE TABLE IF NOT EXISTS central.external_session_turns (
  session_id text NOT NULL REFERENCES central.external_sessions(id) ON DELETE CASCADE,
  id text NOT NULL,
  revision bigint NOT NULL,
  started_at text NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY (session_id, id)
);
CREATE INDEX IF NOT EXISTS external_session_turns_history ON central.external_session_turns(session_id, started_at DESC, id);
