// Copy into the consumer's tools/, outside the full-suite test discovery pattern.
// For another runner, implement this same two-arm assertion using that runner and reporter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('reporter probe', () => {
  assert.equal(process.env.SPECTREE_DELIVERY_PROBE, 'pass');
});
