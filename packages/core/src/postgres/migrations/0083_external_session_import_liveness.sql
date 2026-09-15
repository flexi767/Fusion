-- Historical records establish identity, not evidence of a connected collector.
ALTER TABLE central.session_collectors ALTER COLUMN last_heartbeat_at DROP NOT NULL;
