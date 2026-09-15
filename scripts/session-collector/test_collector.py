import json
from urllib.error import HTTPError
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from collector import connect, scan_file, drain, discover, scan_live, bind_host, NoRedirect, main, diagnostics, apply

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
        archived=self.root/'.codex/archived_sessions/rollout-archived.jsonl';archived.parent.mkdir(parents=True);archived.write_text('')
        self.assertIn(('codex',archived),list(discover(self.root)))

    def test_rate_limit_delays_history_without_blocking_new_live_updates(self):
        with self.db:
            self.db.execute('INSERT INTO pending(event_id,body) VALUES (?,?)',('history',json.dumps(dict(eventId='history'))))
        with patch('collector.time.time',return_value=100):
            drain(self.db,lambda _:(_ for _ in ()).throw(HTTPError('local',429,'limited',{'Retry-After':'60'},None)))
            with self.db:self.db.execute('INSERT INTO pending(event_id,body,priority) VALUES (?,?,1)',('live',json.dumps(dict(eventId='live'))))
            seen=[]
            drain(self.db,lambda e:(seen.append(e['eventId']) or dict(acknowledged=True,eventId=e['eventId'])))
            self.assertEqual(seen,['live'])
        with patch('collector.time.time',return_value=161):
            drain(self.db,lambda e:dict(acknowledged=True,eventId=e['eventId']))
        self.assertEqual(self.db.execute('SELECT count(*) FROM pending').fetchone()[0],0)

    def test_offline_pass_still_commits_discovered_data(self):
        native=self.root/'.codex/sessions/2026/09/15/rollout.jsonl';native.parent.mkdir(parents=True)
        native.write_text(''.join(json.dumps(row)+'\n' for row in self.codex()))
        token=self.root/'token';token.write_text('x'*64);token.chmod(0o600)
        spool=self.root/'offline.sqlite'
        with patch('sys.argv',['collector','--host','m3','--url','http://127.0.0.1:1','--home',str(self.root),'--state',str(spool),'--token-file',str(token),'--once']), patch('collector.post',side_effect=OSError('offline')):
            self.assertEqual(main(),1)
        db=connect(spool)
        self.assertGreater(db.execute('SELECT count(*) FROM pending').fetchone()[0],0)
        self.assertEqual(db.execute('SELECT count(*) FROM files').fetchone()[0],1)
        db.close()

    def test_rejected_history_is_preserved_without_blocking_other_sessions(self):
        for identity in ['bad','good']:
            with self.db:self.db.execute('INSERT INTO pending(event_id,body) VALUES (?,?)',(identity,json.dumps(dict(eventId=identity))))
        def send(e):
            if e['eventId']=='bad':raise HTTPError('local',400,'invalid',{},None)
            return dict(acknowledged=True,eventId=e['eventId'])
        drain(self.db,send)
        self.assertEqual(self.db.execute('SELECT event_id,rejection FROM pending').fetchall(),[('bad','400')])
        drain(self.db,lambda _:self.fail('Rejected data must wait for repair'))

    def test_host_binding_and_redirect_refusal(self):
        bind_host(self.db,'m3');bind_host(self.db,'m3')
        with self.assertRaises(ValueError):bind_host(self.db,'m5')
        with self.assertRaises(ValueError):NoRedirect().redirect_request(None,None,302,'',{},'https://elsewhere')

    def test_live_tail_overtakes_backfill_and_coalesces_offline_updates(self):
        self.write(self.codex())
        scan_file(self.db,self.path,'codex')
        scan_live(self.db,self.path,'codex')
        with self.path.open('a') as stream:
            stream.write(json.dumps(dict(type='event_msg',timestamp='2026-09-15T12:01:00Z',payload=dict(type='task_completed')))+'\n')
        scan_live(self.db,self.path,'codex')
        self.assertEqual(self.db.execute('SELECT count(*) FROM pending WHERE priority=1').fetchone()[0],1)
        seen=[]
        def send(e):
            seen.append(e['observation']);return dict(acknowledged=True,eventId=e['eventId'])
        drain(self.db,send)
        self.assertEqual(seen[0]['activity'],'waiting')
        self.assertGreater(seen[0]['revision'],seen[1]['revision'])
        scan_file(self.db,self.path,'codex')
        self.assertEqual(json.loads(self.db.execute('SELECT body FROM pending').fetchone()[0])['observation']['activity'],'waiting')

    def test_inflight_ack_cannot_remove_a_newer_coalesced_live_snapshot(self):
        self.write(self.codex());scan_live(self.db,self.path,'codex')
        def send(e):
            with self.path.open('a') as stream:
                stream.write(json.dumps(dict(type='event_msg',timestamp='2026-09-15T12:01:00Z',payload=dict(type='task_completed')))+'\n')
            scan_live(self.db,self.path,'codex')
            return dict(acknowledged=True,eventId=e['eventId'])
        drain(self.db,send)
        self.assertEqual(self.db.execute('SELECT count(*) FROM pending').fetchone()[0],1)
        self.assertEqual(json.loads(self.db.execute('SELECT body FROM pending').fetchone()[0])['observation']['activity'],'waiting')

    def test_live_cursor_waits_for_complete_record(self):
        self.write(self.codex());scan_live(self.db,self.path,'codex')
        drain(self.db,lambda e:dict(acknowledged=True,eventId=e['eventId']))
        pending=json.dumps(dict(type='event_msg',timestamp='2026-09-15T12:01:00Z',payload=dict(type='task_completed')))
        with self.path.open('a') as stream:stream.write(pending)
        scan_live(self.db,self.path,'codex')
        with self.path.open('a') as stream:stream.write('\n')
        scan_live(self.db,self.path,'codex')
        self.assertEqual(json.loads(self.db.execute('SELECT body FROM pending').fetchone()[0])['observation']['activity'],'waiting')

    def test_resource_limits_preserve_checkpoint_and_pending_until_capacity_recovers(self):
        self.write(self.codex())
        with patch('collector.MAX_PARSER_STATE', 1): self.assertFalse(scan_file(self.db,self.path,'codex'))
        self.assertIsNone(self.db.execute('SELECT offset FROM files').fetchone())
        self.assertTrue(diagnostics(self.db)['resourcePaused'])
        with patch('collector.MAX_PENDING_BYTES', 1): self.assertFalse(scan_file(self.db,self.path,'codex'))
        self.assertIsNone(self.db.execute('SELECT revision FROM revisions').fetchone())
        self.assertEqual(diagnostics(self.db)['spoolBytes'],0)
        self.assertTrue(scan_file(self.db,self.path,'codex'))
        self.assertFalse(diagnostics(self.db)['resourcePaused'])
        pending=self.db.execute('SELECT body FROM pending').fetchone()[0]
        self.assertEqual(diagnostics(self.db)['spoolBytes'],len(pending.encode()))
        drain(self.db,lambda e:dict(acknowledged=True,eventId=e['eventId']))
        self.assertEqual(diagnostics(self.db)['spoolBytes'],0)

    def test_live_reserve_and_coalescing_obey_byte_limit_without_losing_checkpoint(self):
        self.write(self.codex())
        with patch('collector.MAX_PENDING_BYTES',1): scan_live(self.db,self.path,'codex')
        before=self.db.execute('SELECT offset,state FROM live_files').fetchone()
        with self.path.open('a') as f:f.write(json.dumps(dict(type='event_msg',timestamp='2026-09-15T12:01:00Z',payload=dict(type='task_completed')))+'\n')
        with patch('collector.MAX_PENDING_BYTES',1),patch('collector.LIVE_RESERVE_BYTES',0):scan_live(self.db,self.path,'codex')
        self.assertEqual(self.db.execute('SELECT offset,state FROM live_files').fetchone(),before)
        scan_live(self.db,self.path,'codex')
        self.assertEqual(self.db.execute('SELECT count(*) FROM pending').fetchone()[0],1)
        self.assertEqual(diagnostics(self.db)['spoolBytes'],self.db.execute('SELECT length(CAST(body AS BLOB)) FROM pending').fetchone()[0])

    def test_malformed_complete_record_never_advances_history_cursor(self):
        self.write(self.codex(),'invalid\n')
        self.assertFalse(scan_file(self.db,self.path,'codex'))
        self.assertIsNone(self.db.execute('SELECT offset FROM files').fetchone())
        self.assertTrue(diagnostics(self.db)['parseError'])

    def test_reported_model_context_and_compaction_for_both_providers(self):
        state={}
        for e in self.codex():apply(state,e,'codex')
        def codex(kind,payload):apply(state,dict(type=kind,payload=payload,timestamp='2026-09-15T12:01:00Z'),'codex')
        codex('turn_context',dict(model='gpt-5',service_tier='priority'))
        for context in [1000,100]:
            codex('event_msg',dict(type='token_count',info=dict(last_token_usage=dict(input_tokens=context),model_context_window=2000)))
            self.assertEqual(state['telemetry']['contextTokens'],context)
        self.assertEqual(state['telemetry']['contextCapacity'],2000)
        codex('turn_context',dict(model='gpt-next'))
        self.assertIsNone(state['telemetry']['contextTokens'])
        self.assertIsNone(state['telemetry']['contextCapacity'])
        codex('event_msg',dict(type='item_completed',item=dict(type='UserMessage',content=[dict(type='input_text',text='Desktop prompt')])) )
        self.assertEqual(state['title'],'Desktop prompt')
        claude={}
        apply(claude,dict(type='assistant',sessionId='c',cwd='/repo',timestamp='2026-09-15T12:00:00Z',message=dict(model='claude',content=[],usage=dict(input_tokens=10,cache_read_input_tokens=20,cache_creation_input_tokens=30))),'claude')
        self.assertEqual(claude['telemetry']['contextTokens'],60)
        self.assertIsNone(claude['telemetry']['contextCapacity'])

if __name__ == '__main__': unittest.main()
