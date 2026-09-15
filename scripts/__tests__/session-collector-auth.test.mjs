import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { authenticateSessionCollector } from '../../packages/dashboard/src/routes/session-collector-auth.ts';
const hash = createHash('sha256').update('host-a-secret').digest('hex');
const config = JSON.stringify({ m3: hash });
test('collector credentials identify one host and never accept query or malformed credentials', () => {
  assert.equal(authenticateSessionCollector('Bearer host-a-secret', config), 'm3');
  for (const token of [undefined, '', 'host-a-secret', 'Bearer other']) assert.equal(authenticateSessionCollector(token, config), null);
  for (const value of [undefined, '{}', 'bad', '[]', JSON.stringify({ m3: hash, m5: hash }), JSON.stringify({ m3: 'invalid' })]) {
    assert.equal(authenticateSessionCollector('Bearer host-a-secret', value), null);
  }
});
