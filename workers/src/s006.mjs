const S006_EVENTS = new Set([
  'observation.submitted',
  'observation.approved',
  'observation.rejected',
  'observation.changes_requested',
  'observation.confirmed',
  'observation.disputed',
  'observation.outdated',
  'observation.amended'
]);

export function createS006Handlers({ observationRepository }) {
  if (!observationRepository || typeof observationRepository.recomputeClaim !== 'function') {
    throw new TypeError('observationRepository must implement recomputeClaim');
  }

  return {
    async handle(job) {
      if (!S006_EVENTS.has(job.type)) return { ignored: true, eventType: job.type };
      const placeId = job.payload?.placeId;
      const featureCode = job.payload?.featureCode;
      if (typeof placeId !== 'string' || typeof featureCode !== 'string') {
        const error = new Error('S-006 event is missing placeId or featureCode');
        error.code = 'INVALID_S006_EVENT';
        throw error;
      }
      return observationRepository.recomputeClaim(placeId, featureCode);
    }
  };
}

export { S006_EVENTS };
