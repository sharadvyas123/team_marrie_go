-- S-006 observation amendments and evidence references. Apply after 005.
BEGIN;

CREATE TABLE observation_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id uuid NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  previous_details text,
  previous_measured_value jsonb,
  details text,
  measured_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX observation_amendments_observation_idx
  ON observation_amendments (observation_id, created_at DESC);

ALTER TABLE observation_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE observation_amendments FORCE ROW LEVEL SECURITY;

CREATE POLICY observation_amendments_owner_or_moderator_read
  ON observation_amendments FOR SELECT
  USING (
    author_id = app.current_user_id()
    OR EXISTS (
      SELECT 1
        FROM observations
       WHERE observations.id = observation_amendments.observation_id
         AND observations.contributor_id = app.current_user_id()
    )
    OR app.current_role() IN ('moderator', 'admin')
  );

CREATE POLICY observation_amendments_owner_insert
  ON observation_amendments FOR INSERT
  WITH CHECK (
    author_id = app.current_user_id()
    AND app.current_role() IN ('user', 'facility_manager')
    AND EXISTS (
      SELECT 1
        FROM observations
       WHERE observations.id = observation_amendments.observation_id
         AND observations.contributor_id = app.current_user_id()
    )
  );

DROP POLICY IF EXISTS evidence_assets_owner_insert ON evidence_assets;
CREATE POLICY evidence_assets_owner_insert
  ON evidence_assets FOR INSERT
  WITH CHECK (
    app.current_role() IN ('user', 'facility_manager')
    AND
    EXISTS (
      SELECT 1 FROM observations
       WHERE observations.id = evidence_assets.observation_id
         AND observations.contributor_id = app.current_user_id()
    )
  );

DROP POLICY IF EXISTS moderation_items_evidence_owner_insert ON moderation_items;
CREATE POLICY moderation_items_evidence_owner_insert
  ON moderation_items FOR INSERT
  WITH CHECK (
    entity_type = 'evidence'
    AND app.current_role() IN ('user', 'facility_manager')
    AND EXISTS (
      SELECT 1
        FROM evidence_assets
        JOIN observations ON observations.id = evidence_assets.observation_id
       WHERE evidence_assets.id = moderation_items.entity_id
         AND observations.contributor_id = app.current_user_id()
    )
  );

DROP POLICY IF EXISTS verification_events_worker_read ON verification_events;
CREATE POLICY verification_events_worker_read
  ON verification_events FOR SELECT
  USING (app.current_role() = 'worker');

DROP POLICY IF EXISTS claims_worker_read ON claims;
CREATE POLICY claims_worker_read
  ON claims FOR SELECT
  USING (app.current_role() = 'worker');

DROP POLICY IF EXISTS evidence_assets_moderator_write ON evidence_assets;
CREATE POLICY evidence_assets_moderator_write
  ON evidence_assets FOR UPDATE
  USING (app.current_role() IN ('moderator', 'admin'))
  WITH CHECK (app.current_role() IN ('moderator', 'admin'));

DROP POLICY IF EXISTS audit_moderation_actor_insert ON audit_logs;
CREATE POLICY audit_moderation_actor_insert
  ON audit_logs FOR INSERT
  WITH CHECK (
    actor_id = app.current_user_id()
    AND app.current_role() IN ('moderator', 'admin')
    AND action ~ '^moderation\.(approve|reject|request-changes|escalate)$'
  );

DROP POLICY IF EXISTS audit_observation_actor_insert ON audit_logs;
CREATE POLICY audit_observation_actor_insert
  ON audit_logs FOR INSERT
  WITH CHECK (
    actor_id = app.current_user_id()
    AND app.current_role() IN ('user', 'facility_manager')
    AND action IN (
      'observation.confirmed',
      'observation.disputed',
      'observation.outdated',
      'observation.amended'
    )
  );

DROP POLICY IF EXISTS outbox_api_observation_insert ON outbox_events;
CREATE POLICY outbox_api_observation_insert
  ON outbox_events FOR INSERT
  WITH CHECK (
    app.current_role() IN ('user', 'facility_manager')
    AND aggregate_type = 'observation'
    AND (
      (
        event_type = 'observation.submitted'
        AND EXISTS (
          SELECT 1 FROM observations
           WHERE observations.id = aggregate_id
             AND observations.contributor_id = app.current_user_id()
        )
      )
      OR (
        event_type IN ('observation.confirmed', 'observation.disputed', 'observation.outdated')
        AND EXISTS (
          SELECT 1 FROM verification_events
           WHERE verification_events.observation_id = aggregate_id
             AND verification_events.user_id = app.current_user_id()
             AND 'observation.' || verification_events.event_type = outbox_events.event_type
        )
      )
      OR (
        event_type = 'observation.amended'
        AND EXISTS (
          SELECT 1 FROM observation_amendments
           WHERE observation_amendments.observation_id = aggregate_id
             AND observation_amendments.author_id = app.current_user_id()
        )
      )
    )
  );

COMMIT;
