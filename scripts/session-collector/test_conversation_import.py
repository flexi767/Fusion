import json
import sqlite3
import unittest
from import_agentpulse import conversations_for_session

class ConversationImportTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:');self.db.row_factory=sqlite3.Row
        self.db.executescript('''CREATE TABLE ask_threads(id TEXT,title TEXT,created_at TEXT,archived_at TEXT);
          CREATE TABLE ask_messages(id TEXT,thread_id TEXT,role TEXT,content TEXT,context_session_ids TEXT,tokens_in INTEGER,tokens_out INTEGER,error_message TEXT,created_at TEXT);''')
    def tearDown(self):self.db.close()
    def test_exact_source_references_preserve_both_sides_without_inferring_other_sessions(self):
        self.db.execute("INSERT INTO ask_threads VALUES ('thread','Recent activity','2026-09-15 12:00:00',NULL)")
        self.db.execute("INSERT INTO ask_messages VALUES ('one','thread','user','Summarize only',NULL,NULL,NULL,NULL,'2026-09-15 12:00:00')")
        self.db.execute("INSERT INTO ask_messages VALUES ('two','thread','assistant','Unfinished work',?,20,5,NULL,'2026-09-15 12:00:01')",(json.dumps(['native','other']),))
        rows,truncated=conversations_for_session(self.db,'native')
        self.assertFalse(truncated);self.assertEqual([m['role'] for m in rows[0]['messages']],['user','assistant'])
        self.assertEqual(rows[0]['messages'][1]['contextSessionIds'],['native','other']);self.assertEqual(rows[0]['messages'][1]['outputTokens'],5)
        self.assertEqual(conversations_for_session(self.db,'nativ'),([],False))
    def test_bounds_history_with_explicit_coverage_and_visible_truncation(self):
        for i in range(4):
            self.db.execute('INSERT INTO ask_threads VALUES (?,?,?,NULL)',(str(i),'Thread',f'2026-09-1{i} 12:00:00'))
            for n in range(12):self.db.execute('INSERT INTO ask_messages VALUES (?,?,?,?,?,NULL,NULL,NULL,?)',(f'{i}-{n:02}',str(i),'assistant','😀'*3000+'\0',json.dumps(['native']),f'2026-09-1{i} 12:00:{n:02}'))
        rows,truncated=conversations_for_session(self.db,'native')
        self.assertTrue(truncated);self.assertEqual(len(rows),3)
        for row in rows:
            self.assertEqual(row['totalMessages'],12);self.assertEqual(len(row['messages']),10)
            self.assertTrue(all(m['truncated'] and len(m['content'].encode('utf-16-le'))==8000 for m in row['messages']))
        self.db.execute('DROP TABLE ask_messages')
        self.assertEqual(conversations_for_session(self.db,'native'),([],False))

if __name__=='__main__':unittest.main()
