import { evaluateMatch } from '../../../packages/domain/src/matching/index.mjs';

export const profileStorageKey = 'accessmap.sample.match-profile';
export const profileChangeEvent = 'access-profile-change';

export function profileFromRequirements(requirements = []) {
  return requirements.reduce((profile, requirement) => ({
    ...profile,
    [requirement.featureCode]: requirement.level
  }), {});
}

export function profileSnapshot(profile = {}) {
  const requirements = profile?.requirements ?? Object.entries(profile)
    .filter(([, level]) => level && level !== 'none')
    .map(([featureCode, level]) => ({ featureCode, level }));

  return { requirements };
}

export function loadStoredProfile(fallbackProfile = {}) {
  const fallback = profileSnapshot(fallbackProfile);
  if (typeof window === 'undefined') return fallback;

  try {
    const stored = window.localStorage.getItem(profileStorageKey);
    return stored ? profileSnapshot(JSON.parse(stored)) : fallback;
  } catch {
    return fallback;
  }
}

export function saveStoredProfile(profile) {
  const snapshot = profileSnapshot(profile);
  try {
    window.localStorage.setItem(profileStorageKey, JSON.stringify(snapshot));
    window.dispatchEvent(new CustomEvent(profileChangeEvent, { detail: snapshot }));
  } catch {
    // The editor remains usable in memory when storage is unavailable.
  }
}

export function clearStoredProfile() {
  try {
    window.localStorage.removeItem(profileStorageKey);
    window.dispatchEvent(new CustomEvent(profileChangeEvent, { detail: { requirements: [] } }));
  } catch {
    // Local storage is optional for this private preview.
  }
}

export function evaluatePlaceMatch(profile, place) {
  return evaluateMatch({
    profileSnapshot: profileSnapshot(profile),
    claimsSnapshot: {
      claimsVersion: 1,
      calculationVersion: 1,
      claims: place.claims ?? [],
      barriers: place.activeBarriers ?? []
    }
  });
}

export function decisionLabel(decision) {
  return {
    meets_known_requirements: 'Meets known needs',
    partial: 'Partial match',
    needs_more_information: 'Needs more information',
    known_barrier: 'Known barrier',
    no_profile: 'Set your access needs'
  }[decision] ?? 'Needs more information';
}

export function resultLabel(result) {
  return {
    confirmed: 'Confirmed',
    barrier: 'Barrier',
    partial: 'Partial',
    unknown: 'Unknown',
    warning: 'Avoidance warning',
    clear: 'No reported conflict'
  }[result] ?? result;
}

export function levelLabel(level) {
  return {
    required: 'Required',
    preferred: 'Preferred',
    avoid: 'Avoid'
  }[level] ?? level;
}
