const string = (extra = {}) => ({ type: 'string', ...extra });
const number = (extra = {}) => ({ type: 'number', ...extra });
const boolean = (extra = {}) => ({ type: 'boolean', ...extra });
const nullableString = () => ({ type: ['string', 'null'] });
const nullableNumber = () => ({ type: ['number', 'null'] });
const arrayOf = (items) => ({ type: 'array', items });
const objectOf = (properties, required = [], extra = {}) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
  ...extra
});

export const contractVersion = 'v1';

export const schemas = Object.freeze({
  healthResponse: {
    $id: 'accessmap.health.v1',
    type: 'object',
    required: ['schemaVersion', 'service', 'status', 'version'],
      properties: {
      schemaVersion: string({ const: 'health.v1' }),
      service: string(),
      status: string({ enum: ['ok', 'degraded'] }),
      version: string(),
      checks: { type: 'object' }
    },
    additionalProperties: false
  },
  readyResponse: {
    $id: 'accessmap.ready.v1',
    type: 'object',
    required: ['schemaVersion', 'status', 'checks'],
    properties: {
      schemaVersion: string({ const: 'ready.v1' }),
      status: string({ enum: ['ok', 'degraded'] }),
      checks: { type: 'object', additionalProperties: { type: 'string' } }
    },
    additionalProperties: false
  },
  problemResponse: {
    $id: 'accessmap.problem.v1',
    type: 'object',
    required: ['schemaVersion', 'type', 'title', 'status', 'detail'],
    properties: {
      schemaVersion: string({ const: 'problem.v1' }),
      type: string(),
      title: string(),
      status: number({ minimum: 400, maximum: 599 }),
      detail: string(),
      traceId: string(),
      code: string()
    },
    additionalProperties: false
  },
  pagination: {
    $id: 'accessmap.pagination.v1',
    type: 'object',
    required: ['page', 'pageSize', 'total'],
    properties: {
      page: number({ minimum: 1 }),
      pageSize: number({ minimum: 1, maximum: 100 }),
      total: number({ minimum: 0 }),
      hasNext: boolean()
    },
    additionalProperties: false
  },
  placeSummary: {
    $id: 'accessmap.place-summary.v1',
    type: 'object',
    required: ['id', 'name', 'category', 'address', 'sampleData'],
    properties: {
      id: string(),
      name: string(),
      category: string(),
      categoryLabel: string(),
      address: string(),
      city: string(),
      description: nullableString(),
      latitude: number({ minimum: -90, maximum: 90 }),
      longitude: number({ minimum: -180, maximum: 180 }),
      distanceMeters: number({ minimum: 0 }),
      sampleData: boolean(),
      claimSummary: arrayOf({
        type: 'object',
        required: ['featureCode', 'status', 'summaryValue', 'freshnessState'],
        properties: {
          featureCode: string(),
          status: string(),
          summaryValue: string(),
          observedAt: nullableString(),
          freshnessState: string()
        },
        additionalProperties: false
      }),
      activeIncidents: arrayOf({
        type: 'object',
        required: ['id', 'type', 'severity', 'status', 'reviewAt'],
        properties: {
          id: string(),
          type: string(),
          severity: string({ enum: ['info', 'low', 'medium', 'high', 'critical'] }),
          status: string({ enum: ['reported', 'validated', 'published', 'disputed', 'resolved', 'archived'] }),
          reviewAt: nullableString()
        },
        additionalProperties: false
      })
    },
    additionalProperties: false
  },
  placeSearch: {
    $id: 'accessmap.place-search.v1',
    type: 'object',
    required: ['schemaVersion', 'items', 'pagination'],
    properties: {
      schemaVersion: string({ const: 'place-search.v1' }),
      items: arrayOf({ $ref: 'accessmap.place-summary.v1' }),
      pagination: { $ref: 'accessmap.pagination.v1' }
    },
    additionalProperties: false
  },
  placeDetail: {
    $id: 'accessmap.place-detail.v1',
    type: 'object',
    required: ['schemaVersion', 'id', 'name', 'category', 'address', 'claims', 'incidents', 'accessGraph'],
    properties: {
      schemaVersion: string({ const: 'place-detail.v1' }),
      id: string(),
      name: string(),
      category: string(),
      categoryLabel: string(),
      address: string(),
      city: string(),
      description: nullableString(),
      postalCode: nullableString(),
      latitude: number({ minimum: -90, maximum: 90 }),
      longitude: number({ minimum: -180, maximum: 180 }),
      phone: nullableString(),
      website: nullableString(),
      openingHours: { type: ['object', 'null'] },
      source: string(),
      status: string({ enum: ['active', 'temporarily_closed'] }),
      sampleData: boolean(),
      claims: arrayOf({ $ref: 'accessmap.accessibility-claim.v1' }),
      incidents: arrayOf({ $ref: 'accessmap.incident.v1' }),
      accessGraph: { $ref: 'accessmap.access-graph.v1' }
    },
    additionalProperties: false
  },
  accessGraph: {
    $id: 'accessmap.access-graph.v1',
    type: 'object',
    required: ['graphVersion', 'nodes', 'edges'],
    properties: {
      graphVersion: number({ minimum: 0 }),
      nodes: arrayOf(objectOf({
        id: string(),
        placeId: string(),
        type: string(),
        label: string(),
        floor: nullableString(),
        status: string(),
        latitude: number({ minimum: -90, maximum: 90 }),
        longitude: number({ minimum: -180, maximum: 180 })
      }, ['id', 'placeId', 'type', 'label', 'floor', 'status', 'latitude', 'longitude'])),
      edges: arrayOf(objectOf({
        id: string(),
        fromNodeId: string(),
        toNodeId: string(),
        surfaceType: nullableString(),
        widthMeters: nullableNumber(),
        slopePercent: nullableNumber(),
        stairs: { type: ['boolean', 'null'] },
        stepFree: { type: ['boolean', 'null'] },
        lastObservedAt: nullableString(),
        status: string(),
        geometry: { type: ['object', 'null'] }
      }, ['id', 'fromNodeId', 'toNodeId', 'surfaceType', 'widthMeters', 'slopePercent', 'stairs', 'stepFree', 'lastObservedAt', 'status', 'geometry']))
    },
    additionalProperties: false
  },
  claimsResponse: {
    $id: 'accessmap.claims.v1',
    type: 'object',
    required: ['schemaVersion', 'items'],
    properties: {
      schemaVersion: string({ const: 'claims.v1' }),
      items: arrayOf({ $ref: 'accessmap.accessibility-claim.v1' })
    },
    additionalProperties: false
  },
  incidentsResponse: {
    $id: 'accessmap.incidents.v1',
    type: 'object',
    required: ['schemaVersion', 'items'],
    properties: {
      schemaVersion: string({ const: 'incidents.v1' }),
      items: arrayOf({ $ref: 'accessmap.incident.v1' }),
      pagination: { $ref: 'accessmap.pagination.v1' }
    },
    additionalProperties: false
  },
  streamReady: {
    $id: 'accessmap.stream-ready.v1',
    type: 'object',
    required: ['schemaVersion', 'traceId'],
    properties: {
      schemaVersion: string({ const: 'stream.v1' }),
      traceId: string()
    },
    additionalProperties: false
  },
  streamEvent: {
    $id: 'accessmap.stream-event.v1',
    type: 'object',
    required: ['schemaVersion', 'eventType'],
    properties: {
      schemaVersion: string({ const: 'stream-event.v1' }),
      eventType: string(),
      placeId: nullableString(),
      incidentId: nullableString(),
      accessNodeId: nullableString(),
      accessEdgeId: nullableString(),
      featureId: nullableString(),
      featureCode: nullableString(),
      type: nullableString(),
      severity: string({ enum: ['info', 'low', 'medium', 'high', 'critical'] }),
      source: nullableString(),
      startsAt: nullableString(),
      reviewAt: nullableString(),
      expectedExpiryAt: nullableString(),
      resolvedAt: nullableString(),
      routeId: nullableString(),
      claimsVersion: nullableNumber(),
      graphVersion: nullableNumber(),
      occurredAt: nullableString(),
      status: nullableString(),
      incident: { type: 'object' },
      routeInvalidation: { type: 'object' }
    },
    additionalProperties: false
  },
  incidentEvent: {
    $id: 'accessmap.incident-event.v1',
    type: 'object',
    required: ['schemaVersion', 'eventType', 'occurredAt', 'incidentId', 'placeId', 'status', 'severity', 'type', 'incident'],
    properties: {
      schemaVersion: string({ const: 'incident-event.v1' }),
      eventType: string(),
      occurredAt: string(),
      incidentId: string(),
      placeId: string(),
      status: string(),
      severity: string({ enum: ['info', 'low', 'medium', 'high', 'critical'] }),
      type: string(),
      observedAt: nullableString(),
      expectedExpiryAt: nullableString(),
      incident: { $ref: 'accessmap.incident.v1' },
      routeInvalidation: { type: 'object' }
    },
    additionalProperties: false
  },
  categoriesResponse: {
    $id: 'accessmap.categories.v1',
    type: 'object',
    required: ['schemaVersion', 'items'],
    properties: {
      schemaVersion: string({ const: 'categories.v1' }),
      items: arrayOf(objectOf({ code: string(), name: string() }, ['code', 'name']))
    },
    additionalProperties: false
  },
  featuresResponse: {
    $id: 'accessmap.features.v1',
    type: 'object',
    required: ['schemaVersion', 'items'],
    properties: {
      schemaVersion: string({ const: 'features.v1' }),
      items: arrayOf(objectOf({
        code: string(),
        category: string(),
        label: string(),
        description: string(),
        inputType: string(),
        freshnessDays: number({ minimum: 1 })
      }, ['code', 'category', 'label', 'description', 'inputType', 'freshnessDays']))
    },
    additionalProperties: false
  },
  accessibilityClaim: {
    $id: 'accessmap.accessibility-claim.v1',
    type: 'object',
    required: ['featureCode', 'status', 'source', 'observedAt'],
    properties: {
      id: string(),
      placeId: string(),
      featureCode: string(),
      featureLabel: string(),
      status: string(),
      summaryValue: string(),
      source: string(),
      observedAt: nullableString(),
      freshnessState: string(),
      supportingCount: number({ minimum: 0 }),
      disputingCount: number({ minimum: 0 }),
      claimsVersion: number({ minimum: 0 }),
      calculationVersion: number({ minimum: 1 })
    },
    additionalProperties: false
  },
  matchProfile: {
    $id: 'accessmap.match-profile.v1',
    type: 'object',
    required: ['requirements'],
    properties: {
      requirements: {
        type: 'array',
        items: {
          type: 'object',
          required: ['featureCode', 'level'],
          properties: {
            featureCode: string(),
            level: string({ enum: ['required', 'preferred', 'avoid'] })
          },
          additionalProperties: false
        }
      }
    },
    additionalProperties: false
  },
  matchSummary: {
    $id: 'accessmap.match-summary.v1',
    type: 'object',
    required: ['total', 'confirmed', 'knownBarriers', 'partial', 'unknown'],
    properties: {
      total: number({ minimum: 0 }),
      confirmed: number({ minimum: 0 }),
      knownBarriers: number({ minimum: 0 }),
      partial: number({ minimum: 0 }),
      unknown: number({ minimum: 0 })
    },
    additionalProperties: false
  },
  matchPreferredSummary: {
    $id: 'accessmap.match-preferred-summary.v1',
    type: 'object',
    required: ['total', 'confirmed', 'partial', 'unknown'],
    properties: {
      total: number({ minimum: 0 }),
      confirmed: number({ minimum: 0 }),
      partial: number({ minimum: 0 }),
      unknown: number({ minimum: 0 })
    },
    additionalProperties: false
  },
  matchItem: {
    $id: 'accessmap.match-item.v1',
    type: 'object',
    required: ['featureCode', 'level', 'result', 'reason', 'claimStatus'],
    properties: {
      featureCode: string(),
      level: string({ enum: ['required', 'preferred', 'avoid'] }),
      result: string({ enum: ['confirmed', 'partial', 'barrier', 'unknown', 'warning', 'clear'] }),
      reason: string(),
      claimStatus: string(),
      source: string(),
      observedAt: string()
    },
    additionalProperties: false
  },
  matchResults: {
    $id: 'accessmap.match-results.v1',
    type: 'object',
    required: ['schemaVersion', 'items'],
    properties: {
      schemaVersion: string({ const: 'match-results.v1' }),
      items: arrayOf(objectOf({
        placeId: string(),
        decision: string({ enum: ['meets_known_requirements', 'partial', 'needs_more_information', 'known_barrier', 'no_profile'] }),
        required: { $ref: 'accessmap.match-summary.v1' },
        preferred: { $ref: 'accessmap.match-preferred-summary.v1' },
        avoidanceWarnings: arrayOf({ $ref: 'accessmap.match-item.v1' }),
        items: arrayOf({ $ref: 'accessmap.match-item.v1' }),
        claimsVersion: number({ minimum: 0 }),
        calculationVersion: number({ minimum: 1 })
      }, ['placeId', 'decision', 'required', 'preferred', 'avoidanceWarnings', 'items']))
    },
    additionalProperties: false
  },
  matchExplanation: {
    $id: 'accessmap.match-explanation.v1',
    type: 'object',
      required: ['decision', 'required', 'preferred', 'avoidanceWarnings', 'items'],
    properties: {
      schemaVersion: string({ const: 'match-explanation.v1' }),
      decision: string({
        enum: ['meets_known_requirements', 'partial', 'needs_more_information', 'known_barrier', 'no_profile']
      }),
      required: { $ref: 'accessmap.match-summary.v1' },
      preferred: { $ref: 'accessmap.match-preferred-summary.v1' },
      avoidanceWarnings: arrayOf({ $ref: 'accessmap.match-item.v1' }),
      items: arrayOf({ $ref: 'accessmap.match-item.v1' }),
      claimsVersion: number({ minimum: 0 }),
      calculationVersion: number({ minimum: 1 })
    },
    additionalProperties: false
  },
  observation: {
    $id: 'accessmap.observation.v1',
    type: 'object',
    required: ['id', 'placeId', 'featureCode', 'value', 'observedAt', 'status'],
    properties: {
      schemaVersion: string({ const: 'observation.v1' }),
      id: string(),
      placeId: string(),
      featureCode: string(),
      value: string({ enum: ['yes', 'no', 'partial', 'temporarily_unavailable', 'unknown'] }),
      details: nullableString(),
      measuredValue: { type: ['object', 'null'] },
      observedAt: string(),
      submittedAt: string(),
      status: string({ enum: ['pending', 'approved', 'rejected', 'changes_requested', 'synced'] }),
      visibility: string(),
      clientRequestId: nullableString(),
      duplicate: boolean(),
      synced: boolean(),
      sampleData: boolean(),
      evidence: { type: 'array' },
      amendments: { type: 'array' }
    },
    additionalProperties: false
  },
  observationCreate: {
    $id: 'accessmap.observation-create.v1',
    type: 'object',
    required: ['placeId', 'featureCode', 'value', 'observedAt', 'clientRequestId'],
    properties: {
      placeId: string(),
      featureCode: string(),
      value: string({ enum: ['yes', 'no', 'partial', 'temporarily_unavailable', 'unknown'] }),
      details: string(),
      measuredValue: { type: 'object' },
      observedAt: string(),
      clientRequestId: string()
    },
    additionalProperties: false
  },
  observationSync: {
    $id: 'accessmap.observation-sync.v1',
    type: 'object',
    required: ['schemaVersion', 'items'],
    properties: {
      schemaVersion: string({ const: 'observation-sync.v1' }),
      items: arrayOf({ $ref: 'accessmap.observation.v1' })
    },
    additionalProperties: false
  },
  observationList: {
    $id: 'accessmap.observation-list.v1',
    type: 'object',
    required: ['schemaVersion', 'items', 'pagination'],
    properties: {
      schemaVersion: string({ const: 'observation-list.v1' }),
      items: arrayOf({ $ref: 'accessmap.observation.v1' }),
      pagination: { $ref: 'accessmap.pagination.v1' }
    },
    additionalProperties: false
  },
  observationResponse: {
    $id: 'accessmap.observation-response.v1',
    type: 'object',
    required: ['schemaVersion', 'id', 'placeId', 'featureCode', 'value', 'observedAt', 'status'],
    properties: {
      schemaVersion: string({ const: 'observation.v1' }),
      id: string(),
      placeId: string(),
      featureCode: string(),
      value: string({ enum: ['yes', 'no', 'partial', 'temporarily_unavailable', 'unknown'] }),
      details: nullableString(),
      measuredValue: { type: ['object', 'null'] },
      observedAt: string(),
      submittedAt: string(),
      status: string({ enum: ['pending', 'approved', 'rejected', 'changes_requested', 'synced'] }),
      visibility: string(),
      clientRequestId: nullableString(),
      duplicate: boolean(),
      synced: boolean(),
      sampleData: boolean(),
      evidence: arrayOf({ type: 'object' }),
      amendments: arrayOf({ type: 'object' })
    },
    additionalProperties: false
  },
  moderationItem: {
    $id: 'accessmap.moderation-item.v1',
    type: 'object',
    required: ['id', 'entityType', 'entityId', 'reason', 'priority', 'status', 'createdAt'],
    properties: {
      id: string(),
      entityType: string(),
      entityId: string(),
      reason: string(),
      priority: string(),
      status: string(),
      assignedTo: string(),
      createdAt: string(),
      resolvedAt: string(),
      resolution: string(),
      observation: { type: ['object', 'null'] },
      evidence: { type: ['object', 'null'] }
    },
    additionalProperties: false
  },
  moderationQueue: {
    $id: 'accessmap.moderation-queue.v1',
    type: 'object',
    required: ['schemaVersion', 'items', 'pagination'],
    properties: {
      schemaVersion: string({ const: 'moderation-queue.v1' }),
      items: { type: 'array' },
      pagination: { $ref: 'accessmap.pagination.v1' }
    },
    additionalProperties: false
  },
  incident: {
    $id: 'accessmap.incident.v1',
    type: 'object',
    required: ['id', 'placeId', 'type', 'severity', 'status', 'startsAt', 'reviewAt'],
    properties: {
      id: string(),
      placeId: string(),
      type: string(),
      severity: string({ enum: ['info', 'low', 'medium', 'high', 'critical'] }),
      status: string({ enum: ['reported', 'validated', 'published', 'disputed', 'resolved', 'archived'] }),
      accessNodeId: nullableString(),
      accessEdgeId: nullableString(),
      featureId: nullableString(),
      startsAt: string(),
      reviewAt: nullableString(),
      explanation: nullableString(),
      resolvedAt: nullableString(),
      observedAt: nullableString(),
      source: string(),
      affectedScopes: arrayOf(string())
    },
    additionalProperties: false
  },
  routeRequest: {
    $id: 'accessmap.route-request.v1',
    type: 'object',
    required: ['origin', 'destination', 'constraints'],
    properties: {
      origin: { type: 'object' },
      destination: { type: 'object' },
      constraints: { type: 'object' },
      maxAlternatives: number({ minimum: 1, maximum: 10 }),
      timeoutMs: number({ minimum: 100, maximum: 120000 }),
      mode: string({ enum: ['walking', 'wheelchair', 'mobility_scooter', 'transit'] }),
      locale: string()
    },
    additionalProperties: false
  },
  routeResult: {
    $id: 'accessmap.route-result.v1',
    type: 'object',
    required: ['id', 'distanceMeters', 'estimatedMinutes', 'uncertainSegments', 'recommendation'],
    properties: {
      schemaVersion: string({ const: 'route.v1' }),
      id: string(),
      distanceMeters: number({ minimum: 0 }),
      estimatedMinutes: number({ minimum: 0 }),
      uncertainSegments: arrayOf(string()),
      staleSegments: arrayOf(string()),
      recommendation: string(),
      constraints: { type: 'object' },
      freshness: { type: 'object' },
      incidents: arrayOf({ type: 'object' }),
      alternatives: arrayOf({ type: 'object' }),
      segments: arrayOf({ type: 'object' }),
      explanation: { type: ['object', 'null'] },
      graphVersion: number({ minimum: 0 }),
      incidentVersion: number({ minimum: 0 }),
      calculatedAt: string(),
      isAccessibilityGuarantee: boolean()
    },
    additionalProperties: false
  },
  evidenceUploadIntent: {
    $id: 'accessmap.evidence-upload-intent.v1',
    type: 'object',
    required: ['schemaVersion', 'evidenceId', 'uploadUrl', 'expiresAt', 'mediaType', 'maxBytes', 'status'],
    properties: {
      schemaVersion: string({ const: 'evidence-upload-intent.v1' }),
      evidenceId: string(),
      uploadUrl: string(),
      headers: { type: 'object' },
      expiresAt: string(),
      mediaType: string(),
      maxBytes: number({ minimum: 1 }),
      status: string({ enum: ['awaiting_upload'] })
    },
    additionalProperties: false
  },
  evidence: {
    $id: 'accessmap.evidence.v1',
    type: 'object',
    required: ['schemaVersion', 'id', 'mediaType', 'url', 'altTextStatus'],
    properties: {
      schemaVersion: string({ const: 'evidence.v1' }),
      id: string(),
      mediaType: string(),
      url: string(),
      altText: string(),
      altTextStatus: string({ enum: ['pending', 'suggested', 'available', 'not_required'] })
    },
    additionalProperties: false
  },
  facilityResponse: {
    $id: 'accessmap.facility-response.v1',
    type: 'object',
    required: ['id', 'placeId', 'response', 'source', 'createdAt'],
    properties: {
      id: string(),
      placeId: string(),
      response: string(),
      statusValue: string(),
      source: string({ const: 'facility' }),
      createdAt: string(),
      updatedAt: string()
    },
    additionalProperties: false
  },
  civicChanges: {
    $id: 'accessmap.civic-changes.v1',
    type: 'object',
    required: ['schemaVersion', 'items', 'pagination'],
    properties: {
      schemaVersion: string({ const: 'civic-changes.v1' }),
      items: { type: 'array' },
      pagination: { $ref: 'accessmap.pagination.v1' }
    },
    additionalProperties: false
  },
  sessionSummary: {
    $id: 'accessmap.session-summary.v1',
    type: 'object',
    required: ['schemaVersion', 'authenticated', 'role'],
    properties: {
      schemaVersion: string({ const: 'session.v1' }),
      authenticated: boolean(),
      role: string({ enum: ['anonymous', 'user', 'moderator', 'admin', 'facility_manager'] })
    },
    additionalProperties: false
  },
  profileResponse: {
    $id: 'accessmap.profile.v1',
    type: 'object',
    required: ['schemaVersion', 'userId', 'requirements', 'version'],
    properties: {
      schemaVersion: string({ const: 'profile.v1' }),
      userId: string(),
      requirements: {
        type: 'array',
        items: {
          type: 'object',
          required: ['featureCode', 'level'],
          properties: {
            featureCode: string(),
            level: string({ enum: ['required', 'preferred', 'avoid'] })
          },
          additionalProperties: false
        }
      },
      version: number({ minimum: 0 }),
      createdAt: string(),
      updatedAt: string()
    },
    additionalProperties: false
  }
});

export function getSchema(name) {
  const schema = schemas[name];
  if (!schema) {
    throw new Error(`Unknown contract schema: ${name}`);
  }
  return schema;
}

/**
 * Validate the JSON payloads exchanged at the API boundary without adding a
 * runtime dependency to the JavaScript-only workspace. This intentionally
 * implements the small JSON Schema subset used by the shared contracts.
 */
export function validateContract(name, value) {
  const schema = getSchema(name);
  const errors = [];
  validateValue(value, schema, '$', errors);
  return { valid: errors.length === 0, errors };
}

export function assertValidContract(name, value) {
  const result = validateContract(name, value);
  if (!result.valid) {
    throw new Error(`${name} contract validation failed: ${result.errors.join('; ')}`);
  }
  return value;
}

function validateValue(value, rawSchema, path, errors) {
  const schema = resolveSchema(rawSchema);
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path} must equal ${JSON.stringify(schema.const)}`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path} must be one of: ${schema.enum.join(', ')}`);
    return;
  }

  if (schema.type && !matchesType(value, schema.type)) {
    errors.push(`${path} must be ${Array.isArray(schema.type) ? schema.type.join(' or ') : schema.type}`);
    return;
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path} is too short`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path} is too long`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} is below the minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} is above the maximum`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path} has too few items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path} has too many items`);
    if (schema.items) value.forEach((item, index) => validateValue(item, schema.items, `${path}[${index}]`, errors));
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const field of schema.required ?? []) {
    if (!Object.hasOwn(value, field)) errors.push(`${path}.${field} is required`);
  }
  for (const [field, fieldSchema] of Object.entries(schema.properties ?? {})) {
    if (Object.hasOwn(value, field)) validateValue(value[field], fieldSchema, `${path}.${field}`, errors);
  }
  if (schema.additionalProperties === false) {
    const known = new Set(Object.keys(schema.properties ?? {}));
    for (const field of Object.keys(value)) {
      if (!known.has(field)) errors.push(`${path}.${field} is not allowed`);
    }
  } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    const known = new Set(Object.keys(schema.properties ?? {}));
    for (const [field, fieldValue] of Object.entries(value)) {
      if (!known.has(field)) validateValue(fieldValue, schema.additionalProperties, `${path}.${field}`, errors);
    }
  }
}

function resolveSchema(schema) {
  if (schema?.$ref) {
    const found = Object.values(schemas).find((candidate) => candidate.$id === schema.$ref);
    if (!found) throw new Error(`Unknown contract reference: ${schema.$ref}`);
    return found;
  }
  return schema ?? {};
}

function matchesType(value, type) {
  const types = Array.isArray(type) ? type : [type];
  return types.some((candidate) => {
    if (candidate === 'null') return value === null;
    if (candidate === 'array') return Array.isArray(value);
    if (candidate === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
    if (candidate === 'number') return typeof value === 'number' && Number.isFinite(value);
    return typeof value === candidate;
  });
}
