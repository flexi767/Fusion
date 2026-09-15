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
import uuid
from turn_parser import consume

VERSION = "fusion-native-1"
MAX_READ = 1024 * 1024
MAX_LINE = 4 * MAX_READ


def connect(path):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    db = sqlite3.connect(path)
    os.chmod(path, 0o600)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=FULL")
    db.executescript('''
      CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, inode TEXT, offset INTEGER, state TEXT);
      CREATE TABLE IF NOT EXISTS revisions(identity TEXT PRIMARY KEY, revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS pending(id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE, body TEXT);
      CREATE TABLE IF NOT EXISTS health(key TEXT PRIMARY KEY, value TEXT);
    ''')
    return db


def discover(home):
    # Bounded provider-owned directory depths; includes old/resumed desktop rollouts.
    for path in (home / '.codex/sessions').glob('*/*/*/*.jsonl'):
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
    p = event.get('payload') or {}
    if not isinstance(p, dict): return False
    kind, sub = event.get('type'), p.get('type')
    if provider == 'codex' and kind == 'session_meta':
        state.update(nativeSessionId=p.get('id'), projectPath=p.get('cwd'))
    elif provider == 'claude':
        state['nativeSessionId'] = event.get('sessionId') or state.get('nativeSessionId')
        state['projectPath'] = event.get('cwd') or state.get('projectPath')
    if not state.get('nativeSessionId') or not state.get('projectPath'): return False
    if kind == 'event_msg' and sub in ('task_started', 'user_message'): state['activity'] = 'working'
    if kind == 'event_msg' and sub in ('task_complete', 'task_completed'): state['activity'] = 'waiting'
    if kind == 'event_msg' and sub == 'turn_aborted': state['activity'] = 'waiting'
    if kind == 'event_msg' and sub == 'session_end': state['activity'] = 'completed'
    message = event.get('message') or {}
    prompt = p.get('message') if sub == 'user_message' else text(message.get('content')) if provider == 'claude' and kind == 'user' and not event.get('isMeta') else ''
    if prompt: state['title'] = ' '.join(str(prompt).split())[:512]; state['activity'] = 'working'
    if provider == 'claude' and kind == 'assistant':
        blocks = message.get('content') or []
        state['activity'] = 'working' if any(isinstance(b, dict) and b.get('type') == 'tool_use' for b in blocks) else 'waiting'
    if provider == 'claude' and kind == 'system' and event.get('subtype') == 'turn_duration': state['activity'] = 'waiting'
    state['observedAt'] = at
    state.setdefault('title', Path(state['projectPath']).name or 'External session')
    state.setdefault('activity', 'waiting')
    return True


def scan_file(db, path, provider, max_pending=5000):
    if db.execute('SELECT COUNT(*) FROM pending').fetchone()[0] >= max_pending: return False
    stat = path.stat(); inode = f'{stat.st_dev}:{stat.st_ino}'
    old = db.execute('SELECT inode,offset,state FROM files WHERE path=?', (str(path),)).fetchone()
    offset, state = (old[1], json.loads(old[2])) if old and old[0] == inode and old[1] <= stat.st_size else (0, {})
    if offset == stat.st_size and not state.get("turnsState", {}).get("changed"): return False
    with path.open('rb') as stream:
        stream.seek(offset); data = stream.read(MAX_READ)
        # An incomplete record is never acknowledged. Bound long-line handling.
        while b'\n' not in data and len(data) <= MAX_LINE:
            more = stream.read(MAX_READ)
            if not more: break
            data += more
    end = data.rfind(b'\n') + 1
    if end == 0 and offset != stat.st_size:
        if len(data) > MAX_LINE:
            with db: db.execute('INSERT OR REPLACE INTO health VALUES (?,?)', ('parse_error', 'Oversized native record; collection paused for '+str(path)))
        return False
    changed = False
    for raw in data[:end].splitlines():
        try: event = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            with db: db.execute('INSERT OR REPLACE INTO health VALUES (?,?)', ('parse_error', 'Malformed complete native record in '+str(path)))
            continue
        try:
            changed = apply(state, event, provider) or changed
            consume(state.setdefault('turnsState', {}), event, 'claude_code' if provider == 'claude' else 'codex_cli')
        except (TypeError, ValueError, AttributeError):
            with db: db.execute('INSERT OR REPLACE INTO health VALUES (?,?)', ('parse_error', 'Unsupported native record in '+str(path)))
    with db:
        turns_state = state.get('turnsState', {})
        changed_ids = turns_state.get('changed', [])[:25]
        if changed or changed_ids:
            identity = json.dumps([provider, state['nativeSessionId']])
            # One bounded turn per durable delivery; no batch can exceed HTTP limits.
            for turn_id in changed_ids or [None]:
                db.execute('INSERT INTO revisions VALUES (?,1) ON CONFLICT(identity) DO UPDATE SET revision=revision+1', (identity,))
                revision = db.execute('SELECT revision FROM revisions WHERE identity=?', (identity,)).fetchone()[0]
                event_id = str(uuid.uuid4())
                observation = {k: state[k] for k in ('nativeSessionId','projectPath','observedAt','title','activity')}
                observation.update(version=1, provider=provider, revision=revision)
                envelope = dict(version=1, eventId=event_id, collectorVersion=VERSION, observation=observation)
                if turn_id is not None:
                    result = json.loads(json.dumps(turns_state['turns'][turn_id]))
                    result['provenance'] = 'native-transcript'
                    safe_files = []
                    for file in result['files']:
                        path_value = Path(file['path'])
                        if path_value.is_absolute():
                            try: file['path'] = str(path_value.relative_to(state['projectPath']))
                            except ValueError: continue
                        if '..' not in Path(file['path']).parts: safe_files.append(file)
                    result['files'] = safe_files
                    envelope['turns'] = [result]
                db.execute('INSERT INTO pending(event_id,body) VALUES (?,?)', (event_id, json.dumps(envelope)))
            turns_state['changed'] = [tid for tid in turns_state.get('changed', []) if tid not in changed_ids]
        db.execute('INSERT OR REPLACE INTO files VALUES (?,?,?,?)', (str(path), inode, offset+end, json.dumps(state)))
    return True


def post(url, token, body):
    request = urllib.request.Request(url.rstrip('/')+'/api/session-collector', data=json.dumps(body).encode(), headers={'Content-Type':'application/json', 'Authorization':'Bearer '+token}, method='POST')
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read(65536))


def drain(db, send, limit=50):
    for row_id, event_id, body in db.execute('SELECT id,event_id,body FROM pending ORDER BY id LIMIT ?', (limit,)).fetchall():
        result = send(json.loads(body))
        if result.get('acknowledged') is not True or result.get('eventId') != event_id: raise ValueError('Unmatched acknowledgement')
        with db:
            db.execute('DELETE FROM pending WHERE id=? AND event_id=?', (row_id, event_id))
            db.execute('INSERT OR REPLACE INTO health VALUES (?,?)', ('last_acknowledgement', str(time.time())))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
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
    failures = 0
    while True:
        try:
            # Most recently changed transcripts first; finite read per file per pass.
            files = sorted(discover(args.home), key=lambda pair: pair[1].stat().st_mtime, reverse=True)
            for provider, path in files[:2000]: scan_file(db, path, provider)
            send = lambda body: post(args.url, token, body)
            drain(db, send)
            send(dict(version=1, eventId=str(uuid.uuid4()), collectorVersion=VERSION))
            failures = 0
        except (OSError, ValueError, sqlite3.Error) as error:
            failures += 1
            with db: db.execute('INSERT OR REPLACE INTO health VALUES (?,?)', ('delivery_error', type(error).__name__))
            print('Collector retry pending: '+type(error).__name__, flush=True)
        if args.once: break
        time.sleep(min(30, 5 * 2 ** min(failures, 3)))


if __name__ == '__main__': main()
