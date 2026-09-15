#!/usr/bin/env python3
"""Independent, opt-in Fusion native transcript collector. No AgentPulse cursor is shared."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import sqlite3
import time
import urllib.request
import urllib.error
import uuid
from datetime import datetime
from turn_parser import consume, known, total, claude_turn_finished, bounded_text
import parser_ledger
import delivery_metrics
from opaque_records import ignored_header, scan_opaque_tail

VERSION = "fusion-native-11"
PARSER_VERSION = 4
CLAUDE_PARSER_VERSION = 5
LIVE_PARSER_VERSION = 1
MAX_READ = 1024 * 1024
MAX_LINE = 4 * MAX_READ
LIVE_TAIL = 256 * 1024
MAX_PARSER_STATE = 8 * 1024 * 1024
MAX_PARSER_BYTES = 1024 * 1024 * 1024
MAX_PARSER_RECORDS = 2_000_000
MAX_PENDING_BYTES = 128 * 1024 * 1024
LIVE_RESERVE_BYTES = 2 * 1024 * 1024
MAX_DELIVERY_BYTES = 1_500_000
MAX_PENDING_RECORDS = 5000
BACKGROUND_RECORD_LIMIT = 4500
LIVE_PRIORITY_SECONDS = 90


class CollectionCapacityError(ValueError):
    pass


def normalize_display(envelope):
    """Keep NUL visible without sending a forbidden binary character to the API."""
    if not envelope.get('turns'):return envelope
    turns=[]
    for original in envelope['turns']:
        turn={**original,'prompts':[value.replace('\0','␀') for value in original.get('prompts',[])],
              'response':original.get('response','').replace('\0','␀')}
        turn['files']=[{**file,'diff':file.get('diff','').replace('\0','␀'),
                        'truncated':file.get('truncated',False) or '\0' in file.get('diff','')} for file in original.get('files',[])]
        turns.append(turn)
    return {**envelope,'turns':turns}


def enqueue(db, envelope, live_key=None):
    envelope=normalize_display(envelope)
    if 'observation' in envelope:
        title=envelope['observation'].get('title','')
        title=' '.join(''.join(c if ord(c)>=32 else ' ' for c in title).split())
        envelope={**envelope,'observation':{**envelope['observation'],'title':bounded_text(title,512) or 'External session'}}
    body = json.dumps(envelope)
    size = len(body.encode('utf-8'))
    if size > MAX_DELIVERY_BYTES: raise CollectionCapacityError('Delivery exceeds byte limit')
    count, stored = db.execute('SELECT records,bytes FROM spool_usage WHERE id=1').fetchone()
    previous = db.execute('SELECT length(CAST(body AS BLOB)) FROM pending WHERE live_key=?',(live_key,)).fetchone() if live_key else None
    event_at = None
    if live_key:
        try: event_at = datetime.fromisoformat(envelope['observation']['observedAt'].replace('Z','+00:00')).timestamp()
        except (KeyError,TypeError,ValueError,AttributeError,OverflowError): pass
    priority = 2 if live_key and event_at is not None and -30 <= time.time()-event_at <= LIVE_PRIORITY_SECONDS else 1 if live_key else 0
    budget = MAX_PENDING_BYTES + (LIVE_RESERVE_BYTES if priority == 2 else 0)
    record_limit = MAX_PENDING_RECORDS if priority == 2 else BACKGROUND_RECORD_LIMIT
    if (count >= record_limit and not previous) or stored - (previous[0] if previous else 0) + size > budget:
        raise CollectionCapacityError('Durable spool capacity reached')
    db.execute('INSERT INTO pending(event_id,body,live_key,priority,event_at,enqueued_at,lag_eligible) VALUES (?,?,?,?,?,?,?) ON CONFLICT(live_key) DO UPDATE SET event_id=excluded.event_id,body=excluded.body,priority=excluded.priority,event_at=excluded.event_at,enqueued_at=excluded.enqueued_at,lag_eligible=excluded.lag_eligible,rejection=NULL,retry_after=0',
        (envelope['eventId'], body, live_key, priority, event_at, time.time(), int(priority == 2)))


def capacity_pause(db, path, reason):
    with db: db.execute('INSERT OR REPLACE INTO health VALUES (?,?)', ('capacity:'+str(path), str(reason)))



def connect(path, timeout=5):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    db = sqlite3.connect(path, timeout=timeout)
    os.chmod(path, 0o600)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=FULL")
    db.executescript('''
      CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, inode TEXT, offset INTEGER, state TEXT);
      CREATE TABLE IF NOT EXISTS revisions(identity TEXT PRIMARY KEY, revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS pending(id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE, body TEXT);
      CREATE TABLE IF NOT EXISTS health(key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS live_files(path TEXT PRIMARY KEY,inode TEXT,offset INTEGER,state TEXT);
    ''')
    parser_ledger.initialize(db)
    columns={row[1] for row in db.execute('PRAGMA table_info(pending)')}
    if 'retry_after' not in columns: db.execute('ALTER TABLE pending ADD COLUMN retry_after REAL NOT NULL DEFAULT 0')
    if 'rejection' not in columns: db.execute('ALTER TABLE pending ADD COLUMN rejection TEXT')
    if 'live_key' not in columns: db.execute('ALTER TABLE pending ADD COLUMN live_key TEXT')
    if 'priority' not in columns: db.execute('ALTER TABLE pending ADD COLUMN priority INTEGER NOT NULL DEFAULT 0')
    if 'event_at' not in columns: db.execute('ALTER TABLE pending ADD COLUMN event_at REAL')
    db.execute('CREATE UNIQUE INDEX IF NOT EXISTS pending_live_key ON pending(live_key)')
    db.executescript("""
      CREATE TABLE IF NOT EXISTS spool_usage(id INTEGER PRIMARY KEY,records INTEGER NOT NULL,bytes INTEGER NOT NULL);
      INSERT OR IGNORE INTO spool_usage SELECT 1,count(*),coalesce(sum(length(CAST(body AS BLOB))),0) FROM pending;
      CREATE TRIGGER IF NOT EXISTS spool_insert AFTER INSERT ON pending BEGIN UPDATE spool_usage SET records=records+1,bytes=bytes+length(CAST(new.body AS BLOB)) WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS spool_delete AFTER DELETE ON pending BEGIN UPDATE spool_usage SET records=records-1,bytes=bytes-length(CAST(old.body AS BLOB)) WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS spool_update AFTER UPDATE OF body ON pending BEGIN UPDATE spool_usage SET bytes=bytes+length(CAST(new.body AS BLOB))-length(CAST(old.body AS BLOB)) WHERE id=1; END;
    """)
    delivery_metrics.initialize(db)
    db.commit()
    return db


def history_needs_work(provider, stat, checkpoint):
    if not checkpoint:return True
    inode,offset,encoded=checkpoint
    current_inode=f'{stat.st_dev}:{stat.st_ino}'
    if inode!=current_inode or offset>stat.st_size:return True
    try:state=json.loads(encoded)
    except (ValueError,TypeError):return True
    version=CLAUDE_PARSER_VERSION if provider=='claude' else PARSER_VERSION
    retained=state.get('parserRetained')
    if retained:
        return not (retained.get('inode')==current_inode and retained.get('size')==stat.st_size and retained.get('mtimeNs')==stat.st_mtime_ns
                    and retained.get('parserVersion')==version and (provider!='claude' or retained.get('nativeFormatVersion')==1))
    return (state.get('parserVersion')!=version or offset!=stat.st_size or bool(state.get('turnsState',{}).get('changed'))
            or (provider=='claude' and state.get('nativeFormatVersion')!=1) or state.get('opaqueRecord',{}).get('position',0)>stat.st_size)


def history_work(db, files):
    """Filter completed prefixes without materializing all serialized states."""
    paths={str(path):(provider,path) for provider,path in files}
    pending=set(paths)
    for path,inode,offset,encoded in db.execute('SELECT path,inode,offset,state FROM files'):
        candidate=paths.get(path)
        if not candidate:continue
        provider,native=candidate
        try:needed=history_needs_work(provider,native.stat(),(inode,offset,encoded))
        except OSError:needed=False  # Rediscovery will schedule it if it returns.
        if not needed:pending.discard(path)
    return [(provider,path) for provider,path in files if str(path) in pending]


def discover(home):
    # Bounded provider-owned directory depths; includes old/resumed desktop rollouts.
    for path in (home / '.codex/sessions').glob('*/*/*/*.jsonl'):
        if path.is_file() and not path.is_symlink(): yield 'codex', path
    for path in (home / '.codex/archived_sessions').glob('*.jsonl'):
        if path.is_file() and not path.is_symlink(): yield 'codex', path
    for path in (home / '.claude/projects').glob('*/*.jsonl'):
        if path.is_file() and not path.is_symlink(): yield 'claude', path


def text(value):
    if isinstance(value, str): return value
    return '\n'.join(str(x.get('text', '')) for x in value or [] if isinstance(x, dict) and x.get('type') in ('text', 'input_text', 'output_text')) if isinstance(value, list) else ''


def apply(state, event, provider):
    if not isinstance(event, dict): return False
    at = event.get('timestamp')
    if not isinstance(at, str): return False
    if state.get('observedAt') and at < state['observedAt']: return False
    p = event.get('payload') or {}
    if not isinstance(p, dict): return False
    kind, sub = event.get('type'), p.get('type')
    if provider == 'codex' and kind == 'session_meta':
        state.update(nativeSessionId=p.get('id'), projectPath=p.get('cwd'))
    elif provider == 'claude':
        state['nativeSessionId'] = event.get('sessionId') or state.get('nativeSessionId')
        state['projectPath'] = event.get('cwd') or state.get('projectPath')
    if not state.get('nativeSessionId') or not state.get('projectPath'): return False
    if kind == 'event_msg' and sub == 'task_started':
        state['activeTurnId']=p.get('turn_id');state['activity']='working'
    current_turn=not p.get('turn_id') or not state.get('activeTurnId') or p['turn_id']==state['activeTurnId']
    if kind == 'event_msg' and sub == 'user_message' and current_turn: state['activity'] = 'working'
    if kind == 'event_msg' and sub in ('task_complete', 'task_completed','turn_aborted') and current_turn: state['activity'] = 'waiting'
    if kind == 'event_msg' and sub == 'session_end': state['activity'] = 'completed'
    message = event.get('message') or {}
    prompt = p.get('message') if sub == 'user_message' and current_turn else text(message.get('content')) if provider == 'claude' and kind == 'user' and not event.get('isMeta') else ''
    if prompt: state['title'] = ' '.join(str(prompt).split())[:512]; state['activity'] = 'working'
    if provider == 'claude' and kind == 'assistant':
        state['activity'] = 'waiting' if claude_turn_finished(message) else 'working'
    if provider == 'claude' and kind == 'system' and event.get('subtype') == 'turn_duration': state['activity'] = 'waiting'
    telemetry = state.setdefault('telemetry', dict(model=None, contextTokens=None, contextCapacity=None, serviceTier=None, observedAt=at))
    if provider == 'codex' and kind == 'turn_context':
        if p.get('model') != telemetry['model']:
            telemetry.update(contextTokens=None, contextCapacity=None)
        telemetry.update(model=p.get('model'), serviceTier=p.get('service_tier'), observedAt=at)
    if provider == 'codex' and sub == 'token_count':
        info = p.get('info') or {}; usage = info.get('last_token_usage') or {}
        telemetry.update(contextTokens=known(usage.get('input_tokens')), contextCapacity=known(info.get('model_context_window')), observedAt=at)
    if provider == 'claude' and kind == 'assistant':
        usage = message.get('usage') or {}
        telemetry.update(model=message.get('model'), contextTokens=total(known(usage.get('input_tokens')), known(usage.get('cache_read_input_tokens')), known(usage.get('cache_creation_input_tokens'))), contextCapacity=None, serviceTier=usage.get('speed'), observedAt=at)
    if provider == 'codex' and sub == 'item_completed' and current_turn:
        item = p.get('item') or {}
        if item.get('type') == 'UserMessage':
            value = text(item.get('content'))
            if value: state['title'] = ' '.join(value.split())[:512]; state['activity'] = 'working'
    state['observedAt'] = at
    state.setdefault('title', Path(state['projectPath']).name or 'External session')
    state.setdefault('activity', 'waiting')
    return True


def scan_live(db, path, provider):
    try:
        _scan_live(db, path, provider)
        with db: db.execute('DELETE FROM health WHERE key=?', ('capacity:live:'+str(path),))
    except CollectionCapacityError as error: capacity_pause(db, 'live:'+str(path), error)


def _scan_live(db, path, provider):
    stat=path.stat();inode=f'{stat.st_dev}:{stat.st_ino}'
    old=db.execute('SELECT inode,offset,state FROM live_files WHERE path=?',(str(path),)).fetchone()
    state=json.loads(old[2]) if old and old[0]==inode else {}
    if state.get('liveParserVersion') != LIVE_PARSER_VERSION: state={}
    if old and old[0]==inode and old[1]==stat.st_size and state:return
    chunks=[]
    with path.open('rb') as stream:
        if not state:
            chunks.append(stream.read(MAX_READ))
        start=max(0,stat.st_size-LIVE_TAIL)
        stream.seek(start)
        if start:stream.readline(MAX_LINE) # Discard the leading partial record.
        raw=stream.read(LIVE_TAIL);chunks.append(raw)
        end=stream.tell()-(len(raw)-raw.rfind(b'\n')-1) if b'\n' in raw else start
    if old and old[0]==inode and old[1]==end and state:return
    changed=False
    for chunk in chunks:
        final=chunk.rfind(b'\n')+1
        for raw in chunk[:final].splitlines():
            try:
                event=json.loads(raw)
                if state.get('observedAt') and str(event.get('timestamp','')) < state['observedAt']:continue
                changed=apply(state,event,provider) or changed
            except (ValueError,TypeError,AttributeError):continue
    if not changed:return
    with db:
        identity=json.dumps([provider,state['nativeSessionId']])
        db.execute('INSERT INTO revisions VALUES (?,1) ON CONFLICT(identity) DO UPDATE SET revision=revision+1',(identity,))
        revision=db.execute('SELECT revision FROM revisions WHERE identity=?',(identity,)).fetchone()[0]
        observation={k:state[k] for k in ('nativeSessionId','projectPath','observedAt','title','activity','telemetry') if k in state}
        observation.update(version=1,provider=provider,revision=revision)
        event_id=str(uuid.uuid4())
        enqueue(db, dict(version=1,eventId=event_id,collectorVersion=VERSION,observation=observation), identity)
        state['liveParserVersion']=LIVE_PARSER_VERSION
        db.execute('INSERT OR REPLACE INTO live_files VALUES (?,?,?,?)',(str(path),inode,end,json.dumps(state)))


def scan_file(db, path, provider, max_pending=5000):
    try:
        result = _scan_file(db, path, provider, max_pending)
        with db: db.execute('DELETE FROM health WHERE key=?', ('capacity:'+str(path),))
        return result
    except CollectionCapacityError as error:
        capacity_pause(db, path, error)
        return False


def _scan_file(db, path, provider, max_pending=5000):
    if db.execute('SELECT COUNT(*) FROM pending').fetchone()[0] >= max_pending: raise CollectionCapacityError('Durable spool record limit reached')
    stat = path.stat(); inode = f'{stat.st_dev}:{stat.st_ino}'
    old = db.execute('SELECT inode,offset,state FROM files WHERE path=?', (str(path),)).fetchone()
    offset, state = (old[1], json.loads(old[2])) if old and old[0] == inode and old[1] <= stat.st_size else (0, {})
    parser_version=CLAUDE_PARSER_VERSION if provider=='claude' else PARSER_VERSION
    retained=state.get('parserRetained')
    if retained:
        if retained['inode']==inode and retained['size']==stat.st_size and retained['mtimeNs']==stat.st_mtime_ns and retained.get('parserVersion')==parser_version and (provider!='claude' or retained.get('nativeFormatVersion')==1):return False
        offset,state=0,{}
    if state.get('opaqueRecord',{}).get('position',0)>stat.st_size:offset,state=0,{}
    if state and state.get('parserVersion') != parser_version: offset,state=0,{}
    state['parserVersion']=parser_version
    state.setdefault('ledgerGeneration',str(uuid.uuid4()))
    publish_pending=provider=='claude' and state.get('nativeFormatVersion')!=1
    if offset == stat.st_size and not state.get("turnsState", {}).get("changed") and not publish_pending: return False
    parser_ledger.attach(db,path,state)
    if publish_pending and not state['turnsState'].get('changed'):
        keys=[row[0] for row in db.execute("SELECT key FROM parser_records WHERE path=? AND generation=? AND namespace='turns' AND key>? ORDER BY key LIMIT 25",
            (str(path),state['ledgerGeneration'],state.get('publishCursor','')))]
        if keys:
            state['turnsState']['changed']=keys;state['publishCursor']=keys[-1]
        else:
            state['nativeFormatVersion']=1;state.pop('publishCursor',None)
    data=b''
    # Drain changed turns before reading more input; neither list nor snapshots
    # can grow indefinitely while history delivery is backlogged.
    if not state['turnsState'].get('changed') and not state.get('opaqueRecord'):
        with path.open('rb') as stream:
            stream.seek(offset); data = stream.read(MAX_READ)
            # An incomplete record is never acknowledged. Bound long-line handling.
            while b'\n' not in data and len(data) <= MAX_LINE:
                more = stream.read(MAX_READ)
                if not more: break
                data += more
    end = data.rfind(b'\n') + 1
    opaque=state.get('opaqueRecord')
    if opaque or (end==0 and len(data)>MAX_LINE):
        header=opaque['header'] if opaque else ignored_header(data,provider)
        if header:
            position=opaque['position'] if opaque else offset+len(data)
            position,complete=scan_opaque_tail(path,position,MAX_READ)
            if complete:
                data=(json.dumps(header)+'\n').encode();end=position-offset
                state.pop('opaqueRecord',None)
                with db:
                    db.execute("DELETE FROM health WHERE key='parse_error' AND value=?",('Oversized native record; collection paused for '+str(path),))
            else:
                state['opaqueRecord']={'header':header,'position':position}
                data=b'';end=0
    if end == 0 and offset != stat.st_size and not state['turnsState'].get('changed') and not state.get('opaqueRecord'):
        if len(data) > MAX_LINE:
            with db: db.execute('INSERT OR REPLACE INTO health VALUES (?,?)', ('parse_error', 'Oversized native record; collection paused for '+str(path)))
        return False
    changed = False
    for raw in data[:end].splitlines():
        if len(raw) > MAX_LINE:
            event=ignored_header(raw,provider)
            if event is None:
                capacity_pause(db, path, 'Native record exceeds byte limit; cursor preserved')
                raise CollectionCapacityError('Native record exceeds byte limit; cursor preserved')
            raw=json.dumps(event).encode()
        try: event = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            with db: db.execute('INSERT OR REPLACE INTO health VALUES (?,?)', ('parse_error', 'Malformed complete native record; cursor paused in '+str(path)))
            return False
        try:
            changed = apply(state, event, provider) or changed
            consume(state.setdefault('turnsState', {}), event, 'claude_code' if provider == 'claude' else 'codex_cli')
        except parser_ledger.ParserLedgerCapacity as error:
            raise CollectionCapacityError(str(error)) from error
        except (TypeError, ValueError, AttributeError):
            with db: db.execute('INSERT OR REPLACE INTO health VALUES (?,?)', ('parse_error', 'Unsupported native record; cursor paused in '+str(path)))
            return False
    _,_,memory = parser_ledger.prepare(state)
    if memory > MAX_PARSER_STATE:
        raise CollectionCapacityError('Parser state limit reached; history cursor preserved')
    with db:
        turns_state = state.get('turnsState', {})
        changed_ids = turns_state.get('changed', [])[:25]
        if changed or changed_ids:
            identity = json.dumps([provider, state['nativeSessionId']])
            # One bounded turn per durable delivery; no batch can exceed HTTP limits.
            live=db.execute('SELECT state FROM live_files WHERE path=?',(str(path),)).fetchone()
            live_state=json.loads(live[0]) if live else state
            for turn_id in changed_ids or [None]:
                db.execute('INSERT INTO revisions VALUES (?,1) ON CONFLICT(identity) DO UPDATE SET revision=revision+1', (identity,))
                revision = db.execute('SELECT revision FROM revisions WHERE identity=?', (identity,)).fetchone()[0]
                event_id = str(uuid.uuid4())
                observation = {k: live_state[k] for k in ('nativeSessionId','projectPath','observedAt','title','activity','telemetry') if k in live_state}
                observation.update(version=1, provider=provider, revision=revision)
                envelope = dict(version=1, eventId=event_id, collectorVersion=VERSION, observation=observation)
                if turn_id is not None:
                    result = json.loads(json.dumps(turns_state['turns'][turn_id]))
                    result['provenance'] = 'native-transcript'
                    result['nativeParserVersion'] = parser_version
                    for file in result['files']:
                        path_value = Path(file['path'])
                        if path_value.is_absolute():
                            try: file['path'] = str(path_value.relative_to(state['projectPath']))
                            except ValueError: pass
                    envelope['turns'] = [result]
                enqueue(db, envelope)
            turns_state['changed'] = [tid for tid in turns_state.get('changed', []) if tid not in changed_ids]
        serialized,maps,_=parser_ledger.prepare(state)
        db.execute('DELETE FROM parser_records WHERE path=? AND generation<>?',(str(path),state['ledgerGeneration']))
        for mapping,encoded in maps:mapping.flush(encoded)
        records,bytes_used=db.execute('SELECT records,bytes FROM parser_usage WHERE id=1').fetchone()
        if records>MAX_PARSER_RECORDS or bytes_used>MAX_PARSER_BYTES:
            raise CollectionCapacityError('Parser ledger disk limit reached; cursor preserved')
        db.execute('INSERT OR REPLACE INTO files VALUES (?,?,?,?)', (str(path), inode, offset+end, serialized))
    return True


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Collector redirects are disabled")


def bind_host(db, host):
    old=db.execute("SELECT value FROM health WHERE key='host_id'").fetchone()
    if old and old[0] != host: raise ValueError("Spool belongs to another host")
    with db: db.execute("INSERT OR IGNORE INTO health VALUES ('host_id',?)",(host,))


def post(url, token, body, timeout=10):
    request = urllib.request.Request(url.rstrip('/')+'/api/session-collector', data=json.dumps(body).encode(), headers={'Content-Type':'application/json', 'Authorization':'Bearer '+token}, method='POST')
    with urllib.request.build_opener(NoRedirect).open(request, timeout=timeout) as response:
        return json.loads(response.read(65536))


def repair_rejected_display(db, limit=50):
    """Only repair known display normalization failures; preserve IDs and revisions."""
    repaired=0
    for row_id,event_id,body in db.execute("SELECT id,event_id,body FROM pending WHERE rejection='400' ORDER BY id LIMIT ?",(limit,)).fetchall():
        try:
            original=json.loads(body);normalized=normalize_display(original)
        except (ValueError,TypeError,AttributeError):continue
        if normalized==original:continue
        with db:
            repaired+=db.execute("UPDATE pending SET body=?,rejection=NULL,retry_after=0 WHERE id=? AND event_id=? AND body=? AND rejection='400'",
                (json.dumps(normalized),row_id,event_id,body)).rowcount
    return repaired


def drain(db, send, limit=50):
    repair_rejected_display(db)
    with db: db.execute('UPDATE pending SET priority=1 WHERE priority=2 AND event_at<?',(time.time()-LIVE_PRIORITY_SECONDS,))
    for row_id, event_id, body, priority, event_at, enqueued_at, lag_eligible in db.execute('SELECT id,event_id,body,priority,event_at,enqueued_at,lag_eligible FROM pending WHERE rejection IS NULL AND retry_after<=? ORDER BY priority DESC,CASE WHEN priority=2 THEN event_at END DESC,id LIMIT ?', (time.time(),limit)).fetchall():
        try: result = send(json.loads(body))
        except urllib.error.HTTPError as error:
            if error.code==429:
                try:delay=max(1,min(300,int(error.headers.get('Retry-After','5'))))
                except (ValueError,AttributeError):delay=5
                with db:
                    db.execute('UPDATE pending SET retry_after=? WHERE priority=? AND rejection IS NULL',(time.time()+delay,priority))
                    db.execute("INSERT OR REPLACE INTO health VALUES ('delivery_error','rate_limited')")
                error.close();break
            error.close()
            if error.code not in (400,409,413):raise
            # Preserve rejected data for repair, but do not let one record block unrelated sessions.
            with db:db.execute('UPDATE pending SET rejection=? WHERE id=? AND event_id=?',(str(error.code),row_id,event_id))
            continue
        if result.get('acknowledged') is not True or result.get('eventId') != event_id: raise ValueError('Unmatched acknowledgement')
        with db:
            deleted=db.execute('DELETE FROM pending WHERE id=? AND event_id=? AND body=?', (row_id, event_id, body)).rowcount
            acknowledged_at=time.time()
            if deleted and lag_eligible and event_at is not None and enqueued_at is not None:
                delivery_metrics.record(db,event_id,event_at,enqueued_at,acknowledged_at)
            db.execute('INSERT OR REPLACE INTO health VALUES (?,?)', ('last_acknowledgement', str(acknowledged_at)))


def diagnostics(db):
    return dict(**delivery_metrics.diagnostics(db,time.time()),spoolDepth=db.execute('SELECT count(*) FROM pending WHERE rejection IS NULL').fetchone()[0],
        rejectedDeliveries=db.execute('SELECT count(*) FROM pending WHERE rejection IS NOT NULL').fetchone()[0],
        discoveredFiles=db.execute('SELECT count(*) FROM live_files').fetchone()[0],
        parserStateBytes=db.execute('SELECT coalesce(sum(length(CAST(state AS BLOB))),0) FROM files').fetchone()[0]+db.execute('SELECT bytes FROM parser_usage WHERE id=1').fetchone()[0],
        resourcePaused=bool(db.execute("SELECT 1 FROM health WHERE key LIKE 'capacity:%'").fetchone()),
        spoolBytes=db.execute('SELECT bytes FROM spool_usage WHERE id=1').fetchone()[0],
        parseError=bool(db.execute("SELECT 1 FROM health WHERE key IN ('parse_error','scan_error')").fetchone()),
        deliveryError=bool(db.execute("SELECT 1 FROM health WHERE key='delivery_error'").fetchone()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    parser.add_argument('--host', required=True, help='Stable authenticated host id; permanently binds this spool')
    parser.add_argument('--token-file', required=True, type=Path)
    parser.add_argument('--home', type=Path, default=Path.home())
    parser.add_argument('--state', type=Path, default=Path.home()/'.fusion/session-collector/spool.sqlite')
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    if args.token_file.stat().st_mode & 0o077: parser.error('Credential file must have mode 600')
    token = args.token_file.read_text().strip()
    if len(token) < 32: parser.error('Collector token must have at least 32 characters')
    args.state.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = args.state.with_suffix('.lock').open('a')
    try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError: parser.error('Collector already running for this spool')
    db = connect(args.state)
    bind_host(db,args.host)
    failures = 0
    while True:
        try:
            # Most recently changed transcripts first; finite read per file per pass.
            files = sorted(discover(args.home), key=lambda pair: pair[1].stat().st_mtime, reverse=True)
            position=db.execute("SELECT value FROM health WHERE key='scan_cursor'").fetchone()
            cursor=int(position[0]) if position else 0
            older=files[100:]
            if cursor>=len(older):cursor=0
            selected=files[:100]+older[cursor:cursor+100]
            for provider,path in selected:
                try:scan_live(db,path,provider)
                except (OSError,ValueError,TypeError,KeyError) as error:
                    with db:db.execute('INSERT OR REPLACE INTO health VALUES (?,?)',('scan_error',type(error).__name__+': '+str(path)))
            # Discovery/live tail and history have independent cursors. Backfill cannot hide live sessions.
            history=history_work(db,files)
            budget=8*MAX_READ
            saved=db.execute("SELECT value FROM health WHERE key='history_cursor'").fetchone()
            history_cursor=int(saved[0]) if saved else 0
            visited=0
            while history and budget>0 and visited<min(200,len(history)):
                provider,path=history[history_cursor % len(history)]
                history_cursor=(history_cursor+1) % len(history);visited+=1
                previous=db.execute('SELECT offset FROM files WHERE path=?',(str(path),)).fetchone()
                size=max(0,path.stat().st_size-(previous[0] if previous else 0))
                # Failed/paused work consumes a budget too; one oversized history cannot monopolize discovery.
                budget-=max(65536,min(size,MAX_READ))
                try:scan_file(db,path,provider,max_pending=4500)
                except (OSError,ValueError,TypeError,KeyError) as error:
                    with db:db.execute('INSERT OR REPLACE INTO health VALUES (?,?)',('parse_error',type(error).__name__+': '+str(path)))
            with db:db.execute("INSERT OR REPLACE INTO health VALUES ('history_cursor',?)",(str(history_cursor),))
            with db:db.execute("INSERT OR REPLACE INTO health VALUES ('scan_cursor',?)",(str(cursor+100),))
            # Verify the server credential before sending any session data.
            hello=dict(version=1,eventId=str(uuid.uuid4()),collectorVersion=VERSION,probe=True)
            acknowledgement=post(args.url,token,hello)
            if acknowledgement.get('hostId') != args.host or acknowledgement.get('eventId') != hello['eventId'] or acknowledgement.get('acknowledged') is not True:
                raise ValueError('Collector credential is bound to another host')
            send = lambda body: post(args.url, token, body)
            drain(db, send)
            if not db.execute("SELECT 1 FROM pending WHERE retry_after>? LIMIT 1",(time.time(),)).fetchone():
                with db:db.execute("DELETE FROM health WHERE key='delivery_error'")
            send(dict(version=1, eventId=str(uuid.uuid4()), collectorVersion=VERSION,diagnostics=diagnostics(db)))
            failures = 0
        except (OSError, ValueError, sqlite3.Error) as error:
            failures += 1
            with db: db.execute('INSERT OR REPLACE INTO health VALUES (?,?)', ('delivery_error', type(error).__name__))
            print('Collector retry pending: '+type(error).__name__, flush=True)
        if args.once:
            db.close();lock.close()
            return 1 if failures else 0
        time.sleep(min(30, 5 * 2 ** min(failures, 3)))


if __name__ == '__main__': raise SystemExit(main())
