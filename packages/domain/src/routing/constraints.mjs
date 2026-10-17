const STALE_STATES = new Set(['stale', 'needs_reverification', 'needs-reverification']);
const UNKNOWN_VALUES = new Set(['unknown', 'not_assessed', 'not-assessed', 'unassessed']);

/**
 * Evaluate one route segment. Unknown evidence is reported separately and is
 * never converted into a passing accessibility check.
 */
export function evaluateRouteSegment(segment, constraints = {}, options = {}) {
  const input = segment && typeof segment === 'object' ? segment : {};
  const normalized = normalizeSegment(input, options);
  const normalizedConstraints = normalizeConstraintShape(constraints);
  const hardViolations = [];
  const warnings = [];
  const checks = [];

  check(
    checks,
    hardViolations,
    warnings,
    'stairs',
    normalized.stairs === true,
    normalized.stairsKnown,
    normalizedConstraints.hard.avoidStairs,
    normalizedConstraints.soft.avoidStairs,
    'Segment contains stairs.',
    'Stairs are not confirmed absent.'
  );
  checkMaximum(
    checks,
    hardViolations,
    warnings,
    'slope',
    normalized.slope,
    normalized.slopeKnown,
    normalizedConstraints.hard.maxSlope,
    normalizedConstraints.soft.maxSlope,
    'Segment exceeds the maximum requested slope.'
  );
  checkMinimum(
    checks,
    hardViolations,
    warnings,
    'width',
    normalized.width,
    normalized.widthKnown,
    normalizedConstraints.hard.minWidth,
    normalizedConstraints.soft.minWidth,
    'Segment is narrower than the requested minimum width.'
  );
  check(
    checks,
    hardViolations,
    warnings,
    'curbRamp',
    normalized.curbRamp === false,
    normalized.curbRampKnown,
    normalizedConstraints.hard.requireCurbRamps,
    normalizedConstraints.soft.requireCurbRamps,
    'A required curb ramp is not available.',
    'A required curb ramp is not confirmed.'
  );
  check(
    checks,
    hardViolations,
    warnings,
    'lift',
    normalized.liftAvailable === false,
    normalized.liftKnown,
    normalizedConstraints.hard.requireWorkingLift,
    normalizedConstraints.soft.requireWorkingLift,
    'The lift is not available.',
    'The lift is not confirmed available.'
  );
  check(
    checks,
    hardViolations,
    warnings,
    'transport',
    normalized.stepFreeTransport === false,
    normalized.transportKnown,
    normalizedConstraints.hard.requireStepFreeTransport,
    normalizedConstraints.soft.requireStepFreeTransport,
    'Step-free transport boarding is not available.',
    'Step-free transport boarding is not confirmed.'
  );
  checkSurface(
    checks,
    hardViolations,
    warnings,
    normalized,
    normalizedConstraints
  );

  if (normalized.unknown) {
    const reason = 'Segment has no current usable accessibility evidence.';
    addConstraintResult(checks, hardViolations, warnings, 'unknown',
      normalizedConstraints.hard.avoidUnknown, normalizedConstraints.soft.avoidUnknown,
      reason, reason);
  }
  if (normalized.stale) {
    const reason = 'Segment evidence needs re-verification.';
    addConstraintResult(checks, hardViolations, warnings, 'stale',
      normalizedConstraints.hard.avoidStale, normalizedConstraints.soft.avoidStale,
      reason, reason);
  }
  if (normalized.activeBarriers.length > 0) {
    const reason = 'An active accessibility barrier affects this segment.';
    addConstraintResult(checks, hardViolations, warnings, 'barrier',
      normalizedConstraints.hard.avoidBarriers, normalizedConstraints.soft.avoidBarriers,
      reason, reason);
  }

  return {
    segmentId: normalized.segmentId,
    suitable: hardViolations.length === 0,
    uncertain: normalized.unknown || normalized.stale,
    stale: normalized.stale,
    unknown: normalized.unknown,
    hardViolations: sortResults(hardViolations),
    warnings: sortResults(warnings),
    checks: sortResults(checks),
    evidence: {
      stairs: normalized.stairsKnown ? normalized.stairs : null,
      slope: normalized.slope,
      width: normalized.width,
      curbRamp: normalized.curbRampKnown ? normalized.curbRamp : null,
      surface: normalized.surface,
      liftAvailable: normalized.liftKnown ? normalized.liftAvailable : null,
      stepFreeTransport: normalized.transportKnown ? normalized.stepFreeTransport : null,
      observedAt: normalized.observedAt,
      freshnessState: normalized.freshnessState
    },
    activeBarriers: normalized.activeBarriers
  };
}

export const evaluateSegmentConstraints = evaluateRouteSegment;
export const evaluateConstraints = evaluateRouteSegment;

export function evaluateHardConstraints(segment, constraints = {}, options = {}) {
  const result = evaluateRouteSegment(segment, {
    ...(constraints && typeof constraints === 'object' ? constraints : {}),
    soft: {}
  }, options);
  return {
    suitable: result.hardViolations.length === 0,
    violations: result.hardViolations,
    checks: result.checks,
    unknown: result.unknown,
    stale: result.stale,
    activeBarriers: result.activeBarriers
  };
}

export function evaluateSoftConstraints(segment, constraints = {}, options = {}) {
  const source = constraints && typeof constraints === 'object' ? constraints : {};
  const result = evaluateRouteSegment(segment, {
    hard: {},
    soft: source.soft ?? source
  }, options);
  return {
    warnings: result.warnings,
    checks: result.checks,
    unknown: result.unknown,
    stale: result.stale,
    activeBarriers: result.activeBarriers
  };
}

function normalizeSegment(input, options) {
  const stairsValue = input.stairs ?? input.hasStairs ?? input.steps ?? input.stairCount;
  const stairsKnown = stairsValue !== undefined && stairsValue !== null &&
    !isUnknown(stairsValue);
  const stairs = stairsKnown && (stairsValue === true || Number(stairsValue) > 0 ||
    String(stairsValue).toLowerCase() === 'yes');
  const slopeValue = input.slopePercent ?? input.slope ?? input.incline;
  const widthValue = input.widthMeters ?? input.width ?? input.pathWidth ?? input.path_width;
  const curbValue = input.curbRamp ?? input.curb_ramp ?? input.curbRamps;
  const surfaceValue = input.surface ?? input.surfaceType ?? input.surface_type;
  const liftValue = input.liftAvailable ?? input.lift_available ?? input.liftStatus ?? input.elevatorStatus;
  const transportValue = input.stepFreeTransport ?? input.step_free_transport ??
    input.transportStepFree ?? input.boardingStatus;
  const observedAt = firstString(input.observedAt, input.observed_at, input.latestObservedAt,
    input.latest_observed_at);
  const freshnessState = String(input.freshnessState ?? input.freshness_state ??
    input.status ?? '').toLowerCase() || null;
  const stale = Boolean(input.stale === true || STALE_STATES.has(freshnessState) ||
    (options.staleAfterMs && observedAt && timestamp(typeof options.now === 'function' ? options.now() : options.now ?? Date.now()) - timestamp(observedAt) > options.staleAfterMs));
  const hasAccessibilityValues = [stairsValue, slopeValue, widthValue, curbValue, surfaceValue,
    liftValue, transportValue]
    .some((value) => value !== undefined && value !== null && !isUnknown(value));
  const unknown = Boolean(input.unknown === true || input.accessibilityStatus === 'unknown' ||
    !observedAt && input.observed !== true || !hasAccessibilityValues && !observedAt);
  const barriers = Array.isArray(input.activeBarriers) ? input.activeBarriers :
    Array.isArray(input.barriers) ? input.barriers : [];

  return {
    segmentId: String(input.segmentId ?? input.edgeId ?? input.id ?? 'unknown-segment'),
    stairs,
    stairsKnown,
    slope: finiteOrNull(slopeValue),
    slopeKnown: slopeValue !== undefined && slopeValue !== null && !isUnknown(slopeValue),
    width: finiteOrNull(widthValue),
    widthKnown: widthValue !== undefined && widthValue !== null && !isUnknown(widthValue),
    curbRamp: curbBoolean(curbValue),
    curbRampKnown: curbValue !== undefined && curbValue !== null && !isUnknown(curbValue),
    surface: surfaceValue ? String(surfaceValue).toLowerCase() : null,
    liftAvailable: accessBoolean(liftValue),
    liftKnown: liftValue !== undefined && liftValue !== null && !isUnknown(liftValue),
    stepFreeTransport: accessBoolean(transportValue),
    transportKnown: transportValue !== undefined && transportValue !== null && !isUnknown(transportValue),
    observedAt,
    freshnessState,
    stale,
    unknown,
    activeBarriers: normalizeBarriers(barriers)
  };
}

function normalizeConstraintShape(input) {
  const source = input && typeof input === 'object' ? input : {};
  const hard = source.hard && typeof source.hard === 'object' ? source.hard : source;
  const soft = source.soft && typeof source.soft === 'object' ? source.soft : {};
  return {
    hard: {
      avoidStairs: Boolean(hard.avoidStairs ?? hard.noStairs),
      maxSlope: finiteOrNull(hard.maxSlope ?? hard.maximumSlope),
      minWidth: finiteOrNull(hard.minWidth ?? hard.minimumWidth),
      requireCurbRamps: Boolean(hard.requireCurbRamps ?? hard.curbRamps),
      requireWorkingLift: Boolean(hard.requireWorkingLift ?? hard.requireLift),
      requireStepFreeTransport: Boolean(hard.requireStepFreeTransport ?? hard.stepFreeTransport),
      allowedSurfaces: normalizeSurfaceList(hard.allowedSurfaces ?? hard.surfaces),
      avoidUnknown: Boolean(hard.avoidUnknown ?? hard.unknown),
      avoidStale: Boolean(hard.avoidStale ?? hard.stale),
      avoidBarriers: hard.avoidBarriers !== false
    },
    soft: {
      avoidStairs: Boolean(soft.avoidStairs ?? soft.noStairs),
      maxSlope: finiteOrNull(soft.maxSlope ?? soft.maximumSlope),
      minWidth: finiteOrNull(soft.minWidth ?? soft.minimumWidth),
      requireCurbRamps: Boolean(soft.requireCurbRamps ?? soft.curbRamps),
      requireWorkingLift: Boolean(soft.requireWorkingLift ?? soft.requireLift),
      requireStepFreeTransport: Boolean(soft.requireStepFreeTransport ?? soft.stepFreeTransport),
      allowedSurfaces: normalizeSurfaceList(soft.allowedSurfaces ?? soft.surfaces),
      avoidUnknown: Boolean(soft.avoidUnknown ?? soft.unknown),
      avoidStale: Boolean(soft.avoidStale ?? soft.stale),
      avoidBarriers: Boolean(soft.avoidBarriers)
    }
  };
}

function check(checks, hardViolations, warnings, code, failed, known, hard, soft, hardReason, unknownReason) {
  if (!known) {
    if (hard || soft) addConstraintResult(checks, hardViolations, warnings, code,
      hard, soft, unknownReason, unknownReason);
    return;
  }
  if (!failed) {
    checks.push({ code, result: 'satisfied', reason: `${code} constraint is satisfied.` });
    return;
  }
  addConstraintResult(checks, hardViolations, warnings, code, hard, soft, hardReason, hardReason);
}

function checkMaximum(checks, hardViolations, warnings, code, value, known, hardValue, softValue, reason) {
  if (!known || value === null) return;
  if (hardValue !== null && value > hardValue) {
    addConstraintResult(checks, hardViolations, warnings, code, true, false, reason, reason);
  } else if (softValue !== null && value > softValue) {
    addConstraintResult(checks, hardViolations, warnings, code, false, true,
      'Segment exceeds the preferred maximum.', 'Segment exceeds the preferred maximum.');
  } else {
    checks.push({ code, result: 'satisfied', reason: `${code} constraint is satisfied.` });
  }
}

function checkMinimum(checks, hardViolations, warnings, code, value, known, hardValue, softValue, reason) {
  if (!known || value === null) return;
  if (hardValue !== null && value < hardValue) {
    addConstraintResult(checks, hardViolations, warnings, code, true, false, reason, reason);
  } else if (softValue !== null && value < softValue) {
    addConstraintResult(checks, hardViolations, warnings, code, false, true,
      'Segment is narrower than the preferred minimum width.',
      'Segment is narrower than the preferred minimum width.');
  } else {
    checks.push({ code, result: 'satisfied', reason: `${code} constraint is satisfied.` });
  }
}

function checkSurface(checks, hardViolations, warnings, segment, constraints) {
  const hardSurfaces = constraints.hard.allowedSurfaces;
  const softSurfaces = constraints.soft.allowedSurfaces;
  if (!segment.surface) return;
  if (hardSurfaces.length > 0 && !hardSurfaces.includes(segment.surface)) {
    addConstraintResult(checks, hardViolations, warnings, 'surface', true, false,
      `Surface ${segment.surface} is not allowed by the request.`,
      `Surface ${segment.surface} is not allowed by the request.`);
  } else if (softSurfaces.length > 0 && !softSurfaces.includes(segment.surface)) {
    addConstraintResult(checks, hardViolations, warnings, 'surface', false, true,
      `Surface ${segment.surface} is outside the preferred surfaces.`,
      `Surface ${segment.surface} is outside the preferred surfaces.`);
  } else if (hardSurfaces.length > 0 || softSurfaces.length > 0) {
    checks.push({ code: 'surface', result: 'satisfied', reason: 'surface constraint is satisfied.' });
  }
}

function addConstraintResult(checks, hardViolations, warnings, code, hard, soft, reason) {
  const result = { code, result: hard ? 'violated' : soft ? 'warning' : 'satisfied', reason };
  checks.push(result);
  if (hard) hardViolations.push(result);
  else if (soft) warnings.push(result);
}

function sortResults(items) {
  return [...items].sort((left, right) => left.code.localeCompare(right.code) ||
    left.result.localeCompare(right.result));
}

function normalizeSurfaceList(value) {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).map((item) => String(item).toLowerCase()).sort();
}

function normalizeBarriers(items) {
  return items
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      id: firstString(item.id, item.incidentId, item.incident_id),
      type: firstString(item.type, item.incidentType, item.incident_type),
      severity: firstString(item.severity),
      source: safeSource(item.source ?? item.sourceType ?? item.source_type),
      observedAt: firstString(item.observedAt, item.observed_at, item.startsAt, item.starts_at),
      status: firstString(item.status)
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function safeSource(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return firstString(value.type, value.name);
  return null;
}

function curbBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') return ['yes', 'true', 'available', 'present'].includes(value.toLowerCase());
  return null;
}

function accessBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (['yes', 'true', 'available', 'working', 'step_free', 'step-free'].includes(normalized)) return true;
    if (['no', 'false', 'unavailable', 'broken', 'closed', 'not_step_free', 'not-step-free'].includes(normalized)) return false;
  }
  return null;
}

function isUnknown(value) {
  return UNKNOWN_VALUES.has(String(value).toLowerCase());
}

function finiteOrNull(value) {
  if (value === undefined || value === null || value === '' || isUnknown(value)) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() ?? null;
}

function timestamp(value) {
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}
