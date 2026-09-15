ALTER TABLE central.external_session_details ADD COLUMN IF NOT EXISTS task_project_id text;
ALTER TABLE central.external_session_details ADD COLUMN IF NOT EXISTS task_id text;
ALTER TABLE central.external_session_details ADD COLUMN IF NOT EXISTS task_link_revision bigint NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS external_session_task_link ON central.external_session_details(task_project_id, task_id);
