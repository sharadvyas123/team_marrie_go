-- AccessMap S-002 deterministic demonstration data.
-- Every record created here is synthetic and marked is_sample = true.
-- Re-running this file removes only prior sample records before re-inserting them.

BEGIN;

DELETE FROM audit_logs WHERE is_sample = true;
DELETE FROM webhook_subscriptions WHERE is_sample = true;
DELETE FROM outbox_events WHERE is_sample = true;
DELETE FROM moderation_items WHERE is_sample = true;
DELETE FROM facility_responses WHERE is_sample = true;
DELETE FROM facility_claims WHERE is_sample = true;
DELETE FROM evidence_assets WHERE is_sample = true;
DELETE FROM verification_events WHERE is_sample = true;
DELETE FROM observations WHERE is_sample = true;
DELETE FROM claims WHERE is_sample = true;
DELETE FROM barrier_events WHERE is_sample = true;
DELETE FROM access_edges WHERE is_sample = true;
DELETE FROM access_nodes WHERE is_sample = true;
DELETE FROM route_profiles WHERE is_sample = true;
DELETE FROM user_access_profiles WHERE is_sample = true;
DELETE FROM places WHERE is_sample = true;
DELETE FROM users WHERE is_sample = true;
DELETE FROM accessibility_features WHERE is_sample = true;
DELETE FROM place_categories WHERE is_sample = true;

INSERT INTO place_categories (id, code, name, is_sample) VALUES
  ('10000000-0000-0000-0000-000000000001', 'library', 'Library', true),
  ('10000000-0000-0000-0000-000000000002', 'healthcare', 'Healthcare', true),
  ('10000000-0000-0000-0000-000000000003', 'government', 'Government service', true),
  ('10000000-0000-0000-0000-000000000004', 'cultural_venue', 'Cultural venue', true),
  ('10000000-0000-0000-0000-000000000005', 'transport_stop', 'Transport stop', true),
  ('10000000-0000-0000-0000-000000000006', 'park', 'Park', true),
  ('10000000-0000-0000-0000-000000000007', 'community_center', 'Community center', true),
  ('10000000-0000-0000-0000-000000000008', 'public_toilet', 'Public toilet', true);

INSERT INTO accessibility_features
  (id, code, category, label, description, input_type, freshness_days, is_sample)
VALUES
  ('11000000-0000-0000-0000-000000000001', 'step_free_entrance', 'entrance', 'Step-free entrance', 'An entrance without steps on the usable approach.', 'boolean', 365, true),
  ('11000000-0000-0000-0000-000000000002', 'accessible_toilet', 'toilet', 'Accessible toilet', 'A toilet with the required accessible space and fittings.', 'boolean', 180, true),
  ('11000000-0000-0000-0000-000000000003', 'working_lift', 'building', 'Working lift', 'A lift that is currently available for the relevant route.', 'boolean', 60, true),
  ('11000000-0000-0000-0000-000000000004', 'stairs', 'building', 'Stairs present', 'Stairs on the relevant route or entrance.', 'boolean', 365, true),
  ('11000000-0000-0000-0000-000000000005', 'wide_door', 'entrance', 'Wide door', 'A door with a usable clear opening width.', 'measurement', 365, true),
  ('11000000-0000-0000-0000-000000000006', 'curb_ramp', 'outdoor', 'Curb ramp', 'A usable ramp at the relevant road crossing.', 'boolean', 90, true),
  ('11000000-0000-0000-0000-000000000007', 'path_width', 'outdoor', 'Path width', 'The measured usable width of an access path.', 'measurement', 90, true),
  ('11000000-0000-0000-0000-000000000008', 'quiet_space', 'sensory', 'Quiet space', 'A designated lower-stimulation space.', 'boolean', 180, true),
  ('11000000-0000-0000-0000-000000000009', 'accessible_stop', 'transport', 'Accessible stop', 'A stop with step-free boarding support.', 'boolean', 30, true),
  ('11000000-0000-0000-0000-000000000010', 'accessible_parking', 'outdoor', 'Accessible parking or drop-off', 'A suitable accessible parking bay or drop-off point.', 'boolean', 90, true),
  ('11000000-0000-0000-0000-000000000011', 'tactile_paving', 'outdoor', 'Tactile paving', 'Tactile guidance supports the approach and entrance.', 'boolean', 365, true),
  ('11000000-0000-0000-0000-000000000012', 'audio_directions', 'communication', 'Audio directions or announcements', 'Audio information supports navigation and important updates.', 'boolean', 180, true),
  ('11000000-0000-0000-0000-000000000013', 'high_contrast_signage', 'communication', 'High-contrast signage', 'Signs use clear contrast and readable visual information.', 'boolean', 365, true),
  ('11000000-0000-0000-0000-000000000014', 'visual_alerts', 'communication', 'Visual alerts and displays', 'Important announcements are available through visual alerts or displays.', 'boolean', 180, true),
  ('11000000-0000-0000-0000-000000000015', 'hearing_loop', 'communication', 'Hearing loop', 'An assistive listening system is available where needed.', 'boolean', 180, true),
  ('11000000-0000-0000-0000-000000000016', 'captioned_information', 'communication', 'Captioned or text assistance', 'Service information includes text alternatives.', 'boolean', 180, true),
  ('11000000-0000-0000-0000-000000000017', 'clear_signage', 'cognitive', 'Clear, predictable signage', 'The route and steps to use the service are clearly signposted.', 'boolean', 365, true),
  ('11000000-0000-0000-0000-000000000018', 'seating_available', 'building', 'Seating along the route', 'There is somewhere to rest during a visit or while waiting.', 'boolean', 180, true);

INSERT INTO users
  (id, auth_subject, email, display_name, role, status, is_sample)
VALUES
  ('12000000-0000-0000-0000-000000000001', 'sample-contributor-alice', 'alice@sample.invalid', 'Sample contributor A', 'user', 'active', true),
  ('12000000-0000-0000-0000-000000000002', 'sample-contributor-bob', 'bob@sample.invalid', 'Sample contributor B', 'user', 'active', true),
  ('12000000-0000-0000-0000-000000000003', 'sample-moderator', 'moderator@sample.invalid', 'Sample moderator', 'moderator', 'active', true),
  ('12000000-0000-0000-0000-000000000004', 'sample-facility-manager', 'manager@sample.invalid', 'Sample facility manager', 'facility_manager', 'active', true);

INSERT INTO user_access_profiles
  (user_id, requirements, profile_version, is_sample)
VALUES
  (
    '12000000-0000-0000-0000-000000000001',
    '[
      {"featureCode":"step_free_entrance","level":"required"},
      {"featureCode":"accessible_toilet","level":"required"},
      {"featureCode":"working_lift","level":"preferred"},
      {"featureCode":"stairs","level":"avoid"}
    ]'::jsonb,
    1,
    true
  );

INSERT INTO places
  (id, name, category_id, description, address, city, postal_code, latitude, longitude, source, status, is_sample)
VALUES
  ('13000000-0000-0000-0000-000000000001', 'Sample Central Library', '10000000-0000-0000-0000-000000000001', 'Synthetic sample facility with corroborated entrance and toilet information.', '1 Sample Street', 'Sample City', '000001', 12.971600, 77.594600, 'admin', 'active', true),
  ('13000000-0000-0000-0000-000000000002', 'Sample Community Clinic', '10000000-0000-0000-0000-000000000002', 'Synthetic sample clinic with a temporary toilet barrier.', '2 Sample Street', 'Sample City', '000002', 12.972000, 77.595000, 'import', 'active', true),
  ('13000000-0000-0000-0000-000000000003', 'Sample Civic Office', '10000000-0000-0000-0000-000000000003', 'Synthetic sample office with incomplete accessibility information.', '3 Sample Street', 'Sample City', '000003', 12.972400, 77.595400, 'admin', 'active', true),
  ('13000000-0000-0000-0000-000000000004', 'Sample Arts Hall', '10000000-0000-0000-0000-000000000004', 'Synthetic sample venue with a confirmed step-free entrance and a known stairs condition.', '4 Sample Street', 'Sample City', '000004', 12.972800, 77.595800, 'community', 'active', true),
  ('13000000-0000-0000-0000-000000000005', 'Sample Transit Hub', '10000000-0000-0000-0000-000000000005', 'Synthetic sample stop with recent curb and boarding observations.', '5 Sample Street', 'Sample City', '000005', 12.973200, 77.596200, 'import', 'active', true),
  ('13000000-0000-0000-0000-000000000006', 'Sample Riverside Park', '10000000-0000-0000-0000-000000000006', 'Synthetic sample park with an active blocked path incident.', '6 Sample Street', 'Sample City', '000006', 12.973600, 77.596600, 'community', 'active', true),
  ('13000000-0000-0000-0000-000000000007', 'Sample Neighbourhood Centre', '10000000-0000-0000-0000-000000000007', 'Synthetic sample centre with conflicting toilet observations and a facility response.', '7 Sample Street', 'Sample City', '000007', 12.974000, 77.597000, 'facility', 'active', true),
  ('13000000-0000-0000-0000-000000000008', 'Sample Market Toilet', '10000000-0000-0000-0000-000000000008', 'Synthetic sample toilet with a stale entrance claim and a resolved closure.', '8 Sample Street', 'Sample City', '000008', 12.974400, 77.597400, 'admin', 'temporarily_closed', true);

INSERT INTO observations
  (id, place_id, feature_id, contributor_id, value, details, measured_value, observed_at, submitted_at, source_type, client_request_id, visibility, moderation_status, is_sample)
VALUES
  ('14000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000001', 'yes', 'The main entrance has a level approach.', NULL, '2026-10-01T09:00:00Z', '2026-10-01T09:10:00Z', 'community', 'sample-request-0001', 'public', 'approved', true),
  ('14000000-0000-0000-0000-000000000002', '13000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-000000000002', 'yes', 'The accessible toilet was open on the ground floor.', NULL, '2026-10-02T10:00:00Z', '2026-10-02T10:10:00Z', 'community', 'sample-request-0002', 'public', 'approved', true),
  ('14000000-0000-0000-0000-000000000003', '13000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000002', 'yes', 'A second contributor found the same step-free entrance.', NULL, '2026-10-03T11:00:00Z', '2026-10-03T11:10:00Z', 'community', 'sample-request-0003', 'public', 'approved', true),
  ('14000000-0000-0000-0000-000000000004', '13000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000001', 'yes', 'The clinic entrance was level from the marked drop-off point.', NULL, '2026-09-28T09:00:00Z', '2026-09-28T09:15:00Z', 'community', 'sample-request-0004', 'public', 'approved', true),
  ('14000000-0000-0000-0000-000000000005', '13000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-000000000002', 'temporarily_unavailable', 'The accessible toilet was closed for maintenance.', NULL, '2026-10-04T12:00:00Z', '2026-10-04T12:10:00Z', 'community', 'sample-request-0005', 'public', 'approved', true),
  ('14000000-0000-0000-0000-000000000006', '13000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000001', 'yes', 'The side entrance has a ramp.', NULL, '2026-09-30T08:00:00Z', '2026-09-30T08:05:00Z', 'community', 'sample-request-0006', 'public', 'approved', true),
  ('14000000-0000-0000-0000-000000000007', '13000000-0000-0000-0000-000000000004', '11000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000002', 'yes', 'The auditorium entrance is step-free.', NULL, '2026-10-05T13:00:00Z', '2026-10-05T13:05:00Z', 'community', 'sample-request-0007', 'public', 'approved', true),
  ('14000000-0000-0000-0000-000000000008', '13000000-0000-0000-0000-000000000004', '11000000-0000-0000-0000-000000000004', '12000000-0000-0000-0000-000000000001', 'yes', 'The balcony route includes stairs.', NULL, '2026-10-05T13:30:00Z', '2026-10-05T13:35:00Z', 'community', 'sample-request-0008', 'public', 'approved', true),
  ('14000000-0000-0000-0000-000000000009', '13000000-0000-0000-0000-000000000005', '11000000-0000-0000-0000-000000000006', '12000000-0000-0000-0000-000000000001', 'yes', 'The marked crossing has a curb ramp.', NULL, '2026-10-06T07:00:00Z', '2026-10-06T07:05:00Z', 'import', 'sample-request-0009', 'public', 'approved', true),
  ('14000000-0000-0000-0000-000000000010', '13000000-0000-0000-0000-000000000005', '11000000-0000-0000-0000-000000000009', '12000000-0000-0000-0000-000000000002', 'yes', 'Step-free boarding was available at the near platform.', NULL, '2026-10-07T07:30:00Z', '2026-10-07T07:35:00Z', 'import', 'sample-request-0010', 'public', 'approved', true),
  ('14000000-0000-0000-0000-000000000011', '13000000-0000-0000-0000-000000000006', '11000000-0000-0000-0000-000000000007', '12000000-0000-0000-0000-000000000001', 'partial', 'The riverside path narrows near the bridge.', '{"widthMeters":0.9}'::jsonb, '2026-10-08T15:00:00Z', '2026-10-08T15:10:00Z', 'community', 'sample-request-0011', 'public', 'approved', true),
  ('14000000-0000-0000-0000-000000000012', '13000000-0000-0000-0000-000000000007', '11000000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-000000000001', 'yes', 'The centre toilet was usable during the morning programme.', NULL, '2026-10-09T09:00:00Z', '2026-10-09T09:10:00Z', 'community', 'sample-request-0012', 'public', 'approved', true),
  ('14000000-0000-0000-0000-000000000013', '13000000-0000-0000-0000-000000000007', '11000000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-000000000002', 'no', 'The toilet was locked during an afternoon visit.', NULL, '2026-10-10T14:00:00Z', '2026-10-10T14:10:00Z', 'community', 'sample-request-0013', 'public', 'approved', true),
  ('14000000-0000-0000-0000-000000000014', '13000000-0000-0000-0000-000000000008', '11000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000001', 'yes', 'The entrance was level when last checked.', NULL, '2024-01-10T09:00:00Z', '2024-01-10T09:10:00Z', 'admin', 'sample-request-0014', 'public', 'approved', true),
  ('14000000-0000-0000-0000-000000000015', '13000000-0000-0000-0000-000000000006', '11000000-0000-0000-0000-000000000006', '12000000-0000-0000-0000-000000000002', 'unknown', 'A new curb layout could not be assessed.', NULL, '2026-10-11T16:00:00Z', '2026-10-11T16:10:00Z', 'community', 'sample-request-0015', 'public', 'pending', true);

INSERT INTO claims
  (id, place_id, feature_id, status, summary_value, latest_observed_at, freshness_state, supporting_count, disputing_count, calculation_version, claims_version, is_sample)
VALUES
  ('15000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'community_corroborated', 'yes', '2026-10-03T11:00:00Z', 'fresh', 2, 0, 1, 1, true),
  ('15000000-0000-0000-0000-000000000002', '13000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000002', 'community_reported', 'yes', '2026-10-02T10:00:00Z', 'fresh', 1, 0, 1, 2, true),
  ('15000000-0000-0000-0000-000000000003', '13000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000001', 'community_reported', 'yes', '2026-09-28T09:00:00Z', 'fresh', 1, 0, 1, 1, true),
  ('15000000-0000-0000-0000-000000000004', '13000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000002', 'temporarily_unavailable', 'temporarily_unavailable', '2026-10-04T12:00:00Z', 'fresh', 0, 1, 1, 2, true),
  ('15000000-0000-0000-0000-000000000005', '13000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-000000000001', 'community_reported', 'yes', '2026-09-30T08:00:00Z', 'fresh', 1, 0, 1, 1, true),
  ('15000000-0000-0000-0000-000000000006', '13000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-000000000002', 'not_assessed', 'unknown', NULL, 'needs_reverification', 0, 0, 1, 2, true),
  ('15000000-0000-0000-0000-000000000007', '13000000-0000-0000-0000-000000000004', '11000000-0000-0000-0000-000000000001', 'community_reported', 'yes', '2026-10-05T13:00:00Z', 'fresh', 1, 0, 1, 1, true),
  ('15000000-0000-0000-0000-000000000008', '13000000-0000-0000-0000-000000000004', '11000000-0000-0000-0000-000000000004', 'community_reported', 'yes', '2026-10-05T13:30:00Z', 'fresh', 1, 0, 1, 2, true),
  ('15000000-0000-0000-0000-000000000009', '13000000-0000-0000-0000-000000000005', '11000000-0000-0000-0000-000000000006', 'community_reported', 'yes', '2026-10-06T07:00:00Z', 'fresh', 1, 0, 1, 1, true),
  ('15000000-0000-0000-0000-000000000010', '13000000-0000-0000-0000-000000000005', '11000000-0000-0000-0000-000000000009', 'community_reported', 'yes', '2026-10-07T07:30:00Z', 'fresh', 1, 0, 1, 2, true),
  ('15000000-0000-0000-0000-000000000011', '13000000-0000-0000-0000-000000000006', '11000000-0000-0000-0000-000000000007', 'community_reported', 'partial', '2026-10-08T15:00:00Z', 'fresh', 1, 0, 1, 1, true),
  ('15000000-0000-0000-0000-000000000012', '13000000-0000-0000-0000-000000000007', '11000000-0000-0000-0000-000000000002', 'conflicting_information', 'unknown', '2026-10-10T14:00:00Z', 'fresh', 1, 1, 1, 1, true),
  ('15000000-0000-0000-0000-000000000013', '13000000-0000-0000-0000-000000000008', '11000000-0000-0000-0000-000000000001', 'needs_reverification', 'yes', '2024-01-10T09:00:00Z', 'stale', 1, 0, 1, 1, true);

INSERT INTO verification_events
  (id, observation_id, user_id, event_type, comment, is_sample)
VALUES
  ('16000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000002', 'confirmed', 'Independent sample confirmation.', true),
  ('16000000-0000-0000-0000-000000000002', '14000000-0000-0000-0000-000000000012', '12000000-0000-0000-0000-000000000002', 'helpful', 'Useful detail for the conflicting claim.', true),
  ('16000000-0000-0000-0000-000000000013', '14000000-0000-0000-0000-000000000013', '12000000-0000-0000-0000-000000000001', 'disputed', 'The toilet was not available during a later visit.', true);

INSERT INTO access_nodes
  (id, place_id, node_type, label, floor, geom, status, is_sample)
VALUES
  ('17000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', 'entrance', 'Library main entrance', 'Ground', ST_SetSRID(ST_MakePoint(77.59460, 12.97160), 4326)::geography, 'active', true),
  ('17000000-0000-0000-0000-000000000002', '13000000-0000-0000-0000-000000000001', 'lift', 'Library lift', 'Ground', ST_SetSRID(ST_MakePoint(77.59465, 12.97162), 4326)::geography, 'active', true),
  ('17000000-0000-0000-0000-000000000003', '13000000-0000-0000-0000-000000000001', 'toilet', 'Library accessible toilet', 'Ground', ST_SetSRID(ST_MakePoint(77.59470, 12.97164), 4326)::geography, 'active', true),
  ('17000000-0000-0000-0000-000000000004', '13000000-0000-0000-0000-000000000006', 'entrance', 'Park north entrance', 'Outdoor', ST_SetSRID(ST_MakePoint(77.59660, 12.97360), 4326)::geography, 'active', true),
  ('17000000-0000-0000-0000-000000000005', '13000000-0000-0000-0000-000000000006', 'crossing', 'Park bridge crossing', 'Outdoor', ST_SetSRID(ST_MakePoint(77.59670, 12.97366), 4326)::geography, 'active', true),
  ('17000000-0000-0000-0000-000000000006', '13000000-0000-0000-0000-000000000006', 'room', 'Park community room', 'Ground', ST_SetSRID(ST_MakePoint(77.59680, 12.97372), 4326)::geography, 'active', true),
  ('17000000-0000-0000-0000-000000000007', '13000000-0000-0000-0000-000000000007', 'entrance', 'Centre entrance', 'Ground', ST_SetSRID(ST_MakePoint(77.59700, 12.97400), 4326)::geography, 'active', true),
  ('17000000-0000-0000-0000-000000000008', '13000000-0000-0000-0000-000000000007', 'room', 'Centre hall', 'Ground', ST_SetSRID(ST_MakePoint(77.59710, 12.97405), 4326)::geography, 'unknown', true);

INSERT INTO access_edges
  (id, from_node_id, to_node_id, geometry, surface_type, width_meters, slope_percent, stairs, step_free, last_observed_at, status, is_sample)
VALUES
  ('18000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000002', ST_GeogFromText('LINESTRING(77.59460 12.97160,77.59465 12.97162)'), 'paved', 1.80, 1.00, false, true, '2026-10-01T09:00:00Z', 'active', true),
  ('18000000-0000-0000-0000-000000000002', '17000000-0000-0000-0000-000000000002', '17000000-0000-0000-0000-000000000003', ST_GeogFromText('LINESTRING(77.59465 12.97162,77.59470 12.97164)'), 'paved', 1.60, 0.00, false, true, '2026-10-02T10:00:00Z', 'active', true),
  ('18000000-0000-0000-0000-000000000003', '17000000-0000-0000-0000-000000000004', '17000000-0000-0000-0000-000000000005', ST_GeogFromText('LINESTRING(77.59660 12.97360,77.59670 12.97366)'), 'paved', 1.40, 2.00, false, true, '2026-10-08T15:00:00Z', 'active', true),
  ('18000000-0000-0000-0000-000000000004', '17000000-0000-0000-0000-000000000005', '17000000-0000-0000-0000-000000000006', ST_GeogFromText('LINESTRING(77.59670 12.97366,77.59680 12.97372)'), 'uneven', 0.90, 8.00, true, false, '2026-10-08T15:00:00Z', 'blocked', true),
  ('18000000-0000-0000-0000-000000000005', '17000000-0000-0000-0000-000000000007', '17000000-0000-0000-0000-000000000008', ST_GeogFromText('LINESTRING(77.59700 12.97400,77.59710 12.97405)'), NULL, NULL, NULL, NULL, NULL, NULL, 'unknown', true);

INSERT INTO barrier_events
  (id, place_id, access_edge_id, reported_by, incident_type, severity, status, description, geom, starts_at, review_at, is_sample)
VALUES
  (
    '19000000-0000-0000-0000-000000000001',
    '13000000-0000-0000-0000-000000000006',
    '18000000-0000-0000-0000-000000000004',
    '12000000-0000-0000-0000-000000000001',
    'blocked_path',
    'major',
    'published',
    'Synthetic construction barrier blocks the stairs segment.',
    ST_GeogFromText('LINESTRING(77.59670 12.97366,77.59680 12.97372)'),
    '2026-10-12T08:00:00Z',
    '2026-10-19T08:00:00Z',
    true
  ),
  (
    '19000000-0000-0000-0000-000000000002',
    '13000000-0000-0000-0000-000000000008',
    NULL,
    '12000000-0000-0000-0000-000000000002',
    'toilet_closure',
    'warning',
    'resolved',
    'Synthetic toilet closure was resolved after maintenance.',
    NULL,
    '2026-09-01T08:00:00Z',
    '2026-09-08T08:00:00Z',
    true
  );

UPDATE barrier_events
   SET resolved_at = '2026-09-06T08:00:00Z'
 WHERE id = '19000000-0000-0000-0000-000000000002';

INSERT INTO route_profiles
  (id, user_id, name, constraints, is_private, is_sample)
VALUES
  (
    '1a000000-0000-0000-0000-000000000001',
    '12000000-0000-0000-0000-000000000001',
    'Sample no-stairs route',
    '{"avoidStairs":true,"maxSlopePercent":6,"minimumWidthMeters":1.2,"requireCurbRamps":true,"avoidUnknownSegments":false}'::jsonb,
    true,
    true
  ),
  (
    '1a000000-0000-0000-0000-000000000002',
    '12000000-0000-0000-0000-000000000002',
    'Sample cautious route',
    '{"avoidStairs":true,"avoidUnknownSegments":true}'::jsonb,
    true,
    true
  );

INSERT INTO evidence_assets
  (id, observation_id, storage_key, public_key, media_type, moderation_status, alt_text, is_sample)
VALUES
  (
    '1b000000-0000-0000-0000-000000000001',
    '14000000-0000-0000-0000-000000000005',
    'sample/private/clinic-toilet-closed.jpg',
    NULL,
    'image',
    'pending',
    NULL,
    true
  ),
  (
    '1b000000-0000-0000-0000-000000000002',
    '14000000-0000-0000-0000-000000000001',
    'sample/private/library-entrance.jpg',
    'sample/public/library-entrance-safe.jpg',
    'image',
    'approved',
    'Synthetic sample image showing the level library entrance.',
    true
  );

INSERT INTO facility_claims
  (id, place_id, user_id, organization_name, verification_method, status, reviewed_by, is_sample)
VALUES
  (
    '1c000000-0000-0000-0000-000000000001',
    '13000000-0000-0000-0000-000000000007',
    '12000000-0000-0000-0000-000000000004',
    'Sample Neighbourhood Centre Association',
    'admin_invitation',
    'approved',
    '12000000-0000-0000-0000-000000000003',
    true
  );

INSERT INTO facility_responses
  (id, place_id, feature_id, manager_id, response, status_value, evidence, is_sample)
VALUES
  (
    '1d000000-0000-0000-0000-000000000001',
    '13000000-0000-0000-0000-000000000007',
    '11000000-0000-0000-0000-000000000002',
    '12000000-0000-0000-0000-000000000004',
    'The centre confirms that the accessible toilet is available during scheduled opening hours; please ask reception for access.',
    'yes',
    '{"source":"sample_facility_response","reviewedAt":"2026-10-11T10:00:00Z"}'::jsonb,
    true
  );

INSERT INTO moderation_items
  (id, entity_type, entity_id, reason, priority, status, assigned_to, is_sample)
VALUES
  (
    '1e000000-0000-0000-0000-000000000001',
    'observation',
    '14000000-0000-0000-0000-000000000015',
    'conflict',
    'normal',
    'open',
    '12000000-0000-0000-0000-000000000003',
    true
  ),
  (
    '1e000000-0000-0000-0000-000000000002',
    'evidence',
    '1b000000-0000-0000-0000-000000000001',
    'sensitive_image',
    'high',
    'assigned',
    '12000000-0000-0000-0000-000000000003',
    true
  );

INSERT INTO outbox_events
  (id, event_type, aggregate_type, aggregate_id, payload, attempt_count, is_sample)
VALUES
  (
    '1f000000-0000-0000-0000-000000000001',
    'observation.submitted',
    'observation',
    '14000000-0000-0000-0000-000000000015',
    '{"placeId":"13000000-0000-0000-0000-000000000006","featureCode":"curb_ramp","observationId":"14000000-0000-0000-0000-000000000015"}'::jsonb,
    0,
    true
  ),
  (
    '1f000000-0000-0000-0000-000000000002',
    'claim.recomputed',
    'claim',
    '15000000-0000-0000-0000-000000000012',
    '{"placeId":"13000000-0000-0000-0000-000000000007","featureCode":"accessible_toilet","claimsVersion":1}'::jsonb,
    1,
    true
  );

INSERT INTO webhook_subscriptions
  (id, owner_id, endpoint, events, secret_hash, status, failure_count, is_sample)
VALUES
  (
    '20000000-0000-0000-0000-000000000001',
    '12000000-0000-0000-0000-000000000004',
    'https://example.invalid/accessmap/sample-webhook',
    '["claim.recomputed","barrier.created"]'::jsonb,
    'sample-secret-hash-only',
    'active',
    0,
    true
  );

INSERT INTO audit_logs
  (id, actor_id, action, entity_type, entity_id, metadata, is_sample)
VALUES
  (
    '21000000-0000-0000-0000-000000000001',
    '12000000-0000-0000-0000-000000000003',
    'moderation.item_assigned',
    'moderation_item',
    '1e000000-0000-0000-0000-000000000002',
    '{"sample":true,"reason":"sensitive_image"}'::jsonb,
    true
  ),
  (
    '21000000-0000-0000-0000-000000000002',
    '12000000-0000-0000-0000-000000000003',
    'facility_claim.approved',
    'facility_claim',
    '1c000000-0000-0000-0000-000000000001',
    '{"sample":true,"verificationMethod":"admin_invitation"}'::jsonb,
    true
  );

COMMIT;
