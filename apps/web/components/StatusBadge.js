const toneByStatus = {
  recently_observed: 'status-positive',
  community_observation: 'status-neutral',
  not_assessed: 'status-unknown',
  temporarily_unavailable: 'status-warning',
  published: 'status-warning',
  pending: 'status-pending',
  needs_more_information: 'status-unknown',
  known_barrier: 'status-warning',
  partial: 'status-pending',
  no_profile: 'status-neutral',
  confirmed: 'status-positive',
  barrier: 'status-warning',
  unknown: 'status-unknown',
  warning: 'status-warning',
  clear: 'status-positive'
};

export default function StatusBadge({ status, children }) {
  const tone = toneByStatus[status] ?? 'status-neutral';
  const fallback = status ? String(status).replaceAll('_', ' ') : 'Unknown';
  return <span className={`status-badge ${tone}`}><span aria-hidden="true" className="status-dot" />{children ?? fallback}</span>;
}
