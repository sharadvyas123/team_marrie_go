export const EVIDENCE_STATES = Object.freeze({
  AWAITING_UPLOAD: 'awaiting_upload',
  UPLOADED: 'uploaded',
  PROCESSING: 'processing',
  PRIVACY_PROCESSED: 'privacy_processed',
  HELD: 'held',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  FAILED: 'failed',
  CLEANED: 'cleaned'
});

const TRANSITIONS = Object.freeze({
  awaiting_upload: new Set(['awaiting_upload', 'uploaded', 'failed', 'cleaned']),
  uploaded: new Set(['uploaded', 'processing', 'failed', 'cleaned']),
  processing: new Set(['processing', 'privacy_processed', 'held', 'rejected', 'failed']),
  privacy_processed: new Set(['privacy_processed', 'approved', 'held', 'failed']),
  held: new Set(['held', 'processing', 'approved', 'rejected']),
  approved: new Set(['approved']),
  rejected: new Set(['rejected', 'cleaned']),
  failed: new Set(['failed', 'processing', 'cleaned']),
  cleaned: new Set(['cleaned'])
});

export function canTransitionEvidenceState(from, to) {
  return TRANSITIONS[from]?.has(to) === true;
}

export function transitionEvidenceState(from, to) {
  if (!canTransitionEvidenceState(from, to)) {
    const error = new Error(`Evidence state cannot transition from ${from} to ${to}.`);
    error.code = 'EVIDENCE_INVALID_STATE_TRANSITION';
    throw error;
  }
  return to;
}

export function isEvidenceTerminalState(state) {
  return state === EVIDENCE_STATES.APPROVED
    || state === EVIDENCE_STATES.REJECTED
    || state === EVIDENCE_STATES.CLEANED;
}

export function isEvidencePublicState(state) {
  return state === EVIDENCE_STATES.APPROVED;
}

export const EVIDENCE_STATE_TRANSITIONS = TRANSITIONS;
