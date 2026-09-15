"""Lazy parser maps inside the collector's existing SQLite transaction.

Only records touched by a bounded transcript chunk are materialized. Historical
request and deduplication records remain durable for late events and replay.
"""
import json
from collections.abc import MutableMapping

NAMESPACES = ('turns', 'requests', 'fallback', 'calls', 'edits', 'promptEvents', 'nativePrompts', 'toolEvents', 'claudeOwners')
class ParserLedgerCapacity(ValueError):pass

def initialize(db):
    db.executescript('''
      CREATE TABLE IF NOT EXISTS parser_records (
        path TEXT NOT NULL, generation TEXT NOT NULL, namespace TEXT NOT NULL,
        key TEXT NOT NULL, owner TEXT, value TEXT NOT NULL,
        PRIMARY KEY(path,generation,namespace,key));
      CREATE INDEX IF NOT EXISTS parser_record_owner ON parser_records(path,generation,namespace,owner);
      CREATE TABLE IF NOT EXISTS parser_usage(id INTEGER PRIMARY KEY, records INTEGER NOT NULL, bytes INTEGER NOT NULL);
      INSERT OR IGNORE INTO parser_usage SELECT 1,count(*),coalesce(sum(length(CAST(value AS BLOB))),0) FROM parser_records;
      CREATE TRIGGER IF NOT EXISTS parser_insert AFTER INSERT ON parser_records BEGIN
        UPDATE parser_usage SET records=records+1,bytes=bytes+length(CAST(new.value AS BLOB)) WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS parser_delete AFTER DELETE ON parser_records BEGIN
        UPDATE parser_usage SET records=records-1,bytes=bytes-length(CAST(old.value AS BLOB)) WHERE id=1; END;
      CREATE TRIGGER IF NOT EXISTS parser_update AFTER UPDATE OF value ON parser_records BEGIN
        UPDATE parser_usage SET bytes=bytes+length(CAST(new.value AS BLOB))-length(CAST(old.value AS BLOB)) WHERE id=1; END;
    ''')

class ParserMap(MutableMapping):
    def __init__(self, db, path, generation, namespace):
        self.db,self.path,self.generation,self.namespace=db,path,generation,namespace
        self.cache={}
    def __getitem__(self,key):
        key=str(key)
        if key not in self.cache:
            row=self.db.execute('SELECT value FROM parser_records WHERE path=? AND generation=? AND namespace=? AND key=?',(self.path,self.generation,self.namespace,key)).fetchone()
            if row is None:raise KeyError(key)
            self.cache[key]=json.loads(row[0])
        return self.cache[key]
    def __setitem__(self,key,value):self.cache[str(key)]=value
    def __delitem__(self,key):raise TypeError('Parser records are retained until checkpoint reset')
    def __iter__(self):
        seen=set(self.cache)
        yield from self.cache
        for row in self.db.execute('SELECT key FROM parser_records WHERE path=? AND generation=? AND namespace=?',(self.path,self.generation,self.namespace)):
            if row[0] not in seen:yield row[0]
    def __len__(self):
        return sum(1 for _ in self)
    def values_for_turn(self,turn):
        # Do not hydrate every request in the session for one turn's accounting.
        keys=set();size=0
        for key,value in self.cache.items():
            if value.get('turn')==turn:
                size+=len(json.dumps(value).encode())
                if size>8*1024*1024:raise ParserLedgerCapacity('Single-turn request state exceeds memory bound')
                keys.add(key);yield value
        for key,value in self.db.execute('SELECT key,value FROM parser_records WHERE path=? AND generation=? AND namespace=? AND owner=?',(self.path,self.generation,self.namespace,turn)):
            if key not in keys and key not in self.cache:
                size+=len(value.encode())
                if size>8*1024*1024:raise ParserLedgerCapacity('Single-turn request state exceeds memory bound')
                yield json.loads(value)
    def encoded(self):
        return [(key,json.dumps(value),value.get('turn') if isinstance(value,dict) else None) for key,value in self.cache.items()]
    def flush(self,encoded):
        self.db.executemany('INSERT INTO parser_records VALUES (?,?,?,?,?,?) ON CONFLICT(path,generation,namespace,key) DO UPDATE SET owner=excluded.owner,value=excluded.value',
            [(self.path,self.generation,self.namespace,key,owner,value) for key,value,owner in encoded])

def attach(db,path,state):
    turns=state.setdefault('turnsState',{})
    for name in NAMESPACES:
        turns[name]=ParserMap(db,str(path),state['ledgerGeneration'],name)

def prepare(state):
    turns=state.get('turnsState',{})
    wire={**state,'turnsState':{key:value for key,value in turns.items() if key not in NAMESPACES}}
    serialized=json.dumps(wire)
    maps=[(turns[name],turns[name].encoded()) for name in NAMESPACES]
    memory=len(serialized.encode())+sum(len(value.encode())+len(key.encode()) for _,rows in maps for key,value,_ in rows)
    return serialized,maps,memory
