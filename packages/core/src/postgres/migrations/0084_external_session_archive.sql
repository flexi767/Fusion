ALTER TABLE central.external_session_details ADD COLUMN IF NOT EXISTS imported_metadata jsonb;
ALTER TABLE central.external_session_details ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
ALTER TABLE central.external_session_details ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;
ALTER TABLE central.external_session_details ADD COLUMN IF NOT EXISTS preferences_revision bigint NOT NULL DEFAULT 0;
