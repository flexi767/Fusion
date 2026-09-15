import unittest
from turn_parser import consume
class TurnParserTests(unittest.TestCase):
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

if __name__ == '__main__':unittest.main()
