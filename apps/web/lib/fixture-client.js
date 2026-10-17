import placeSummary from '@accessmap/contracts/fixtures/place-summary.json' with { type: 'json' };
import claim from '@accessmap/contracts/fixtures/accessibility-claim.json' with { type: 'json' };
import matchProfile from '@accessmap/contracts/fixtures/match-profile.json' with { type: 'json' };
import matchExplanation from '@accessmap/contracts/fixtures/match-explanation.json' with { type: 'json' };
import observation from '@accessmap/contracts/fixtures/observation.json' with { type: 'json' };
import incident from '@accessmap/contracts/fixtures/incident.json' with { type: 'json' };

export const featureCatalog = [
  {
    code: 'step_free_entrance',
    label: 'Step-free entrance',
    group: 'Mobility',
    description: 'An entrance without steps on the approach.'
  },
  {
    code: 'accessible_toilet',
    label: 'Accessible toilet',
    group: 'Mobility',
    description: 'A toilet with accessible features available to visitors.'
  },
  {
    code: 'quiet_space',
    label: 'Quiet space',
    group: 'Sensory environment',
    description: 'A calmer area for people who need a lower-stimulation space.'
  },
  {
    code: 'ramp_available',
    label: 'Ramp available',
    group: 'Mobility',
    description: 'A ramp that provides an alternative to steps.'
  },
  {
    code: 'working_lift',
    label: 'Working lift',
    group: 'Mobility',
    description: 'A lift is available and reported to be working for the public route.'
  },
  {
    code: 'accessible_parking',
    label: 'Accessible parking or drop-off',
    group: 'Mobility',
    description: 'A suitable accessible parking bay or drop-off point is available.'
  },
  {
    code: 'tactile_paving',
    label: 'Tactile paving',
    group: 'Visual access',
    description: 'Tactile guidance helps people navigate the approach and entrance.'
  },
  {
    code: 'audio_directions',
    label: 'Audio directions or announcements',
    group: 'Visual access',
    description: 'Audio information supports navigation and important updates.'
  },
  {
    code: 'high_contrast_signage',
    label: 'High-contrast signage',
    group: 'Visual access',
    description: 'Signs use clear contrast and readable visual information.'
  },
  {
    code: 'visual_alerts',
    label: 'Visual alerts and displays',
    group: 'Hearing and communication',
    description: 'Important announcements are available through visual alerts or displays.'
  },
  {
    code: 'hearing_loop',
    label: 'Hearing loop',
    group: 'Hearing and communication',
    description: 'A hearing loop or assistive listening system is available where needed.'
  },
  {
    code: 'captioned_information',
    label: 'Captioned or text assistance',
    group: 'Hearing and communication',
    description: 'Videos, service information, or staff support include text alternatives.'
  },
  {
    code: 'clear_signage',
    label: 'Clear, predictable signage',
    group: 'Sensory environment',
    description: 'The route and steps to use the service are clearly signposted.'
  },
  {
    code: 'seating_available',
    label: 'Seating along the route',
    group: 'Sensory environment',
    description: 'There is somewhere to rest during a visit or while waiting.'
  }
];

export const samplePlace = {
  ...placeSummary,
  categoryLabel: 'Community centre',
  claims: [claim],
  activeBarriers: [{
    featureCode: 'ramp_available',
    status: 'published',
    source: 'community_incident',
    observedAt: incident.startsAt
  }],
  incidents: [incident],
  observation,
  matchProfile,
  matchExplanation
};

export function labelForFeature(featureCode) {
  return featureCatalog.find((feature) => feature.code === featureCode)?.label ?? featureCode.replaceAll('_', ' ');
}

export function featureForCode(featureCode) {
  return featureCatalog.find((feature) => feature.code === featureCode);
}

export function searchPlaces(query = '') {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [samplePlace];

  const searchableText = [
    samplePlace.name,
    samplePlace.category,
    samplePlace.categoryLabel,
    samplePlace.address,
    'community centre pilot district'
  ].join(' ').toLowerCase();

  return searchableText.includes(normalizedQuery) ? [samplePlace] : [];
}

export function formatObservedDate(value) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeZone: 'UTC'
  }).format(new Date(value));
}

export function formatDistance(distanceMeters) {
  if (distanceMeters < 1000) return `${distanceMeters} m away`;
  return `${(distanceMeters / 1000).toFixed(1)} km away`;
}

export function statusLabel(status) {
  const labels = {
    recently_observed: 'Recently observed',
    community_observation: 'Community observation',
    not_assessed: 'Not assessed',
    temporarily_unavailable: 'Temporarily unavailable',
    published: 'Published barrier',
    pending: 'Pending review',
    needs_more_information: 'Needs more information'
  };

  return labels[status] ?? status.replaceAll('_', ' ');
}

export function getMatchItem(featureCode) {
  return samplePlace.matchExplanation.items.find((item) => item.featureCode === featureCode);
}
