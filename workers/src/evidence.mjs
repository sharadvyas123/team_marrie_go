const EVIDENCE_TRIGGER_EVENTS = new Set(['observation.submitted', 'evidence.processed']);

export function createEvidenceHandlers({ evidenceProcessor }) {
  if (!evidenceProcessor || typeof evidenceProcessor.handle !== 'function') {
    throw new TypeError('evidenceProcessor must implement handle');
  }

  return {
    async handle(job) {
      if (!EVIDENCE_TRIGGER_EVENTS.has(job.type)) return { ignored: true, eventType: job.type };
      const evidenceIds = job.type === 'observation.submitted'
        ? job.payload?.evidenceIds
        : [job.payload?.evidenceId ?? job.aggregateId];
      if (!Array.isArray(evidenceIds) || evidenceIds.some((id) => typeof id !== 'string')) {
        const error = new Error('Evidence event is missing evidence identifiers.');
        error.code = 'INVALID_EVIDENCE_EVENT';
        throw error;
      }
      const results = [];
      for (const evidenceId of evidenceIds) {
        results.push(await evidenceProcessor.handle({
          ...job,
          evidenceId,
          idempotencyKey: `${job.eventId ?? job.id}:${evidenceId}`
        }));
      }
      return { processed: results };
    }
  };
}

export { EVIDENCE_TRIGGER_EVENTS };
