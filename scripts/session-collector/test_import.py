import json
import hashlib
from pathlib import Path
import sqlite3
import tempfile
import unittest
from collector import connect
from import_agentpulse import import_snapshot
class ImportTests(unittest.TestCase):
    def test_verified_source_aliases_share_native_identity_without_losing_labels_or_canonical_metadata(self):
        with tempfile.TemporaryDirectory() as root:
            root=Path(root);snapshot=root/'snapshot.db';source=sqlite3.connect(snapshot)
            source.executescript('CREATE TABLE sessions(session_id TEXT,agent_type TEXT,display_name TEXT,cwd TEXT,status TEXT,is_working INTEGER,last_activity_at TEXT,notes TEXT,metadata TEXT,model TEXT,started_at TEXT,ended_at TEXT,git_branch TEXT,is_archived INTEGER,is_pinned INTEGER); CREATE TABLE events(id INTEGER,session_id TEXT,provider_event_type TEXT,raw_payload TEXT);')
            source.execute('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',('native','codex_cli','Native title','/repo','active',1,'2026-09-15T12:00:00Z','Native note','{"hostName":"m3"}','native-model',None,None,'main',0,0))
            source.execute('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',('alias','codex_cli','Managed alias','/repo','stopped',0,'2026-09-15T11:00:00Z','Alias note','{}',None,None,None,None,1,1))
            source.commit();source.close();db=connect(root/'spool.db')
            mapping={key:dict(hostId='m3',provider='codex',nativeSessionId='native') for key in ['native','alias']}
            self.assertEqual(import_snapshot(snapshot,db,mapping,'m3')['queued'],2)
            bodies=[json.loads(row[0]) for row in db.execute('SELECT body FROM pending')]
            self.assertEqual(bodies[0]['importedMetadata'],bodies[1]['importedMetadata'])
            metadata=bodies[0]['importedMetadata'];self.assertEqual(metadata['sourceSessionId'],'native');self.assertEqual(metadata['model'],'native-model')
            self.assertFalse(metadata['archived']);self.assertTrue(metadata['pinned'])
            self.assertEqual(metadata['sourceAliases'][0]['notes'],'Alias note');self.assertTrue(metadata['sourceAliases'][0]['archived'])
            self.assertTrue(all(b['observation']['nativeSessionId']=='native' and b['observation']['title']=='Native title' and b['observation']['activity']=='working' for b in bodies))
            source=sqlite3.connect(snapshot);source.execute('UPDATE sessions SET metadata=? WHERE session_id=?',('{"hostName":"j"}','alias'));source.commit();source.close()
            with self.assertRaisesRegex(ValueError,'recorded host'):import_snapshot(snapshot,db,mapping,'m3')
            db.close()
    def test_resumable_identity_scoped_import_and_unmapped_stop(self):
        with tempfile.TemporaryDirectory() as root:
            root=Path(root);snapshot=root/'snapshot.db';source=sqlite3.connect(snapshot)
            source.executescript('CREATE TABLE sessions(session_id TEXT,agent_type TEXT,display_name TEXT,cwd TEXT,status TEXT,is_working INTEGER,last_activity_at TEXT,notes TEXT,metadata TEXT,model TEXT,started_at TEXT,ended_at TEXT,git_branch TEXT,is_archived INTEGER,is_pinned INTEGER); CREATE TABLE events(id INTEGER,session_id TEXT,provider_event_type TEXT,raw_payload TEXT);')
            source.execute('INSERT INTO sessions(session_id,agent_type,display_name,cwd,status,is_working,last_activity_at,notes,metadata) VALUES (?,?,?,?,?,?,?,?,?)',('native','codex_cli','Old session','/repo','active',0,'2026-09-15T12:00:00Z','Imported note','{}'))
            source.execute("UPDATE sessions SET is_archived=1,is_pinned=0,model='fixture',started_at='2026-09-01T12:00:00Z',git_branch='main'")
            source.execute('INSERT INTO events VALUES (?,?,?,?)',(1,'native','agentpulse_turn_result',json.dumps(dict(id='t',files=[dict(path='/repo/a',diff='+new'),dict(path='/outside/b',diff='+external'),dict(path='../c',diff='+parent')],prompts=['Prompt'],response='Response'))));source.commit();source.close()
            db=connect(root/'spool.db')
            self.assertEqual(import_snapshot(snapshot,db,{},'m3')['unmapped'],['native'])
            mapping={'native':dict(hostId='m3',provider='codex',nativeSessionId='verified-native')}
            self.assertEqual(import_snapshot(snapshot,db,mapping,'m3')['queued'],1)
            metadata=json.loads(db.execute('SELECT body FROM pending').fetchone()[0])['importedMetadata']
            self.assertTrue(metadata['archived']);self.assertEqual(metadata['model'],'fixture');self.assertEqual(metadata['branch'],'main')
            self.assertEqual(import_snapshot(snapshot,db,mapping,'m3')['phase'],'events')
            self.assertEqual(import_snapshot(snapshot,db,mapping,'m3')['queued'],1)
            self.assertTrue(import_snapshot(snapshot,db,mapping,'m3')['complete'])
            self.assertEqual(import_snapshot(snapshot,db,mapping,'m3')['queued'],0)
            body=json.loads(db.execute('SELECT body FROM pending ORDER BY id DESC').fetchone()[0]);self.assertTrue(body['historical'])
            self.assertEqual(body['observation']['nativeSessionId'],'verified-native');self.assertEqual(body['turns'][0]['files'][0]['path'],'a')
            self.assertEqual([f['path'] for f in body['turns'][0]['files']],['a','/outside/b','../c'])
            # A format upgrade restarts the scan and does not collide with an
            # unacknowledged old metadata envelope for the same snapshot row.
            old_digest=hashlib.sha256(json.dumps(mapping,sort_keys=True,separators=(',',':')).encode()).hexdigest()
            old_event=hashlib.sha256(f'{metadata["snapshot"]}:sessions:1'.encode()).hexdigest()
            old=json.loads(db.execute('SELECT body FROM pending ORDER BY id LIMIT 1').fetchone()[0]);old['eventId']=old_event
            for key in ['formatVersion','conversations','conversationsTruncated']:old['importedMetadata'].pop(key,None)
            with db:
                db.execute("UPDATE imports_v4 SET identity_digest=?,phase='done',cursor=0",(old_digest,))
                db.execute('UPDATE pending SET event_id=?,body=? WHERE id=(SELECT min(id) FROM pending)',(old_event,json.dumps(old)))
            upgraded=import_snapshot(snapshot,db,mapping,'m3')
            self.assertEqual(upgraded['queued'],1);self.assertEqual(upgraded['phase'],'sessions')
            self.assertEqual(db.execute('SELECT count(*) FROM pending').fetchone()[0],3)
            self.assertEqual(json.loads(db.execute('SELECT body FROM pending ORDER BY id DESC').fetchone()[0])['importedMetadata']['formatVersion'],5)
            db.close()
    def test_unmapped_identities_are_durable_and_can_be_resolved_later(self):
        with tempfile.TemporaryDirectory() as root:
            root=Path(root);snapshot=root/'snapshot.db';source=sqlite3.connect(snapshot)
            source.executescript('CREATE TABLE sessions(session_id TEXT,agent_type TEXT,display_name TEXT,cwd TEXT,status TEXT,is_working INTEGER,last_activity_at TEXT,notes TEXT,metadata TEXT,model TEXT,started_at TEXT,ended_at TEXT,git_branch TEXT,is_archived INTEGER,is_pinned INTEGER); CREATE TABLE events(id INTEGER,session_id TEXT,provider_event_type TEXT,raw_payload TEXT);')
            for native,host in [('unmapped','m3'),('verified','m3'),('remote','j')]:
                source.execute('INSERT INTO sessions(session_id,agent_type,display_name,cwd,status,is_working,last_activity_at,notes,metadata) VALUES (?,?,?,?,?,?,?,?,?)',(native,'codex_cli',native,'/repo','active',0,'2026-09-15T12:00:00Z','',json.dumps(dict(hostName=host))))
            source.commit();source.close();db=connect(root/'spool.db')
            mapping={'verified':dict(hostId='m3',provider='codex',nativeSessionId='verified')}
            first=import_snapshot(snapshot,db,mapping,'m3')
            self.assertEqual(first['queued'],1);self.assertEqual(first['excludedHost'],1);self.assertEqual(first['unmapped'],['unmapped'])
            import_snapshot(snapshot,db,mapping,'m3');last=import_snapshot(snapshot,db,mapping,'m3')
            self.assertEqual(last['phase'],'done');self.assertFalse(last['complete']);self.assertEqual(last['unmapped'],['unmapped'])
            mapping['unmapped']=dict(hostId='m3',provider='codex',nativeSessionId='unmapped')
            import_snapshot(snapshot,db,mapping,'m3');import_snapshot(snapshot,db,mapping,'m3')
            self.assertTrue(import_snapshot(snapshot,db,mapping,'m3')['complete'])
            self.assertEqual(db.execute('SELECT count(*) FROM import_unmapped').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT count(*) FROM pending').fetchone()[0],2)
            db.close()
if __name__=='__main__':unittest.main()
