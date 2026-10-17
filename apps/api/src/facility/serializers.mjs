const PRIVATE_KEYS = new Set([
  'managerId', 'manager_id', 'userId', 'user_id', 'ownerId', 'owner_id',
  'email', 'phonePrivate', 'reviewedBy', 'reviewed_by', 'moderatorNotes',
  'moderator_notes', 'privateNotes', 'private_notes', 'evidenceKey', 'storageKey',
  'reporterEmail', 'reporter_email', 'contributorEmail', 'contributor_email',
  'managerEmail', 'manager_email', 'userEmail', 'user_email'
]);

export function serializeFacilityClaim(record) {
  if (!record) return null;
  return pick(record, [
    ['id', 'id'], ['placeId', 'place_id'], ['organizationName', 'organization_name'],
    ['verificationMethod', 'verification_method'], ['status', 'status'],
    ['createdAt', 'created_at'], ['updatedAt', 'updated_at']
  ]);
}

export function serializeFacilityResponse(record) {
  if (!record) return null;
  return {
    schemaVersion: 'facility-response.v1',
    id: record.id ?? record.responseId,
    placeId: record.placeId ?? record.place_id,
    ...(record.featureId ?? record.feature_id ? { featureId: record.featureId ?? record.feature_id } : {}),
    response: record.response ?? record.text ?? record.message,
    ...(record.statusValue ?? record.status_value ? { statusValue: record.statusValue ?? record.status_value } : {}),
    ...(record.evidence ? { evidence: safePublicObject(record.evidence) } : {}),
    source: 'facility',
    sourceLabel: 'Facility response',
    observedAt: record.effectiveAt ?? record.effective_at ?? record.updatedAt ?? record.updated_at ?? record.createdAt ?? record.created_at ?? null,
    createdAt: record.createdAt ?? record.created_at ?? null,
    updatedAt: record.updatedAt ?? record.updated_at ?? null
  };
}

export function serializeFacilityIncident(record) {
  if (!record) return null;
  return pick(record, [
    ['id', 'id'], ['placeId', 'place_id'], ['accessNodeId', 'access_node_id'],
    ['accessEdgeId', 'access_edge_id'], ['type', 'type'], ['severity', 'severity'],
    ['status', 'status'], ['explanation', 'explanation'], ['startsAt', 'starts_at'],
    ['expectedExpiryAt', 'expected_expiry_at'], ['acknowledgedAt', 'acknowledged_at'],
    ['resolvedAt', 'resolved_at'], ['createdAt', 'created_at'], ['updatedAt', 'updated_at'],
    ['source', 'source'], ['observedAt', 'observed_at']
  ]);
}

export function serializeFacilityPlace(record) {
  if (!record) return null;
  const output = safePublicObject(record);
  for (const key of PRIVATE_KEYS) delete output[key];
  if (output.claim) output.claim = serializeFacilityClaim(output.claim);
  delete output.claims;
  delete output.observations;
  if (Array.isArray(output.responses)) output.responses = output.responses.map(serializeFacilityResponse).filter(Boolean);
  if (Array.isArray(output.incidents)) output.incidents = output.incidents.map(serializeFacilityIncident).filter(Boolean);
  if (Array.isArray(output.communityHistory)) output.communityHistory = output.communityHistory.map(serializeCommunityHistoryItem).filter(Boolean);
  return output;
}

export function serializeCommunityHistoryItem(record) {
  if (!record) return null;
  const output = safePublicObject(record);
  for (const key of PRIVATE_KEYS) delete output[key];
  delete output.moderation;
  delete output.moderationStatus;
  return output;
}

export function serializeFacilityList(records = []) {
  return records.map(serializeFacilityPlace).filter(Boolean);
}

function pick(record, fields) {
  const output = {};
  for (const [target, source] of fields) {
    const value = record[target] ?? record[source];
    if (value !== undefined) output[target] = value;
  }
  return output;
}

function safePublicObject(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(safePublicObject);
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !PRIVATE_KEYS.has(key))
    .map(([key, child]) => [key, safePublicObject(child)]));
}
