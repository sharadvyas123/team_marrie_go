import {
  MATCH_DECISIONS,
  OBSERVATION_VALUES,
  REQUIREMENT_LEVELS,
  isOneOf
} from '../index.mjs';

export const MATCH_CALCULATION_VERSION = 1;

const UNKNOWN_CLAIM_STATUS = 'not_assessed';
const STALE_CLAIM_STATUSES = new Set(['needs_reverification', 'stale']);
const CONFLICT_CLAIM_STATUSES = new Set([
  'conflicting_information',
  'conflicted',
  'disputed'
]);
const BARRIER_CLAIM_STATUSES = new Set(['temporarily_unavailable']);
const POSITIVE_VALUES = new Set(['yes']);
const BARRIER_VALUES = new Set(['no', 'temporarily_unavailable']);
const PARTIAL_VALUES = new Set(['partial']);
const INACTIVE_BARRIER_STATUSES = new Set(['resolved', 'archived']);

/**
 * Evaluate a private match profile against a public claims snapshot.
 *
 * The function accepts either `(profileSnapshot, claimsSnapshot)` or an object
 * containing `profileSnapshot` and `claimsSnapshot` properties. The latter is
 * useful at application boundaries while the former keeps the domain function
 * convenient to call in tests and replay jobs.
 *
 * No input is changed and the returned explanation contains derived values
 * only; the private profile itself is never included in the result.
 */
export function evaluateMatch(profileOrInput, claimsSnapshotArgument) {
  const { profileSnapshot, claimsSnapshot } = resolveSnapshots(
    profileOrInput,
    claimsSnapshotArgument
  );
  const metadata = readSnapshotMetadata(claimsSnapshot);
  const requirements = readRequirements(profileSnapshot);

  if (requirements.length === 0) {
    return createEmptyExplanation({
      decision: 'no_profile',
      claimsVersion: metadata.claimsVersion,
      calculationVersion: metadata.calculationVersion
    });
  }

  const claims = readClaims(claimsSnapshot);
  const barriers = readBarriers(claimsSnapshot);
  const items = requirements.map((requirement) =>
    explainRequirement(requirement, claims.get(requirement.featureCode), barriers.get(requirement.featureCode))
  );

  const required = summarizeRequired(items);
  const preferred = summarizePreferred(items);
  const avoidanceWarnings = items
    .filter((item) => item.level === 'avoid' && item.result === 'warning')
    .map((item) => ({ ...item }));

  return {
    decision: decide({ required, items }),
    required,
    preferred,
    avoidanceWarnings,
    items,
    claimsVersion: metadata.claimsVersion,
    calculationVersion: metadata.calculationVersion
  };
}

export const evaluateAccessibilityMatch = evaluateMatch;
export const calculateMatch = evaluateMatch;
export const matchProfile = evaluateMatch;

export default evaluateMatch;

function resolveSnapshots(profileOrInput, claimsSnapshotArgument) {
  if (claimsSnapshotArgument !== undefined) {
    return {
      profileSnapshot: profileOrInput,
      claimsSnapshot: claimsSnapshotArgument
    };
  }

  if (profileOrInput && typeof profileOrInput === 'object') {
    if ('profileSnapshot' in profileOrInput || 'claimsSnapshot' in profileOrInput) {
      return {
        profileSnapshot: profileOrInput.profileSnapshot ?? null,
        claimsSnapshot: profileOrInput.claimsSnapshot ?? null
      };
    }

    if ('profile' in profileOrInput || 'claims' in profileOrInput) {
      return {
        profileSnapshot: profileOrInput.profile ?? null,
        claimsSnapshot: profileOrInput.claims ?? null
      };
    }
  }

  return {
    profileSnapshot: profileOrInput,
    claimsSnapshot: null
  };
}

function readRequirements(profileSnapshot) {
  if (profileSnapshot == null) return [];

  const requirements = Array.isArray(profileSnapshot)
    ? profileSnapshot
    : profileSnapshot.requirements;

  if (requirements == null) return [];
  if (!Array.isArray(requirements)) {
    throw new TypeError('Match profile requirements must be an array');
  }

  const normalized = requirements.map((requirement) => {
    if (!requirement || typeof requirement !== 'object') {
      throw new TypeError('Each match requirement must be an object');
    }

    const featureCode = requirement.featureCode ?? requirement.feature_code;
    const level = requirement.level;

    if (typeof featureCode !== 'string' || featureCode.trim() === '') {
      throw new TypeError('Each match requirement needs a featureCode');
    }
    if (!isOneOf(level, REQUIREMENT_LEVELS)) {
      throw new RangeError(`Unsupported match requirement level: ${level}`);
    }

    return { featureCode: featureCode.trim(), level };
  });

  const seenFeatures = new Set();
  for (const requirement of normalized) {
    if (seenFeatures.has(requirement.featureCode)) {
      throw new RangeError(`Duplicate match requirement: ${requirement.featureCode}`);
    }
    seenFeatures.add(requirement.featureCode);
  }

  return normalized.sort((left, right) => {
    const featureOrder = compareStrings(left.featureCode, right.featureCode);
    return featureOrder || compareStrings(left.level, right.level);
  });
}

function readSnapshotMetadata(claimsSnapshot) {
  if (!claimsSnapshot || typeof claimsSnapshot !== 'object' || Array.isArray(claimsSnapshot)) {
    return { claimsVersion: 0, calculationVersion: MATCH_CALCULATION_VERSION };
  }

  const claimsVersion = firstInteger(
    claimsSnapshot.claimsVersion,
    claimsSnapshot.claims_version,
    0
  );
  const calculationVersion = firstInteger(
    claimsSnapshot.calculationVersion,
    claimsSnapshot.calculation_version,
    MATCH_CALCULATION_VERSION
  );

  return {
    claimsVersion: Math.max(0, claimsVersion),
    calculationVersion: Math.max(1, calculationVersion)
  };
}

function readClaims(claimsSnapshot) {
  const rawClaims = extractArray(claimsSnapshot, ['claims', 'items']);
  const grouped = new Map();

  for (const rawClaim of rawClaims) {
    const claim = normalizeClaim(rawClaim);
    if (!claim) continue;
    const existing = grouped.get(claim.featureCode) ?? [];
    existing.push(claim);
    grouped.set(claim.featureCode, existing);
  }

  const selected = new Map();
  for (const [featureCode, featureClaims] of grouped) {
    selected.set(featureCode, selectClaim(featureClaims));
  }
  return selected;
}

function readBarriers(claimsSnapshot) {
  const rawBarriers = extractArray(claimsSnapshot, ['barriers', 'activeBarriers']);
  const grouped = new Map();

  for (const rawBarrier of rawBarriers) {
    const barrier = normalizeBarrier(rawBarrier);
    if (!barrier || !barrier.active) continue;
    const existing = grouped.get(barrier.featureCode) ?? [];
    existing.push(barrier);
    grouped.set(barrier.featureCode, existing);
  }

  const selected = new Map();
  for (const [featureCode, featureBarriers] of grouped) {
    selected.set(featureCode, selectLatest(featureBarriers));
  }
  return selected;
}

function extractArray(snapshot, propertyNames) {
  if (Array.isArray(snapshot)) return snapshot;
  if (!snapshot || typeof snapshot !== 'object') return [];

  for (const propertyName of propertyNames) {
    if (Array.isArray(snapshot[propertyName])) return snapshot[propertyName];
  }

  if (snapshot.featureCode || snapshot.feature_code) return [snapshot];
  return [];
}

function normalizeClaim(rawClaim) {
  if (!rawClaim || typeof rawClaim !== 'object') return null;

  const featureCode = rawClaim.featureCode ?? rawClaim.feature_code;
  if (typeof featureCode !== 'string' || featureCode.trim() === '') return null;

  const status = normalizeString(
    rawClaim.claimStatus ?? rawClaim.claim_status ?? rawClaim.status,
    UNKNOWN_CLAIM_STATUS
  );
  const value = normalizeString(
    rawClaim.summaryValue ?? rawClaim.summary_value ?? rawClaim.value,
    'unknown'
  );
  const freshnessState = normalizeString(
    rawClaim.freshnessState ?? rawClaim.freshness_state,
    null
  );
  const observedAt = firstString(
    rawClaim.observedAt,
    rawClaim.observed_at,
    rawClaim.latestObservedAt,
    rawClaim.latest_observed_at
  );

  return {
    featureCode: featureCode.trim(),
    status,
    value,
    freshnessState,
    observedAt,
    source: firstString(rawClaim.source, rawClaim.sourceType, rawClaim.source_type),
    recent: isRecent({ status, freshnessState }),
    conflicted:
      CONFLICT_CLAIM_STATUSES.has(status) ||
      rawClaim.conflicted === true ||
      rawClaim.isConflicted === true ||
      hasConflictingCounts(rawClaim)
  };
}

function normalizeBarrier(rawBarrier) {
  if (!rawBarrier || typeof rawBarrier !== 'object') return null;

  const featureCode = rawBarrier.featureCode ?? rawBarrier.feature_code;
  if (typeof featureCode !== 'string' || featureCode.trim() === '') return null;

  const status = normalizeString(rawBarrier.status, 'published');
  const active =
    rawBarrier.active !== false &&
    !INACTIVE_BARRIER_STATUSES.has(status) &&
    rawBarrier.resolvedAt == null &&
    rawBarrier.resolved_at == null;

  return {
    featureCode: featureCode.trim(),
    status,
    active,
    observedAt: firstString(
      rawBarrier.observedAt,
      rawBarrier.observed_at,
      rawBarrier.startsAt,
      rawBarrier.starts_at
    ),
    source: firstString(rawBarrier.source, rawBarrier.sourceType, rawBarrier.source_type)
  };
}

function selectClaim(claims) {
  const recentClaims = claims.filter((claim) => claim.recent);
  const comparisonClaims = recentClaims.length > 0 ? recentClaims : claims;
  const recognizedValues = new Set(
    comparisonClaims
      .filter((claim) => !claim.conflicted)
      .map((claim) => claim.value)
      .filter((value) => isRecognizedValue(value))
  );
  const hasConflict = comparisonClaims.some((claim) => claim.conflicted) || recognizedValues.size > 1;

  const selected = selectLatest(comparisonClaims);
  if (hasConflict) {
    return {
      ...selected,
      status: 'conflicting_information',
      value: 'unknown',
      conflicted: true
    };
  }
  return selected;
}

function selectLatest(values) {
  return [...values].sort((left, right) => {
    const leftTime = timestamp(left.observedAt);
    const rightTime = timestamp(right.observedAt);
    if (leftTime !== rightTime) return rightTime - leftTime;
    return compareStrings(JSON.stringify(left), JSON.stringify(right));
  })[0];
}

function explainRequirement(requirement, claim, barrier) {
  const itemClaim = barrier ?? claim;
  const base = {
    featureCode: requirement.featureCode,
    level: requirement.level
  };

  if (barrier) {
    return addEvidence(base, {
      result: requirement.level === 'avoid' ? 'warning' : 'barrier',
      reason:
        requirement.level === 'avoid'
          ? 'A current barrier or condition conflicts with this avoid preference'
          : 'An active barrier is reported for this feature',
      claimStatus: barrier.status,
      source: barrier.source,
      observedAt: barrier.observedAt
    });
  }

  if (!itemClaim || itemClaim.conflicted || !itemClaim.recent) {
    return addEvidence(base, {
      result: 'unknown',
      reason: unknownReason(itemClaim),
      claimStatus: itemClaim?.status ?? UNKNOWN_CLAIM_STATUS,
      source: itemClaim?.source,
      observedAt: itemClaim?.observedAt
    });
  }

  if (requirement.level === 'avoid') {
    if (POSITIVE_VALUES.has(itemClaim.value) || PARTIAL_VALUES.has(itemClaim.value)) {
      return addEvidence(base, {
        result: 'warning',
        reason: 'A known condition conflicts with this avoid preference',
        claimStatus: itemClaim.status,
        source: itemClaim.source,
        observedAt: itemClaim.observedAt
      });
    }

    return addEvidence(base, {
      result: 'clear',
      reason: 'Recent claim does not report the avoided condition',
      claimStatus: itemClaim.status,
      source: itemClaim.source,
      observedAt: itemClaim.observedAt
    });
  }

  if (POSITIVE_VALUES.has(itemClaim.value)) {
    return addEvidence(base, {
      result: 'confirmed',
      reason: 'Recent supporting claim confirms this feature',
      claimStatus: itemClaim.status,
      source: itemClaim.source,
      observedAt: itemClaim.observedAt
    });
  }

  if (BARRIER_VALUES.has(itemClaim.value) || BARRIER_CLAIM_STATUSES.has(itemClaim.status)) {
    return addEvidence(base, {
      result: 'barrier',
      reason: 'Recent claim reports a known barrier for this feature',
      claimStatus: itemClaim.status,
      source: itemClaim.source,
      observedAt: itemClaim.observedAt
    });
  }

  if (PARTIAL_VALUES.has(itemClaim.value)) {
    return addEvidence(base, {
      result: 'partial',
      reason: 'Recent claim only partially supports this feature',
      claimStatus: itemClaim.status,
      source: itemClaim.source,
      observedAt: itemClaim.observedAt
    });
  }

  return addEvidence(base, {
    result: 'unknown',
    reason: 'Claim does not provide a usable result',
    claimStatus: itemClaim.status,
    source: itemClaim.source,
    observedAt: itemClaim.observedAt
  });
}

function addEvidence(item, evidence) {
  return {
    ...item,
    result: evidence.result,
    reason: evidence.reason,
    claimStatus: evidence.claimStatus,
    ...(evidence.source ? { source: evidence.source } : {}),
    ...(evidence.observedAt ? { observedAt: evidence.observedAt } : {})
  };
}

function summarizeRequired(items) {
  const requiredItems = items.filter((item) => item.level === 'required');
  return {
    total: requiredItems.length,
    confirmed: requiredItems.filter((item) => item.result === 'confirmed').length,
    knownBarriers: requiredItems.filter((item) => item.result === 'barrier').length,
    partial: requiredItems.filter((item) => item.result === 'partial').length,
    unknown: requiredItems.filter((item) => item.result === 'unknown').length
  };
}

function summarizePreferred(items) {
  const preferredItems = items.filter((item) => item.level === 'preferred');
  return {
    total: preferredItems.length,
    confirmed: preferredItems.filter((item) => item.result === 'confirmed').length,
    partial: preferredItems.filter((item) => item.result === 'partial').length,
    unknown: preferredItems.filter((item) => item.result === 'unknown').length
  };
}

function decide({ required, items }) {
  let decision = 'meets_known_requirements';
  if (required.knownBarriers > 0) decision = 'known_barrier';
  else if (
    items.some((item) => item.level === 'required' && item.result === 'unknown')
  ) {
    decision = 'needs_more_information';
  }
  else if (items.some((item) => item.level === 'required' && item.result === 'partial')) {
    decision = 'partial';
  }

  return isOneOf(decision, MATCH_DECISIONS) ? decision : 'needs_more_information';
}

function unknownReason(claim) {
  if (!claim) return 'No recent supporting claim';
  if (claim.conflicted || CONFLICT_CLAIM_STATUSES.has(claim.status)) {
    return 'Recent claims contain conflicting information';
  }
  if (!claim.recent || STALE_CLAIM_STATUSES.has(claim.status) || claim.freshnessState === 'stale') {
    return 'Claim needs re-verification before it can confirm this feature';
  }
  return 'No recent supporting claim';
}

function isRecent({ status, freshnessState }) {
  if (freshnessState === 'stale' || freshnessState === 'needs_reverification') return false;
  if (status === 'needs_reverification' || status === 'stale') return false;
  if (freshnessState === 'fresh' || status === 'recently_observed') return true;

  // A current claims snapshot is already freshness-filtered unless it marks a
  // claim stale or in need of re-verification explicitly.
  return true;
}

function hasConflictingCounts(claim) {
  const supportingCount = numberOrZero(claim.supportingCount ?? claim.supporting_count);
  const disputingCount = numberOrZero(claim.disputingCount ?? claim.disputing_count);
  return supportingCount > 0 && disputingCount > 0;
}

function isRecognizedValue(value) {
  return isOneOf(value, OBSERVATION_VALUES);
}

function createEmptyExplanation({ decision, claimsVersion, calculationVersion }) {
  return {
    decision,
    required: { total: 0, confirmed: 0, knownBarriers: 0, partial: 0, unknown: 0 },
    preferred: { total: 0, confirmed: 0, partial: 0, unknown: 0 },
    avoidanceWarnings: [],
    items: [],
    claimsVersion,
    calculationVersion
  };
}

function firstInteger(...values) {
  for (const value of values) {
    if (Number.isInteger(value)) return value;
  }
  return 0;
}

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value !== '') ?? null;
}

function normalizeString(value, fallback) {
  return typeof value === 'string' && value !== '' ? value.toLowerCase() : fallback;
}

function numberOrZero(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function timestamp(value) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function compareStrings(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
