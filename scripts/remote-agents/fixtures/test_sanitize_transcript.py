import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent)]

from sanitize_transcript import Sanitizer, sanitize_file, validate  # noqa: E402
from turn_parser import consume_claude  # noqa: E402


class SanitizeTests(unittest.TestCase):
    def test_keeps_structure_drops_text_and_parses(self):
        secret = 'deploy to secret-host.example with token abc123'
        events = [
            dict(type='user', timestamp='2026-09-22T12:00:00Z', sessionId='s-1', cwd='/home/me/repo',
                 uuid='u-1', message=dict(role='user', content=secret)),
            dict(type='assistant', timestamp='2026-09-22T12:00:01Z', sessionId='s-1', cwd='/home/me/repo',
                 message=dict(id='m-1', model='claude-opus-4-1[1m]', usage=dict(input_tokens=7, output_tokens=3),
                              content=[dict(type='tool_use', id='t-1', name='Edit',
                                            input=dict(file_path='/home/me/repo/app.py', old_string=secret))])),
            dict(type='user', timestamp='2026-09-22T12:00:02Z', sessionId='s-1', cwd='/home/me/repo',
                 message=dict(content=[dict(type='tool_result', tool_use_id='t-1', content=secret)]),
                 toolUseResult=dict(structuredPatch=[dict(oldStart=1, oldLines=1, newStart=1, newLines=1,
                                                          lines=['-' + secret, '+' + secret])])),
            dict(type='system', subtype='turn_duration', timestamp='2026-09-22T12:00:05Z', sessionId='s-1',
                 cwd='/home/me/repo', durationMs=4200),
        ]
        with tempfile.TemporaryDirectory() as directory:
            source, target = Path(directory) / 'in.jsonl', Path(directory) / 'out.jsonl'
            source.write_text(''.join(json.dumps(e) + '\n' for e in events))
            self.assertEqual(sanitize_file('claude', source, target), 4)
            text = target.read_text()
            for leak in ('secret', 'abc123', '/home/me', 'app.py', 's-1', '2026-09-22'):
                self.assertNotIn(leak, text)
            clean = [json.loads(line) for line in text.splitlines()]
        self.assertEqual(clean[1]['message']['model'], 'claude-opus-4-1[1m]')
        self.assertEqual(clean[1]['message']['usage'], dict(input_tokens=7, output_tokens=3))
        state, last = {}, None
        for event in clean:
            last = consume_claude(state, event) or last
        change = last['fileChanges'][0]
        self.assertEqual((change['addedLines'], change['removedLines']), (1, 1))
        self.assertEqual((last['durationMs'], last['durationSource']), (4200, 'native'))

    def test_validate_rejects_unknown_text(self):
        with self.assertRaises(ValueError):
            validate(dict(note='free text that escaped'))
        validate(Sanitizer().mapping(dict(note='free text that escaped')))

    def test_head_keeps_session_meta_before_window(self):
        lines = [dict(type='session_meta', timestamp='2026-09-22T12:00:00Z', payload=dict(id='x'))] + [
            dict(type='event_msg', timestamp=f'2026-09-22T12:00:{i:02d}Z', payload=dict(type='token_count'))
            for i in range(1, 10)]
        with tempfile.TemporaryDirectory() as directory:
            source, target = Path(directory) / 'in.jsonl', Path(directory) / 'out.jsonl'
            source.write_text(''.join(json.dumps(e) + '\n' for e in lines))
            self.assertEqual(sanitize_file('codex', source, target, start=5, limit=2, head=1), 3)
            types = [json.loads(line)['type'] for line in target.read_text().splitlines()]
        self.assertEqual(types, ['session_meta', 'event_msg', 'event_msg'])


if __name__ == '__main__':
    unittest.main()
