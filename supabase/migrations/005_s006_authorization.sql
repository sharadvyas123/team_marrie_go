-- S-006 observation lifecycle authorization and claim worker policies.
BEGIN;

CREATE OR REPLACE FUNCTION app.current_auth_subject()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.auth_subject', true), '');
$$;

DROP POLICY IF EXISTS users_auth_subject_lookup ON users;
CREATE POLICY users_auth_subject_lookup
  ON users FOR SELECT
  USING (auth_subject = app.current_auth_subject());

DROP POLICY IF EXISTS moderation_items_observation_owner_insert ON moderation_items;
CREATE POLICY moderation_items_observation_owner_insert
  ON moderation_items FOR INSERT
  WITH CHECK (
    entity_type = 'observation'
    AND app.current_role() IN ('user', 'facility_manager')
    AND EXISTS (
      SELECT 1
        FROM observations
       WHERE observations.id = moderation_items.entity_id
         AND observations.contributor_id = app.current_user_id()
    )
  );

DROP POLICY IF EXISTS outbox_api_observation_insert ON outbox_events;
CREATE POLICY outbox_api_observation_insert
  ON outbox_events FOR INSERT
  WITH CHECK (
    app.current_role() IN ('user', 'facility_manager')
    AND aggregate_type = 'observation'
    AND EXISTS (SELECT 1 FROM observations WHERE observations.id = aggregate_id)
  );

DROP POLICY IF EXISTS audit_observation_actor_insert ON audit_logs;
CREATE POLICY audit_observation_actor_insert
  ON audit_logs FOR INSERT
  WITH CHECK (
    actor_id = app.current_user_id()
    AND app.current_role() IN ('user', 'facility_manager')
    AND action IN ('observation.confirmed', 'observation.disputed', 'observation.outdated')
  );

DROP POLICY IF EXISTS claims_worker_write ON claims;
CREATE POLICY claims_worker_write
  ON claims FOR INSERT
  WITH CHECK (app.current_role() IN ('worker', 'moderator', 'admin'));

DROP POLICY IF EXISTS claims_worker_update ON claims;
CREATE POLICY claims_worker_update
  ON claims FOR UPDATE
  USING (app.current_role() IN ('worker', 'moderator', 'admin'))
  WITH CHECK (app.current_role() IN ('worker', 'moderator', 'admin'));

COMMIT;
