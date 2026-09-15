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
from collector import connect, bind_host


def timestamp(value):
    if not isinstance(value,str): raise ValueError('Missing historical timestamp')
    parsed=datetime.fromisoformat(value.replace('Z','+00:00'))
    if parsed.tzinfo is None: parsed=parsed.replace(tzinfo=timezone.utc)
    return parsed.isoformat(timespec='milliseconds').replace('+00:00','Z')


def import_snapshot(snapshot, db, identities, host_id, limit=100):
    bind_host(db,host_id)
    source=sqlite3.connect(f'file:{snapshot.resolve()}?mode=ro&immutable=1',uri=True)
    source.row_factory=sqlite3.Row
    # SHA-256 identity keeps imports restartable, independent of pathname or mtime.
    with snapshot.open('rb') as snapshot_file:
        digest=hashlib.file_digest(snapshot_file,'sha256').hexdigest()
    identity_digest=hashlib.sha256(json.dumps(identities,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    db.executescript('''CREATE TABLE IF NOT EXISTS imports_v3(snapshot TEXT,host TEXT,identity_digest TEXT,phase TEXT,cursor INTEGER NOT NULL,PRIMARY KEY(snapshot,host));
      CREATE TABLE IF NOT EXISTS import_unmapped(snapshot TEXT,host TEXT,phase TEXT,row_id INTEGER,session_id TEXT,PRIMARY KEY(snapshot,host,phase,row_id));''')
    position=db.execute('SELECT identity_digest,phase,cursor FROM imports_v3 WHERE snapshot=? AND host=?',(digest,host_id)).fetchone()
    phase,cursor=(position[1],position[2]) if position and position[0]==identity_digest else ('sessions',0)
    if position and position[0]!=identity_digest:
        with db:db.execute('DELETE FROM import_unmapped WHERE snapshot=? AND host=?',(digest,host_id))
    def checkpoint(current_phase,row_id):
        db.execute('INSERT OR REPLACE INTO imports_v3 VALUES (?,?,?,?,?)',(digest,host_id,identity_digest,current_phase,row_id))
    def unresolved():
        return [row[0] for row in db.execute('SELECT DISTINCT session_id FROM import_unmapped WHERE snapshot=? AND host=? ORDER BY session_id',(digest,host_id))]
    report={'queued':0,'excludedHost':0,'unmapped':unresolved(),'snapshot':digest,'phase':phase,'cursor':cursor,'complete':phase=='done' and not unresolved()}
    if phase=='done':source.close();return report
    if phase=='sessions':
        rows=source.execute('SELECT rowid event_id,session_id,agent_type,display_name,cwd,status,is_working,last_activity_at,notes,metadata FROM sessions WHERE rowid>? ORDER BY rowid LIMIT ?',(cursor,limit)).fetchall()
    else:
        rows=source.execute("SELECT e.id event_id,e.session_id,e.raw_payload,s.agent_type,s.display_name,s.cwd,s.status,s.is_working,s.last_activity_at,s.metadata FROM events e JOIN sessions s ON s.session_id=e.session_id WHERE e.provider_event_type='agentpulse_turn_result' AND e.id>? ORDER BY e.id LIMIT ?",(cursor,limit)).fetchall()
    for row in rows:
        if db.execute('SELECT count(*) FROM pending').fetchone()[0] >= 5000:
            report['paused']='Spool capacity reached';break
        identity=identities.get(row['session_id'])
        source_host=(json.loads(row['metadata'] or '{}') or {}).get('hostName')
        if source_host and source_host!=host_id:
            with db:checkpoint(phase,row['event_id'])
            report['excludedHost']+=1;report['cursor']=row['event_id'];continue
        if not identity:
            with db:
                db.execute('INSERT OR IGNORE INTO import_unmapped VALUES (?,?,?,?,?)',(digest,host_id,phase,row['event_id'],row['session_id']))
                checkpoint(phase,row['event_id'])
            report['cursor']=row['event_id'];continue

        provider=identity.get('provider');native=identity.get('nativeSessionId')
        if provider not in ('codex','claude') or not native:raise ValueError('Invalid audited identity mapping')
        if identity.get('hostId') != host_id:
            with db:checkpoint(phase,row['event_id'])
            report['excludedHost']+=1;continue
        turn=None
        if phase=='events':
            turn=json.loads(row['raw_payload']);turn['provenance']='agentpulse-import'
            for change in turn.get('files',[]):
                path=Path(change['path'])
                if path.is_absolute():
                    try:change['path']=str(path.relative_to(row['cwd']))
                    except (TypeError,ValueError):pass
        observation=dict(version=1,provider=provider,nativeSessionId=native,revision=0,
            observedAt=timestamp(row['last_activity_at']),activity='completed' if row['status'] in ('completed','ended','stopped') else 'working' if row['is_working'] else 'waiting',
            title=(row['display_name'] or Path(row['cwd'] or '/').name or 'Imported session')[:512],projectPath=row['cwd'] or '(historical project unavailable)')
        event_id=hashlib.sha256(f'{digest}:{phase}:{row["event_id"]}'.encode()).hexdigest()
        envelope=dict(version=1,eventId=event_id,collectorVersion='agentpulse-import-1',historical=True,observation=observation,turns=[turn] if turn else [])
        if phase=='sessions' and row['notes']:envelope['importedNotes']=row['notes']
        with db:
            db.execute('INSERT OR IGNORE INTO pending(event_id,body) VALUES (?,?)',(event_id,json.dumps(envelope)))
            checkpoint(phase,row['event_id'])
        report['queued']+=1;report['cursor']=row['event_id']
    if not rows:
        phase='events' if phase=='sessions' else 'done'
        with db:checkpoint(phase,0)
        report.update(phase=phase,cursor=0,complete=phase=='done')
    report['unmapped']=unresolved();report['complete']=phase=='done' and not report['unmapped']
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
