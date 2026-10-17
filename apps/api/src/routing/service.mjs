import {
  createRouteCacheKey,
  createRouteInvalidationMessage,
  enrichRouteResult,
  incidentInvalidationScopes,
  normalizeRouteRequest
} from '../../../../packages/domain/src/routing/index.mjs';
import { RoutingServiceError } from './errors.mjs';

const DEFAULT_CACHE_TTL_SECONDS = 60;

/**
 * Application boundary for route calculation. All durable data, cache, event,
 * and provider behavior is supplied as a port so this module can be tested
 * without Redis, PostgreSQL, or a real routing provider.
 */
export function createRoutingService({
  routingEngine,
  routeEngine,
  cache,
  routeCache,
  accessGraphPort,
  accessGraphRepository,
  incidentPort,
  incidentRepository,
  versionPort,
  clock = () => Date.now(),
  timeoutMs = 5_000,
  cacheTtlSeconds = DEFAULT_CACHE_TTL_SECONDS,
  staleAfterMs,
  metrics,
  tracer
} = {}) {
  const engine = routingEngine ?? routeEngine;
  const cachePort = cache ?? routeCache ?? null;
  const graphPort = accessGraphPort ?? accessGraphRepository ?? null;
  const barriersPort = incidentPort ?? incidentRepository ?? null;
  if (!engine || typeof (engine.calculate ?? engine.route) !== 'function') {
    throw new TypeError('routingEngine.calculate(request) is required.');
  }

  return {
    calculate: (input) => calculateRoute(input),
    calculateRoute,
    route: calculateRoute,
    invalidateForIncident,
    invalidateRouteCache: invalidateForIncident
  };

  async function calculateRoute(input) {
    const request = normalizeRouteRequest(input, { timeoutMs });
    const versions = await readVersions(request);
    const key = createRouteCacheKey(request, versions);
    let cacheStatus = cachePort ? 'miss' : 'unavailable';
    let cached = null;

    if (cachePort && typeof cachePort.get === 'function') {
      try {
        cached = await cachePort.get(key);
        if (cached) {
          cacheStatus = 'hit';
          incrementMetric(metrics, 'route.cache.hit');
          return withCalculationMetadata(cached, {
            key,
            cacheStatus,
            calculatedAt: cached.calculatedAt ?? nowIso(clock)
          });
        }
        incrementMetric(metrics, 'route.cache.miss');
      } catch (error) {
        cacheStatus = 'unavailable';
        incrementMetric(metrics, 'route.cache.error');
      }
    }

    const snapshot = await readRouteSnapshot(request);
    const startedAt = clock();
    let baseResult;
    try {
      baseResult = await withTimeout(
        callEngine(engine, request, snapshot),
        request.timeoutMs,
        'ROUTING_PROVIDER_TIMEOUT'
      );
    } catch (error) {
      const staleFallback = await readStaleCache(key);
      if (staleFallback) {
        incrementMetric(metrics, 'route.stale_fallback');
        return withCalculationMetadata(staleFallback, {
          key,
          cacheStatus: 'stale-fallback',
          calculatedAt: nowIso(clock)
        });
      }
      if (error instanceof RoutingServiceError) throw error;
      throw new RoutingServiceError(
        error?.code ?? 'ROUTING_PROVIDER_FAILED',
        'The route provider could not calculate this route.',
        { cause: error }
      );
    }

    const enriched = enrichRouteResult(baseResult, {
      constraints: request.constraints,
      accessGraph: snapshot.accessGraph,
      incidents: snapshot.incidents,
      now: clock,
      staleAfterMs
    });
    const result = withCalculationMetadata(enriched, {
      key,
      cacheStatus,
      calculatedAt: nowIso(clock),
      calculationMs: Math.max(0, clock() - startedAt),
      graphVersion: versions.graphVersion,
      incidentVersion: versions.incidentVersion
    });

    if (cachePort && typeof cachePort.set === 'function') {
      try {
        await cachePort.set(key, result, cacheTtlSeconds);
      } catch (error) {
        cacheStatus = 'unavailable';
        incrementMetric(metrics, 'route.cache.error');
        result.cache = { ...(result.cache ?? {}), status: cacheStatus, writeError: true };
      }
    }
    if (cacheStatus === 'unavailable') result.cache = { ...(result.cache ?? {}), status: cacheStatus };
    incrementMetric(metrics, 'route.calculated');
    return result;
  }

  async function invalidateForIncident(incident, { previous = null, reason = 'incident_changed' } = {}) {
    const scopes = [...new Set([
      ...incidentInvalidationScopes(previous),
      ...incidentInvalidationScopes(incident)
    ])].sort();
    const message = createRouteInvalidationMessage({
      ...incident,
      affectedScopes: scopes
    }, { reason, occurredAt: nowIso(clock) });
    if (cachePort) {
      try {
        if (typeof cachePort.invalidateAffected === 'function') {
          await cachePort.invalidateAffected(message);
        } else if (typeof cachePort.invalidateByScopes === 'function') {
          await cachePort.invalidateByScopes(scopes, message);
        } else if (typeof cachePort.deleteByScopes === 'function') {
          await cachePort.deleteByScopes(scopes, message);
        }
      } catch (error) {
        incrementMetric(metrics, 'route.cache.invalidation_error');
        return { ...message, cacheInvalidated: false, cacheError: true };
      }
    }
    incrementMetric(metrics, 'route.cache.invalidated');
    return { ...message, cacheInvalidated: Boolean(cachePort) };
  }

  async function readVersions(request) {
    if (!versionPort) return { graphVersion: 0, incidentVersion: 0 };
    try {
      if (typeof versionPort.getRouteVersions === 'function') {
        return normalizeVersions(await versionPort.getRouteVersions(request));
      }
      const graphVersion = typeof versionPort.getGraphVersion === 'function'
        ? await versionPort.getGraphVersion(request)
        : 0;
      const incidentVersion = typeof versionPort.getIncidentVersion === 'function'
        ? await versionPort.getIncidentVersion(request)
        : 0;
      return normalizeVersions({ graphVersion, incidentVersion });
    } catch {
      // A version port is an optimization boundary. The route still computes
      // with version zero rather than silently making a request unbounded.
      incrementMetric(metrics, 'route.version.unavailable');
      return { graphVersion: 0, incidentVersion: 0 };
    }
  }

  async function readRouteSnapshot(request) {
    let accessGraph = null;
    let incidents = [];
    try {
      accessGraph = await readPort(graphPort, ['getForRoute', 'getGraphForRoute', 'getAccessGraph'], request);
    } catch {
      incrementMetric(metrics, 'route.graph.unavailable');
    }
    try {
      incidents = await readPort(barriersPort, ['listForRoute', 'getActiveForRoute', 'listActive'], request);
    } catch {
      incrementMetric(metrics, 'route.incidents.unavailable');
    }
    return {
      accessGraph: accessGraph ?? null,
      incidents: Array.isArray(incidents) ? incidents : incidents?.items ?? []
    };
  }

  async function readStaleCache(key) {
    if (!cachePort) return null;
    try {
      if (typeof cachePort.getStale === 'function') return await cachePort.getStale(key);
      if (typeof cachePort.getWithMetadata === 'function') {
        const result = await cachePort.getWithMetadata(key, { allowStale: true });
        return result?.value ?? result?.staleValue ?? null;
      }
    } catch {
      incrementMetric(metrics, 'route.cache.stale_read_error');
    }
    return null;
  }
}

export const createRouteService = createRoutingService;
export const createRoutingApi = createRoutingService;

async function readPort(port, methodNames, request) {
  if (!port) return null;
  const method = methodNames.find((name) => typeof port[name] === 'function');
  if (!method) return null;
  return port[method](request);
}

function callEngine(engine, request, snapshot) {
  return typeof engine.calculate === 'function'
    ? engine.calculate(request, snapshot)
    : engine.route(request, snapshot);
}

function withTimeout(promise, timeout, code) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new RoutingServiceError(code, 'The routing provider timed out.', { status: 504 }));
    }, timeout);
    Promise.resolve(promise).then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

function withCalculationMetadata(result, metadata) {
  return {
    ...result,
    schemaVersion: result.schemaVersion ?? 'route.v1',
    calculatedAt: metadata.calculatedAt,
    calculationMs: metadata.calculationMs ?? result.calculationMs ?? 0,
    graphVersion: metadata.graphVersion ?? result.graphVersion ?? 0,
    incidentVersion: metadata.incidentVersion ?? result.incidentVersion ?? 0,
    cache: {
      status: metadata.cacheStatus,
      key: metadata.key
    },
    recommendation: true,
    isAccessibilityGuarantee: false
  };
}

function normalizeVersions(value) {
  return {
    graphVersion: Number.isSafeInteger(Number(value?.graphVersion)) && Number(value.graphVersion) >= 0
      ? Number(value.graphVersion) : 0,
    incidentVersion: Number.isSafeInteger(Number(value?.incidentVersion)) && Number(value.incidentVersion) >= 0
      ? Number(value.incidentVersion) : 0
  };
}

function nowIso(clock) {
  return new Date(clock()).toISOString();
}

function incrementMetric(metrics, name) {
  try {
    if (typeof metrics?.increment === 'function') metrics.increment(name);
    else if (typeof metrics?.count === 'function') metrics.count(name);
  } catch {
    // Metrics must not make route calculation fail.
  }
}
