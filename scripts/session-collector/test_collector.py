import json
from pathlib import Path
import tempfile
import unittest
from collector import connect, scan_file, drain, discover

class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.db = connect(self.root/'spool.sqlite')
        self.path = self.root/'rollout.jsonl'
    def tearDown(self):
        self.db.close(); self.temp.cleanup()
    def write(self, rows, tail=''):
        self.path.write_text(''.join(json.dumps(row)+'\n' for row in rows)+tail)
    def codex(self):
        return [dict(type='session_meta', timestamp='2026-09-15T12:00:00Z', payload=dict(id='desktop-1', cwd='/repo')), dict(type='event_msg', timestamp='2026-09-15T12:00:01Z', payload=dict(type='task_started'))]
    def test_spool_checkpoint_partial_line_restart_and_replay(self):
        self.write(self.codex(), '{"type":')
        scan_file(self.db, self.path, 'codex')
        pending = self.db.execute('SELECT body FROM pending').fetchone()[0]
        self.assertEqual(json.loads(pending)['observation']['activity'], 'working')
        self.db.close(); self.db = connect(self.root/'spool.sqlite')
        scan_file(self.db, self.path, 'codex')
        self.assertEqual(self.db.execute('SELECT count(*) FROM pending').fetchone()[0], 1)
        with self.assertRaises(OSError): drain(self.db, lambda _: (_ for _ in ()).throw(OSError('offline')))
        with self.assertRaises(ValueError): drain(self.db, lambda _: dict(acknowledged=True, eventId='wrong'))
        self.assertEqual(self.db.execute('SELECT body FROM pending').fetchone()[0], pending)
        drain(self.db, lambda e: dict(acknowledged=True, eventId=e['eventId']))
        self.assertEqual(self.db.execute('SELECT count(*) FROM pending').fetchone()[0], 0)
    def test_rotation_preserves_session_revision_and_waiting(self):
        self.write(self.codex()); scan_file(self.db, self.path, 'codex')
        self.path.unlink()
        self.write(self.codex()+[dict(type='event_msg', timestamp='2026-09-15T12:00:02Z', payload=dict(type='task_completed'))])
        scan_file(self.db, self.path, 'codex')
        rows=[json.loads(row[0])['observation'] for row in self.db.execute('SELECT body FROM pending ORDER BY id')]
        self.assertEqual([row['revision'] for row in rows], [1,2]); self.assertEqual(rows[-1]['activity'],'waiting')
    def test_claude_observation_never_enrolls_and_old_rollout_discovery(self):
        self.write([dict(type='user', sessionId='claude-1', cwd='/repo', timestamp='2026-09-15T12:00:00Z', message=dict(content='Implement change'))])
        scan_file(self.db,self.path,'claude')
        row=json.loads(self.db.execute('SELECT body FROM pending').fetchone()[0])['observation']
        self.assertEqual(row['provider'],'claude'); self.assertNotIn('taskId',row); self.assertNotIn('capabilities',row)
        old=self.root/'.codex/sessions/2020/01/01/rollout-old.jsonl';old.parent.mkdir(parents=True);old.write_text('')
        self.assertIn(('codex',old), list(discover(self.root)))

if __name__ == '__main__': unittest.main()
