const PRIVATE_KEYS = new Set([
  'email', 'phonePrivate', 'userId', 'user_id', 'contributorId', 'contributor_id',
  'managerId', 'manager_id', 'ownerId', 'owner_id', 'reporterId', 'reporter_id',
  'reporterEmail', 'reporter_email', 'contributorEmail', 'contributor_email',
  'managerEmail', 'manager_email', 'userEmail', 'user_email',
  'moderatorId', 'moderator_id', 'moderatorNotes', 'moderator_notes', 'audit',
  'auditLog', 'audit_log', 'storageKey', 'privateEvidenceKey', 'original', 'secret',
  'privateNotes', 'private_notes', 'internal', 'sourceDetails', 'source_details'
]);
const PRIVATE_STATUSES = new Set(['pending', 'rejected', 'hidden', 'deleted', 'changes_requested']);

export function isApprovedPublicRecord(record) {
  if (!record || typeof record !== 'object') return false;
  if (record.public === false || record.visibility === 'private' || record.visibility === 'hidden') return false;
  if (record.approved === false || record.moderationStatus && record.moderationStatus !== 'approved') return false;
  if (PRIVATE_STATUSES.has(record.status)) return false;
  return true;
}

export function serializePublicPlace(record) {
  if (!isApprovedPublicRecord(record) || (record.status && !['active', 'temporarily_closed'].includes(record.status))) return null;
  const output = safePublicObject(record);
  delete output.claim;
  delete output.claims;
  delete output.observations;
  delete output.communityHistory;
  delete output.manager;
  delete output.facilityClaim;
  return output;
}

export function serializePublicClaim(record) {
  if (!isApprovedPublicRecord(record)) return null;
  const output = safePublicObject(record);
  for (const key of ['observations', 'supportingObservationIds', 'disputingObservationIds', 'moderationStatus']) delete output[key];
  return output;
}

export function serializePublicAccessibility(record) {
  if (!record) return null;
  const place = serializePublicPlace(record.place ?? record);
  if (!place) return null;
  const claims = (record.claims ?? record.accessibilityClaims ?? []).map(serializePublicClaim).filter(Boolean);
  return {
    schemaVersion: 'civic-place-accessibility.v1',
    place,
    claims,
    ...(record.responses ? { facilityResponses: record.responses.map(serializePublicFacilityResponse).filter(Boolean) } : {}),
    generatedAt: record.generatedAt ?? record.updatedAt ?? null
  };
}

export function serializePublicFacilityResponse(record) {
  if (!isApprovedPublicRecord(record)) return null;
  return {
    id: record.id ?? record.responseId,
    placeId: record.placeId ?? record.place_id,
    featureId: record.featureId ?? record.feature_id ?? null,
    response: record.response ?? record.text ?? record.message,
    statusValue: record.statusValue ?? record.status_value ?? null,
    source: 'facility',
    observedAt: record.effectiveAt ?? record.effective_at ?? record.updatedAt ?? record.updated_at ?? record.createdAt ?? null,
    createdAt: record.createdAt ?? record.created_at ?? null,
    updatedAt: record.updatedAt ?? record.updated_at ?? null
  };
}

export function serializePublicCivicIncident(record) {
  if (!isApprovedPublicRecord(record) || !['validated', 'published', 'disputed', 'resolved'].includes(record.status)) return null;
  return {
    id: record.id ?? record.incidentId,
    placeId: record.placeId ?? record.place_id ?? null,
    accessNodeId: record.accessNodeId ?? record.access_node_id ?? null,
    accessEdgeId: record.accessEdgeId ?? record.access_edge_id ?? null,
    type: record.type ?? record.incidentType ?? record.incident_type ?? null,
    severity: record.severity ?? null,
    status: record.status,
    source: typeof record.source === 'string' ? record.source : record.sourceType ?? 'community',
    startsAt: record.startsAt ?? record.starts_at ?? null,
    observedAt: record.observedAt ?? record.observed_at ?? record.startsAt ?? null,
    expectedExpiryAt: record.expectedExpiryAt ?? record.expected_expiry_at ?? record.reviewAt ?? record.review_at ?? null,
    explanation: record.explanation ?? record.description ?? null,
    resolvedAt: record.resolvedAt ?? record.resolved_at ?? null
  };
}

export function serializePublicChange(record) {
  if (!isApprovedPublicRecord(record)) return null;
  return {
    id: record.id ?? null,
    eventType: record.eventType ?? record.event_type ?? record.type ?? null,
    aggregateType: record.aggregateType ?? record.aggregate_type ?? null,
    aggregateId: record.aggregateId ?? record.aggregate_id ?? null,
    occurredAt: record.occurredAt ?? record.occurred_at ?? record.createdAt ?? record.created_at ?? null,
    ...(record.data !== undefined ? { data: safePublicObject(record.data) } : {})
  };
}

export function serializePublicIncidentList(records = []) { return records.map(serializePublicCivicIncident).filter(Boolean); }
export function serializePublicChangeList(records = []) { return records.map(serializePublicChange).filter(Boolean); }

function safePublicObject(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(safePublicObject);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !PRIVATE_KEYS.has(key))
    .map(([key, child]) => [key, safePublicObject(child)]));
}
