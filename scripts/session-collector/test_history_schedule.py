import json
from pathlib import Path
import tempfile
import unittest
from collector import connect, history_work

class HistoryScheduleTests(unittest.TestCase):
    def setUp(self):self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.db=connect(self.root/'spool.sqlite')
    def tearDown(self):self.db.close();self.temp.cleanup()
    def checkpoint(self,name,provider='codex',state=None,offset=None):
        path=self.root/name;path.write_text('{}\n');stat=path.stat()
        state={'parserVersion':5 if provider=='claude' else 4,'nativeFormatVersion':1,**(state or {})}
        with self.db:self.db.execute('INSERT OR REPLACE INTO files VALUES (?,?,?,?)',(str(path),f'{stat.st_dev}:{stat.st_ino}',stat.st_size if offset is None else offset,json.dumps(state)))
        return provider,path
    def test_completed_cohort_cannot_consume_backlog_slots_and_live_discovery_list_is_unchanged(self):
        files=[self.checkpoint(f'complete-{i}') for i in range(300)]
        backlog=[self.checkpoint('codex-backlog',offset=0),self.checkpoint('claude-backlog','claude',offset=0)]
        files+=backlog
        self.assertEqual(history_work(self.db,files),backlog);self.assertEqual(len(files),302)
    def test_both_providers_reenter_after_append_and_pending_publish_or_generation_change(self):
        for provider in ['codex','claude']:
            file=self.checkpoint(provider,provider)
            self.assertEqual(history_work(self.db,[file]),[])
            with file[1].open('a') as stream:stream.write('{}\n')
            self.assertEqual(history_work(self.db,[file]),[file])
            for state in [{'turnsState':{'changed':['turn']}},{'parserVersion':0}]:
                file=self.checkpoint(provider,provider,state)
                self.assertEqual(history_work(self.db,[file]),[file])
        file=self.checkpoint('publish','claude',{'nativeFormatVersion':None})
        self.assertEqual(history_work(self.db,[file]),[file])
    def test_unknown_rotated_truncated_and_retained_sources_are_scheduled_safely(self):
        file=self.checkpoint('native');path=file[1];stat=path.stat()
        retained={'inode':f'{stat.st_dev}:{stat.st_ino}','size':stat.st_size,'mtimeNs':stat.st_mtime_ns,'parserVersion':4}
        with self.db:self.db.execute('UPDATE files SET offset=0,state=? WHERE path=?',(json.dumps({'parserRetained':retained}),str(path)))
        self.assertEqual(history_work(self.db,[file]),[])
        path.write_text('{}\nmore\n');self.assertEqual(history_work(self.db,[file]),[file])
        file=self.checkpoint('native');path.write_text('');self.assertEqual(history_work(self.db,[file]),[file])
        file=self.checkpoint('native');path.rename(self.root/'rotated');path.write_text('{}\n');self.assertEqual(history_work(self.db,[file]),[file])
        unknown=self.root/'new';unknown.write_text('{}\n');self.assertEqual(history_work(self.db,[('claude',unknown)]),[('claude',unknown)])

if __name__=='__main__':unittest.main()
