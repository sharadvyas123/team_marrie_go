const STATUS_LABELS = {
  community_corroborated: 'Community corroborated',
  community_reported: 'Community reported',
  facility_confirmed: 'Facility confirmed',
  recently_observed: 'Recently observed',
  temporarily_unavailable: 'Temporarily unavailable',
  not_assessed: 'Not assessed',
  published: 'Published',
  disputed: 'Disputed',
  resolved: 'Resolved',
  archived: 'Archived'
};

const VALUE_LABELS = {
  yes: 'Yes',
  no: 'No',
  partial: 'Partly',
  temporarily_unavailable: 'Temporarily unavailable',
  unknown: 'Unknown'
};

export function labelForFeature(featureCode, featureLabel = '') {
  if (featureLabel) return featureLabel;
  return String(featureCode ?? 'Unknown feature')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function statusLabel(status) {
  if (!status) return 'Unknown';
  return STATUS_LABELS[status] ?? String(status).replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function valueLabel(value) {
  return VALUE_LABELS[value] ?? (value ? String(value).replaceAll('_', ' ') : 'Not provided');
}

export function sourceLabel(source) {
  if (!source) return 'Source not provided';
  return String(source).replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatObservedDate(value) {
  if (!value) return 'Date not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date not available';
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}

export function formatDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters)) return 'Distance unavailable';
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)} m away`;
  return `${(distanceMeters / 1000).toFixed(1)} km away`;
}

export function normalizePlaceSummary(place) {
  return {
    ...place,
    categoryLabel: place.categoryLabel || labelForFeature(place.category),
    address: place.address || place.city || 'Address not provided',
    claimSummary: Array.isArray(place.claimSummary) ? place.claimSummary : [],
    activeIncidents: Array.isArray(place.activeIncidents) ? place.activeIncidents : []
  };
}

export function normalizePlaceDetail(place) {
  return {
    ...place,
    categoryLabel: place.categoryLabel || labelForFeature(place.category),
    address: place.address || place.city || 'Address not provided',
    claims: Array.isArray(place.claims) ? place.claims : [],
    incidents: Array.isArray(place.incidents) ? place.incidents : [],
    accessGraph: place.accessGraph && typeof place.accessGraph === 'object'
      ? place.accessGraph
      : { graphVersion: 0, nodes: [], edges: [] }
  };
}

export function serializeApiErrorForView(error) {
  return {
    status: error?.status ?? 503,
    title: error?.title ?? 'Service unavailable',
    message: error?.userMessage ?? error?.detail ?? 'The directory could not be reached. Please try again.',
    traceId: error?.traceId ?? null
  };
}
