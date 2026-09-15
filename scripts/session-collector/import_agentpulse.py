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
from collector import connect, bind_host, enqueue, CollectionCapacityError
from turn_parser import bounded_text

IMPORT_FORMAT = 5


def canonical_source_session(source, identities, identity):
    source_ids=sorted(key for key,value in identities.items() if all(value.get(field)==identity.get(field) for field in ('hostId','provider','nativeSessionId')))
    if not source_ids or len(source_ids)>8:raise ValueError('Invalid or oversized audited source alias group')
    rows=source.execute('SELECT * FROM sessions WHERE session_id IN ('+','.join('?' for _ in source_ids)+') ORDER BY session_id',source_ids).fetchall()
    if len(rows)!=len(source_ids):raise ValueError('Audited source alias is absent from snapshot')
    for row in rows:
        host=(json.loads(row['metadata'] or '{}') or {}).get('hostName')
        if host and host!=identity['hostId']:raise ValueError('Audited source alias conflicts with recorded host')
        provider={'codex_cli':'codex','claude_code':'claude'}.get(row['agent_type'])
        if provider and provider!=identity['provider']:raise ValueError('Audited source alias conflicts with recorded provider')
    primary=next((row for row in rows if row['session_id']==identity['nativeSessionId']),rows[0])
    aliases=[dict(sourceSessionId=row['session_id'],title=bounded_text(row['display_name'] or row['session_id'],512),
        archived=bool(row['is_archived']),pinned=bool(row['is_pinned']),status=bounded_text(row['status'] or 'unreported',64),
        notes=bounded_text(row['notes'] or '',32000),truncated=bounded_text(row['notes'] or '',32000)!=(row['notes'] or '')) for row in rows if row['session_id']!=primary['session_id']]
    return primary,aliases,all(bool(row['is_archived']) for row in rows),any(bool(row['is_pinned']) for row in rows)


def conversations_for_session(source, session_id):
    """Preserve only source-recorded conversation references, as inert archive data."""
    tables={row[0] for row in source.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('ask_threads','ask_messages')")}
    if tables != {'ask_threads','ask_messages'}:return [],False
    threads=source.execute('''SELECT t.* FROM ask_threads t WHERE EXISTS (
      SELECT 1 FROM ask_messages m, json_each(m.context_session_ids) c
      WHERE m.thread_id=t.id AND c.value=?) ORDER BY t.created_at DESC,t.id DESC LIMIT 4''',(session_id,)).fetchall()
    result=[];truncated=len(threads)>3
    for thread in threads[:3]:
        count=source.execute('SELECT count(*) FROM ask_messages WHERE thread_id=?',(thread['id'],)).fetchone()[0]
        rows=source.execute('SELECT * FROM ask_messages WHERE thread_id=? ORDER BY created_at DESC,id DESC LIMIT 10',(thread['id'],)).fetchall()
        messages=[];truncated=truncated or count>len(rows)
        for row in reversed(rows):
            content=bounded_text(row['content'],4000);contexts=json.loads(row['context_session_ids'] or '[]')
            if not isinstance(contexts,list) or any(not isinstance(value,str) for value in contexts):raise ValueError('Invalid archived conversation context')
            clipped=content!=row['content'] or len(contexts)>64
            messages.append(dict(id=row['id'],role=row['role'],content=content,at=timestamp(row['created_at']),truncated=clipped,
                contextSessionIds=contexts[:64],error=bounded_text(row['error_message'],1000) if row['error_message'] else None,
                inputTokens=row['tokens_in'],outputTokens=row['tokens_out']))
            truncated=truncated or clipped
        result.append(dict(id=thread['id'],title=bounded_text(thread['title'] or 'Imported conversation',512),createdAt=timestamp(thread['created_at']),
            archivedAt=timestamp(thread['archived_at']) if thread['archived_at'] else None,totalMessages=count,messages=messages))
    return result,truncated


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
    identity_digest=hashlib.sha256(json.dumps({'format':IMPORT_FORMAT,'identities':identities},sort_keys=True,separators=(',',':')).encode()).hexdigest()
    db.executescript('''CREATE TABLE IF NOT EXISTS imports_v4(snapshot TEXT,host TEXT,identity_digest TEXT,phase TEXT,cursor INTEGER NOT NULL,PRIMARY KEY(snapshot,host));
      CREATE TABLE IF NOT EXISTS import_unmapped(snapshot TEXT,host TEXT,phase TEXT,row_id INTEGER,session_id TEXT,PRIMARY KEY(snapshot,host,phase,row_id));''')
    position=db.execute('SELECT identity_digest,phase,cursor FROM imports_v4 WHERE snapshot=? AND host=?',(digest,host_id)).fetchone()
    phase,cursor=(position[1],position[2]) if position and position[0]==identity_digest else ('sessions',0)
    if not position or position[0]!=identity_digest:
        with db:db.execute('DELETE FROM import_unmapped WHERE snapshot=? AND host=?',(digest,host_id))
    def checkpoint(current_phase,row_id):
        db.execute('INSERT OR REPLACE INTO imports_v4 VALUES (?,?,?,?,?)',(digest,host_id,identity_digest,current_phase,row_id))
    def unresolved():
        return [row[0] for row in db.execute('SELECT DISTINCT session_id FROM import_unmapped WHERE snapshot=? AND host=? ORDER BY session_id',(digest,host_id))]
    report={'queued':0,'excludedHost':0,'unmapped':unresolved(),'snapshot':digest,'phase':phase,'cursor':cursor,'complete':phase=='done' and not unresolved()}
    if phase=='done':source.close();return report
    if phase=='sessions':
        rows=source.execute('SELECT rowid event_id,session_id,agent_type,display_name,cwd,status,is_working,last_activity_at,notes,metadata,model,started_at,ended_at,git_branch,is_archived,is_pinned FROM sessions WHERE rowid>? ORDER BY rowid LIMIT ?',(cursor,limit)).fetchall()
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
        with db:db.execute('DELETE FROM import_unmapped WHERE snapshot=? AND host=? AND session_id=?',(digest,host_id,row['session_id']))
        primary=row;aliases=[];archived=pinned=False
        if phase=='sessions':primary,aliases,archived,pinned=canonical_source_session(source,identities,identity)
        turn=None
        if phase=='events':
            turn=json.loads(row['raw_payload']);turn['provenance']='agentpulse-import'
            for change in turn.get('files',[]):
                path=Path(change['path'])
                if path.is_absolute():
                    try:change['path']=str(path.relative_to(row['cwd']))
                    except (TypeError,ValueError):pass
        observation=dict(version=1,provider=provider,nativeSessionId=native,revision=0,
            observedAt=timestamp(primary['last_activity_at']),activity='completed' if primary['status'] in ('completed','ended','stopped') else 'working' if primary['is_working'] else 'waiting',
            title=(primary['display_name'] or Path(primary['cwd'] or '/').name or 'Imported session')[:512],projectPath=primary['cwd'] or '(historical project unavailable)')
        phase_key=f'{phase}-v{IMPORT_FORMAT}' if phase=='sessions' else phase
        event_id=hashlib.sha256(f'{digest}:{phase_key}:{row["event_id"]}'.encode()).hexdigest()
        envelope=dict(version=1,eventId=event_id,collectorVersion='agentpulse-import-2',historical=True,observation=observation,turns=[turn] if turn else [])
        if phase=='sessions':
            if primary['notes']:envelope['importedNotes']=primary['notes']
            metadata=json.loads(primary['metadata'] or '{}')
            envelope['importedMetadata']=dict(formatVersion=IMPORT_FORMAT,snapshot=digest,sourceSessionId=primary['session_id'],sourceAliases=aliases,archived=archived,pinned=pinned,model=primary['model'],
                startedAt=timestamp(primary['started_at']) if primary['started_at'] else None,endedAt=timestamp(primary['ended_at']) if primary['ended_at'] else None,branch=primary['git_branch'],usage=metadata.get('costUsage') or [])
            conversations={};truncated=False
            for source_id in [primary['session_id']]+[alias['sourceSessionId'] for alias in aliases]:
                threads,clipped=conversations_for_session(source,source_id);truncated=truncated or clipped
                conversations.update((thread['id'],thread) for thread in threads)
            threads=sorted(conversations.values(),key=lambda thread:(thread['createdAt'],thread['id']),reverse=True)
            envelope['importedMetadata'].update(conversations=threads[:3],conversationsTruncated=truncated or len(threads)>3)
        try:
            with db:
                db.execute('BEGIN IMMEDIATE')
                if not db.execute('SELECT 1 FROM pending WHERE event_id=?',(event_id,)).fetchone(): enqueue(db,envelope)
                checkpoint(phase,row['event_id'])
        except CollectionCapacityError as error:
            report['paused']=str(error);break
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
