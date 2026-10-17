import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createUploadIntent,
  serializePrivateEvidence,
  serializePublicEvidence,
  validateUploadMetadata
} from '../../src/evidence/index.mjs';
import { cleanupAbandonedUploads } from '../../../../workers/evidence/cleanup.mjs';
import { createEvidenceProcessor } from '../../../../workers/evidence/processor.mjs';
import {
  canTransitionEvidenceState,
  transitionEvidenceState
} from '../../../../workers/evidence/state-machine.mjs';

const NOW = Date.parse('2026-10-17T10:00:00.000Z');

class FakeIdempotencyStore {
  constructor() {
    this.records = new Map();
  }

  async claim(key) {
    const existing = this.records.get(key);
    if (existing?.state === 'completed' || existing?.state === 'processing') {
      return { acquired: false, state: existing.state };
    }
    this.records.set(key, { state: 'processing' });
    return { acquired: true, state: 'processing' };
  }

  async complete(key, result) {
    this.records.set(key, { state: 'completed', result });
  }

  async release(key) {
    if (this.records.get(key)?.state === 'processing') this.records.delete(key);
  }
}

class FakeStateStore {
  constructor(records) {
    this.records = new Map(records.map((record) => [record.id, structuredClone(record)]));
  }

  async get(id) {
    const record = this.records.get(id);
    return record ? structuredClone(record) : null;
  }

  async transition(id, { from, to, patch = {} }) {
    const current = this.records.get(id);
    if (!current || current.state !== from) return null;
    transitionEvidenceState(from, to);
    const next = { ...current, ...patch, state: to };
    this.records.set(id, next);
    return structuredClone(next);
  }

  async listAbandoned({ states, limit }) {
    return [...this.records.values()]
      .filter((record) => states.includes(record.state))
      .slice(0, limit)
      .map((record) => structuredClone(record));
  }
}

class FakeStorage {
  constructor(stateStore, { failDeleteFor = null } = {}) {
    this.stateStore = stateStore;
    this.original = Buffer.from('original-image');
    this.privateDerivatives = new Map();
    this.published = new Map();
    this.publishStates = [];
    this.deleteCalls = [];
    this.failDeleteFor = failDeleteFor;
  }

  async readPrivateObject() {
    return this.original;
  }

  async putPrivateDerivative({ evidenceId, object }) {
    const privateKey = `private/derivative/${evidenceId}`;
    this.privateDerivatives.set(evidenceId, object);
    return { privateKey };
  }

  async publishDerivative({ evidenceId }) {
    this.publishStates.push((await this.stateStore.get(evidenceId)).state);
    const existing = this.published.get(evidenceId);
    if (existing) return existing;
    const published = {
      publicKey: `public/derivative/${evidenceId}.webp`,
      publicUrl: `https://cdn.example.test/evidence/${evidenceId}.webp`
    };
    this.published.set(evidenceId, published);
    return published;
  }

  async deletePrivateObject({ evidenceId }) {
    this.deleteCalls.push({ type: 'original', evidenceId });
    if (evidenceId === this.failDeleteFor) throw Object.assign(new Error('storage unavailable'), { code: 'STORAGE_UNAVAILABLE' });
  }

  async deletePrivateDerivative({ evidenceId }) {
    this.deleteCalls.push({ type: 'derivative', evidenceId });
  }
}

function evidenceRecord(overrides = {}) {
  return {
    id: 'evidence-1',
    observationId: 'observation-1',
    storageKey: 'private/original/evidence-1',
    fileName: 'entrance.jpg',
    mediaType: 'image/jpeg',
    state: 'awaiting_upload',
    moderationStatus: 'pending',
    ...overrides
  };
}

function processorFixture(overrides = {}) {
  const stateStore = new FakeStateStore([evidenceRecord(overrides.record)]);
  const storage = new FakeStorage(stateStore, overrides.storage);
  const observationFailures = [];
  const observationStore = {
    async markEvidenceFailure(input) {
      observationFailures.push(input);
    }
  };
  const idempotencyStore = new FakeIdempotencyStore();
  const signatureChecker = overrides.signatureChecker ?? { async check() { return { valid: true }; } };
  const malwareScanner = overrides.malwareScanner ?? { async scan() { return { clean: true }; } };
  const metadataSanitizer = overrides.metadataSanitizer ?? {
    async sanitize({ object }) { return { object, metadataRemoved: true }; }
  };
  const derivativeGenerator = overrides.derivativeGenerator ?? {
    async generate({ object }) { return { object: Buffer.from(object), mediaType: 'image/webp' }; }
  };
  const sensitiveContentScanner = overrides.sensitiveContentScanner ?? { async scan() { return { flags: [] }; } };
  const altTextSuggester = overrides.altTextSuggester ?? { async suggest() { return { text: 'An entrance ramp.' }; } };
  const processor = createEvidenceProcessor({
    stateStore,
    storage,
    signatureChecker,
    malwareScanner,
    metadataSanitizer,
    derivativeGenerator,
    sensitiveContentScanner,
    altTextSuggester,
    observationStore,
    idempotencyStore,
    clock: () => NOW
  });
  return { processor, stateStore, storage, observationFailures, idempotencyStore };
}

test('upload metadata validates type, extension, size, and checksum without accepting storage fields', () => {
  assert.deepEqual(
    validateUploadMetadata({
      fileName: '  entrance.JPG ',
      mediaType: 'IMAGE/JPEG',
      sizeBytes: 128,
      checksumSha256: 'A'.repeat(64),
      storageKey: 'private/attacker-chosen-key'
    }),
    {
      fileName: 'entrance.JPG',
      mediaType: 'image/jpeg',
      sizeBytes: 128,
      checksumSha256: 'a'.repeat(64),
      maxBytes: 10 * 1024 * 1024
    }
  );
  assert.throws(() => validateUploadMetadata({ fileName: 'evidence.txt', mediaType: 'text/plain', sizeBytes: 1 }), /not supported/);
  assert.throws(() => validateUploadMetadata({ fileName: '../evidence.jpg', mediaType: 'image/jpeg', sizeBytes: 1 }), /simple file name/);
  assert.throws(() => validateUploadMetadata({ fileName: 'evidence.jpg', mediaType: 'image/jpeg', sizeBytes: 11 }, { maxBytes: 10 }), /too large/);
  assert.throws(() => validateUploadMetadata({ fileName: 'evidence.png', mediaType: 'image/png', sizeBytes: 1, checksum: 'bad' }), /SHA-256/);
});

test('upload intent stores a private original but returns no raw storage key', async () => {
  let stored;
  let storageInput;
  const intent = await createUploadIntent(
    {
      observationId: 'observation-1',
      ownerId: 'user-1',
      metadata: { fileName: 'ramp.jpg', mediaType: 'image/jpeg', sizeBytes: 12 }
    },
    {
      idFactory: () => 'evidence-1',
      clock: () => NOW,
      storage: {
        async createPrivateUpload(input) {
          storageInput = input;
          return {
            storageKey: 'private/original/evidence-1',
            uploadUrl: 'https://upload.example.test/signed',
            headers: { 'content-type': 'image/jpeg' },
            expiresAt: new Date(NOW + 60_000).toISOString()
          };
        }
      },
      evidenceStore: {
        async createIntent(input) { stored = input; }
      }
    }
  );

  assert.equal(intent.evidenceId, 'evidence-1');
  assert.equal(intent.status, 'awaiting_upload');
  assert.equal(Object.hasOwn(intent, 'storageKey'), false);
  assert.equal(storageInput.visibility, 'private');
  assert.equal(stored.storageKey, 'private/original/evidence-1');
});

test('public and private serializers enforce derivative gating and hide storage keys', () => {
  const pending = evidenceRecord({ state: 'processing' });
  assert.equal(serializePublicEvidence(pending), null);
  const privateView = serializePrivateEvidence(pending);
  assert.equal(privateView.original.available, true);
  assert.equal(Object.hasOwn(privateView, 'storageKey'), false);

  const approved = evidenceRecord({
    state: 'approved',
    privacyProcessed: true,
    moderationStatus: 'approved',
    publicAvailable: true,
    publicDerivative: {
      publicKey: 'public/derivative/evidence-1.webp',
      publicUrl: 'https://cdn.example.test/evidence/evidence-1.webp'
    },
    altText: 'An entrance ramp.',
    altTextStatus: 'suggested'
  });
  const publicView = serializePublicEvidence(approved);
  assert.deepEqual(publicView, {
    id: 'evidence-1',
    mediaType: 'image/jpeg',
    url: 'https://cdn.example.test/evidence/evidence-1.webp',
    altText: 'An entrance ramp.',
    altTextStatus: 'suggested'
  });
  assert.equal(Object.hasOwn(publicView, 'publicKey'), false);
  assert.doesNotMatch(JSON.stringify(publicView), /private\/original/);
});

test('processing state machine permits retry paths but rejects unsafe publication jumps', () => {
  assert.equal(canTransitionEvidenceState('failed', 'processing'), true);
  assert.equal(canTransitionEvidenceState('processing', 'privacy_processed'), true);
  assert.equal(canTransitionEvidenceState('awaiting_upload', 'approved'), false);
  assert.throws(
    () => transitionEvidenceState('awaiting_upload', 'approved'),
    /cannot transition/
  );
});

test('signature mismatch rejects evidence without publishing a derivative', async () => {
  const fixture = processorFixture({ signatureChecker: { async check() { return { valid: false }; } } });
  const result = await fixture.processor.process('evidence-1');
  assert.equal(result.status, 'rejected');
  assert.equal((await fixture.stateStore.get('evidence-1')).state, 'rejected');
  assert.equal(fixture.storage.published.size, 0);
  assert.deepEqual(fixture.observationFailures[0], {
    observationId: 'observation-1', evidenceId: 'evidence-1', status: 'rejected', code: 'EVIDENCE_SIGNATURE_INVALID'
  });
});

test('malware detection rejects evidence before any public derivative is available', async () => {
  const fixture = processorFixture({ malwareScanner: { async scan() { return { clean: false }; } } });
  const result = await fixture.processor.process('evidence-1');
  assert.equal(result.status, 'rejected');
  assert.equal((await fixture.stateStore.get('evidence-1')).moderationStatus, 'rejected');
  assert.equal(fixture.storage.published.size, 0);
});

test('sensitive content is held for moderation and never published', async () => {
  const fixture = processorFixture({
    sensitiveContentScanner: { async scan() { return { flags: ['face', 'license_plate'] }; } }
  });
  const result = await fixture.processor.process('evidence-1');
  const record = await fixture.stateStore.get('evidence-1');
  assert.equal(result.status, 'held');
  assert.equal(record.state, 'held');
  assert.equal(record.holdReason, 'sensitive_content');
  assert.deepEqual(record.sensitiveFlags, ['face', 'license_plate']);
  assert.equal(fixture.storage.published.size, 0);
});

test('safe processing publishes only after privacy processing and preserves a pending alt description', async () => {
  const fixture = processorFixture({
    altTextSuggester: { async suggest() { return { text: '' }; } }
  });
  const result = await fixture.processor.process('evidence-1');
  const record = await fixture.stateStore.get('evidence-1');
  assert.equal(result.status, 'approved');
  assert.deepEqual(fixture.storage.publishStates, ['privacy_processed']);
  assert.equal(record.state, 'approved');
  assert.equal(record.privacyProcessed, true);
  assert.equal(record.altText, null);
  assert.equal(record.altTextStatus, 'pending');
  assert.equal(serializePublicEvidence(record)?.altTextStatus, 'pending');
});

test('processing is idempotent across redelivery and does not duplicate public derivatives', async () => {
  const fixture = processorFixture();
  const first = await fixture.processor.process('evidence-1');
  const second = await fixture.processor.process('evidence-1');
  assert.equal(first.status, 'approved');
  assert.equal(second.status, 'duplicate');
  assert.equal(fixture.storage.publishStates.length, 1);
  assert.equal(fixture.idempotencyStore.records.size, 1);
});

test('transient processing failure marks failure, preserves the observation, and can retry', async () => {
  let shouldFail = true;
  const fixture = processorFixture({
    derivativeGenerator: {
      async generate({ object }) {
        if (shouldFail) throw Object.assign(new Error('derivative provider unavailable'), { code: 'DERIVATIVE_PROVIDER_UNAVAILABLE' });
        return { object: Buffer.from(object), mediaType: 'image/webp' };
      }
    }
  });
  await assert.rejects(
    () => fixture.processor.process('evidence-1'),
    (error) => error.name === 'EvidenceProcessingError' && error.code === 'DERIVATIVE_PROVIDER_UNAVAILABLE'
  );
  assert.equal((await fixture.stateStore.get('evidence-1')).state, 'failed');
  assert.equal(fixture.observationFailures[0].observationId, 'observation-1');
  shouldFail = false;
  const retry = await fixture.processor.process('evidence-1');
  assert.equal(retry.status, 'approved');
  assert.equal((await fixture.stateStore.get('evidence-1')).retryCount, 1);
});

test('cleanup removes abandoned private objects without returning their keys', async () => {
  const records = [
    evidenceRecord({ id: 'evidence-abandoned', state: 'awaiting_upload', storageKey: 'private/original/abandoned' }),
    evidenceRecord({ id: 'evidence-failed', state: 'failed', storageKey: 'private/original/failed' }),
    evidenceRecord({ id: 'evidence-held', state: 'held', storageKey: 'private/original/held' })
  ];
  const stateStore = new FakeStateStore(records);
  const storage = new FakeStorage(stateStore, { failDeleteFor: 'evidence-failed' });
  const result = await cleanupAbandonedUploads({
    stateStore,
    storage,
    now: () => NOW,
    abandonedAfterMs: 60_000,
    limit: 10
  });
  assert.equal(result.cleaned, 1);
  assert.equal(result.attempted, 2);
  assert.equal((await stateStore.get('evidence-abandoned')).state, 'cleaned');
  assert.equal((await stateStore.get('evidence-failed')).state, 'failed');
  assert.equal((await stateStore.get('evidence-held')).state, 'held');
  assert.equal(Object.hasOwn(result.failures[0], 'storageKey'), false);
  assert.doesNotMatch(JSON.stringify(result), /private\/original/);
});
