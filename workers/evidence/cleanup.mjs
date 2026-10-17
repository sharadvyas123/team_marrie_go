import { EVIDENCE_STATES, transitionEvidenceState } from './state-machine.mjs';

function safeCode(error) {
  return typeof error?.code === 'string' ? error.code : 'EVIDENCE_CLEANUP_FAILED';
}

/**
 * Remove private objects belonging to expired, unfinished uploads. The state
 * store query must be bounded and should be implemented as a database query in
 * production; this module never returns the private keys it receives.
 */
export async function cleanupAbandonedUploads({
  stateStore,
  storage,
  now = () => Date.now(),
  abandonedAfterMs = 24 * 60 * 60 * 1_000,
  limit = 100,
  logger = null
} = {}) {
  if (!stateStore || typeof stateStore.listAbandoned !== 'function' || typeof stateStore.transition !== 'function') {
    throw new TypeError('stateStore must implement listAbandoned and transition');
  }
  if (!storage || typeof storage.deletePrivateObject !== 'function') {
    throw new TypeError('storage must implement deletePrivateObject');
  }
  if (!Number.isSafeInteger(abandonedAfterMs) || abandonedAfterMs < 0) {
    throw new RangeError('abandonedAfterMs must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('limit must be a positive safe integer');

  const before = new Date(now() - abandonedAfterMs).toISOString();
  const records = await stateStore.listAbandoned({
    before,
    states: [EVIDENCE_STATES.AWAITING_UPLOAD, EVIDENCE_STATES.UPLOADED, EVIDENCE_STATES.FAILED],
    limit
  });
  let cleaned = 0;
  const failures = [];
  for (const record of records ?? []) {
    try {
      await storage.deletePrivateObject({ evidenceId: record.id, storageKey: record.storageKey });
      if (record.privateDerivativeRef && typeof storage.deletePrivateDerivative === 'function') {
        await storage.deletePrivateDerivative({ evidenceId: record.id, privateDerivativeRef: record.privateDerivativeRef });
      }
      transitionEvidenceState(record.state, EVIDENCE_STATES.CLEANED);
      const updated = await stateStore.transition(record.id, {
        from: record.state,
        to: EVIDENCE_STATES.CLEANED,
        patch: { cleanedAt: new Date(now()).toISOString() }
      });
      if (!updated || updated.state !== EVIDENCE_STATES.CLEANED) throw new Error('Cleanup state was not persisted.');
      cleaned += 1;
    } catch (error) {
      failures.push({ evidenceId: record.id, code: safeCode(error) });
      logger?.error?.({ evidenceId: record.id, code: safeCode(error) }, 'Abandoned evidence cleanup failed');
    }
  }
  return { cleaned, attempted: records?.length ?? 0, failures };
}

export const cleanupAbandonedEvidence = cleanupAbandonedUploads;
