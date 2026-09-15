#!/usr/bin/env python3
"""Explicit bounded cleanup of acknowledged, unchanged native parser caches."""
import argparse
import fcntl
import json
import sqlite3
import time
from pathlib import Path

MAX_FILES = 5
SCAN_FILES = 50
MAX_RECORDS = 10_000


def eligible(db, row, cutoff):
    path,inode,offset,encoded=row
    state=json.loads(encoded)
    if state.get('parserRetained') or state.get('opaqueRecord') or state.get('turnsState',{}).get('changed'):return None
    try:stat=Path(path).stat()
    except OSError:return None
    if f'{stat.st_dev}:{stat.st_ino}'!=inode or stat.st_size!=offset or stat.st_mtime>=cutoff:return None
    count,size=db.execute('SELECT count(*),coalesce(sum(size),0) FROM (SELECT length(CAST(value AS BLOB)) size FROM parser_records WHERE path=? LIMIT ?)',(path,MAX_RECORDS+1)).fetchone()
    if not count or count>MAX_RECORDS:return None
    return dict(path=path,records=count,bytes=size,offset=offset,mtimeNs=stat.st_mtime_ns,inode=inode,parserVersion=state.get('parserVersion'),nativeFormatVersion=state.get('nativeFormatVersion'))


def review(db, days, now=None, after=''):
    if type(days) is not int or not 1<=days<=3650:raise ValueError('Keep days must be between 1 and 3650')
    now=time.time() if now is None else now
    rows=db.execute('SELECT path,inode,offset,state FROM files WHERE path>? ORDER BY path LIMIT ?',(after,SCAN_FILES)).fetchall()
    items=[];cursor=after
    for row in rows:
        cursor=row[0];item=eligible(db,row,now-days*86400)
        if item:items.append(item)
        if len(items)==MAX_FILES:break
    return dict(files=items,nextCursor=cursor if len(rows)==SCAN_FILES or len(items)==MAX_FILES else None,
                pendingDeliveries=db.execute('SELECT count(*) FROM pending').fetchone()[0])


def prune(db, days, now=None, after=''):
    now=time.time() if now is None else now
    with db:
        # Acquire SQLite's write lock before checking acknowledgements.
        db.execute('UPDATE parser_usage SET records=records WHERE id=1')
        if db.execute('SELECT count(*) FROM pending').fetchone()[0]:raise ValueError('All pending and rejected deliveries must be acknowledged before parser cleanup')
        preview=review(db,days,now,after);removed=[]
        for item in preview['files']:
            row=db.execute('SELECT path,inode,offset,state FROM files WHERE path=?',(item['path'],)).fetchone()
            current=eligible(db,row,now-days*86400) if row else None
            if current!=item:continue
            # Offset zero makes older readers safely reparse instead of trusting
            # an empty ledger. New readers skip the unchanged retained prefix.
            state={'parserRetained':{'inode':item['inode'],'size':item['offset'],'mtimeNs':item['mtimeNs'],'parserVersion':item['parserVersion'],'nativeFormatVersion':item['nativeFormatVersion'],'at':now}}
            db.execute('DELETE FROM parser_records WHERE path=?',(item['path'],))
            db.execute('UPDATE files SET offset=0,state=? WHERE path=?',(json.dumps(state),item['path']))
            removed.append(item)
        return {**preview,'files':removed,'removedRecords':sum(item['records'] for item in removed)}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state',type=Path,required=True)
    parser.add_argument('--keep-days',type=int,default=30)
    parser.add_argument('--after',default='',help='Continue from the previous nextCursor')
    parser.add_argument('--apply',action='store_true',help='Requires the collector stopped and its durable queue empty')
    args=parser.parse_args()
    if not args.state.is_file():parser.error('Existing collector spool required')
    lock=None
    try:
        if args.apply:
            lock=args.state.with_suffix('.lock').open('a')
            try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError:parser.error('Stop this spool\'s collector before applying parser cleanup')
            from collector import connect
            db=connect(args.state)
        else:db=sqlite3.connect(args.state.resolve().as_uri()+'?mode=ro',uri=True)
        try:result=(prune if args.apply else review)(db,args.keep_days,after=args.after)
        finally:db.close()
        print(json.dumps({'applied':args.apply,**result},indent=2))
    except ValueError as error:parser.error(str(error))
    finally:
        if lock:lock.close()

if __name__=='__main__':main()
