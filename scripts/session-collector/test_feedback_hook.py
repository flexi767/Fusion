import hashlib
import json
from pathlib import Path
import tempfile
import time
import unittest
from datetime import datetime, timezone
from collector import connect
from feedback_hook import execute_once, run_hook, setup

class FeedbackTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.db=connect(Path(self.temp.name)/'ledger.sqlite');setup(self.db)
        self.command=dict(id='feedback-request-1234',operation='feedback',text='Check the failing test',expiresAt=datetime.fromtimestamp(time.time()+300,timezone.utc).isoformat())
    def tearDown(self):self.db.close();self.temp.cleanup()
    def test_retries_acknowledge_without_emitting_twice(self):
        emitted=[]
        self.assertEqual(execute_once(self.db,self.command,emitted.append),'applied')
        self.assertEqual(execute_once(self.db,self.command,emitted.append),'applied')
        self.assertEqual(len(emitted),1)
        self.assertEqual(execute_once(self.db,{**self.command,'text':'Conflicting reuse'},emitted.append),'failed')
        self.assertEqual(len(emitted),1)
    def test_ambiguous_crash_and_expiry_never_replay(self):
        digest=hashlib.sha256(json.dumps(self.command,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        with self.db:self.db.execute("INSERT INTO feedback_execution VALUES (?,?,'prepared',?)",(self.command['id'],digest,time.time()+300))
        self.assertEqual(execute_once(self.db,self.command,lambda _:self.fail('Ambiguous delivery replayed')),'failed')
        self.assertEqual(execute_once(self.db,{**self.command,'id':'expired-request-1234'},lambda _:self.fail('Expired delivery emitted'),now=time.time()+301),'failed')
    def test_hook_identity_generation_and_capability_are_explicit(self):
        for provider in ['codex','claude']:
            emitted=[];registrations=[];acks=[]
            def send(operation):
                if operation.get('probe'):return dict(hostId='m3',acknowledged=True)
                if 'runtime' in operation:
                    registrations.append(operation['runtime']);return dict(acknowledged=True)
                if 'commandClaim' in operation:
                    claim=operation['commandClaim']
                    return dict(commands=[{**self.command,'id':'feedback-request-'+provider,'hostId':'m3','sessionId':claim['sessionId'],'generation':claim['generation'],'nativeSessionId':'native'}])
                acks.append(operation['commandAck']);return dict(acknowledged=True)
            payload=dict(session_id='native',hook_event_name='PreToolUse')
            run_hook(self.db,'m3',provider,payload,send,emitted.append)
            run_hook(self.db,'m3',provider,payload,send,emitted.append)
            self.assertEqual(registrations[0]['capabilities'],['feedback'])
            self.assertEqual(registrations[0]['generation'],registrations[1]['generation'])
            self.assertEqual(len(emitted),1);self.assertEqual(acks[-1]['status'],'applied')
            self.assertIn('additionalContext',emitted[0]['hookSpecificOutput'])
    def test_wrong_host_never_registers_a_runtime(self):
        with self.assertRaises(ValueError):run_hook(self.db,'m3','codex',dict(session_id='native',hook_event_name='SessionStart'),lambda _:dict(hostId='j',acknowledged=True),lambda _:self.fail('Wrong host emitted'))

if __name__=='__main__':unittest.main()
