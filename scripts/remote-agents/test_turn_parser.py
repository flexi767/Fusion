import unittest

from turn_parser import consume_codex


class CodexTurnTests(unittest.TestCase):
    def test_prompt_result_duration_and_native_patch(self):
        state = {}
        def event(at, kind, **payload):
            return dict(timestamp=f'2026-09-22T12:00:{at:02d}Z', type=kind, payload=payload)

        self.assertIsNone(consume_codex(state, event(0, 'event_msg', type='task_started', turn_id='turn-1')))
        first = consume_codex(state, event(1, 'event_msg', type='user_message', message='Fix this'))
        self.assertEqual((first['nativeTurnId'], first['ordinal'], first['revision']), ('turn-1', 0, 1))
        self.assertEqual(first['prompts'][0]['text'], 'Fix this')
        consume_codex(state, event(2, 'event_msg', type='item_completed', item=dict(type='CommandExecution')))
        changed = consume_codex(state, event(3, 'event_msg', type='item_completed', item=dict(
            type='FileChange', changes={'src/a.ts': {'type': 'modify', 'unified_diff': '@@ -1 +1 @@\n-old\n+new\n'},
                                         'src/b.ts': {'type': 'add'}})))
        self.assertEqual(changed['toolCallCount'], 1)
        self.assertEqual((changed['fileChanges'][0]['addedLines'], changed['fileChanges'][0]['removedLines']), (1, 1))
        self.assertFalse(changed['fileChanges'][1]['patchAvailable'])
        done = consume_codex(state, event(8, 'event_msg', type='task_complete', last_agent_message='Done'))
        self.assertEqual((done['state'], done['response'], done['durationMs'], done['durationSource']),
                         ('completed', 'Done', 8000, 'derived'))
        self.assertEqual(done['revision'], 4)

    def test_native_duration_and_interrupted_turn(self):
        state = {}
        consume_codex(state, dict(timestamp='2026-09-22T12:00:00Z', type='event_msg', payload=dict(type='task_started', turn_id='a')))
        consume_codex(state, dict(timestamp='2026-09-22T12:00:01Z', type='event_msg', payload=dict(type='user_message', message='Prompt')))
        result = consume_codex(state, dict(timestamp='2026-09-22T12:00:05Z', type='event_msg', payload=dict(type='turn_aborted', duration_ms=1700)))
        self.assertEqual((result['state'], result['durationMs'], result['durationSource']), ('interrupted', 1700, 'native'))

    def test_prompt_before_task_start_keeps_one_native_identity(self):
        state = {}
        prompt = dict(timestamp='2026-09-22T12:00:00Z', type='event_msg', payload=dict(type='user_message', message='First'))
        self.assertIsNone(consume_codex(state, prompt))
        first = consume_codex(state, dict(timestamp='2026-09-22T12:00:01Z', type='event_msg', payload=dict(type='task_started', turn_id='native-a')))
        self.assertEqual((first['nativeTurnId'], first['ordinal'], first['revision'], first['startedAt']),
                         ('native-a', 0, 1, '2026-09-22T12:00:00Z'))
        consume_codex(state, dict(timestamp='2026-09-22T12:00:02Z', type='event_msg', payload=dict(type='task_complete')))
        self.assertIsNone(consume_codex(state, dict(timestamp='2026-09-22T12:00:03Z', type='event_msg', payload=dict(type='user_message', message='Second'))))
        second = consume_codex(state, dict(timestamp='2026-09-22T12:00:04Z', type='event_msg', payload=dict(type='task_started', turn_id='native-b')))
        self.assertEqual((second['nativeTurnId'], second['ordinal'], second['prompts'][0]['text']), ('native-b', 1, 'Second'))


if __name__ == '__main__':
    unittest.main()
