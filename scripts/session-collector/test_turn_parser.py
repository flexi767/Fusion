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
if __name__ == '__main__':unittest.main()
