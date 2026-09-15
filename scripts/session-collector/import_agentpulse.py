#!/usr/bin/env python3
"""Import a consistent AgentPulse SQLite snapshot into the same durable Fusion spool.

Identity mapping is explicit: never infer native ids from display names or paths.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
from datetime import datetime, timezone
from collector import connect


def timestamp(value):
    if not isinstance(value,str): raise ValueError('Missing historical timestamp')
    parsed=datetime.fromisoformat(value.replace('Z','+00:00'))
    if parsed.tzinfo is None: parsed=parsed.replace(tzinfo=timezone.utc)
    return parsed.isoformat(timespec='milliseconds').replace('+00:00','Z')


def import_snapshot(snapshot, db, identities, host_id, limit=100):
    source=sqlite3.connect(f'file:{snapshot.resolve()}?mode=ro&immutable=1',uri=True)
    source.row_factory=sqlite3.Row
    # SHA-256 identity keeps imports restartable, independent of pathname or mtime.
    with snapshot.open('rb') as snapshot_file:
        digest=hashlib.file_digest(snapshot_file,'sha256').hexdigest()
    db.execute('CREATE TABLE IF NOT EXISTS imports(snapshot TEXT PRIMARY KEY, cursor INTEGER NOT NULL)')
    cursor_row=db.execute('SELECT cursor FROM imports WHERE snapshot=?',(digest,)).fetchone()
    cursor=cursor_row[0] if cursor_row else 0
    report={'queued':0,'excludedHost':0,'unmapped':[],'snapshot':digest,'cursor':cursor}
    rows=source.execute("SELECT e.id event_id,e.session_id,e.raw_payload,s.agent_type,s.display_name,s.cwd,s.status,s.is_working,s.last_activity_at FROM events e JOIN sessions s ON s.session_id=e.session_id WHERE e.provider_event_type='agentpulse_turn_result' AND e.id>? ORDER BY e.id LIMIT ?",(cursor,limit)).fetchall()
    for row in rows:
        identity=identities.get(row['session_id'])
        if not identity:
            report['unmapped'].append(row['session_id']);break # Never skip an unmapped identity silently.
        provider=identity.get('provider');native=identity.get('nativeSessionId')
        if provider not in ('codex','claude') or not native:raise ValueError('Invalid audited identity mapping')
        if identity.get('hostId') != host_id:
            with db:db.execute('INSERT OR REPLACE INTO imports VALUES (?,?)',(digest,row['event_id']))
            report['excludedHost']+=1;continue
        turn=json.loads(row['raw_payload']);turn['provenance']='agentpulse-import'
        # Upstream patches can be absolute. Preserve only paths proven within the recorded project.
        safe=[]
        for change in turn.get('files',[]):
            path=Path(change['path'])
            if path.is_absolute():
                try:change['path']=str(path.relative_to(row['cwd']))
                except (TypeError,ValueError):continue
            if '..' not in Path(change['path']).parts:safe.append(change)
        turn['files']=safe
        observation=dict(version=1,provider=provider,nativeSessionId=native,revision=0,
            observedAt=timestamp(row['last_activity_at']),activity='completed' if row['status'] in ('completed','ended','stopped') else 'working' if row['is_working'] else 'waiting',
            title=(row['display_name'] or Path(row['cwd'] or '/').name or 'Imported session')[:512],projectPath=row['cwd'] or '(historical project unavailable)')
        event_id=hashlib.sha256(f'{digest}:{row["event_id"]}'.encode()).hexdigest()
        envelope=dict(version=1,eventId=event_id,collectorVersion='agentpulse-import-1',historical=True,observation=observation,turns=[turn])
        with db:
            db.execute('INSERT OR IGNORE INTO pending(event_id,body) VALUES (?,?)',(event_id,json.dumps(envelope)))
            db.execute('INSERT OR REPLACE INTO imports VALUES (?,?)',(digest,row['event_id']))
        report['queued']+=1;report['cursor']=row['event_id']
    source.close()
    return report


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--snapshot',type=Path,required=True);p.add_argument('--identity-map',type=Path,required=True)
    p.add_argument('--host',required=True);p.add_argument('--state',type=Path,required=True);p.add_argument('--limit',type=int,default=100)
    args=p.parse_args();db=connect(args.state)
    result=import_snapshot(args.snapshot,db,json.loads(args.identity_map.read_text()),args.host,max(1,min(1000,args.limit)))
    print(json.dumps(result,indent=2));db.close()
if __name__=='__main__':main()
