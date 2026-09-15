#!/usr/bin/env python3
"""Opt-in native feedback hook. No process control or automatic hook installation.

Hook output contract verified in AgentPulse 04f0dcf scripts/session-hook.py.
The execution ledger is independent from AgentPulse and the transcript spool.
"""
import argparse
import fcntl
import hashlib
import json
from pathlib import Path
import sys
import sqlite3
import re
import time
import uuid
from datetime import datetime
from collector import bind_host, connect, post

EVENTS = {'PreToolUse','PostToolUse','UserPromptSubmit','SessionStart'}


def setup(db):
    db.executescript('''
      CREATE TABLE IF NOT EXISTS feedback_runtimes(session_id TEXT PRIMARY KEY,generation TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS feedback_execution(id TEXT PRIMARY KEY,digest TEXT NOT NULL,state TEXT NOT NULL,expires REAL NOT NULL);
    ''')


def execute_once(db, command, emit, now=None):
    """At most one output attempt. Ambiguous crashes become failed, never automatic replay."""
    now=time.time() if now is None else now
    if not isinstance(command.get('id'),str) or not re.fullmatch(r'[a-zA-Z0-9-]{16,128}',command['id']):return 'failed'
    expiry=datetime.fromisoformat(command['expiresAt'].replace('Z','+00:00')).timestamp()
    if expiry <= now or expiry > now+600: return 'failed'
    text=command.get('text')
    if command.get('operation') != 'feedback' or not isinstance(text,str) or not text.strip() or len(text)>16000:return 'failed'
    digest=hashlib.sha256(json.dumps(command,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    with db:
        previous=db.execute('SELECT digest,state FROM feedback_execution WHERE id=?',(command['id'],)).fetchone()
        if previous:
            if previous[0] != digest:return 'failed'
            if previous[1]=='emitted':return 'applied'
            db.execute("UPDATE feedback_execution SET state='failed' WHERE id=?",(command['id'],))
            return 'failed'
        db.execute("INSERT INTO feedback_execution VALUES (?,?,'prepared',?)",(command['id'],digest,expiry))
    try:
        emit('[Fusion feedback '+command['id']+']\n'+text)
    except (OSError,ValueError):
        with db:db.execute("UPDATE feedback_execution SET state='failed' WHERE id=?",(command['id'],))
        return 'failed'
    with db:db.execute("UPDATE feedback_execution SET state='emitted' WHERE id=?",(command['id'],))
    return 'applied'


def run_hook(db, host, provider, payload, send, emit):
    event=payload.get('hook_event_name');native=payload.get('session_id')
    if event not in EVENTS or not isinstance(native,str) or not native or len(native)>256:return
    session=hashlib.sha256(json.dumps([host,provider,native],separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
    bind_host(db,host);setup(db)
    hello=send(dict(probe=True))
    if hello.get('hostId') != host or hello.get('acknowledged') is not True:raise ValueError('Wrong authenticated host')
    with db:
        db.execute('INSERT OR IGNORE INTO feedback_runtimes VALUES (?,?)',(session,str(uuid.uuid4())))
        generation=db.execute('SELECT generation FROM feedback_runtimes WHERE session_id=?',(session,)).fetchone()[0]
        db.execute('DELETE FROM feedback_execution WHERE expires<?',(time.time()-14*86400,))
    if send(dict(runtime=dict(sessionId=session,generation=generation,capabilities=['feedback']))).get('acknowledged') is not True:return
    commands=send(dict(commandClaim=dict(sessionId=session,generation=generation))).get('commands',[])
    if not isinstance(commands,list):return
    for command in commands[:1]:
        if not isinstance(command,dict) or any(command.get(key)!=value for key,value in [('hostId',host),('sessionId',session),('nativeSessionId',native),('generation',generation)]):return
        # Mutable transport fields are not the identity of the operation.
        action={key:command.get(key) for key in ('id','text','operation','expiresAt','sessionId','hostId','nativeSessionId','generation')}
        outcome=execute_once(db,action,lambda text:emit({'hookSpecificOutput':{'hookEventName':event,'additionalContext':text}}))
        send(dict(commandAck=dict(id=command['id'],generation=generation,status=outcome)))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host',required=True);parser.add_argument('--provider',choices=['codex','claude'],required=True)
    parser.add_argument('--url',required=True);parser.add_argument('--token-file',type=Path,required=True)
    parser.add_argument('--state',type=Path,default=Path.home()/'.fusion/session-collector/feedback.sqlite')
    args=parser.parse_args()
    # Provider hooks must never block a session on an unavailable observer.
    try:
        if args.token_file.stat().st_mode & 0o077:return
        token=args.token_file.read_text().strip()
        if len(token)<32:return
        raw=sys.stdin.buffer.read(1024*1024+1)
        if len(raw)>1024*1024:return
        payload=json.loads(raw)
        if not isinstance(payload,dict):return
        args.state.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with args.state.with_suffix('.lock').open('a') as lock:
            try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError:return
            db=connect(args.state,timeout=0.1);deadline=time.monotonic()+2
            try:
                def send(operation):
                    remaining=deadline-time.monotonic()
                    if remaining<=0:raise TimeoutError('Hook delivery budget exhausted')
                    envelope=dict(version=1,eventId=str(uuid.uuid4()),collectorVersion='fusion-feedback-1',**operation)
                    response=post(args.url,token,envelope,timeout=min(1,remaining))
                    if response.get('eventId')!=envelope['eventId']:raise ValueError('Unmatched hook acknowledgement')
                    return response
                run_hook(db,args.host,args.provider,payload,send,lambda output:print(json.dumps(output),flush=True))
            finally:db.close()
    except (OSError,ValueError,KeyError,TypeError,sqlite3.Error):
        return


if __name__=='__main__':main()
