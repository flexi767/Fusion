import json
from urllib.error import HTTPError
from pathlib import Path
import tempfile
import unittest
from datetime import datetime
from unittest.mock import patch
from collector import connect, scan_file, drain, discover, scan_live, bind_host, NoRedirect, main, diagnostics, apply, enqueue, CollectionCapacityError

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
    def test_claude_native_ownership_survives_sqlite_restart_and_appended_history_replay(self):
        first=dict(type='user',uuid='first',sessionId='claude-1',cwd='/repo',timestamp='2026-09-15T12:00:00Z',message=dict(content='First'))
        answer=dict(type='assistant',uuid='answer',parentUuid='first',timestamp='2026-09-15T12:00:01Z',message=dict(id='request',model='claude',stop_reason='end_turn',content=[dict(type='text',text='Done')],usage=dict(input_tokens=10,cache_read_input_tokens=0,cache_creation_input_tokens=0,output_tokens=2)))
        second={**first,'uuid':'second','timestamp':'2026-09-15T12:01:00Z','message':dict(content='Second')}
        self.write([first,answer,second]);scan_file(self.db,self.path,'claude')
        drain(self.db,lambda body:dict(acknowledged=True,eventId=body['eventId']))
        self.db.close();self.db=connect(self.root/'spool.sqlite')
        with self.path.open('a') as stream:stream.write(json.dumps(first)+'\n'+json.dumps(answer)+'\n')
        scan_file(self.db,self.path,'claude')
        rows={key:json.loads(value) for key,value in self.db.execute("SELECT key,value FROM parser_records WHERE namespace='turns'")}
        self.assertEqual(rows['first']['usage'][0]['requests'],1)
        self.assertIsNone(rows['second']['completedAt']);self.assertEqual(rows['second']['usage'],[])
        self.assertEqual(rows['second']['prompts'],['Second'])
        self.assertGreater(self.db.execute("SELECT count(*) FROM parser_records WHERE namespace='claudeOwners'").fetchone()[0],0)

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
        now=datetime.fromisoformat('2026-09-15T12:01:00+00:00').timestamp()
        with patch('collector.MAX_PENDING_BYTES',1),patch('collector.time.time',return_value=now): scan_live(self.db,self.path,'codex')
        before=self.db.execute('SELECT offset,state FROM live_files').fetchone()
        with self.path.open('a') as f:f.write(json.dumps(dict(type='event_msg',timestamp='2026-09-15T12:01:00Z',payload=dict(type='task_completed')))+'\n')
        with patch('collector.MAX_PENDING_BYTES',1),patch('collector.LIVE_RESERVE_BYTES',0):scan_live(self.db,self.path,'codex')
        self.assertEqual(self.db.execute('SELECT offset,state FROM live_files').fetchone(),before)
        scan_live(self.db,self.path,'codex')
        self.assertEqual(self.db.execute('SELECT count(*) FROM pending').fetchone()[0],1)
        self.assertEqual(diagnostics(self.db)['spoolBytes'],self.db.execute('SELECT length(CAST(body AS BLOB)) FROM pending').fetchone()[0])

    def test_unchanged_and_partial_transcripts_without_usage_do_not_reenqueue_live_snapshots(self):
        for provider in ['codex','claude']:
            path=self.root/(provider+'.jsonl')
            rows=self.codex() if provider=='codex' else [dict(type='user',timestamp='2026-09-15T12:00:00Z',sessionId='claude-native',cwd='/repo',message=dict(content='Inspect'))]
            path.write_text(''.join(json.dumps(row)+'\n' for row in rows))
            scan_live(self.db,path,provider);drain(self.db,lambda e:dict(acknowledged=True,eventId=e['eventId']))
            revision=self.db.execute('SELECT sum(revision) FROM revisions').fetchone()[0]
            scan_live(self.db,path,provider)
            with path.open('a') as f:f.write('{"type":')
            scan_live(self.db,path,provider);scan_live(self.db,path,provider)
            self.assertEqual(self.db.execute('SELECT count(*) FROM pending').fetchone()[0],0)
            self.assertEqual(self.db.execute('SELECT sum(revision) FROM revisions').fetchone()[0],revision)

    def test_fresh_live_updates_keep_reserved_capacity_and_overtake_initial_discovery(self):
        now=datetime.fromisoformat('2026-09-15T12:01:00+00:00').timestamp()
        def envelope(event,at):return dict(eventId=event,observation=dict(observedAt=at,title=event))
        cold=envelope('cold','2026-09-01T00:00:00Z');other=envelope('other','2026-09-01T00:00:01Z')
        with patch('collector.time.time',return_value=now),patch('collector.MAX_PENDING_RECORDS',4),patch('collector.BACKGROUND_RECORD_LIMIT',2):
            with self.db:
                enqueue(self.db,cold,'cold');enqueue(self.db,other,'other')
            with self.assertRaises(CollectionCapacityError):
                with self.db:enqueue(self.db,envelope('blocked','2026-09-01T00:00:02Z'),'blocked')
            with self.db:
                enqueue(self.db,envelope('older-live','2026-09-15T12:00:10Z'),'live-a')
                enqueue(self.db,envelope('newest-live','2026-09-15T12:01:00Z'),'live-b')
            seen=[]
            drain(self.db,lambda e:(seen.append(e['eventId']) or dict(acknowledged=True,eventId=e['eventId'])),limit=1)
            self.assertEqual(seen,['newest-live'])
            self.assertEqual(json.loads(self.db.execute('SELECT body FROM pending WHERE live_key=?',('cold',)).fetchone()[0]),cold)
            with self.db:enqueue(self.db,envelope('promoted','2026-09-15T12:01:00Z'),'cold')
            self.assertEqual(self.db.execute('SELECT priority FROM pending WHERE live_key=?',('cold',)).fetchone()[0],2)
        self.db.close();self.db=connect(self.root/'spool.sqlite')
        with patch('collector.time.time',return_value=now+91):
            drain(self.db,lambda e:dict(acknowledged=True,eventId=e['eventId']),limit=0)
        self.assertEqual(self.db.execute('SELECT count(*) FROM pending WHERE priority=2').fetchone()[0],0)
        self.assertEqual(self.db.execute('SELECT count(*) FROM pending').fetchone()[0],3)

    def test_malformed_complete_record_never_advances_history_cursor(self):
        self.write(self.codex(),'invalid\n')
        self.assertFalse(scan_file(self.db,self.path,'codex'))
        self.assertIsNone(self.db.execute('SELECT offset FROM files').fetchone())
        self.assertTrue(diagnostics(self.db)['parseError'])

    def test_live_activity_waits_for_current_turn_completion_for_both_providers(self):
        state={}
        for row in self.codex():apply(state,row,'codex')
        def event(payload):return dict(type='event_msg',timestamp='2026-09-15T12:00:03Z',payload=payload)
        apply(state,event(dict(type='task_started',turn_id='current')),'codex')
        for typ in ['task_completed','task_complete','turn_aborted']:
            apply(state,event(dict(type=typ,turn_id='old')),'codex')
            self.assertEqual(state['activity'],'working')
        apply(state,event(dict(type='task_completed',turn_id='current')),'codex')
        self.assertEqual(state['activity'],'waiting')
        for stop_reason in ['tool_use',None,'end_turn','stop_sequence','max_tokens']:
            for block in ['text','thinking','tool_use']:
                with self.subTest(stop_reason=stop_reason,block=block):
                    state={}
                    apply(state,dict(type='assistant',sessionId='c',cwd='/repo',timestamp='2026-09-15T12:00:00Z',message=dict(stop_reason=stop_reason,content=[dict(type=block,text='Interim')])),'claude')
                    self.assertEqual(state['activity'],'waiting' if stop_reason in ('end_turn','stop_sequence','max_tokens') and block!='tool_use' else 'working')

    def test_historical_state_spills_durably_and_late_updates_load_only_their_turn(self):
        for provider in ['codex','claude']:
            with self.subTest(provider=provider):
                path=self.root/(provider+'.jsonl');rows=[]
                if provider=='codex':rows=self.codex()[:1]
                for index in range(60):
                    at=f'2026-09-15T12:{index:02}:00Z'
                    if provider=='codex':
                        rows.extend([dict(type='event_msg',timestamp=at,payload=dict(type='task_started',turn_id=str(index))),
                            dict(type='event_msg',timestamp=at,payload=dict(type='task_completed',turn_id=str(index),last_agent_message='result '+str(index)+'x'*1024))])
                    else:
                        rows.extend([dict(type='user',uuid=str(index),sessionId='claude-ledger',cwd='/repo',timestamp=at,message=dict(content='Prompt '+str(index))),
                            dict(type='assistant',timestamp=at,message=dict(id='request-'+str(index),model='fixture',content=[dict(type='text',text='result '+str(index)+'x'*1024)],stop_reason='end_turn',usage=dict(input_tokens=10,cache_read_input_tokens=0,cache_creation_input_tokens=0,output_tokens=2)))])
                path.write_text(''.join(json.dumps(row)+'\n' for row in rows));results={}
                def send(e):
                    for turn in e.get('turns',[]):results[turn['id']]=turn
                    return dict(acknowledged=True,eventId=e['eventId'])
                with patch('collector.MAX_READ',4096),patch('collector.MAX_PARSER_STATE',16*1024):
                    for step in range(200):
                        progressed=scan_file(self.db,path,provider);drain(self.db,send)
                        if step==5:self.db.close();self.db=connect(self.root/'spool.sqlite')
                        if not progressed:break
                    self.assertEqual(len(results),60)
                    offset,wire=self.db.execute('SELECT offset,state FROM files WHERE path=?',(str(path),)).fetchone()
                    self.assertEqual(offset,path.stat().st_size);self.assertLess(len(wire),2048)
                    self.assertGreater(diagnostics(self.db)['parserStateBytes'],60*1024)
                    self.assertFalse(diagnostics(self.db)['resourcePaused'])
                    if provider=='codex':
                        with path.open('a') as stream:
                            stream.write(json.dumps(dict(type='token_usage_record',timestamp='2026-09-15T13:00:00Z',payload=dict(turn_id='0',response_id='late',usage=dict(input_tokens=10,output_tokens=2))))+'\n')
                        self.assertTrue(scan_file(self.db,path,provider));drain(self.db,send)
                        self.assertEqual(results['0']['usage'][0]['inputTokens'],10)
                        self.assertTrue(results['0']['response'].startswith('result 0'))
                        self.assertEqual(json.loads(self.db.execute('SELECT state FROM files WHERE path=?',(str(path),)).fetchone()[0])['turnsState']['active'],'59')

    def test_ledger_capacity_rolls_back_state_cursor_revision_and_delivery_together(self):
        self.write(self.codex())
        with patch('collector.MAX_PARSER_BYTES',1):self.assertFalse(scan_file(self.db,self.path,'codex'))
        for table in ['files','revisions','pending','parser_records']:
            self.assertEqual(self.db.execute('SELECT count(*) FROM '+table).fetchone()[0],0)
        self.assertEqual(self.db.execute('SELECT records,bytes FROM parser_usage').fetchone(),(0,0))
        self.assertTrue(scan_file(self.db,self.path,'codex'))
        self.assertFalse(diagnostics(self.db)['resourcePaused'])
        self.assertGreater(self.db.execute('SELECT bytes FROM parser_usage').fetchone()[0],0)

    def test_native_and_imported_titles_use_the_servers_utf16_boundary(self):
        for historical in [False,True]:
            for provider in ['codex','claude']:
                event_id=provider+str(historical)
                with self.db:enqueue(self.db,dict(eventId=event_id,historical=historical,observation=dict(provider=provider,title='😀'+'x'*511+'\x00')))
                title=json.loads(self.db.execute('SELECT body FROM pending WHERE event_id=?',(event_id,)).fetchone()[0])['observation']['title']
                self.assertEqual(len(title.encode('utf-16-le'))//2,512)
                self.assertTrue(title.startswith('😀'));self.assertNotIn('\x00',title)

    def test_changed_turn_backlog_drains_without_reading_ahead(self):
        rows=self.codex()[:1]+[dict(type='event_msg',timestamp='2026-09-15T12:00:00Z',payload=dict(type='task_started',turn_id=str(i))) for i in range(40)]
        self.write(rows);self.assertTrue(scan_file(self.db,self.path,'codex'))
        offset=self.db.execute('SELECT offset FROM files').fetchone()[0]
        with self.path.open('a') as stream:stream.write(json.dumps(dict(type='event_msg',timestamp='2026-09-15T12:01:00Z',payload=dict(type='task_started',turn_id='later')))+'\n')
        self.assertTrue(scan_file(self.db,self.path,'codex'))
        self.assertEqual(self.db.execute('SELECT offset FROM files').fetchone()[0],offset)
        self.assertTrue(scan_file(self.db,self.path,'codex'))
        turns=[turn['id'] for (body,) in self.db.execute('SELECT body FROM pending') for turn in json.loads(body).get('turns',[])]
        self.assertEqual(len(turns),len(set(turns)));self.assertEqual(len(turns),41)

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


    def test_opaque_codex_records_resume_after_restart_without_hiding_following_prompts(self):
        for kind,payload in [('compacted',{'opaque':'x'*1800}),('response_item',{'type':'custom_tool_call_output','output':'x'*1800})]:
            with self.subTest(kind=kind),patch('collector.MAX_READ',256),patch('collector.MAX_LINE',512):
                self.path=self.root/(kind+'.jsonl')
                first=self.codex()[:1]
                opaque=dict(timestamp='2026-09-15T12:00:01Z',ordinal=7,type=kind,payload=payload)
                later=dict(type='event_msg',timestamp='2026-09-15T12:00:02Z',payload=dict(type='item_completed',turn_id='later-'+kind,item=dict(type='UserMessage',id='prompt',content=[dict(type='input_text',text='After opaque record')])))
                self.write(first+[opaque,later])
                for _ in range(2):scan_file(self.db,self.path,'codex')
                row=self.db.execute('SELECT offset,state FROM files WHERE path=?',(str(self.path),)).fetchone()
                self.assertIn('opaqueRecord',json.loads(row[1]));self.assertLess(row[0],self.path.stat().st_size)
                self.db.close();self.db=connect(self.root/'spool.sqlite')
                for _ in range(12):scan_file(self.db,self.path,'codex')
                self.assertEqual(self.db.execute('SELECT offset FROM files WHERE path=?',(str(self.path),)).fetchone()[0],self.path.stat().st_size)
                value=json.loads(self.db.execute("SELECT value FROM parser_records WHERE path=? AND namespace='turns' AND key=?",(str(self.path),'later-'+kind)).fetchone()[0])
                self.assertEqual(value['prompts'],['After opaque record'])

    def test_opaque_framing_never_skips_actionable_or_unrecognized_oversized_records(self):
        from opaque_records import ignored_header
        for provider,kind,payload in [('codex','response_item',{'type':'message','content':'x'*1800}),('claude','compacted',{'opaque':'x'*1800})]:
            row=dict(timestamp='2026-09-15T12:00:01Z',type=kind,payload=payload)
            self.assertIsNone(ignored_header(json.dumps(row).encode(),provider))
        self.write(self.codex()[:1]+[dict(timestamp='2026-09-15T12:00:01Z',type='response_item',payload=dict(type='message',role='user',content='x'*1800))])
        with patch('collector.MAX_READ',256),patch('collector.MAX_LINE',512):
            scan_file(self.db,self.path,'codex');before=self.db.execute('SELECT offset FROM files').fetchone()[0]
            self.assertFalse(scan_file(self.db,self.path,'codex'))
            self.assertEqual(self.db.execute('SELECT offset FROM files').fetchone()[0],before)
            self.assertTrue(diagnostics(self.db)['parseError'])

    def test_nul_display_repair_keeps_event_identity_and_patch_counts(self):
        from collector import normalize_display
        body=dict(eventId='same-event',turns=[dict(id='turn',prompts=['before\0after'],response='a\0b',files=[dict(path='a.txt',diff='+a\0b',added=1,removed=0,truncated=False)])])
        result=normalize_display(body)
        self.assertEqual(result['eventId'],'same-event');self.assertEqual(body['turns'][0]['response'],'a\0b')
        self.assertEqual(result['turns'][0]['prompts'],['before␀after']);self.assertEqual(result['turns'][0]['response'],'a␀b')
        self.assertEqual(result['turns'][0]['files'][0],dict(path='a.txt',diff='+a␀b',added=1,removed=0,truncated=True))


    def test_rejected_nul_display_retries_with_original_identity_and_other_rejections_stay_parked(self):
        body=dict(eventId='nul',turns=[dict(id='turn',prompts=[],response='a\0b',files=[])])
        with self.db:
            self.db.execute("INSERT INTO pending(event_id,body,rejection) VALUES (?,?,?)",('nul',json.dumps(body),'400'))
            self.db.execute("INSERT INTO pending(event_id,body,rejection) VALUES (?,?,?)",('other',json.dumps(dict(eventId='other')),'400'))
        seen=[];drain(self.db,lambda body:(seen.append(body) or dict(acknowledged=True,eventId=body['eventId'])))
        self.assertEqual(len(seen),1);self.assertEqual(seen[0]['eventId'],'nul')
        self.assertEqual(seen[0]['turns'][0]['response'],'a␀b')
        self.assertEqual(self.db.execute('SELECT event_id,rejection FROM pending').fetchall(),[('other','400')])


    def test_incomplete_opaque_record_keeps_main_cursor_until_newline_arrives(self):
        first=self.codex()[:1];self.write(first)
        initial=self.path.stat().st_size
        opaque=json.dumps(dict(timestamp='2026-09-15T12:00:01Z',ordinal=1,type='compacted',payload=dict(opaque='x'*1800)))
        with self.path.open('a') as stream:stream.write(opaque[:-2])
        with patch('collector.MAX_READ',256),patch('collector.MAX_LINE',512):
            for _ in range(12):scan_file(self.db,self.path,'codex')
            row=self.db.execute('SELECT offset,state FROM files').fetchone()
            self.assertEqual(row[0],initial);self.assertIn('opaqueRecord',json.loads(row[1]))
            self.db.close();self.db=connect(self.root/'spool.sqlite')
            with self.path.open('a') as stream:stream.write(opaque[-2:]+'\n')
            scan_file(self.db,self.path,'codex')
            row=self.db.execute('SELECT offset,state FROM files').fetchone()
            self.assertEqual(row[0],self.path.stat().st_size);self.assertNotIn('opaqueRecord',json.loads(row[1]))


    def test_native_format_upgrade_republishes_bounded_existing_claude_turns_across_restart(self):
        rows=[]
        for index in range(40):
            rows += [dict(type='user',uuid='turn-'+str(index),sessionId='claude',cwd='/repo',timestamp=f'2026-09-15T12:{index:02d}:00Z',message=dict(content='Prompt')),
                     dict(type='assistant',uuid='answer-'+str(index),parentUuid='turn-'+str(index),timestamp=f'2026-09-15T12:{index:02d}:01Z',message=dict(content=[],stop_reason='end_turn'))]
        self.write(rows)
        for _ in range(3):scan_file(self.db,self.path,'claude');drain(self.db,lambda body:dict(acknowledged=True,eventId=body['eventId']))
        offset,raw=self.db.execute('SELECT offset,state FROM files').fetchone();state=json.loads(raw);state.pop('nativeFormatVersion')
        with self.db:self.db.execute('UPDATE files SET state=?',(json.dumps(state),))
        scan_file(self.db,self.path,'claude')
        self.assertEqual(self.db.execute('SELECT count(*) FROM pending').fetchone()[0],25)
        self.db.close();self.db=connect(self.root/'spool.sqlite')
        for _ in range(2):scan_file(self.db,self.path,'claude')
        turns=[turn for (body,) in self.db.execute('SELECT body FROM pending') for turn in json.loads(body).get('turns',[])]
        self.assertEqual(len(turns),40);self.assertEqual(len({turn['id'] for turn in turns}),40)
        self.assertTrue(all(turn['nativeParserVersion']==5 for turn in turns))
        current=self.db.execute('SELECT offset,state FROM files').fetchone();self.assertEqual(current[0],offset)
        self.assertEqual(json.loads(current[1])['nativeFormatVersion'],1)

if __name__ == '__main__': unittest.main()
