import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from collector import connect, enqueue, drain, diagnostics
import delivery_metrics

class DeliveryMetricsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name)/'spool.sqlite';self.db=connect(self.path)
    def tearDown(self):self.db.close();self.temp.cleanup()
    def enqueue(self,event,at='1970-01-01T00:16:39Z',key='session'):
        with self.db:enqueue(self.db,dict(eventId=event,observation=dict(observedAt=at)),key)
    def ack(self,body):return dict(acknowledged=True,eventId=body['eventId'])
    def test_outage_restart_ageing_and_retries_preserve_original_live_eligibility(self):
        with patch('collector.time.time',return_value=1000):
            self.enqueue('live')
            with self.assertRaises(OSError):drain(self.db,lambda _:(_ for _ in ()).throw(OSError('offline')))
        self.db.close();self.db=connect(self.path)
        with patch('collector.time.time',return_value=1600):
            self.assertEqual(diagnostics(self.db)['oldestLivePendingMs'],600000)
            with self.assertRaises(ValueError):drain(self.db,lambda _:dict(acknowledged=True,eventId='wrong'))
            self.assertEqual(diagnostics(self.db)['liveLagSamples'],0)
            drain(self.db,self.ack);drain(self.db,self.ack)
            metrics=diagnostics(self.db)
        self.assertEqual(metrics['liveLagSamples'],1);self.assertEqual(metrics['liveLagP95Ms'],601000)
        self.assertEqual(metrics['liveQueueP95Ms'],600000);self.assertNotIn('oldestLivePendingMs',metrics)
    def test_coalescing_records_only_exact_acknowledged_snapshot_and_excludes_backfill(self):
        with patch('collector.time.time',return_value=1000):
            self.enqueue('replaced');self.enqueue('cold','1970-01-01T00:00:01Z','cold')
            self.enqueue('history',key=None)
            def update_during_send(body):
                if body['eventId']=='replaced':self.enqueue('latest')
                return self.ack(body)
            drain(self.db,update_during_send)
            self.assertEqual(diagnostics(self.db)['liveLagSamples'],0)
        with patch('collector.time.time',return_value=1002):
            drain(self.db,self.ack)
            self.assertEqual(diagnostics(self.db)['liveLagSamples'],1)
            self.assertEqual(diagnostics(self.db)['liveLagP95Ms'],3000)
        self.assertEqual(self.db.execute('SELECT event_id FROM delivery_samples').fetchall(),[('latest',)])
    def test_clock_skew_is_visible_and_empty_window_has_no_invented_zero_latency(self):
        with patch('collector.time.time',return_value=1000):
            self.enqueue('future','1970-01-01T00:16:45Z');drain(self.db,self.ack)
            metrics=diagnostics(self.db)
            self.assertEqual(metrics['liveLagClockSkewSamples'],1);self.assertEqual(metrics['liveLagSamples'],0)
            self.assertNotIn('liveLagP95Ms',metrics)
        self.assertEqual(delivery_metrics.diagnostics(self.db,100000),dict(liveLagSamples=0,liveLagClockSkewSamples=0))
    def test_samples_are_bounded_deduplicated_and_quantile_is_nearest_rank(self):
        with patch('delivery_metrics.MAX_SAMPLES',20),self.db:
            for i in range(25):delivery_metrics.record(self.db,str(i),1000,1000,1000+i)
            delivery_metrics.record(self.db,'24',1000,1000,1024)
        metrics=delivery_metrics.diagnostics(self.db,1025)
        self.assertEqual(metrics['liveLagSamples'],20);self.assertEqual(metrics['liveLagP95Ms'],23000)
        self.assertEqual(metrics['liveLagMaxMs'],24000)
        with self.db:delivery_metrics.record(self.db,'new',100000,100000,100001)
        self.assertEqual(self.db.execute('SELECT count(*) FROM delivery_samples').fetchone()[0],1)

if __name__=='__main__':unittest.main()
