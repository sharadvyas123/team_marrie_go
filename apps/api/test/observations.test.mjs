import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  observationClientRequestId,
  privateObservation,
  publicObservation
} from '../src/db/observations.mjs';

test('public observation serialization excludes pending evidence and amendment history', () => {
  const row = {
    id: 'observation-1',
    place_id: 'place-1',
    feature_code: 'step_free_entrance',
    value: 'yes',
    details: 'Front entrance',
    measured_value: null,
    observed_at: '2026-10-17T10:00:00Z',
    is_sample: false,
    evidence: [
      {
        id: 'evidence-approved',
        public_key: 'public/approved.webp',
        media_type: 'image',
        moderation_status: 'approved',
        alt_text: 'Entrance ramp'
      },
      {
        id: 'evidence-pending',
        storage_key: 'private/pending.jpg',
        public_key: 'public/pending.jpg',
        media_type: 'image',
        moderation_status: 'pending',
        alt_text: 'Pending image'
      }
    ],
    amendments: [{ id: 'amendment-1', previous_details: 'Old details' }]
  };

  assert.deepEqual(publicObservation(row).evidence, [{
    id: 'evidence-approved',
    mediaType: 'image',
    altText: 'Entrance ramp'
  }]);
  assert.equal(Object.hasOwn(publicObservation(row), 'amendments'), false);
  assert.equal(Object.hasOwn(publicObservation(row).evidence[0], 'storageKey'), false);
  assert.equal(privateObservation(row).amendments[0].previousDetails, 'Old details');
});

test('client request IDs are trimmed before durable idempotency lookup', () => {
  assert.equal(observationClientRequestId({ clientRequestId: '  request-123  ' }), 'request-123');
  assert.equal(observationClientRequestId({ client_request_id: 'request-456' }), 'request-456');
});
