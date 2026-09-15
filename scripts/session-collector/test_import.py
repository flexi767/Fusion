import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from collector import connect
from import_agentpulse import import_snapshot
class ImportTests(unittest.TestCase):
    def test_resumable_identity_scoped_import_and_unmapped_stop(self):
        with tempfile.TemporaryDirectory() as root:
            root=Path(root);snapshot=root/'snapshot.db';source=sqlite3.connect(snapshot)
            source.executescript('CREATE TABLE sessions(session_id TEXT,agent_type TEXT,display_name TEXT,cwd TEXT,status TEXT,is_working INTEGER,last_activity_at TEXT,notes TEXT); CREATE TABLE events(id INTEGER,session_id TEXT,provider_event_type TEXT,raw_payload TEXT);')
            source.execute('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?)',('native','codex_cli','Old session','/repo','active',0,'2026-09-15T12:00:00Z','Imported note'))
            source.execute('INSERT INTO events VALUES (?,?,?,?)',(1,'native','agentpulse_turn_result',json.dumps(dict(id='t',files=[dict(path='/repo/a',diff='+new'),dict(path='/outside/b',diff='+external'),dict(path='../c',diff='+parent')],prompts=['Prompt'],response='Response'))));source.commit();source.close()
            db=connect(root/'spool.db')
            self.assertEqual(import_snapshot(snapshot,db,{},'m3')['unmapped'],['native'])
            mapping={'native':dict(hostId='m3',provider='codex',nativeSessionId='verified-native')}
            self.assertEqual(import_snapshot(snapshot,db,mapping,'m3')['queued'],1)
            self.assertEqual(import_snapshot(snapshot,db,mapping,'m3')['phase'],'events')
            self.assertEqual(import_snapshot(snapshot,db,mapping,'m3')['queued'],1)
            self.assertTrue(import_snapshot(snapshot,db,mapping,'m3')['complete'])
            self.assertEqual(import_snapshot(snapshot,db,mapping,'m3')['queued'],0)
            body=json.loads(db.execute('SELECT body FROM pending ORDER BY id DESC').fetchone()[0]);self.assertTrue(body['historical'])
            self.assertEqual(body['observation']['nativeSessionId'],'verified-native');self.assertEqual(body['turns'][0]['files'][0]['path'],'a')
            self.assertEqual([f['path'] for f in body['turns'][0]['files']],['a','/outside/b','../c'])
            db.close()
if __name__=='__main__':unittest.main()
