ALTER TABLE central.external_session_details ADD COLUMN IF NOT EXISTS task_link_source text;
ALTER TABLE central.external_session_details ADD COLUMN IF NOT EXISTS native_runtime jsonb;
UPDATE central.external_session_details SET task_link_source='explicit' WHERE task_id IS NOT NULL AND task_link_source IS NULL;
ALTER TABLE central.external_session_commands ADD COLUMN IF NOT EXISTS controller text NOT NULL DEFAULT 'host-adapter';
ALTER TABLE central.external_session_runtimes ADD COLUMN IF NOT EXISTS controller text NOT NULL DEFAULT 'host-adapter';
ALTER TABLE central.external_session_commands DROP CONSTRAINT IF EXISTS external_session_commands_status_check;
ALTER TABLE central.external_session_commands ADD CONSTRAINT external_session_commands_status_check CHECK(status IN ('queued','delivered','executing','applied','failed','expired'));
