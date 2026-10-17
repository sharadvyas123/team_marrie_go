import { evaluateRouteSegment } from './constraints.mjs';

export const ROUTE_ENRICHMENT_VERSION = 1;

export function enrichAccessGraph(accessGraph, {
  incidents = [],
  now = () => Date.now(),
  staleAfterMs = 180 * 24 * 60 * 60 * 1000
} = {}) {
  if (!accessGraph || typeof accessGraph !== 'object') {
    return { nodes: [], edges: [] };
  }
  const enrichItem = (item) => {
    const related = incidentsForSegment(item, incidents);
    const observedAt = item.observedAt ?? item.observed_at ?? item.latestObservedAt ?? null;
    const freshnessState = String(item.freshnessState ?? item.freshness_state ?? item.status ?? '').toLowerCase();
    const stale = Boolean(item.stale === true || ['stale', 'needs_reverification', 'needs-reverification'].includes(freshnessState) ||
      observedAt && new Date(now()).getTime() - Date.parse(observedAt) > staleAfterMs);
    const unknown = item.unknown === true || (!observedAt && item.observed !== true);
    return {
      ...item,
      unknown,
      stale,
      activeIncidents: related
    };
  };
  return {
    ...accessGraph,
    nodes: (accessGraph.nodes ?? []).map(enrichItem).sort(compareSegments),
    edges: (accessGraph.edges ?? accessGraph.segments ?? []).map(enrichItem).sort(compareSegments)
  };
}

/** Enrich a provider route using only the supplied graph and incident snapshot. */
export function enrichRoute(baseRoute, {
  constraints = {},
  accessGraph = null,
  incidents = [],
  now = () => Date.now(),
  staleAfterMs = 180 * 24 * 60 * 60 * 1000
} = {}) {
  if (!baseRoute || typeof baseRoute !== 'object') {
    throw new TypeError('A base route object is required.');
  }
  const graph = indexGraph(accessGraph);
  const rawSegments = routeSegments(baseRoute);
  const segments = rawSegments.map((segment, index) => {
    const graphSegment = graph.get(segment.edgeId ?? segment.segmentId ?? segment.id) ?? {};
    const merged = { ...graphSegment, ...segment };
    const relatedIncidents = [
      ...normalizeInlineIncidents(merged.activeBarriers ?? merged.barriers),
      ...incidentsForSegment(merged, incidents)
    ].sort(compareIncidents).filter((incident, incidentIndex, all) =>
      incidentIndex === all.findIndex((candidate) => candidate.id === incident.id));
    return {
      ...merged,
      sequence: Number.isInteger(merged.sequence) ? merged.sequence : index,
      activeBarriers: relatedIncidents,
      constraintEvaluation: evaluateRouteSegment(merged, constraints, {
        now: now(),
        staleAfterMs
      })
    };
  }).sort(compareSegments);

  const allEvaluations = segments.map((segment) => segment.constraintEvaluation);
  const hardViolations = uniqueResults(allEvaluations.flatMap((item) => item.hardViolations));
  const warnings = uniqueResults(allEvaluations.flatMap((item) => item.warnings));
  const unknownSegments = segments
    .filter((segment) => segment.constraintEvaluation.unknown)
    .map((segment) => segmentId(segment));
  const staleSegments = segments
    .filter((segment) => segment.constraintEvaluation.stale)
    .map((segment) => segmentId(segment));
  const activeIncidents = uniqueIncidents(segments.flatMap((segment) => segment.activeBarriers));
  const observedAt = segments
    .map((segment) => segment.constraintEvaluation.evidence.observedAt)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
  const satisfied = allConstraintCodes(constraints).filter((code) =>
    !hardViolations.some((item) => item.code === code) &&
    !warnings.some((item) => item.code === code)
  );

  const explanation = {
    recommendation: hardViolations.length === 0
      ? 'This route is a recommendation based on current accessibility information, not a guarantee.'
      : 'This route has known constraint conflicts and is not suitable for the requested profile.',
    constraints: {
      satisfied,
      violated: hardViolations,
      warnings
    },
    uncertainty: {
      unknownSegments,
      staleSegments,
      hasUnknown: unknownSegments.length > 0,
      hasStale: staleSegments.length > 0
    },
    activeIncidents
  };

  return {
    ...baseRoute,
    schemaVersion: 'route.v1',
    enrichmentVersion: ROUTE_ENRICHMENT_VERSION,
    segments,
    distanceMeters: finite(baseRoute.distanceMeters ?? baseRoute.distance ?? baseRoute.length),
    durationSeconds: finite(baseRoute.durationSeconds ?? baseRoute.duration ?? baseRoute.time),
    suitable: hardViolations.length === 0,
    uncertain: unknownSegments.length > 0 || staleSegments.length > 0,
    activeIncidents,
    unknownSegments,
    staleSegments,
    dataFreshness: {
      latestObservedAt: observedAt,
      state: staleSegments.length > 0 ? 'stale' : unknownSegments.length > 0 ? 'unknown' : 'current'
    },
    explanation,
    isAccessibilityGuarantee: false,
    recommendation: true
  };
}

export function enrichRouteResult(baseResult, options = {}) {
  if (Array.isArray(baseResult)) {
    const routes = baseResult.map((route) => enrichRoute(route, options)).sort(compareRoutes);
    return selectRouteResult(routes);
  }
  const rawRoutes = Array.isArray(baseResult?.routes) ? baseResult.routes : null;
  if (rawRoutes) {
    const routes = rawRoutes.map((route) => enrichRoute(route, options)).sort(compareRoutes);
    return {
      ...baseResult,
      routes,
      ...selectRouteResult(routes)
    };
  }
  return enrichRoute(baseResult, options);
}

export const enrichAccessRoute = enrichRoute;
export const explainRoute = enrichRoute;

function selectRouteResult(routes) {
  const suitableRoutes = routes.filter((route) => route.suitable);
  const selectedRoute = suitableRoutes[0] ?? null;
  return {
    routes,
    selectedRoute,
    suitable: Boolean(selectedRoute),
    noSuitableRoute: selectedRoute === null,
    routeExplanation: selectedRoute?.explanation ?? {
      recommendation: 'No route satisfies the hard accessibility constraints with current information.',
      constraints: { satisfied: [], violated: [], warnings: [] },
      uncertainty: { unknownSegments: [], staleSegments: [], hasUnknown: false, hasStale: false },
      activeIncidents: []
    }
  };
}

function routeSegments(route) {
  if (Array.isArray(route.segments)) return route.segments;
  if (Array.isArray(route.legs)) return route.legs.flatMap((leg) => leg.segments ?? [leg]);
  return [{ ...route, segmentId: route.segmentId ?? route.edgeId ?? route.id ?? 'route' }];
}

function indexGraph(graph) {
  const edges = Array.isArray(graph) ? graph : graph?.edges ?? graph?.segments ?? [];
  return new Map(edges
    .filter((edge) => edge && typeof edge === 'object')
    .map((edge) => [edge.edgeId ?? edge.segmentId ?? edge.id, edge]));
}

function incidentsForSegment(segment, incidents) {
  const segmentIds = new Set([
    segment.id,
    segment.segmentId,
    segment.edgeId,
    segment.accessEdgeId,
    segment.accessNodeId,
    segment.placeId
  ].filter(Boolean).map(String));
  return incidents
    .filter((incident) => incident && isActiveIncident(incident))
    .filter((incident) => {
      const values = [incident.id, incident.incidentId, incident.accessEdgeId, incident.accessNodeId,
        incident.routeSegmentId, incident.placeId, incident.affectedEntity?.id]
        .filter(Boolean).map(String);
      return values.some((value) => segmentIds.has(value));
    })
    .map(publicIncident)
    .sort(compareIncidents);
}

function publicIncident(incident) {
  return {
    id: incident.id ?? incident.incidentId,
    type: incident.type ?? incident.incidentType ?? null,
    severity: incident.severity ?? null,
    source: typeof incident.source === 'string' ? incident.source : incident.sourceType ?? null,
    observedAt: incident.observedAt ?? incident.startsAt ?? incident.starts_at ?? null,
    expectedExpiryAt: incident.expectedExpiryAt ?? incident.reviewAt ?? incident.review_at ?? null,
    status: incident.status ?? 'published'
  };
}

function normalizeInlineIncidents(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((incident) => incident && typeof incident === 'object')
    .filter(isActiveIncident)
    .map(publicIncident);
}

function isActiveIncident(incident) {
  return incident.active !== false && !['resolved', 'archived'].includes(incident.status) &&
    !(incident.resolvedAt ?? incident.resolved_at);
}

function uniqueIncidents(items) {
  const map = new Map(items.map((item) => [item.id, item]));
  return [...map.values()].sort(compareIncidents);
}

function uniqueResults(items) {
  const map = new Map(items.map((item) => [`${item.code}:${item.result}:${item.reason}`, item]));
  return [...map.values()].sort((left, right) => left.code.localeCompare(right.code));
}

function allConstraintCodes(constraints) {
  const hard = constraints?.hard ?? constraints ?? {};
  const soft = constraints?.soft ?? {};
  return ['stairs', 'slope', 'width', 'curbRamp', 'surface', 'unknown', 'stale', 'barrier']
    .filter((code) => ({
      stairs: hard.avoidStairs || soft.avoidStairs,
      slope: hard.maxSlope !== null && hard.maxSlope !== undefined || soft.maxSlope !== null && soft.maxSlope !== undefined,
      width: hard.minWidth !== null && hard.minWidth !== undefined || soft.minWidth !== null && soft.minWidth !== undefined,
      curbRamp: hard.requireCurbRamps || soft.requireCurbRamps,
      lift: hard.requireWorkingLift || soft.requireWorkingLift,
      transport: hard.requireStepFreeTransport || soft.requireStepFreeTransport,
      surface: (hard.allowedSurfaces?.length ?? 0) > 0 || (soft.allowedSurfaces?.length ?? 0) > 0,
      unknown: hard.avoidUnknown || soft.avoidUnknown,
      stale: hard.avoidStale || soft.avoidStale,
      barrier: hard.avoidBarriers || soft.avoidBarriers
    }[code]));
}

function compareSegments(left, right) {
  return (Number(left.sequence ?? 0) - Number(right.sequence ?? 0)) || segmentId(left).localeCompare(segmentId(right));
}

function compareRoutes(left, right) {
  return Number(right.suitable) - Number(left.suitable) ||
    (left.hardViolations?.length ?? left.explanation.constraints.violated.length) -
    (right.hardViolations?.length ?? right.explanation.constraints.violated.length) ||
    (left.durationSeconds ?? Number.MAX_SAFE_INTEGER) - (right.durationSeconds ?? Number.MAX_SAFE_INTEGER) ||
    String(left.id ?? '').localeCompare(String(right.id ?? ''));
}

function compareIncidents(left, right) {
  return String(left.id).localeCompare(String(right.id));
}

function segmentId(segment) {
  return String(segment.segmentId ?? segment.edgeId ?? segment.id);
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
