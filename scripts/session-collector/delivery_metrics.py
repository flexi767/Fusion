"""Bounded local ACK samples; never retain prompts, paths or credentials."""
import math

WINDOW_SECONDS = 24 * 60 * 60
MAX_SAMPLES = 10_000


def initialize(db):
    columns={row[1] for row in db.execute('PRAGMA table_info(pending)')}
    if 'enqueued_at' not in columns:db.execute('ALTER TABLE pending ADD COLUMN enqueued_at REAL')
    if 'lag_eligible' not in columns:db.execute('ALTER TABLE pending ADD COLUMN lag_eligible INTEGER NOT NULL DEFAULT 0')
    db.executescript('''
      CREATE TABLE IF NOT EXISTS delivery_samples(id INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT UNIQUE,ack_at REAL NOT NULL,lag_ms INTEGER,queue_ms INTEGER);
      CREATE INDEX IF NOT EXISTS delivery_samples_ack ON delivery_samples(ack_at);
    ''')


def record(db,event_id,event_at,enqueued_at,ack_at):
    # Eligibility is fixed at enqueue, before queue ageing and network outages.
    skew=ack_at < enqueued_at or enqueued_at < event_at
    db.execute('INSERT OR IGNORE INTO delivery_samples(event_id,ack_at,lag_ms,queue_ms) VALUES (?,?,?,?)',
        (event_id,ack_at,None if skew else round((ack_at-event_at)*1000),None if skew else round((ack_at-enqueued_at)*1000)))
    db.execute('DELETE FROM delivery_samples WHERE ack_at<?',(ack_at-WINDOW_SECONDS,))
    db.execute('DELETE FROM delivery_samples WHERE id <= coalesce((SELECT id FROM delivery_samples ORDER BY id DESC LIMIT 1 OFFSET ?),-1)',(MAX_SAMPLES,))


def diagnostics(db,now):
    rows=db.execute('SELECT lag_ms,queue_ms FROM delivery_samples WHERE ack_at>=? AND ack_at<=? ORDER BY id DESC LIMIT ?',
                    (now-WINDOW_SECONDS,now,MAX_SAMPLES)).fetchall()
    lags=sorted(row[0] for row in rows if row[0] is not None)
    queues=sorted(row[1] for row in rows if row[1] is not None)
    result=dict(liveLagSamples=len(lags),liveLagClockSkewSamples=len(rows)-len(lags))
    if lags:
        result.update(liveLagP95Ms=lags[math.ceil(len(lags)*.95)-1],liveLagMaxMs=lags[-1],liveQueueP95Ms=queues[math.ceil(len(queues)*.95)-1])
    oldest=db.execute('SELECT min(enqueued_at) FROM pending WHERE lag_eligible=1 AND rejection IS NULL').fetchone()[0]
    if oldest is not None and oldest<=now:result['oldestLivePendingMs']=round((now-oldest)*1000)
    return result
