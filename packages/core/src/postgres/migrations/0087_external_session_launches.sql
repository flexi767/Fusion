CREATE TABLE IF NOT EXISTS central.external_session_launch_runtimes (
  host_id text NOT NULL, project_id text NOT NULL, generation text NOT NULL,
  project_path text NOT NULL, expires_at text NOT NULL,
  PRIMARY KEY(host_id, project_id)
);
CREATE TABLE IF NOT EXISTS central.external_session_launches (
  id text PRIMARY KEY, host_id text NOT NULL, project_id text NOT NULL,
  generation text NOT NULL, prompt text NOT NULL, model text,
  status text NOT NULL CHECK(status IN ('queued','starting','started','failed','cancelled','expired')),
  cli_session_id text, failure text, created_at text NOT NULL, expires_at text NOT NULL, updated_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS external_session_launches_host_queue ON central.external_session_launches(host_id,project_id,status,created_at);
