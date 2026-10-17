const string = (extra = {}) => ({ type: 'string', ...extra });
const number = (extra = {}) => ({ type: 'number', ...extra });
const boolean = (extra = {}) => ({ type: 'boolean', ...extra });

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
      description: string(),
      latitude: number({ minimum: -90, maximum: 90 }),
      longitude: number({ minimum: -180, maximum: 180 }),
      distanceMeters: number({ minimum: 0 }),
      sampleData: boolean(),
      claimSummary: { type: 'array' },
      activeIncidents: { type: 'array' }
    },
    additionalProperties: false
  },
  placeSearch: {
    $id: 'accessmap.place-search.v1',
    type: 'object',
    required: ['schemaVersion', 'items', 'pagination'],
    properties: {
      schemaVersion: string({ const: 'place-search.v1' }),
      items: { type: 'array' },
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
      address: string(),
      claims: { type: 'array' },
      incidents: { type: 'array' },
      accessGraph: { type: 'object' }
    },
    additionalProperties: false
  },
  categoriesResponse: {
    $id: 'accessmap.categories.v1',
    type: 'object',
    required: ['schemaVersion', 'items'],
    properties: { schemaVersion: string({ const: 'categories.v1' }), items: { type: 'array' } },
    additionalProperties: false
  },
  featuresResponse: {
    $id: 'accessmap.features.v1',
    type: 'object',
    required: ['schemaVersion', 'items'],
    properties: { schemaVersion: string({ const: 'features.v1' }), items: { type: 'array' } },
    additionalProperties: false
  },
  accessibilityClaim: {
    $id: 'accessmap.accessibility-claim.v1',
    type: 'object',
    required: ['featureCode', 'status', 'source', 'observedAt'],
    properties: {
      featureCode: string(),
      status: string(),
      source: string(),
      observedAt: string(),
      supportingCount: number({ minimum: 0 }),
      disputingCount: number({ minimum: 0 })
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
  matchExplanation: {
    $id: 'accessmap.match-explanation.v1',
    type: 'object',
      required: ['decision', 'required', 'preferred', 'avoidanceWarnings', 'items'],
    properties: {
      decision: string({
        enum: ['meets_known_requirements', 'partial', 'needs_more_information', 'known_barrier', 'no_profile']
      }),
      required: { type: 'object' },
      preferred: { type: 'object' },
      avoidanceWarnings: { type: 'array' },
      items: { type: 'array' },
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
      id: string(),
      placeId: string(),
      featureCode: string(),
      value: string(),
      details: string(),
      measuredValue: { type: 'object' },
      observedAt: string(),
      status: string({ enum: ['pending', 'approved', 'rejected', 'changes_requested', 'synced'] }),
      visibility: string(),
      clientRequestId: string(),
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
    required: ['items'],
    properties: { items: { type: 'array' } },
    additionalProperties: false
  },
  observationList: {
    $id: 'accessmap.observation-list.v1',
    type: 'object',
    required: ['items', 'pagination'],
    properties: { items: { type: 'array' }, pagination: { $ref: 'accessmap.pagination.v1' } },
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
      severity: string({ enum: ['informational', 'warning', 'major', 'critical'] }),
      status: string({ enum: ['reported', 'validated', 'published', 'disputed', 'resolved', 'archived'] }),
      accessNodeId: string(),
      accessEdgeId: string(),
      featureId: string(),
      startsAt: string(),
      reviewAt: string(),
      description: string(),
      resolvedAt: string(),
      observedAt: string(),
      source: string(),
      affectedScopes: { type: 'array' }
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
      alternatives: number({ minimum: 1, maximum: 3 }),
      timeoutMs: number({ minimum: 100, maximum: 15000 })
    },
    additionalProperties: false
  },
  routeResult: {
    $id: 'accessmap.route-result.v1',
    type: 'object',
    required: ['id', 'distanceMeters', 'estimatedMinutes', 'uncertainSegments', 'recommendation'],
    properties: {
      id: string(),
      distanceMeters: number({ minimum: 0 }),
      estimatedMinutes: number({ minimum: 0 }),
      uncertainSegments: { type: 'array' },
      recommendation: string(),
      constraints: { type: 'object' },
      freshness: { type: 'object' },
      incidents: { type: 'array' },
      alternatives: { type: 'array' },
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
    required: ['authenticated', 'role'],
    properties: {
      authenticated: boolean(),
      role: string({ enum: ['anonymous', 'user', 'moderator', 'admin', 'facility_manager'] })
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
