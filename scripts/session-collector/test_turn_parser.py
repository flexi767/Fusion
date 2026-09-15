import unittest
from turn_parser import consume
class TurnParserTests(unittest.TestCase):
    def test_astral_prompts_responses_and_patches_obey_utf16_limits(self):
        for provider in ['codex_cli','claude_code']:
            state={};at='2026-09-15T12:00:00Z';large='😀'*70000
            def send(kind,**values):consume(state,dict(type=kind,timestamp=at,**values),provider)
            if provider=='codex_cli':
                send('event_msg',payload=dict(type='task_started',turn_id='t'))
                send('response_item',payload=dict(type='message',role='user',content=large))
                send('event_msg',payload=dict(type='item_completed',turn_id='t',item=dict(type='FileChange',changes={'a.py':dict(diff='+'+large)})))
                send('event_msg',payload=dict(type='task_completed',turn_id='t',last_agent_message=large))
            else:
                send('user',uuid='t',message=dict(content=large))
                send('assistant',message=dict(content=[dict(type='tool_use',id='edit',name='Write',input=dict(file_path='a.py',content=large))]))
                send('user',message=dict(content=[dict(type='tool_result',tool_use_id='edit')]))
                send('assistant',message=dict(content=[dict(type='text',text=large)],stop_reason='end_turn'))
            turn=state['turns']['t']
            self.assertEqual(len(turn['prompts'][0].encode('utf-16-le'))//2,65536)
            self.assertEqual(len(turn['response'].encode('utf-16-le'))//2,131072)
            self.assertLessEqual(len(turn['files'][0]['diff'].encode('utf-16-le'))//2,65536)
            self.assertTrue(turn['files'][0]['truncated'])

    def test_codex_prompt_final_duration_and_canonical_usage_replace_fallback(self):
        state={}
        def send(kind, payload, at='2026-09-15T12:00:00Z'):
            consume(state,dict(type=kind,payload=payload,timestamp=at),'codex_cli')
        send('turn_context',dict(model='gpt-5'))
        send('event_msg',dict(type='task_started',turn_id='t'))
        send('response_item',dict(type='message',role='user',content=[dict(type='input_text',text='Fix tests')]))
        send('event_msg',dict(type='token_count',info=dict(total_token_usage=dict(input_tokens=100,output_tokens=20))))
        send('token_usage_record',dict(turn_id='t',response_id='r',usage=dict(input_tokens=100,output_tokens=20)))
        send('token_usage_record',dict(turn_id='t',response_id='r',usage=dict(input_tokens=100,output_tokens=20)))
        send('event_msg',dict(type='task_completed',turn_id='t',duration_ms=1250,last_agent_message='Fixed'),'2026-09-15T12:00:02Z')
        turn=state['turns']['t']
        self.assertEqual(turn['prompts'],['Fix tests']);self.assertEqual(turn['response'],'Fixed')
        self.assertEqual(turn['durationMs'],1250);self.assertEqual(turn['usage'][0]['inputTokens'],100)
    def test_claude_cache_semantics_and_only_successful_edit_results(self):
        state={}
        def send(kind, message, **extra):
            consume(state,dict(type=kind,message=message,timestamp='2026-09-15T12:00:00Z',**extra),'claude_code')
        send('user',dict(content='Edit file'),uuid='t')
        send('assistant',dict(id='r',model='claude-sonnet',usage=dict(input_tokens=10,cache_read_input_tokens=20,cache_creation_input_tokens=30,output_tokens=4),content=[dict(type='tool_use',id='edit',name='Edit',input=dict(file_path='/repo/a',old_string='old',new_string='new'))]))
        send('user',dict(content=[dict(type='tool_result',tool_use_id='edit',is_error=True)]))
        self.assertEqual(state['turns']['t']['files'],[])
        send('user',dict(content=[dict(type='tool_result',tool_use_id='edit')]))
        turn=state['turns']['t'];self.assertEqual(turn['usage'][0]['inputTokens'],60)
        self.assertEqual(turn['usage'][0]['cachedInputTokens'],20);self.assertEqual(turn['usage'][0]['cacheWriteTokens'],30)
        self.assertEqual(turn['files'][0]['added'],1);self.assertEqual(turn['files'][0]['removed'],1)
    def test_missing_categories_remain_unknown_and_current_context_can_shrink(self):
        state={}
        def send(message): consume(state,dict(type='assistant',message=message,timestamp='2026-09-15T12:00:00Z'),'claude_code')
        send(dict(id='a',model='claude',usage=dict(input_tokens=100,output_tokens=10),content=[]))
        usage=next(iter(state['turns'].values()))['usage'][0]
        self.assertIsNone(usage['inputTokens']);self.assertIsNone(usage['cachedInputTokens']);self.assertIsNone(usage['cacheWriteTokens'])
        send(dict(id='b',model='claude',usage=dict(input_tokens=20,cache_read_input_tokens=0,cache_creation_input_tokens=0,output_tokens=5),content=[]))
        usage=next(iter(state['turns'].values()))['usage'][0]
        self.assertIsNone(usage['inputTokens']);self.assertEqual(usage['contextTokens'],20)
        self.assertEqual(usage['outputTokens'],15)

    def test_canonical_usage_in_one_turn_does_not_disable_next_turn_cumulative_deltas(self):
        state={}
        def send(kind,payload):consume(state,dict(type=kind,payload=payload,timestamp='2026-09-15T12:00:00Z'),'codex_cli')
        send('event_msg',dict(type='task_started',turn_id='first'))
        send('token_usage_record',dict(turn_id='first',response_id='r',usage=dict(input_tokens=100,output_tokens=20)))
        send('event_msg',dict(type='token_count',info=dict(total_token_usage=dict(input_tokens=100,output_tokens=20))))
        send('event_msg',dict(type='task_started',turn_id='second'))
        send('event_msg',dict(type='token_count',info=dict(total_token_usage=dict(input_tokens=120,output_tokens=30),last_token_usage=dict(input_tokens=20))))
        self.assertEqual(state['turns']['second']['usage'][0]['inputTokens'],20)
        self.assertEqual(state['turns']['second']['usage'][0]['outputTokens'],10)
        self.assertIsNone(state['turns']['second']['usage'][0]['cachedInputTokens'])

    def test_duplicate_native_events_do_not_inflate_prompts_tools_or_patches(self):
        state={}
        def send(payload):consume(state,dict(type='event_msg',timestamp='2026-09-15T12:00:00Z',payload=payload),'codex_cli')
        for tid in ['first','second']:
            send(dict(type='task_started',turn_id=tid))
            for prompt_id in ['one','two']:
                event=dict(type='item_completed',turn_id=tid,item=dict(type='UserMessage',id=prompt_id,content='Same steering'))
                send(event);send(event)
            for typ in ['CommandExecution','McpToolCall']:
                event=dict(type='item_completed',turn_id=tid,item=dict(type=typ,id=typ));send(event);send(event)
            event=dict(type='item_completed',turn_id=tid,item=dict(type='FileChange',changes={'../shared.py':{'diff':'+edit'}}))
            send(event);send(event)
            self.assertEqual(state['turns'][tid]['prompts'],['Same steering','Same steering'])
            self.assertEqual(state['turns'][tid]['toolCalls'],2)
            self.assertEqual(state['turns'][tid]['files'][0]['added'],1)
        claude={}
        def user(uid):consume(claude,dict(type='user',uuid=uid,message=dict(content='Repeat'),timestamp='2026-09-15T12:00:00Z'),'claude_code')
        user('one');user('one');user('two');user('two')
        self.assertEqual(claude['turns']['one']['prompts'],['Repeat','Repeat'])

    def test_late_explicit_turn_events_never_reassign_following_unscoped_output(self):
        state={}
        def send(kind,payload,second):consume(state,dict(type=kind,payload=payload,timestamp=f'2026-09-15T12:00:{second:02}Z'),'codex_cli')
        send('event_msg',dict(type='task_started',turn_id='old'),0)
        send('event_msg',dict(type='task_started',turn_id='current'),1)
        for kind,payload in [
            ('token_usage_record',dict(turn_id='old',response_id='late',usage=dict(input_tokens=10,output_tokens=2))),
            ('event_msg',dict(type='item_completed',turn_id='old',item=dict(type='FileChange',changes={'a.py':dict(diff='+old edit')}))),
            ('event_msg',dict(type='task_completed',turn_id='old')),
            ('event_msg',dict(type='task_started',turn_id='old')),
        ]:
            send(kind,payload,0)
            self.assertEqual(state['active'],'current')
        send('response_item',dict(type='message',role='assistant',phase='final',content='Current result'),2)
        self.assertEqual(state['turns']['current']['response'],'Current result')
        self.assertEqual(state['turns']['old']['response'],'')
        self.assertEqual(state['turns']['old']['usage'][0]['inputTokens'],10)
        self.assertEqual(state['turns']['old']['files'][0]['added'],1)

    def test_claude_text_and_thinking_with_tool_stop_reason_keep_turn_open(self):
        for stop_reason in ['tool_use',None,'end_turn','stop_sequence','max_tokens']:
            with self.subTest(stop_reason=stop_reason):
                state={}
                def send(kind,message,**extra):consume(state,dict(type=kind,message=message,timestamp='2026-09-15T12:00:00Z',**extra),'claude_code')
                send('user',dict(content='Start'),uuid='first')
                send('assistant',dict(content=[dict(type='text',text='Interim output')],stop_reason=stop_reason))
                finished=stop_reason in ('end_turn','stop_sequence','max_tokens')
                self.assertEqual(state['turns']['first']['completedAt'] is not None,finished)
                send('user',dict(content='Steering'),uuid='second')
                self.assertEqual(state['active'],'second' if finished else 'first')
                self.assertEqual(state['turns'][state['active']]['prompts'],['Steering'] if finished else ['Start','Steering'])

    def test_late_claude_tool_result_does_not_switch_the_active_turn(self):
        state={}
        def send(kind,message,**extra):consume(state,dict(type=kind,message=message,timestamp='2026-09-15T12:00:00Z',**extra),'claude_code')
        send('user',dict(content='First'),uuid='first')
        send('assistant',dict(content=[dict(type='tool_use',id='edit',name='Edit',input=dict(file_path='a.py',old_string='a',new_string='b'))]))
        send('assistant',dict(content=[dict(type='text',text='Finished')],stop_reason='end_turn'))
        send('user',dict(content='Second'),uuid='second')
        send('user',dict(content=[dict(type='tool_result',tool_use_id='edit')]))
        send('assistant',dict(content=[dict(type='text',text='Second result')],stop_reason='end_turn'))
        self.assertEqual(state['turns']['first']['files'][0]['added'],1)
        self.assertEqual(state['turns']['first']['response'],'Finished')
        self.assertEqual(state['turns']['second']['response'],'Second result')


    def test_replayed_claude_records_keep_native_owners_and_never_complete_a_newer_turn(self):
        import copy
        state={}
        def event(kind,uuid,at,content,**extra):
            return dict(type=kind,uuid=uuid,timestamp=at,message=dict(content=content,**extra.pop('message',{})),**extra)
        first=event('user','first','2026-09-15T12:00:00Z','First prompt')
        answer=event('assistant','answer','2026-09-15T12:00:01Z',[dict(type='text',text='First answer')],parentUuid='first',message=dict(id='request',model='claude',stop_reason='end_turn',usage=dict(input_tokens=10,cache_read_input_tokens=0,cache_creation_input_tokens=0,output_tokens=2)))
        second=event('user','second','2026-09-15T12:01:00Z','Second prompt',parentUuid='answer')
        for e in [first,answer,second]:consume(state,e,'claude_code')
        expected=copy.deepcopy(state['turns']['second'])
        for e in [first,answer,first,answer]:consume(state,e,'claude_code')
        self.assertEqual(state['active'],'second')
        self.assertEqual(state['turns']['second'],expected)
        # A changed snapshot of the same request still belongs to the first turn.
        amended=copy.deepcopy(answer);amended['uuid']='answer-amended';amended['message']['usage']['output_tokens']=3
        consume(state,amended,'claude_code')
        self.assertEqual(state['turns']['first']['usage'][0]['outputTokens'],3)
        self.assertEqual(state['turns']['first']['usage'][0]['requests'],1)
        self.assertEqual(state['turns']['second'],expected)
        # Delayed provider durations route by native parent, never the current turn.
        consume(state,dict(type='system',uuid='duration',parentUuid='answer',timestamp='2026-09-15T12:00:02Z',subtype='turn_duration',durationMs=2000),'claude_code')
        self.assertEqual(state['turns']['first']['durationMs'],2000)
        self.assertIsNone(state['turns']['second']['completedAt'])
        self.assertEqual(state['active'],'second')

    def test_late_claude_assistant_cannot_rewind_output_or_current_context(self):
        state={}
        consume(state,dict(type='user',uuid='first',timestamp='2026-09-15T12:00:00Z',message=dict(content='Prompt')),'claude_code')
        for uuid,at,value,tokens,stop in [('new','2026-09-15T12:00:03Z','Latest',20,'end_turn'),('old','2026-09-15T12:00:01Z','Earlier',100,None)]:
            consume(state,dict(type='assistant',uuid=uuid,parentUuid='first',timestamp=at,message=dict(id=uuid,model='claude',content=[dict(type='text',text=value)],stop_reason=stop,usage=dict(input_tokens=tokens,cache_read_input_tokens=0,cache_creation_input_tokens=0,output_tokens=2))),'claude_code')
        turn=state['turns']['first']
        self.assertEqual(turn['response'],'Latest');self.assertEqual(turn['completedAt'],'2026-09-15T12:00:03Z')
        self.assertEqual(turn['usage'][0]['requests'],2);self.assertEqual(turn['usage'][0]['inputTokens'],120)
        self.assertEqual(turn['usage'][0]['contextTokens'],20)


    def test_partial_claude_request_replay_preserves_its_full_input_band_and_metadata(self):
        state={}
        for index,tokens in enumerate([250000,0]):
            consume(state,dict(type='assistant',uuid=str(index),timestamp='2026-09-15T12:00:00Z',message=dict(id='request',**({'model':'claude'} if index==0 else {}),content=[],usage=dict(input_tokens=tokens,cache_read_input_tokens=0,cache_creation_input_tokens=0,output_tokens=2,**({'speed':'standard'} if index==0 else {})))),'claude_code')
        usage=next(iter(state['turns'].values()))['usage']
        self.assertEqual(len(usage),1)
        self.assertEqual(usage[0]['inputTokens'],250000);self.assertEqual(usage[0]['contextTokens'],250000)
        self.assertTrue(usage[0]['longContext']);self.assertEqual(usage[0]['model'],'claude')
        self.assertEqual(usage[0]['requests'],1);self.assertEqual(usage[0]['serviceTier'],'standard')

if __name__ == '__main__':unittest.main()
