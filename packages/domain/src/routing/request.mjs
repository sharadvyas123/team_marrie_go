import { RouteRequestError } from './errors.mjs';

export const MAX_ROUTE_ALTERNATIVES = 10;
export const MAX_ROUTE_TIMEOUT_MS = 120_000;
export const ROUTE_REQUEST_VERSION = 1;

const SURFACE_NAMES = new Set([
  'asphalt',
  'concrete',
  'paved',
  'brick',
  'cobblestone',
  'gravel',
  'dirt',
  'grass',
  'wood',
  'metal',
  'sand',
  'unknown'
]);

/**
 * Convert API-shaped route input into a small, deterministic engine request.
 * The normalizer deliberately accepts common camel/snake case aliases at the
 * boundary, while everything downstream uses the canonical shape.
 */
export function normalizeRouteRequest(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new RouteRequestError('A route request object is required.', {
      field: 'request'
    });
  }

  const origin = normalizeEndpoint(input.origin ?? input.from, 'origin');
  const destination = normalizeEndpoint(input.destination ?? input.to, 'destination');
  if (sameEndpoint(origin, destination)) {
    throw new RouteRequestError('origin and destination must be different.', {
      code: 'ROUTE_ENDPOINTS_MUST_DIFFER'
    });
  }

  const constraints = normalizeConstraints(input.constraints ?? input.profile ?? {}, input);
  const maxAlternatives = boundedInteger(
    input.maxAlternatives ?? input.max_alternatives ?? options.maxAlternatives ?? 3,
    1,
    MAX_ROUTE_ALTERNATIVES,
    'maxAlternatives'
  );
  const timeoutMs = boundedInteger(
    input.timeoutMs ?? input.timeout_ms ?? options.timeoutMs ?? 5_000,
    100,
    MAX_ROUTE_TIMEOUT_MS,
    'timeoutMs'
  );

  return {
    version: ROUTE_REQUEST_VERSION,
    origin,
    destination,
    constraints,
    maxAlternatives,
    timeoutMs,
    mode: normalizeMode(input.mode ?? input.travelMode ?? input.travel_mode),
    locale: normalizeLocale(input.locale),
    ...(typeof input.requestId === 'string' && input.requestId.trim()
      ? { requestId: input.requestId.trim().slice(0, 128) }
      : {})
  };
}

export const normalizeRouteProfile = normalizeRouteRequest;
export const normalizeRouteInput = normalizeRouteRequest;

function normalizeEndpoint(value, field) {
  if (typeof value === 'string') {
    return { placeId: boundedString(value, `${field}.placeId`, 128) };
  }
  if (Array.isArray(value)) {
    if (value.length !== 2) invalid(`${field} coordinates must contain longitude and latitude.`,
      'ROUTE_COORDINATES_INVALID', `${field}.coordinates`);
    return coordinatesEndpoint(value[1], value[0], field);
  }
  if (!value || typeof value !== 'object') {
    invalid(`${field} is required and must contain a placeId or coordinates.`,
      'ROUTE_ENDPOINT_REQUIRED', field);
  }

  const placeId = value.placeId ?? value.place_id;
  if (placeId !== undefined && placeId !== null) {
    return { placeId: boundedString(placeId, `${field}.placeId`, 128) };
  }

  const nodeId = value.nodeId ?? value.node_id ?? value.accessNodeId ?? value.access_node_id;
  if (nodeId !== undefined && nodeId !== null) {
    return { nodeId: boundedString(nodeId, `${field}.nodeId`, 160) };
  }

  const geometry = value.geometry?.coordinates ?? value.coordinates;
  if (Array.isArray(geometry)) {
    if (geometry.length !== 2) invalid(`${field} coordinates must contain longitude and latitude.`,
      'ROUTE_COORDINATES_INVALID', `${field}.coordinates`);
    return coordinatesEndpoint(geometry[1], geometry[0], field);
  }

  const latitude = value.latitude ?? value.lat;
  const longitude = value.longitude ?? value.lon ?? value.lng;
  return coordinatesEndpoint(latitude, longitude, field);
}

function coordinatesEndpoint(latitudeValue, longitudeValue, field) {
  const latitude = number(latitudeValue, `${field}.latitude`);
  const longitude = number(longitudeValue, `${field}.longitude`);
  if (latitude < -90 || latitude > 90) invalid(`${field}.latitude must be between -90 and 90.`,
    'ROUTE_COORDINATE_OUT_OF_RANGE', `${field}.latitude`);
  if (longitude < -180 || longitude > 180) invalid(`${field}.longitude must be between -180 and 180.`,
    'ROUTE_COORDINATE_OUT_OF_RANGE', `${field}.longitude`);
  return { latitude, longitude };
}

function normalizeConstraints(raw, input) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    invalid('constraints must be an object.', 'ROUTE_CONSTRAINTS_INVALID', 'constraints');
  }
  const hardInput = raw.hard && typeof raw.hard === 'object' ? raw.hard : {};
  const softInput = raw.soft && typeof raw.soft === 'object' ? raw.soft : {};
  const source = { ...raw, ...input };

  const hard = {
    avoidStairs: readBoolean(
      hardInput.avoidStairs ?? hardInput.noStairs ?? source.avoidStairs ?? source.noStairs ??
      source.avoid_stairs ?? source.no_stairs ?? source.stairs === 'avoid',
      false,
      'constraints.hard.avoidStairs'
    ),
    maxSlope: readMeasurement(
      hardInput.maxSlope ?? hardInput.maximumSlope ?? source.maxSlope ?? source.maximumSlope ??
      source.max_slope ?? source.maxSlopePercent,
      'maxSlope',
      0,
      100
    ),
    minWidth: readMeasurement(
      hardInput.minWidth ?? hardInput.minimumWidth ?? source.minWidth ?? source.minimumWidth ??
      source.min_width ?? source.minimumWidthMeters,
      'minWidth',
      0.1,
      20
    ),
    requireCurbRamps: readBoolean(
      hardInput.requireCurbRamps ?? hardInput.curbRamps ?? source.requireCurbRamps ??
      source.require_curb_ramps ?? source.curbRamps === 'required',
      false,
      'constraints.hard.requireCurbRamps'
    ),
    requireWorkingLift: readBoolean(
      hardInput.requireWorkingLift ?? hardInput.requireLift ?? source.requireWorkingLift ??
      source.requireLift ?? source.require_working_lift,
      false,
      'constraints.hard.requireWorkingLift'
    ),
    requireStepFreeTransport: readBoolean(
      hardInput.requireStepFreeTransport ?? hardInput.stepFreeTransport ?? source.requireStepFreeTransport ??
      source.stepFreeTransport ?? source.require_step_free_transport,
      false,
      'constraints.hard.requireStepFreeTransport'
    ),
    allowedSurfaces: readSurfaces(
      hardInput.allowedSurfaces ?? hardInput.surfaces ?? source.allowedSurfaces ??
      source.allowed_surfaces,
      'constraints.hard.allowedSurfaces'
    ),
    avoidUnknown: readPolicy(
      hardInput.unknown ?? source.unknownPolicy ?? source.unknown ?? source.avoidUnknown ??
      source.avoid_unknown,
      false,
      'constraints.hard.avoidUnknown'
    ),
    avoidStale: readPolicy(
      hardInput.stale ?? source.stalePolicy ?? source.stale ?? source.avoidStale ?? source.avoid_stale,
      false,
      'constraints.hard.avoidStale'
    ),
    avoidBarriers: readBoolean(
      hardInput.avoidBarriers ?? source.avoidBarriers ?? source.avoid_barriers,
      true,
      'constraints.hard.avoidBarriers'
    )
  };

  const soft = {
    avoidStairs: readBoolean(softInput.avoidStairs ?? softInput.noStairs, false,
      'constraints.soft.avoidStairs'),
    maxSlope: readMeasurement(softInput.maxSlope ?? softInput.maximumSlope, 'soft.maxSlope', 0, 100),
    minWidth: readMeasurement(softInput.minWidth ?? softInput.minimumWidth, 'soft.minWidth', 0.1, 20),
    requireCurbRamps: readBoolean(softInput.requireCurbRamps ?? softInput.curbRamps, false,
      'constraints.soft.requireCurbRamps'),
    requireWorkingLift: readBoolean(softInput.requireWorkingLift ?? softInput.requireLift, false,
      'constraints.soft.requireWorkingLift'),
    requireStepFreeTransport: readBoolean(softInput.requireStepFreeTransport ?? softInput.stepFreeTransport,
      false, 'constraints.soft.requireStepFreeTransport'),
    allowedSurfaces: readSurfaces(softInput.allowedSurfaces ?? softInput.surfaces,
      'constraints.soft.allowedSurfaces'),
    avoidUnknown: readPolicy(softInput.unknown ?? softInput.avoidUnknown, false,
      'constraints.soft.avoidUnknown'),
    avoidStale: readPolicy(softInput.stale ?? softInput.avoidStale, false,
      'constraints.soft.avoidStale'),
    avoidBarriers: readBoolean(softInput.avoidBarriers, false, 'constraints.soft.avoidBarriers')
  };

  return {
    hard,
    soft,
    // These aliases make the normalized request convenient for simple engine
    // adapters and preserve no private profile data.
    avoidStairs: hard.avoidStairs,
    maxSlope: hard.maxSlope,
    minWidth: hard.minWidth,
    requireCurbRamps: hard.requireCurbRamps,
    requireWorkingLift: hard.requireWorkingLift,
    requireStepFreeTransport: hard.requireStepFreeTransport,
    allowedSurfaces: hard.allowedSurfaces,
    avoidUnknown: hard.avoidUnknown,
    avoidStale: hard.avoidStale,
    avoidBarriers: hard.avoidBarriers
  };
}

function readMeasurement(value, field, minimum, maximum) {
  if (value === undefined || value === null || value === '') return null;
  const raw = value && typeof value === 'object' ? value.value ?? value.amount : value;
  const result = number(raw, `constraints.${field}`);
  if (result < minimum || result > maximum) {
    invalid(`constraints.${field} must be between ${minimum} and ${maximum}.`,
      'ROUTE_CONSTRAINT_OUT_OF_RANGE', `constraints.${field}`);
  }
  return result;
}

function readSurfaces(value, field) {
  if (value === undefined || value === null || value === '') return [];
  const values = Array.isArray(value) ? value : [value];
  if (values.length > 20) invalid(`${field} contains too many surfaces.`,
    'ROUTE_CONSTRAINT_TOO_LARGE', field);
  return [...new Set(values.map((item) => boundedString(item, field, 32).toLowerCase()))]
    .map((surface) => {
      if (!SURFACE_NAMES.has(surface)) invalid(`Unsupported surface: ${surface}.`,
        'ROUTE_SURFACE_UNSUPPORTED', field);
      return surface;
    })
    .sort();
}

function readPolicy(value, fallback, field) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['hard', 'avoid', 'required', 'strict', 'true'].includes(normalized)) return true;
    if (['soft', 'warn', 'allow', 'false'].includes(normalized)) return false;
  }
  return readBoolean(value, fallback, field);
}

function readBoolean(value, fallback, field) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  invalid(`${field} must be a boolean.`, 'ROUTE_BOOLEAN_INVALID', field);
}

function normalizeMode(value) {
  if (value === undefined || value === null || value === '') return 'walking';
  const mode = boundedString(value, 'mode', 32).toLowerCase();
  if (!['walking', 'wheelchair', 'mobility_scooter', 'transit'].includes(mode)) {
    invalid('mode must be walking, wheelchair, mobility_scooter, or transit.',
      'ROUTE_MODE_UNSUPPORTED', 'mode');
  }
  return mode;
}

function normalizeLocale(value) {
  if (value === undefined || value === null || value === '') return 'en';
  const locale = boundedString(value, 'locale', 16);
  if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(locale)) {
    invalid('locale must be a valid short locale.', 'ROUTE_LOCALE_INVALID', 'locale');
  }
  return locale;
}

function sameEndpoint(left, right) {
  if (left.placeId && right.placeId) return left.placeId === right.placeId;
  if (left.nodeId && right.nodeId) return left.nodeId === right.nodeId;
  return left.latitude === right.latitude && left.longitude === right.longitude;
}

function boundedInteger(value, minimum, maximum, field) {
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    invalid(`${field} must be an integer between ${minimum} and ${maximum}.`,
      'ROUTE_BOUND_INVALID', field);
  }
  return result;
}

function number(value, field) {
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(result)) invalid(`${field} must be a finite number.`,
    'ROUTE_NUMBER_INVALID', field);
  return result;
}

function boundedString(value, field, maximum) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    invalid(`${field} must be a non-empty string of at most ${maximum} characters.`,
      'ROUTE_STRING_INVALID', field);
  }
  return value.trim();
}

function invalid(detail, code, field) {
  throw new RouteRequestError(detail, { code, field });
}
