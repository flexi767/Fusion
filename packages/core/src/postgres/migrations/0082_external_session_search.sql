-- Search the collected historical text, never the host filesystem.
CREATE INDEX IF NOT EXISTS external_session_turns_search
ON central.external_session_turns USING gin (jsonb_to_tsvector('simple', result, '["string"]'::jsonb));
CREATE INDEX IF NOT EXISTS external_sessions_search
ON central.external_sessions USING gin (jsonb_to_tsvector('simple', observation, '["string"]'::jsonb));
