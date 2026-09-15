import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from collector import connect, scan_file, drain
from parser_retention import review, prune, main

class ParserRetentionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.spool=self.root/'spool.sqlite';self.db=connect(self.spool);self.path=self.root/'native.jsonl';self.now=1789473600
    def tearDown(self):self.db.close();self.temp.cleanup()
    def prepare(self,provider):
        if provider=='claude':
            rows=[dict(type='user',uuid='first',sessionId='native',cwd='/repo',timestamp='2026-07-01T12:00:00Z',message=dict(content='First prompt')),
                  dict(type='assistant',uuid='answer',parentUuid='first',timestamp='2026-07-01T12:00:01Z',message=dict(id='request',model='fixture',stop_reason='end_turn',content=[dict(type='text',text='Done')],usage=dict(input_tokens=10,output_tokens=2)))]
        else:
            rows=[dict(type='session_meta',timestamp='2026-07-01T12:00:00Z',payload=dict(id='native',cwd='/repo')),
                  dict(type='event_msg',timestamp='2026-07-01T12:00:00Z',payload=dict(type='task_started',turn_id='first')),
                  dict(type='event_msg',timestamp='2026-07-01T12:00:01Z',payload=dict(type='user_message',message='First prompt')),
                  dict(type='event_msg',timestamp='2026-07-01T12:00:02Z',payload=dict(type='task_completed',turn_id='first',last_agent_message='Done'))]
        self.path.write_text(''.join(json.dumps(row)+'\n' for row in rows));scan_file(self.db,self.path,provider)
        return rows
    def ack(self):drain(self.db,lambda body:dict(acknowledged=True,eventId=body['eventId']),limit=100)
    def age(self):os.utime(self.path,(self.now-60*86400,self.now-60*86400))
    def test_cleanup_is_acknowledgement_gated_preview_only_and_preserves_identity_revision(self):
        self.prepare('codex');self.age()
        with self.assertRaisesRegex(ValueError,'acknowledged'):prune(self.db,30,self.now)
        self.ack();before=self.db.execute('SELECT sum(revision) FROM revisions').fetchone()[0]
        count=self.db.execute('SELECT records FROM parser_usage WHERE id=1').fetchone()[0]
        self.assertGreater(count,0);self.assertEqual(len(review(self.db,30,self.now)['files']),1)
        self.assertEqual(self.db.execute('SELECT records FROM parser_usage WHERE id=1').fetchone()[0],count)
        native_bytes=self.path.read_bytes()
        result=prune(self.db,30,self.now);self.assertEqual(result['removedRecords'],count)
        self.assertEqual(self.path.read_bytes(),native_bytes)
        self.assertEqual(self.db.execute('SELECT sum(revision) FROM revisions').fetchone()[0],before)
        self.assertFalse(scan_file(self.db,self.path,'codex'));self.assertEqual(self.db.execute('SELECT count(*) FROM pending').fetchone()[0],0)
        state=json.loads(self.db.execute('SELECT state FROM files').fetchone()[0]);self.assertEqual(state['parserRetained']['size'],self.path.stat().st_size)
    def test_claude_append_after_cleanup_rebuilds_ownership_and_never_double_counts_replay(self):
        rows=self.prepare('claude');self.ack();scan_file(self.db,self.path,'claude');self.ack();self.age()
        before=self.db.execute('SELECT sum(revision) FROM revisions').fetchone()[0]
        self.assertEqual(len(prune(self.db,30,self.now)['files']),1)
        self.db.close();self.db=connect(self.spool);self.assertFalse(scan_file(self.db,self.path,'claude'))
        second={**rows[0],'uuid':'second','timestamp':'2026-09-15T12:00:00Z','message':dict(content='New prompt')}
        with self.path.open('a') as stream:stream.write(json.dumps(rows[1])+'\n'+json.dumps(second)+'\n')
        scan_file(self.db,self.path,'claude')
        turns={key:json.loads(value) for key,value in self.db.execute("SELECT key,value FROM parser_records WHERE namespace='turns'")}
        self.assertEqual(turns['first']['usage'][0]['requests'],1);self.assertEqual(turns['first']['response'],'Done')
        self.assertEqual(turns['second']['prompts'],['New prompt']);self.assertEqual(turns['second']['usage'],[])
        self.assertGreater(self.db.execute('SELECT sum(revision) FROM revisions').fetchone()[0],before)
    def test_changed_incomplete_new_and_large_files_are_protected_with_bounded_candidates(self):
        self.prepare('codex');self.ack();self.assertEqual(review(self.db,30,self.now)['files'],[])
        self.age()
        with patch('parser_retention.MAX_RECORDS',0):self.assertEqual(review(self.db,30,self.now)['files'],[])
        with self.path.open('a') as stream:stream.write('{')
        self.age();self.assertEqual(review(self.db,30,self.now)['files'],[])
        self.path.unlink();self.assertEqual(review(self.db,30,self.now)['files'],[])
        self.assertGreater(self.db.execute('SELECT records FROM parser_usage WHERE id=1').fetchone()[0],0)
        for invalid in [0,3651,1.5,True]:
            with self.assertRaises(ValueError):review(self.db,invalid,self.now)
    def test_generation_upgrade_replays_a_retained_prefix(self):
        self.prepare('codex');self.ack();self.age();prune(self.db,30,self.now)
        with patch('collector.PARSER_VERSION',5):self.assertTrue(scan_file(self.db,self.path,'codex'))
        self.assertGreater(self.db.execute('SELECT records FROM parser_usage WHERE id=1').fetchone()[0],0)
    def test_file_limit_and_continuation_bound_each_cleanup(self):
        for i in range(6):
            self.path=self.root/f'native-{i}.jsonl';self.prepare('codex');self.ack();self.age()
        first=prune(self.db,30,self.now)
        self.assertEqual(len(first['files']),5);self.assertIsNotNone(first['nextCursor'])
        second=prune(self.db,30,self.now,first['nextCursor'])
        self.assertEqual(len(second['files']),1)
        self.assertEqual(self.db.execute('SELECT records FROM parser_usage WHERE id=1').fetchone()[0],0)
        self.assertEqual(self.db.execute('SELECT count(*) FROM files').fetchone()[0],6)

    def test_apply_refuses_an_active_collector_lock(self):
        import fcntl
        lock=self.spool.with_suffix('.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        try:
            with patch('sys.argv',['maintenance','--state',str(self.spool),'--apply']),self.assertRaises(SystemExit):main()
        finally:lock.close()

if __name__=='__main__':unittest.main()
