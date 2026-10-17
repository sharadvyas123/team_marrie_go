import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EvidenceRepository } from '../../src/db/evidence.mjs';

test('EvidenceRepository persists the upload-intent identifier through parameterized SQL', async () => {
  const queries = [];
  const client = {
    async query(text, values = []) {
      queries.push({ text, values });
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
      if (text.includes('set_config')) return { rows: [] };
      if (text.includes('SELECT id FROM observations')) return { rows: [{ id: 'observation-1' }] };
      if (text.includes('INSERT INTO evidence_assets')) return { rows: [{ id: 'evidence-1' }] };
      if (text.includes('FROM evidence_assets e')) {
        return {
          rows: [{
            id: 'evidence-1',
            observation_id: 'observation-1',
            owner_id: 'user-1',
            storage_key: 'private/original/evidence-1',
            media_type: 'image',
            state: 'awaiting_upload',
            moderation_status: 'pending',
            sensitive_flags: []
          }]
        };
      }
      throw new Error(`unexpected query: ${text}`);
    },
    release() {}
  };
  const repository = new EvidenceRepository({ async connect() { return client; } });
  const result = await repository.createIntent({
    id: 'evidence-1',
    observationId: 'observation-1',
    ownerId: 'user-1',
    storageKey: 'private/original/evidence-1',
    fileName: 'ramp.jpg',
    mediaType: 'image',
    contentMediaType: 'image/jpeg',
    sizeBytes: 10,
    uploadExpiresAt: '2026-10-17T10:15:00Z'
  });

  assert.equal(result.id, 'evidence-1');
  const insert = queries.find((query) => query.text.includes('INSERT INTO evidence_assets'));
  assert.equal(insert.values[0], 'evidence-1');
  assert.doesNotMatch(insert.text, /private\/original\/evidence-1/);
});
