import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { withDatabase, withTransaction } from './pool.mjs';

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : String(value).split(',').filter(Boolean);
}

function mapPlace(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category_code,
    categoryLabel: row.category_label,
    address: row.address,
    city: row.city,
    description: row.description ?? null,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    distanceMeters: row.distance_meters === null || row.distance_meters === undefined
      ? undefined
      : Number(row.distance_meters),
    sampleData: Boolean(row.is_sample),
    claimSummary: row.claim_summary ?? [],
    activeIncidents: row.active_incidents ?? []
  };
}

function mapClaim(row) {
  return {
    id: row.id,
    placeId: row.place_id,
    featureCode: row.feature_code,
    featureLabel: row.feature_label,
    status: row.status,
    summaryValue: row.summary_value,
    source: row.source ?? 'community',
    observedAt: row.latest_observed_at,
    freshnessState: row.freshness_state,
    supportingCount: Number(row.supporting_count ?? 0),
    disputingCount: Number(row.disputing_count ?? 0),
    claimsVersion: Number(row.claims_version ?? 1),
    calculationVersion: Number(row.calculation_version ?? 1)
  };
}

function mapIncident(row) {
  return {
    id: row.id,
    placeId: row.place_id,
    accessNodeId: row.access_node_id ?? null,
    accessEdgeId: row.access_edge_id ?? null,
    featureId: row.feature_id ?? null,
    featureCode: row.feature_code ?? null,
    type: row.incident_type,
    incidentType: row.incident_type,
    severity: fromDatabaseSeverity(row.severity),
    status: row.status,
    explanation: row.description ?? null,
    description: row.description ?? null,
    source: row.source_type ?? 'community',
    startsAt: row.starts_at,
    expectedExpiryAt: row.expected_expiry_at ?? null,
    reviewAt: row.review_at,
    resolvedAt: row.resolved_at ?? null,
    observedAt: row.starts_at,
    reportedBy: row.reported_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude)
  };
}

function mapFacilityClaim(row) {
  if (!row) return null;
  return {
    id: row.id,
    placeId: row.place_id,
    userId: row.user_id,
    organizationName: row.organization_name,
    verificationMethod: row.verification_method,
    status: row.status,
    reviewedBy: row.reviewed_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapFacilityResponse(row) {
  if (!row) return null;
  return {
    id: row.id,
    placeId: row.place_id,
    featureId: row.feature_id ?? null,
    response: row.response,
    statusValue: row.status_value ?? null,
    evidence: row.evidence ?? {},
    isPublic: row.is_public !== false,
    managerId: row.manager_id ?? null,
    source: 'facility',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    effectiveAt: row.effective_at ?? row.updated_at ?? row.created_at
  };
}

function fromDatabaseSeverity(value) {
  return {
    informational: 'info',
    warning: 'low',
    major: 'high',
    critical: 'critical'
  }[value] ?? value;
}

function toDatabaseSeverity(value) {
  return {
    info: 'informational',
    low: 'warning',
    medium: 'major',
    high: 'major',
    critical: 'critical'
  }[value] ?? value;
}

function endpointValue(endpoint, ...keys) {
  for (const key of keys) {
    if (endpoint?.[key] !== undefined && endpoint?.[key] !== null) return String(endpoint[key]);
  }
  return null;
}

function routeScopeValues(request = {}) {
  return {
    placeIds: [...new Set([
      endpointValue(request.origin, 'placeId', 'place_id'),
      endpointValue(request.destination, 'placeId', 'place_id')
    ].filter(Boolean))],
    nodeIds: [...new Set([
      endpointValue(request.origin, 'nodeId', 'node_id', 'accessNodeId'),
      endpointValue(request.destination, 'nodeId', 'node_id', 'accessNodeId')
    ].filter(Boolean))]
  };
}

export class SqlRepository {
  constructor(pool, { webhookSecretKey = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY } = {}) {
    this.pool = pool;
    this.webhookSecretKey = webhookSecretKey;
  }

  async getUserByAuthSubject(authSubject) {
    const result = await withDatabase(this.pool, (client) => client.query(
      `SELECT id, auth_subject, email, display_name, role, status
          FROM users
         WHERE auth_subject = $1`,
      [authSubject]
    ), { authSubject });
    return result.rows[0] ?? null;
  }

  async getUserById(id) {
    const result = await withDatabase(this.pool, (client) => client.query(
      `SELECT id, auth_subject, email, display_name, role, status
         FROM users
        WHERE id = $1`,
      [id]
    ));
    return result.rows[0] ?? null;
  }

  async health() {
    const result = await withDatabase(this.pool, (client) => client.query('SELECT 1 AS ok'));
    return result.rows[0]?.ok === 1;
  }

  async listCategories() {
    const result = await withDatabase(this.pool, (client) => client.query(
      `SELECT code, name
         FROM place_categories
        WHERE is_active = true
        ORDER BY name`
    ));
    return result.rows;
  }

  async listFeatures() {
    const result = await withDatabase(this.pool, (client) => client.query(
      `SELECT code, category, label, description, input_type AS "inputType", freshness_days AS "freshnessDays"
         FROM accessibility_features
        WHERE is_active = true
        ORDER BY category, label`
    ));
    return result.rows;
  }

  async searchPlaces({
    query = '',
    category = null,
    city = null,
    latitude = null,
    longitude = null,
    radius = null,
    bbox = null,
    features = [],
    page = 1,
    pageSize = 20,
    sort = 'distance'
  } = {}) {
    const values = [];
    const conditions = ["p.status IN ('active', 'temporarily_closed')"];
    const add = (value) => {
      values.push(value);
      return `$${values.length}`;
    };

    if (query) {
      const placeholder = add(`%${query}%`);
      conditions.push(`(p.name ILIKE ${placeholder} OR p.address ILIKE ${placeholder} OR p.city ILIKE ${placeholder})`);
    }
    if (category) conditions.push(`c.code = ${add(category)}`);
    if (city) conditions.push(`p.city ILIKE ${add(`%${city}%`)}`);
    if (latitude !== null && longitude !== null && radius !== null) {
      const point = `ST_SetSRID(ST_Point(${add(longitude)}, ${add(latitude)}), 4326)::geography`;
      conditions.push(`ST_DWithin(p.geom, ${point}, ${add(radius)})`);
    }
    if (bbox) {
      conditions.push(`ST_Intersects(
        p.geom,
        ST_SetSRID(ST_MakeEnvelope(${add(bbox.minLongitude)}, ${add(bbox.minLatitude)}, ${add(bbox.maxLongitude)}, ${add(bbox.maxLatitude)}), 4326)::geography
      )`);
    }
    for (const featureCode of asArray(features)) {
      conditions.push(`EXISTS (
        SELECT 1
          FROM claims feature_filter_claim
          JOIN accessibility_features feature_filter ON feature_filter.id = feature_filter_claim.feature_id
         WHERE feature_filter_claim.place_id = p.id
           AND feature_filter.code = ${add(featureCode)}
           AND feature_filter_claim.summary_value = 'yes'
           AND feature_filter_claim.freshness_state = 'fresh'
      )`);
    }

    const distanceExpression = latitude !== null && longitude !== null
      ? `ST_Distance(p.geom, ST_SetSRID(ST_Point(${add(longitude)}, ${add(latitude)}), 4326)::geography)`
      : 'NULL';
    const orderBy = sort === 'freshness'
      ? 'p.updated_at DESC, p.name ASC'
      : latitude !== null && longitude !== null
        ? 'distance_meters ASC NULLS LAST, p.name ASC'
        : 'p.name ASC';
    const where = conditions.join(' AND ');
    const countResult = await withDatabase(this.pool, (client) => client.query(
      `SELECT count(*)::integer AS total
         FROM places p
         JOIN place_categories c ON c.id = p.category_id
        WHERE ${where}`,
      values
    ));
    const total = countResult.rows[0]?.total ?? 0;
    const offset = (page - 1) * pageSize;
    const limitPlaceholder = add(pageSize);
    const offsetPlaceholder = add(offset);
    const result = await withDatabase(this.pool, (client) => client.query(
      `SELECT
         p.id, p.name, c.code AS category_code, c.name AS category_label,
         p.address, p.city, p.description, p.latitude, p.longitude, p.is_sample,
         ${distanceExpression} AS distance_meters,
         COALESCE((
           SELECT json_agg(json_build_object(
             'featureCode', f.code,
             'status', cl.status,
             'summaryValue', cl.summary_value,
             'observedAt', cl.latest_observed_at,
             'freshnessState', cl.freshness_state
           ) ORDER BY f.code)
           FROM claims cl
           JOIN accessibility_features f ON f.id = cl.feature_id
          WHERE cl.place_id = p.id
         ), '[]'::json) AS claim_summary,
         COALESCE((
           SELECT json_agg(json_build_object(
             'id', b.id,
             'type', b.incident_type,
             'severity', b.severity,
             'status', b.status,
             'reviewAt', b.review_at
           ) ORDER BY b.review_at)
           FROM barrier_events b
          WHERE b.place_id = p.id
            AND b.status IN ('reported', 'validated', 'published', 'disputed')
         ), '[]'::json) AS active_incidents
       FROM places p
       JOIN place_categories c ON c.id = p.category_id
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
      values
    ));
    return {
      items: result.rows.map(mapPlace),
      pagination: { page, pageSize, total, hasNext: offset + result.rows.length < total }
    };
  }

  async getPlace(placeId) {
    const result = await withDatabase(this.pool, (client) => client.query(
      `SELECT p.id, p.name, c.code AS category_code, c.name AS category_label,
              p.address, p.city, p.postal_code, p.description, p.latitude,
              p.longitude, p.phone, p.website, p.opening_hours, p.source,
              p.status, p.is_sample
         FROM places p
         JOIN place_categories c ON c.id = p.category_id
        WHERE p.id = $1
          AND p.status IN ('active', 'temporarily_closed')`,
      [placeId]
    ));
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return {
      ...mapPlace(row),
      postalCode: row.postal_code,
      phone: row.phone,
      website: row.website,
      openingHours: row.opening_hours,
      source: row.source,
      status: row.status,
      claims: await this.listClaims(placeId),
      incidents: await this.listIncidents({ placeId }),
      accessGraph: await this.getAccessGraph(placeId)
    };
  }

  async listClaims(placeId) {
    const result = await withDatabase(this.pool, (client) => client.query(
      `SELECT cl.id, cl.place_id, f.code AS feature_code, f.label AS feature_label,
              cl.status, cl.summary_value, cl.latest_observed_at, cl.freshness_state,
              cl.supporting_count, cl.disputing_count, cl.claims_version,
              cl.calculation_version,
              CASE WHEN cl.status = 'facility_confirmed' THEN 'facility' ELSE 'community' END AS source
         FROM claims cl
         JOIN accessibility_features f ON f.id = cl.feature_id
        WHERE cl.place_id = $1
        ORDER BY f.category, f.label`,
      [placeId]
    ));
    return result.rows.map(mapClaim);
  }

  async listIncidents({ placeId = null, bbox = null, placeIds = [], nodeIds = [], publicOnly = true, activeOnly = false, page, pageSize } = {}) {
    const values = [];
    const conditions = [publicOnly
      ? "b.status IN ('published', 'disputed', 'resolved', 'archived')"
      : "b.status IN ('reported', 'validated', 'published', 'disputed', 'resolved', 'archived')"];
    const add = (value) => {
      values.push(value);
      return `$${values.length}`;
    };
    if (placeId) conditions.push(`b.place_id = ${add(placeId)}`);
    if (placeIds.length > 0) conditions.push(`b.place_id::text = ANY(${add(placeIds)}::text[])`);
    if (nodeIds.length > 0) conditions.push(`(b.access_node_id::text = ANY(${add(nodeIds)}::text[]) OR b.access_edge_id::text = ANY(${add(nodeIds)}::text[]))`);
    if (activeOnly) conditions.push("b.status IN ('published', 'disputed')");
    if (bbox) {
      conditions.push(`ST_Intersects(
        b.geom,
        ST_SetSRID(ST_MakeEnvelope(${add(bbox.minLongitude)}, ${add(bbox.minLatitude)}, ${add(bbox.maxLongitude)}, ${add(bbox.maxLatitude)}), 4326)::geography
      )`);
    }
    const where = conditions.join(' AND ');
    const offset = page === undefined ? 0 : (Number(page) - 1) * Number(pageSize);
    const limit = pageSize === undefined ? null : Number(pageSize);
    const result = await withDatabase(this.pool, (client) => client.query(
      `${incidentSelect()}
        WHERE ${where}
        ORDER BY b.starts_at DESC, b.id ASC${limit === null ? '' : ` LIMIT ${add(limit)} OFFSET ${add(offset)}`}`,
      values
    ));
    const items = result.rows.map(mapIncident);
    if (page === undefined) return items;
    const count = await withDatabase(this.pool, (client) => client.query(
      `SELECT count(*)::integer AS total FROM barrier_events b WHERE ${where}`,
      values.slice(0, limit === null ? values.length : values.length - 2)
    ));
    const total = Number(count.rows[0]?.total ?? 0);
    return { items, pagination: { page: Number(page), pageSize: Number(pageSize), total, hasNext: offset + items.length < total } };
  }

  async getAccessGraph(placeId) {
    const result = await withDatabase(this.pool, (client) => client.query(
      `SELECT id, place_id, node_type, label, floor, status, updated_at,
              ST_Y(geom::geometry) AS latitude, ST_X(geom::geometry) AS longitude
         FROM access_nodes
        WHERE place_id = $1
          AND status IN ('active', 'unknown')
        ORDER BY label`,
      [placeId]
    ));
    const edges = await withDatabase(this.pool, (client) => client.query(
      `SELECT id, from_node_id, to_node_id, surface_type, width_meters,
               slope_percent, stairs, step_free, last_observed_at, status, updated_at,
               ST_AsGeoJSON(geometry)::json AS geometry
         FROM access_edges
        WHERE from_node_id IN (SELECT id FROM access_nodes WHERE place_id = $1)
          AND to_node_id IN (SELECT id FROM access_nodes WHERE place_id = $1)
        ORDER BY id`,
      [placeId]
    ));
    return {
       graphVersion: versionFromRows([...result.rows, ...edges.rows]),
       nodes: result.rows.map((row) => ({
         id: row.id,
         placeId: row.place_id,
         type: row.node_type,
        label: row.label,
        floor: row.floor,
        status: row.status,
        latitude: Number(row.latitude),
        longitude: Number(row.longitude)
      })),
      edges: edges.rows.map((row) => ({
        id: row.id,
        fromNodeId: row.from_node_id,
        toNodeId: row.to_node_id,
        surfaceType: row.surface_type,
         widthMeters: row.width_meters === null ? null : Number(row.width_meters),
         slopePercent: row.slope_percent === null ? null : Number(row.slope_percent),
        stairs: row.stairs,
        stepFree: row.step_free,
         lastObservedAt: row.last_observed_at,
         status: row.status,
         geometry: row.geometry ?? null
      }))
    };
  }

  async getForRoute(request = {}) {
    const { placeIds, nodeIds } = routeScopeValues(request);
    if (placeIds.length === 0 && nodeIds.length === 0) return null;
    return withDatabase(this.pool, async (client) => {
      const nodes = await client.query(
        `SELECT n.id, n.place_id, n.node_type, n.label, n.floor, n.status,
                n.updated_at,
                ST_Y(n.geom::geometry) AS latitude, ST_X(n.geom::geometry) AS longitude
           FROM access_nodes n
          WHERE n.status IN ('active', 'unknown')
            AND (
              n.place_id::text = ANY($1::text[])
              OR n.id::text = ANY($2::text[])
              OR n.place_id IN (
                SELECT scoped.place_id FROM access_nodes scoped
                 WHERE scoped.id::text = ANY($2::text[])
              )
            )
          ORDER BY n.id`,
        [placeIds, nodeIds]
      );
      const nodeIdsForEdges = nodes.rows.map((row) => row.id);
      const edges = await client.query(
        `SELECT e.id, e.from_node_id, e.to_node_id, e.surface_type, e.width_meters,
                 e.slope_percent, e.stairs, e.step_free, e.last_observed_at,
                 e.status, e.updated_at,
                 ST_AsGeoJSON(e.geometry)::json AS geometry
           FROM access_edges e
          WHERE e.from_node_id = ANY($1::uuid[])
            AND e.to_node_id = ANY($1::uuid[])
          ORDER BY e.id`,
        [nodeIdsForEdges]
      );
      return {
        graphVersion: versionFromRows([...nodes.rows, ...edges.rows]),
        nodes: nodes.rows.map(mapGraphNode),
        edges: edges.rows.map(mapGraphEdge)
      };
    });
  }

  async getGraphForRoute(request) {
    return this.getForRoute(request);
  }

  async getRouteVersions(request = {}) {
    const { placeIds, nodeIds } = routeScopeValues(request);
    return withDatabase(this.pool, async (client) => {
      const graph = await client.query(
        `SELECT EXTRACT(EPOCH FROM max(updated_at)) * 1000 AS version
           FROM (
             SELECT n.updated_at
               FROM access_nodes n
              WHERE n.place_id::text = ANY($1::text[])
                 OR n.id::text = ANY($2::text[])
             UNION ALL
             SELECT e.updated_at
               FROM access_edges e
              WHERE e.from_node_id IN (
                SELECT n.id FROM access_nodes n
                 WHERE n.place_id::text = ANY($1::text[])
                    OR n.id::text = ANY($2::text[])
              )
                 OR e.to_node_id IN (
                SELECT n.id FROM access_nodes n
                 WHERE n.place_id::text = ANY($1::text[])
                    OR n.id::text = ANY($2::text[])
              )
           ) graph_rows`,
        [placeIds, nodeIds]
      );
      const incidents = await client.query(
        `SELECT EXTRACT(EPOCH FROM max(updated_at)) * 1000 AS version
           FROM barrier_events b
          WHERE b.status IN ('reported', 'validated', 'published', 'disputed')
            AND (
              b.place_id::text = ANY($1::text[])
              OR b.access_node_id::text = ANY($2::text[])
              OR b.access_edge_id::text = ANY($2::text[])
            )`,
        [placeIds, nodeIds]
      );
      return {
        graphVersion: safeVersion(graph.rows[0]?.version),
        incidentVersion: safeVersion(incidents.rows[0]?.version)
      };
    });
  }

  async listForRoute(request = {}) {
    const { placeIds, nodeIds } = routeScopeValues(request);
    return withDatabase(this.pool, async (client) => {
      const result = await client.query(
        `${incidentSelect()}
          WHERE b.status IN ('reported', 'validated', 'published', 'disputed')
            AND (
              b.place_id::text = ANY($1::text[])
              OR b.access_node_id::text = ANY($2::text[])
              OR b.access_edge_id::text = ANY($2::text[])
            )
          ORDER BY b.starts_at DESC, b.id ASC`,
        [placeIds, nodeIds]
      );
      return result.rows.map(mapIncident);
    });
  }

  async createIncident(record) {
    return withTransaction(this.pool, async (client) => {
      const startsAt = record.startsAt ?? new Date().toISOString();
      const reviewAt = record.reviewAt ?? record.expectedExpiryAt ?? startsAt;
      const inserted = await client.query(
        `INSERT INTO barrier_events
          (id, place_id, access_node_id, access_edge_id, feature_id, incident_type, severity,
           status, description, geom, reported_by, source_type, starts_at, review_at,
           expected_expiry_at, resolved_at)
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9,
           CASE WHEN $10 IS NULL THEN NULL
                ELSE ST_SetSRID(ST_GeomFromGeoJSON($10), 4326)::geography END,
           $11, $12, $13, $14, $15, $16
         )
         RETURNING id`,
        [
          record.id,
          record.placeId ?? null,
          record.accessNodeId ?? null,
           record.accessEdgeId ?? null,
           record.featureId ?? null,
           record.type ?? record.incidentType,
           toDatabaseSeverity(record.severity),
           record.status ?? 'reported',
           record.explanation ?? record.description ?? null,
           record.geometry ? JSON.stringify(record.geometry) : null,
           record.reporterId ?? record.createdBy ?? null,
           record.source ?? 'community',
           startsAt,
           reviewAt,
           record.expectedExpiryAt ?? null,
           record.resolvedAt ?? null
        ]
      );
      const stored = await client.query(`${incidentSelect()} WHERE b.id = $1`, [inserted.rows[0].id]);
      await insertOutbox(client, {
        eventType: publicIncidentEventType(record.status, 'created'),
        aggregateType: 'incident',
        aggregateId: inserted.rows[0].id,
        payload: publicIncidentPayload(stored.rows[0])
      });
      return mapIncident(stored.rows[0]);
    }, databaseContext(record));
  }

  async getIncident(id) {
    const result = await withDatabase(this.pool, (client) => client.query(
      `${incidentSelect()} WHERE b.id = $1`,
      [id]
    ));
    return mapIncident(result.rows[0]);
  }

  async getById(id) {
    return this.getIncident(id);
  }

  async updateIncident(id, record) {
    return withTransaction(this.pool, async (client) => {
      const current = await client.query(`${incidentSelect()} WHERE b.id = $1 FOR UPDATE`, [id]);
      if (!current.rows[0]) return null;
      const startsAt = record.startsAt ?? current.rows[0].starts_at;
      const reviewAt = record.reviewAt ?? record.expectedExpiryAt ?? current.rows[0].review_at;
      await client.query(
        `UPDATE barrier_events
            SET status = $2,
                severity = $3,
                description = $4,
                review_at = $5,
                expected_expiry_at = $6,
                resolved_at = $7,
                updated_at = now()
          WHERE id = $1`,
        [
          id,
          record.status ?? current.rows[0].status,
          toDatabaseSeverity(record.severity ?? fromDatabaseSeverity(current.rows[0].severity)),
          record.explanation ?? record.description ?? current.rows[0].description,
          reviewAt,
          record.expectedExpiryAt ?? current.rows[0].expected_expiry_at ?? null,
          record.resolvedAt ?? null
        ]
      );
      const stored = await client.query(`${incidentSelect()} WHERE b.id = $1`, [id]);
      await insertOutbox(client, {
        eventType: publicIncidentEventType(record.status, 'updated'),
        aggregateType: 'incident',
        aggregateId: id,
        payload: publicIncidentPayload(stored.rows[0])
      });
      return mapIncident(stored.rows[0]);
    }, databaseContext(record));
  }

  async createFacilityClaim(record) {
    return withTransaction(this.pool, async (client) => {
      const result = await client.query(
        `INSERT INTO facility_claims
          (id, place_id, user_id, organization_name, verification_method, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         RETURNING id, place_id, user_id, organization_name, verification_method,
                   status, reviewed_by, created_at, updated_at`,
        [record.id, record.placeId, record.userId, record.organizationName, record.verificationMethod]
      );
      return mapFacilityClaim(result.rows[0]);
    }, databaseContext(record));
  }

  async createClaim(record) {
    return this.createFacilityClaim(record);
  }

  async findApprovedClaim(placeId, userId) {
    const result = await withDatabase(this.pool, (client) => client.query(
      `SELECT id, place_id, user_id, organization_name, verification_method,
              status, reviewed_by, created_at, updated_at
         FROM facility_claims
        WHERE place_id = $1 AND user_id = $2 AND status = 'approved'
        ORDER BY updated_at DESC
        LIMIT 1`,
      [placeId, userId]
    ), { userId, role: 'facility_manager' });
    return mapFacilityClaim(result.rows[0]);
  }

  async listApprovedClaims(userId) {
    const result = await withDatabase(this.pool, (client) => client.query(
      `SELECT id, place_id, user_id, organization_name, verification_method,
              status, reviewed_by, created_at, updated_at
         FROM facility_claims
        WHERE user_id = $1 AND status = 'approved'
        ORDER BY place_id`,
      [userId]
    ), { userId, role: 'facility_manager' });
    return result.rows.map(mapFacilityClaim);
  }

  async listForUser(userId) {
    return this.listApprovedClaims(userId);
  }

  async listApprovedFacilities(options = {}) {
    const values = [];
    const conditions = ["p.status IN ('active', 'temporarily_closed')", "fc.status = 'approved'"];
    const add = (value) => {
      values.push(value);
      return `$${values.length}`;
    };
    if (Array.isArray(options.facilityIds)) {
      if (options.facilityIds.length === 0) return { items: [], pagination: { page: options.page ?? 1, pageSize: options.pageSize ?? 20, total: 0, hasNext: false } };
      conditions.push(`p.id::text = ANY(${add(options.facilityIds)}::text[])`);
    }
    if (options.city) conditions.push(`p.city ILIKE ${add(`%${options.city}%`)}`);
    if (options.category) conditions.push(`pc.code = ${add(options.category)}`);
    if (options.placeId) conditions.push(`p.id = ${add(options.placeId)}`);
    const page = Number(options.page ?? 1);
    const pageSize = Number(options.pageSize ?? 20);
    const count = await withDatabase(this.pool, (client) => client.query(
      `SELECT count(DISTINCT p.id)::integer AS total
         FROM places p
         JOIN place_categories pc ON pc.id = p.category_id
         JOIN facility_claims fc ON fc.place_id = p.id
        WHERE ${conditions.join(' AND ')}`,
      values
    ), databaseContext(options));
    const total = Number(count.rows[0]?.total ?? 0);
    const result = await withDatabase(this.pool, (client) => client.query(
      `SELECT DISTINCT ON (p.id)
              p.id, p.name, pc.code AS category_code, pc.name AS category_label,
              p.address, p.city, p.description, p.latitude, p.longitude,
              p.is_sample, p.status, p.source
         FROM places p
         JOIN place_categories pc ON pc.id = p.category_id
         JOIN facility_claims fc ON fc.place_id = p.id
        WHERE ${conditions.join(' AND ')}
        ORDER BY p.id, fc.updated_at DESC
        LIMIT ${add(pageSize)} OFFSET ${add((page - 1) * pageSize)}`,
      values
    ), databaseContext(options));
    return {
      items: result.rows.map(mapPlace),
      pagination: { page, pageSize, total, hasNext: page * pageSize < total }
    };
  }

  async listFacilities(options) {
    return this.listApprovedFacilities(options);
  }

  async getFacility(placeId) {
    const place = await this.getPlace(placeId);
    if (!place) return null;
    const [responses, history, incidents] = await Promise.all([
      this.listFacilityResponses(placeId, { publicOnly: true }),
      this.listPublicObservationHistory(placeId),
      this.listIncidents({ placeId })
    ]);
    return { ...place, responses, communityHistory: history, incidents };
  }

  async getByPlaceId(placeId) {
    return this.getFacility(placeId);
  }

  async createFacilityResponse(record) {
    return withTransaction(this.pool, async (client) => {
      const result = await client.query(
        `INSERT INTO facility_responses
          (id, place_id, feature_id, manager_id, response, status_value, evidence, is_public)
         VALUES (
           $1, $2,
           (SELECT id FROM accessibility_features WHERE id::text = $3 OR code = $3 LIMIT 1),
           $4, $5, $6, $7::jsonb, true
         )
         RETURNING id, place_id, feature_id, manager_id, response, status_value,
                   evidence, is_public, created_at, updated_at`,
        [record.id, record.placeId, record.featureId ?? '', record.managerId, record.response, record.statusValue ?? null, JSON.stringify(record.evidence ?? {})]
      );
      if (!result.rows[0]) return null;
      await insertOutbox(client, {
        eventType: 'facility.response.published',
        aggregateType: 'facility_response',
        aggregateId: result.rows[0].id,
        payload: { placeId: result.rows[0].place_id, status: 'published' }
      });
      return mapFacilityResponse(result.rows[0]);
    }, databaseContext(record));
  }

  async createResponse(record) {
    return this.createFacilityResponse(record);
  }

  async getFacilityResponse(id) {
    const result = await withDatabase(this.pool, (client) => client.query(
      `SELECT id, place_id, feature_id, manager_id, response, status_value,
              evidence, is_public, created_at, updated_at
         FROM facility_responses WHERE id = $1`,
      [id]
    ));
    return mapFacilityResponse(result.rows[0]);
  }

  async getResponse(id) {
    return this.getFacilityResponse(id);
  }

  async updateFacilityResponse(id, record) {
    return withTransaction(this.pool, async (client) => {
      const result = await client.query(
        `UPDATE facility_responses
            SET response = $2,
                status_value = $3,
                evidence = $4::jsonb,
                updated_at = now()
          WHERE id = $1
          RETURNING id, place_id, feature_id, manager_id, response, status_value,
                    evidence, is_public, created_at, updated_at`,
        [id, record.response, record.statusValue ?? null, JSON.stringify(record.evidence ?? {})]
      );
      return mapFacilityResponse(result.rows[0]);
    }, databaseContext(record));
  }

  async updateResponse(id, record) {
    return this.updateFacilityResponse(id, record);
  }

  async listFacilityResponses(placeId, { publicOnly = true } = {}) {
    const result = await withDatabase(this.pool, (client) => client.query(
      `SELECT id, place_id, feature_id, manager_id, response, status_value,
              evidence, is_public, created_at, updated_at
         FROM facility_responses
        WHERE place_id = $1 AND ($2 = false OR is_public = true)
        ORDER BY updated_at DESC, id ASC`,
      [placeId, publicOnly]
    ));
    return result.rows.map(mapFacilityResponse);
  }

  async listPublicObservationHistory(placeId) {
    const result = await withDatabase(this.pool, (client) => client.query(
      `SELECT o.id, o.place_id, f.code AS feature_code, o.value, o.details,
              o.observed_at, o.moderation_status, o.visibility, o.is_sample
         FROM observations o
         JOIN accessibility_features f ON f.id = o.feature_id
        WHERE o.place_id = $1 AND o.visibility = 'public' AND o.moderation_status = 'approved'
        ORDER BY o.observed_at DESC, o.id ASC`,
      [placeId]
    ));
    return result.rows.map((row) => ({
      id: row.id,
      placeId: row.place_id,
      featureCode: row.feature_code,
      value: row.value,
      details: row.details,
      observedAt: row.observed_at,
      status: row.moderation_status,
      sampleData: Boolean(row.is_sample)
    }));
  }

  async createFacilityIncident(record) {
    return this.createIncident({ ...record, source: 'facility', actorRole: record.actorRole ?? 'facility_manager' });
  }

  async getFacilityIncident(id) {
    return this.getIncident(id);
  }

  async updateFacilityIncident(id, record) {
    return this.updateIncident(id, { ...record, actorRole: record.actorRole ?? 'facility_manager' });
  }

  async createQrCode(record) {
    return withTransaction(this.pool, async (client) => {
      const result = await client.query(
        `INSERT INTO facility_qr_codes
          (id, facility_id, place_id, token_hash, context, expires_at, created_by)
         VALUES ($1, $2, $3, encode(digest($4, 'sha256'), 'hex'), $5::jsonb, $6, $7)
         RETURNING id, facility_id, place_id, expires_at, context, created_at`,
        [record.id, record.facilityId, record.placeId, record.token, JSON.stringify(record.context ?? {}), record.expiresAt, record.createdBy]
      );
      return result.rows[0] ? { ...record, id: result.rows[0].id, token: undefined, createdAt: result.rows[0].created_at } : null;
    }, databaseContext(record));
  }

  async resolveContext(context) {
    const result = await withDatabase(this.pool, (client) => client.query(
      `SELECT facility_id, place_id, context
         FROM facility_qr_codes
        WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [context?.jti ?? context?.id]
    ));
    if (!result.rows[0]) return null;
    return { ...result.rows[0].context, facilityId: result.rows[0].facility_id, placeId: result.rows[0].place_id, public: true };
  }

  async getContext(context) {
    return this.resolveContext(context);
  }

  async isRevoked(jti) {
    const result = await withDatabase(this.pool, (client) => client.query(
      `SELECT revoked_at IS NOT NULL AS revoked FROM facility_qr_codes WHERE id = $1`,
      [jti]
    ));
    return Boolean(result.rows[0]?.revoked);
  }

  async revoke(jti) {
    const result = await withDatabase(this.pool, (client) => client.query(
      `UPDATE facility_qr_codes SET revoked_at = now() WHERE id = $1 RETURNING id`,
      [jti]
    ));
    return Boolean(result.rows[0]);
  }

  async getPublicPlaceAccessibility(placeId) {
    const place = await this.getPlace(placeId);
    if (!place) return null;
    const [claims, responses, incidents] = await Promise.all([
      this.listClaims(placeId),
      this.listFacilityResponses(placeId, { publicOnly: true }),
      this.listIncidents({ placeId })
    ]);
    return { place, claims, responses, incidents, generatedAt: new Date().toISOString() };
  }

  async getPlaceAccessibility(placeId) {
    return this.getPublicPlaceAccessibility(placeId);
  }

  async getPublicPlace(placeId) {
    return this.getPublicPlaceAccessibility(placeId);
  }

  async listPublicIncidents(options = {}) {
    return this.listIncidents({ ...options, publicOnly: true });
  }

  async listPublicChanges(options = {}) {
    const publicEventTypes = [
      'place.created', 'place.updated', 'claim.recomputed', 'facility.response.published',
      'barrier.created', 'barrier.updated', 'barrier.resolved', 'route.invalidated', 'change.published'
    ];
    const values = [publicEventTypes];
    const conditions = ['event_type = ANY($1::text[])'];
    const add = (value) => { values.push(value); return `$${values.length}`; };
    if (options.since) conditions.push(`created_at >= ${add(options.since)}`);
    if (options.placeId) conditions.push(`payload->>'placeId' = ${add(options.placeId)}`);
    if (options.eventType) conditions.push(`event_type = ${add(options.eventType)}`);
    const page = Number(options.page ?? 1);
    const pageSize = Number(options.pageSize ?? 20);
    const result = await withDatabase(this.pool, (client) => client.query(
      `SELECT id, event_type, aggregate_type, aggregate_id, payload, created_at
         FROM outbox_events
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at ASC, id ASC
        LIMIT ${add(pageSize)} OFFSET ${add((page - 1) * pageSize)}`,
      values
    ));
    const count = await withDatabase(this.pool, (client) => client.query(
      `SELECT count(*)::integer AS total FROM outbox_events WHERE ${conditions.join(' AND ')}`,
      values.slice(0, -2)
    ));
    return {
      items: result.rows.map(mapPublicChange),
      pagination: { page, pageSize, total: Number(count.rows[0]?.total ?? 0), hasNext: page * pageSize < Number(count.rows[0]?.total ?? 0) }
    };
  }

  async createSubscription(record) {
    const result = await withDatabase(this.pool, (client) => client.query(
      `INSERT INTO webhook_subscriptions
        (id, owner_id, endpoint, events, secret_hash, status)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       RETURNING id, owner_id, endpoint, events, secret_hash, status,
                 last_delivery_at, failure_count, last_error, created_at, updated_at`,
      [record.id, record.ownerId, record.endpoint, JSON.stringify(record.events), record.secretHash, record.status]
    ), databaseContext(record));
    return mapWebhookSubscription(result.rows[0]);
  }

  async createWebhookSubscription(record) {
    return this.createSubscription(record);
  }

  async getSubscription(id, { ownerId = null, role = 'user' } = {}) {
    const result = await withDatabase(this.pool, (client) => client.query(
      `SELECT id, owner_id, endpoint, events, secret_hash, status,
              last_delivery_at, failure_count, last_error, created_at, updated_at,
              secret_ciphertext
         FROM webhook_subscriptions WHERE id = $1`,
      [id]
    ), { userId: ownerId, role });
    return mapWebhookSubscription(result.rows[0]);
  }

  async getWebhookSubscription(id, options) {
    return this.getSubscription(id, options);
  }

  async listSubscriptions(ownerId) {
    const result = await withDatabase(this.pool, (client) => client.query(
      `SELECT id, owner_id, endpoint, events, secret_hash, status,
              last_delivery_at, failure_count, last_error, created_at, updated_at
         FROM webhook_subscriptions
        WHERE owner_id = $1
        ORDER BY created_at DESC`,
      [ownerId]
    ), { userId: ownerId, role: 'user' });
    return result.rows.map(mapWebhookSubscription);
  }

  async listWebhookSubscriptions(ownerId) {
    return this.listSubscriptions(ownerId);
  }

  async updateSubscription(id, record) {
    const result = await withDatabase(this.pool, (client) => client.query(
      `UPDATE webhook_subscriptions
          SET status = $2, updated_at = now()
        WHERE id = $1
        RETURNING id, owner_id, endpoint, events, secret_hash, status,
                  last_delivery_at, failure_count, last_error, created_at, updated_at`,
      [id, record.status]
    ), databaseContext(record));
    return mapWebhookSubscription(result.rows[0]);
  }

  async updateWebhookSubscription(id, record) {
    return this.updateSubscription(id, record);
  }

  async storeWebhookSecret({ id, secret }) {
    const encrypted = encryptWebhookSecret(secret, this.webhookSecretKey);
    await withDatabase(this.pool, (client) => client.query(
      `UPDATE webhook_subscriptions SET secret_ciphertext = $2, updated_at = now() WHERE id = $1`,
      [id, encrypted]
    ), { role: 'admin' });
  }

  async getWebhookSecret(id) {
    const result = await withDatabase(this.pool, (client) => client.query(
      `SELECT secret_ciphertext FROM webhook_subscriptions WHERE id = $1`,
      [id]
    ), { role: 'admin' });
    return result.rows[0]?.secret_ciphertext
      ? decryptWebhookSecret(result.rows[0].secret_ciphertext, this.webhookSecretKey)
      : null;
  }

  async claimIdempotency(idempotencyKey, { subscriptionId, eventId, ownerId } = {}) {
    const result = await withDatabase(this.pool, (client) => client.query(
      `INSERT INTO webhook_deliveries
        (id, subscription_id, event_id, idempotency_key, status)
       VALUES ($1, $2, $3, $4, 'pending')
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [idempotencyKey, subscriptionId, eventId, idempotencyKey]
    ), { userId: ownerId, role: 'user' });
    return Boolean(result.rows[0]);
  }

  async claimDelivery(idempotencyKey, options) {
    return this.claimIdempotency(idempotencyKey, options);
  }

  async recordDelivery(record) {
    const state = record.state ?? {};
    await withDatabase(this.pool, (client) => client.query(
      `INSERT INTO webhook_deliveries
        (id, subscription_id, event_id, idempotency_key, attempt, status,
         status_code, next_attempt_at, delivered_at, last_error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (idempotency_key) DO UPDATE SET
         attempt = EXCLUDED.attempt,
         status = EXCLUDED.status,
         status_code = EXCLUDED.status_code,
         next_attempt_at = EXCLUDED.next_attempt_at,
         delivered_at = EXCLUDED.delivered_at,
         last_error = EXCLUDED.last_error,
         updated_at = now()`,
      [record.id, record.subscriptionId, record.eventId, record.idempotencyKey,
        record.attempt, state.status ?? 'failed', record.statusCode,
        state.nextAttemptAt ?? null, record.deliveredAt, record.error ?? null]
    ), { userId: record.ownerId ?? null, role: record.role ?? 'user' });
  }

  async getDelivery(id, { ownerId = null, role = 'user' } = {}) {
    const result = await withDatabase(this.pool, (client) => client.query(
      `SELECT d.id, d.subscription_id, d.event_id, d.idempotency_key,
              d.attempt, d.status, d.status_code, d.next_attempt_at,
              d.delivered_at, d.last_error, d.created_at, d.updated_at
         FROM webhook_deliveries d
        WHERE d.id = $1`,
      [id]
    ), { userId: ownerId, role });
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      subscriptionId: row.subscription_id,
      eventId: row.event_id,
      idempotencyKey: row.idempotency_key,
      attempt: Number(row.attempt),
      status: row.status,
      statusCode: row.status_code,
      nextAttemptAt: row.next_attempt_at,
      deliveredAt: row.delivered_at,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async findCivicApiKey(rawKey) {
    const keyHash = createHash('sha256').update(String(rawKey)).digest('hex');
    const result = await withDatabase(this.pool, (client) => client.query(
      `UPDATE civic_api_keys
          SET last_used_at = now()
        WHERE key_hash = $1 AND status = 'active'
        RETURNING id, owner_id, label, rate_limit_per_minute, status`,
      [keyHash]
    ), { role: 'worker' });
    return result.rows[0] ?? null;
  }

  async getProfile(userId) {
    const result = await withDatabase(this.pool, (client) => client.query(
      `SELECT user_id, requirements, profile_version, created_at, updated_at
         FROM user_access_profiles
        WHERE user_id = $1`,
      [userId]
    ));
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return {
      userId: row.user_id,
      requirements: row.requirements,
      version: row.profile_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async upsertProfile(userId, requirements) {
    const result = await withTransaction(this.pool, async (client) => {
      const saved = await client.query(
        `INSERT INTO user_access_profiles (user_id, requirements, profile_version)
         VALUES ($1, $2::jsonb, 1)
         ON CONFLICT (user_id) DO UPDATE
           SET requirements = EXCLUDED.requirements,
               profile_version = user_access_profiles.profile_version + 1
         RETURNING user_id, requirements, profile_version, created_at, updated_at`,
        [userId, JSON.stringify(requirements)]
      );
      return saved.rows[0];
    });
    return {
      userId: result.user_id,
      requirements: result.requirements,
      version: result.profile_version,
      createdAt: result.created_at,
      updatedAt: result.updated_at
    };
  }

  async claimsForMatch(placeId) {
    const claims = await this.listClaims(placeId);
    const incidents = await this.listIncidents({ placeId, activeOnly: true });
    return {
      claimsVersion: claims.reduce((version, claim) => Math.max(version, claim.claimsVersion), 0),
      claims,
      barriers: incidents
        .filter((incident) => incident.featureCode)
        .map((incident) => ({
          featureCode: incident.featureCode,
          status: incident.status,
          source: incident.source,
          observedAt: incident.observedAt,
          active: true
        }))
    };
  }
}

function mapGraphNode(row) {
  return {
    id: row.id,
    placeId: row.place_id,
    type: row.node_type,
    label: row.label,
    floor: row.floor,
    status: row.status,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude)
  };
}

function mapGraphEdge(row) {
  return {
    id: row.id,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    surfaceType: row.surface_type,
    widthMeters: row.width_meters === null ? null : Number(row.width_meters),
    slopePercent: row.slope_percent === null ? null : Number(row.slope_percent),
    stairs: row.stairs,
    stepFree: row.step_free,
    lastObservedAt: row.last_observed_at,
     status: row.status,
     geometry: row.geometry ?? null
  };
}

function versionFromRows(rows) {
  const values = rows.map((row) => row.updated_at ? Date.parse(row.updated_at) : 0).filter(Number.isFinite);
  return values.length === 0 ? 0 : Math.max(...values);
}

function safeVersion(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function incidentSelect() {
  return `SELECT b.id, b.place_id, b.access_node_id, b.access_edge_id, b.feature_id,
                  f.code AS feature_code,
                  b.incident_type, b.severity, b.status, b.description, b.reported_by,
                 b.source_type, b.starts_at, b.review_at, b.expected_expiry_at,
                 b.resolved_at, b.created_at, b.updated_at,
                 ST_Y(ST_Centroid(b.geom::geometry)) AS latitude,
                 ST_X(ST_Centroid(b.geom::geometry)) AS longitude
             FROM barrier_events b
             LEFT JOIN accessibility_features f ON f.id = b.feature_id`;
}

function databaseContext(record = {}) {
  return {
    userId: record.actorId ?? record.createdBy ?? record.reporterId ?? record.managerId ?? null,
    role: record.actorRole ?? record.role ?? 'user'
  };
}

function publicIncidentEventType(status, action) {
  if (status === 'resolved') return 'barrier.resolved';
  if (action === 'created') return 'barrier.created';
  return 'barrier.updated';
}

function publicIncidentPayload(row) {
  return {
    incidentId: row.id,
    placeId: row.place_id ?? null,
    accessNodeId: row.access_node_id ?? null,
    accessEdgeId: row.access_edge_id ?? null,
    featureId: row.feature_id ?? null,
    type: row.incident_type,
    severity: fromDatabaseSeverity(row.severity),
    status: row.status,
    occurredAt: row.starts_at,
    expectedExpiryAt: row.expected_expiry_at ?? row.review_at
  };
}

async function insertOutbox(client, { eventType, aggregateType, aggregateId, payload }) {
  await client.query(
    `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [eventType, aggregateType, aggregateId, JSON.stringify(payload)]
  );
}

function mapPublicChange(row) {
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    id: row.id,
    eventType: row.event_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    occurredAt: row.created_at,
    data: publicChangeData(payload)
  };
}

function publicChangeData(payload) {
  const allowed = [
    'placeId', 'featureCode', 'claimsVersion', 'graphVersion', 'incidentId',
    'routeId', 'status', 'severity', 'type', 'occurredAt', 'expectedExpiryAt'
  ];
  return Object.fromEntries(allowed.filter((key) => payload[key] !== undefined)
    .map((key) => [key, payload[key]]));
}

function mapWebhookSubscription(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    endpoint: row.endpoint,
    events: Array.isArray(row.events) ? row.events : [],
    secretHash: row.secret_hash,
    secretCiphertext: row.secret_ciphertext ?? null,
    status: row.status,
    lastDeliveryAt: row.last_delivery_at ?? null,
    failureCount: Number(row.failure_count ?? 0),
    lastError: row.last_error ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function encryptionKey(value) {
  if (typeof value !== 'string' || value.trim().length < 16) {
    const error = new Error('Webhook secret encryption is not configured.');
    error.status = 503;
    error.code = 'WEBHOOK_SECRET_STORAGE_UNAVAILABLE';
    throw error;
  }
  return createHash('sha256').update(value).digest();
}

function encryptWebhookSecret(secret, configuredKey) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(configuredKey), iv);
  const ciphertext = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

function decryptWebhookSecret(value, configuredKey) {
  try {
    const [ivEncoded, tagEncoded, ciphertextEncoded] = String(value).split('.');
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(configuredKey), Buffer.from(ivEncoded, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextEncoded, 'base64url')),
      decipher.final()
    ]).toString('utf8');
  } catch (cause) {
    const error = new Error('Webhook secret could not be read securely.', { cause });
    error.status = 503;
    error.code = 'WEBHOOK_SECRET_STORAGE_UNAVAILABLE';
    throw error;
  }
}

export function makeId() {
  return randomUUID();
}
