import { MemoryIdempotencyStore } from '../src/idempotency.mjs';
import { EVIDENCE_STATES, transitionEvidenceState } from './state-machine.mjs';

function requireAdapter(adapter, name, methods) {
  if (!adapter || typeof adapter !== 'object' || methods.some((method) => typeof adapter[method] !== 'function')) {
    throw new TypeError(`${name} must implement ${methods.join(', ')}`);
  }
}

function safeFailure(error, fallbackCode = 'EVIDENCE_PROCESSING_FAILED') {
  return {
    code: typeof error?.code === 'string' ? error.code : fallbackCode,
    name: typeof error?.name === 'string' ? error.name : 'Error'
  };
}

function processingError(code, cause) {
  const error = new Error('Evidence processing could not be completed.');
  error.name = 'EvidenceProcessingError';
  error.code = code;
  error.retryable = true;
  if (cause) error.cause = cause;
  return error;
}

function resultObject(result) {
  if (result && typeof result === 'object' && ('object' in result || 'bytes' in result)) {
    return result.object ?? result.bytes;
  }
  return result;
}

function resultFlags(result) {
  if (!result || typeof result !== 'object') return [];
  const values = result.flags ?? result.sensitiveFlags ?? [];
  return Array.isArray(values)
    ? values.filter((value) => typeof value === 'string').map((value) => value.trim()).filter(Boolean).slice(0, 20)
    : [];
}

function hasSensitiveContent(result) {
  return Boolean(result?.sensitive || result?.hasSensitiveContent || result?.requiresModeration || resultFlags(result).length > 0);
}

function altTextFrom(result) {
  const text = result?.text ?? result?.altText ?? result?.suggestion ?? null;
  if (typeof text !== 'string' || text.trim().length === 0 || text.trim().length > 500) {
    return { altText: null, altTextStatus: 'pending' };
  }
  return { altText: text.trim(), altTextStatus: 'suggested' };
}

function publicDerivativeRef(result) {
  if (!result || typeof result !== 'object') return null;
  const publicKey = result.publicKey ?? result.key ?? null;
  const publicUrl = result.publicUrl ?? result.url ?? null;
  if (typeof publicKey !== 'string' || publicKey.length === 0) {
    const error = new Error('The derivative publisher did not return an immutable public reference.');
    error.code = 'EVIDENCE_PUBLIC_DERIVATIVE_MISSING';
    throw error;
  }
  return {
    publicKey,
    ...(typeof publicUrl === 'string' && publicUrl.length > 0 ? { publicUrl } : {})
  };
}

function ensureSeparated(privateReference, publicReference) {
  if (privateReference && publicReference.publicKey === privateReference) {
    const error = new Error('The public derivative must not reuse the private original reference.');
    error.code = 'EVIDENCE_DERIVATIVE_NOT_SEPARATED';
    throw error;
  }
}

/**
 * Evidence processing ports:
 *
 * - stateStore: get(id), transition(id, { from, to, patch })
 * - storage: readPrivateObject, putPrivateDerivative, publishDerivative
 * - signatureChecker: check({ object, declaredMediaType })
 * - malwareScanner: scan({ object, mediaType })
 * - metadataSanitizer: sanitize({ object, mediaType })
 * - derivativeGenerator: generate({ object, mediaType, evidenceId })
 * - sensitiveContentScanner: scan({ object, mediaType })
 * - altTextSuggester: suggest({ object, mediaType })
 * - observationStore: markEvidenceFailure({ observationId, evidenceId, status, code })
 * - idempotencyStore: claim/complete/release
 *
 * State and storage adapters must make transitions and publication conditional
 * on the evidence ID so a redelivered job cannot create another public image.
 */
export class EvidenceProcessor {
  constructor({
    stateStore,
    storage,
    signatureChecker,
    malwareScanner,
    metadataSanitizer,
    derivativeGenerator,
    sensitiveContentScanner,
    altTextSuggester,
    observationStore = null,
    idempotencyStore = new MemoryIdempotencyStore(),
    clock = () => Date.now(),
    logger = null
  } = {}) {
    requireAdapter(stateStore, 'stateStore', ['get', 'transition']);
    requireAdapter(storage, 'storage', ['readPrivateObject', 'putPrivateDerivative', 'publishDerivative']);
    requireAdapter(signatureChecker, 'signatureChecker', ['check']);
    requireAdapter(malwareScanner, 'malwareScanner', ['scan']);
    requireAdapter(metadataSanitizer, 'metadataSanitizer', ['sanitize']);
    requireAdapter(derivativeGenerator, 'derivativeGenerator', ['generate']);
    requireAdapter(sensitiveContentScanner, 'sensitiveContentScanner', ['scan']);
    requireAdapter(altTextSuggester, 'altTextSuggester', ['suggest']);
    requireAdapter(idempotencyStore, 'idempotencyStore', ['claim', 'complete', 'release']);
    if (observationStore !== null) requireAdapter(observationStore, 'observationStore', ['markEvidenceFailure']);
    this.stateStore = stateStore;
    this.storage = storage;
    this.signatureChecker = signatureChecker;
    this.malwareScanner = malwareScanner;
    this.metadataSanitizer = metadataSanitizer;
    this.derivativeGenerator = derivativeGenerator;
    this.sensitiveContentScanner = sensitiveContentScanner;
    this.altTextSuggester = altTextSuggester;
    this.observationStore = observationStore;
    this.idempotencyStore = idempotencyStore;
    this.clock = clock;
    this.logger = logger;
  }

  async handle(job) {
    const evidenceId = job?.evidenceId ?? job?.payload?.evidenceId;
    if (typeof evidenceId !== 'string' || evidenceId.trim().length === 0) {
      const error = new Error('Evidence job is missing evidenceId.');
      error.code = 'EVIDENCE_JOB_INVALID';
      throw error;
    }
    return this.process(evidenceId, { processingKey: job.idempotencyKey ?? job.eventId ?? null });
  }

  async process(evidenceId, { processingKey = null } = {}) {
    const id = String(evidenceId);
    let record = await this.stateStore.get(id);
    if (!record) {
      const error = new Error('Evidence record was not found.');
      error.code = 'EVIDENCE_NOT_FOUND';
      throw error;
    }

    const idempotencyKey = processingKey || `evidence:${id}:process:v1`;
    const claim = await this.idempotencyStore.claim(idempotencyKey);
    if (!claim?.acquired) {
      return {
        status: 'duplicate',
        evidenceId: id,
        state: record.state,
        reason: claim?.state ?? 'already-processed'
      };
    }

    if (record.state === EVIDENCE_STATES.APPROVED || (record.state === EVIDENCE_STATES.HELD && record.moderationStatus !== 'approved')) {
      await this.idempotencyStore.complete(idempotencyKey, { status: record.state });
      return this.#statusResult(record, record.state === EVIDENCE_STATES.APPROVED ? 'approved' : 'held');
    }
    if (record.state === EVIDENCE_STATES.REJECTED || record.state === EVIDENCE_STATES.CLEANED) {
      await this.idempotencyStore.complete(idempotencyKey, { status: record.state });
      return this.#statusResult(record, record.state);
    }

    try {
      if (record.state === EVIDENCE_STATES.HELD && record.moderationStatus === 'approved') {
        record = await this.#transition(record, EVIDENCE_STATES.PROCESSING, {
          holdReason: null,
          moderationStatus: 'approved'
        });
      }
      record = await this.#prepareProcessing(record);
      if (record.state === EVIDENCE_STATES.PROCESSING) {
        record = await this.#validateAndPrepareDerivative(record);
      }
      if (record.state === EVIDENCE_STATES.REJECTED) {
        await this.idempotencyStore.complete(idempotencyKey, { status: 'rejected' });
        return this.#statusResult(record, 'rejected');
      }
      if (record.state === EVIDENCE_STATES.HELD) {
        await this.idempotencyStore.complete(idempotencyKey, { status: 'held' });
        return this.#statusResult(record, 'held');
      }
      if (record.state === EVIDENCE_STATES.PROCESSING) {
        record = await this.#markPrivacyProcessed(record);
      }
      if (record.state === EVIDENCE_STATES.PRIVACY_PROCESSED) {
        record = await this.#publishAndApprove(record);
      }
      await this.idempotencyStore.complete(idempotencyKey, { status: 'approved' });
      return this.#statusResult(record, 'approved');
    } catch (error) {
      const failure = safeFailure(error);
      let failedRecord = record;
      try {
        failedRecord = await this.#transition(
          record,
          EVIDENCE_STATES.FAILED,
          { failureCode: failure.code, failedAt: new Date(this.clock()).toISOString() }
        );
      } catch (transitionError) {
        this.logger?.error?.({ evidenceId: id, code: safeFailure(transitionError).code }, 'Evidence failure state update failed');
      }
      await this.#preserveObservation(failedRecord, failure.code, 'failed');
      await this.idempotencyStore.release(idempotencyKey);
      this.logger?.error?.({ evidenceId: id, code: failure.code }, 'Evidence processing failed');
      throw processingError(failure.code, error);
    }
  }

  async #prepareProcessing(record) {
    if (record.state === EVIDENCE_STATES.FAILED) {
      record = await this.#transition(record, EVIDENCE_STATES.PROCESSING, {
        failureCode: null,
        retryCount: (record.retryCount ?? 0) + 1
      });
    }
    if (record.state === EVIDENCE_STATES.AWAITING_UPLOAD) {
      const original = await this.storage.readPrivateObject({
        evidenceId: record.id,
        storageKey: record.storageKey
      });
      if (!original) {
        const error = new Error('The private upload is not available.');
        error.code = 'EVIDENCE_UPLOAD_MISSING';
        throw error;
      }
      record = await this.#transition(record, EVIDENCE_STATES.UPLOADED, { uploadedAt: new Date(this.clock()).toISOString() });
    }
    if (record.state === EVIDENCE_STATES.UPLOADED) {
      record = await this.#transition(record, EVIDENCE_STATES.PROCESSING, { processingStartedAt: new Date(this.clock()).toISOString() });
    }
    if (record.state === EVIDENCE_STATES.PROCESSING && record.privacyProcessed === true && record.privateDerivativeRef) {
      record = await this.#transition(record, EVIDENCE_STATES.PRIVACY_PROCESSED, {});
    }
    return record;
  }

  async #validateAndPrepareDerivative(record) {
    if (record.privateDerivativeRef && record.metadataRemoved === true) return record;
    const original = await this.storage.readPrivateObject({ evidenceId: record.id, storageKey: record.storageKey });
    if (!original) {
      const error = new Error('The private upload is not available.');
      error.code = 'EVIDENCE_UPLOAD_MISSING';
      throw error;
    }
    const signature = await this.signatureChecker.check({
      object: original,
      declaredMediaType: record.mediaType,
      fileName: record.fileName
    });
    if (!signature?.valid || (signature.detectedMediaType && signature.detectedMediaType !== record.mediaType)) {
      return this.#reject(record, 'EVIDENCE_SIGNATURE_INVALID');
    }
    const malware = await this.malwareScanner.scan({ object: original, mediaType: record.mediaType });
    if (malware?.clean !== true) return this.#reject(record, 'EVIDENCE_MALWARE_DETECTED');
    record = await this.#transition(record, EVIDENCE_STATES.PROCESSING, {
      signatureStatus: 'verified',
      malwareStatus: 'clean'
    });

    const sanitized = await this.metadataSanitizer.sanitize({ object: original, mediaType: record.mediaType });
    const derivative = await this.derivativeGenerator.generate({
      object: resultObject(sanitized),
      mediaType: record.mediaType,
      evidenceId: record.id
    });
    const derivativeObject = resultObject(derivative);
    if (!derivativeObject) {
      const error = new Error('The derivative generator returned no object.');
      error.code = 'EVIDENCE_DERIVATIVE_FAILED';
      throw error;
    }
    const privateDerivative = await this.storage.putPrivateDerivative({
      evidenceId: record.id,
      object: derivativeObject,
      mediaType: derivative.mediaType ?? record.mediaType,
      immutable: true
    });
    if (!privateDerivative?.privateKey && !privateDerivative?.storageKey && !privateDerivative?.reference) {
      const error = new Error('The private derivative was not stored.');
      error.code = 'EVIDENCE_DERIVATIVE_STORE_FAILED';
      throw error;
    }
    const privateDerivativeRef = privateDerivative.privateKey ?? privateDerivative.storageKey ?? privateDerivative.reference;
    const sensitive = await this.sensitiveContentScanner.scan({
      object: derivativeObject,
      mediaType: derivative.mediaType ?? record.mediaType
    });
    const altText = altTextFrom(await this.altTextSuggester.suggest({
      object: derivativeObject,
      mediaType: derivative.mediaType ?? record.mediaType
    }));
    record = await this.#transition(record, EVIDENCE_STATES.PROCESSING, {
      metadataRemoved: sanitized.metadataRemoved !== false,
      privateDerivativeRef,
      derivativeMediaType: derivative.mediaType ?? record.mediaType,
      sensitiveFlags: resultFlags(sensitive),
      altText: altText.altText,
      altTextStatus: altText.altTextStatus
    });
    if (hasSensitiveContent(sensitive)) {
      record = await this.#transition(record, EVIDENCE_STATES.HELD, {
        moderationStatus: 'pending',
        holdReason: 'sensitive_content'
      });
    }
    return record;
  }

  async #markPrivacyProcessed(record) {
    return this.#transition(record, EVIDENCE_STATES.PRIVACY_PROCESSED, {
      privacyProcessed: true,
      privacyProcessedAt: new Date(this.clock()).toISOString()
    });
  }

  async #publishAndApprove(record) {
    let publicDerivative = record.publicDerivative;
    if (!publicDerivative) {
      const published = await this.storage.publishDerivative({
        evidenceId: record.id,
        privateDerivativeRef: record.privateDerivativeRef,
        mediaType: record.derivativeMediaType ?? record.mediaType,
        immutable: true
      });
      publicDerivative = publicDerivativeRef(published);
      ensureSeparated(record.storageKey, publicDerivative.publicKey);
      ensureSeparated(record.privateDerivativeRef, publicDerivative.publicKey);
    }
    return this.#transition(record, EVIDENCE_STATES.APPROVED, {
      moderationStatus: 'approved',
      publicKey: publicDerivative.publicKey,
      publicDerivative,
      publicAvailable: true,
      approvedAt: new Date(this.clock()).toISOString()
    });
  }

  async #reject(record, code) {
    const rejected = await this.#transition(record, EVIDENCE_STATES.REJECTED, {
      moderationStatus: 'rejected',
      failureCode: code
    });
    await this.#preserveObservation(rejected, code, 'rejected');
    return rejected;
  }

  async #preserveObservation(record, code, status) {
    if (!this.observationStore) return;
    await this.observationStore.markEvidenceFailure({
      observationId: record.observationId,
      evidenceId: record.id,
      status,
      code
    });
  }

  async #transition(record, to, patch) {
    transitionEvidenceState(record.state, to);
    const next = await this.stateStore.transition(record.id, { from: record.state, to, patch });
    if (!next || next.state !== to) {
      const error = new Error('Evidence state transition was not persisted.');
      error.code = 'EVIDENCE_STATE_PERSIST_FAILED';
      throw error;
    }
    return next;
  }

  #statusResult(record, status) {
    return {
      status,
      evidenceId: record.id,
      observationId: record.observationId,
      state: record.state,
      observationPreserved: true,
      publicAvailable: record.publicAvailable === true
    };
  }
}

export function createEvidenceProcessor(options) {
  return new EvidenceProcessor(options);
}

export { safeFailure };
