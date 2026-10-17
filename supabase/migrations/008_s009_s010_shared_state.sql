-- S-009/S-010 shared durable state and write boundaries. Apply after 007.
-- Existing incident, facility, and webhook tables are extended in place so
-- sample data and existing RLS policies remain valid.
BEGIN;

ALTER TABLE barrier_events
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'community',
  ADD COLUMN IF NOT EXISTS expected_expiry_at timestamptz;

ALTER TABLE barrier_events DROP CONSTRAINT IF EXISTS barrier_events_status_check;
ALTER TABLE barrier_events ADD CONSTRAINT barrier_events_status_check CHECK (
  status IN ('reported', 'validated', 'published', 'disputed', 'acknowledged',
             'in_progress', 'resolved', 'archived')
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'barrier_events_source_type_check') THEN
    ALTER TABLE barrier_events ADD CONSTRAINT barrier_events_source_type_check
      CHECK (source_type IN ('community', 'facility', 'authority', 'moderator', 'system'));
  END IF;
END $$;

ALTER TABLE webhook_subscriptions
  ADD COLUMN IF NOT EXISTS secret_ciphertext text,
  ADD COLUMN IF NOT EXISTS last_error text;

CREATE TABLE IF NOT EXISTS facility_qr_codes (
  id text PRIMARY KEY,
  facility_id uuid NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  place_id uuid NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT facility_qr_codes_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT facility_qr_codes_context_check CHECK (jsonb_typeof(context) = 'object')
);

CREATE TABLE IF NOT EXISTS civic_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
  key_hash text NOT NULL UNIQUE,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  rate_limit_per_minute integer NOT NULL DEFAULT 60,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT civic_api_keys_status_check CHECK (status IN ('active', 'paused', 'revoked')),
  CONSTRAINT civic_api_keys_rate_check CHECK (rate_limit_per_minute > 0 AND rate_limit_per_minute <= 10000),
  CONSTRAINT civic_api_keys_label_check CHECK (length(btrim(label)) > 0),
  CONSTRAINT civic_api_keys_hash_check CHECK (key_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id text PRIMARY KEY,
  subscription_id uuid NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  attempt integer NOT NULL DEFAULT 0,
  status text NOT NULL,
  status_code integer,
  next_attempt_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_deliveries_attempt_check CHECK (attempt >= 0),
  CONSTRAINT webhook_deliveries_status_check CHECK (status IN ('pending', 'retry_scheduled', 'delivered', 'dead_letter', 'failed'))
);

CREATE INDEX IF NOT EXISTS barrier_events_route_scope_idx
  ON barrier_events (place_id, access_node_id, access_edge_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS facility_qr_codes_active_idx
  ON facility_qr_codes (facility_id, expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS civic_api_keys_owner_idx ON civic_api_keys (owner_id, status);
CREATE INDEX IF NOT EXISTS webhook_deliveries_subscription_idx
  ON webhook_deliveries (subscription_id, created_at DESC);

DROP TRIGGER IF EXISTS civic_api_keys_touch_updated_at ON civic_api_keys;
CREATE TRIGGER civic_api_keys_touch_updated_at
BEFORE UPDATE ON civic_api_keys
FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

DROP TRIGGER IF EXISTS webhook_deliveries_touch_updated_at ON webhook_deliveries;
CREATE TRIGGER webhook_deliveries_touch_updated_at
BEFORE UPDATE ON webhook_deliveries
FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Public consumers may read only event types that the API serializer knows how
-- to reduce. Repository methods still apply a field allowlist to payload data.
DROP POLICY IF EXISTS outbox_public_change_read ON outbox_events;
CREATE POLICY outbox_public_change_read
  ON outbox_events FOR SELECT
  USING (event_type IN (
    'place.created', 'place.updated', 'claim.recomputed',
    'facility.response.published', 'barrier.created', 'barrier.updated',
    'barrier.resolved', 'route.invalidated', 'change.published'
  ));

DROP POLICY IF EXISTS barrier_events_public_read ON barrier_events;
CREATE POLICY barrier_events_public_read
  ON barrier_events FOR SELECT
  USING (status IN ('published', 'disputed', 'resolved', 'archived'));

DROP POLICY IF EXISTS barrier_events_owner_read ON barrier_events;
CREATE POLICY barrier_events_owner_read
  ON barrier_events FOR SELECT
  USING (
    reported_by = app.current_user_id()
    OR app.current_role() IN ('moderator', 'admin')
    OR (
      app.current_role() = 'facility_manager'
      AND EXISTS (
        SELECT 1 FROM facility_claims
         WHERE facility_claims.place_id = barrier_events.place_id
           AND facility_claims.user_id = app.current_user_id()
           AND facility_claims.status = 'approved'
      )
    )
  );

DROP POLICY IF EXISTS barrier_events_reporter_insert ON barrier_events;
CREATE POLICY barrier_events_reporter_insert
  ON barrier_events FOR INSERT
  WITH CHECK (
    reported_by = app.current_user_id()
    AND app.current_role() IN ('user', 'facility_manager')
    AND status = 'reported'
    AND source_type = CASE WHEN app.current_role() = 'facility_manager' THEN 'facility' ELSE 'community' END
    AND (
      app.current_role() = 'user'
      OR EXISTS (
        SELECT 1 FROM facility_claims
         WHERE facility_claims.place_id = barrier_events.place_id
           AND facility_claims.user_id = app.current_user_id()
           AND facility_claims.status = 'approved'
      )
    )
  );

DROP POLICY IF EXISTS barrier_events_operator_update ON barrier_events;
CREATE POLICY barrier_events_operator_update
  ON barrier_events FOR UPDATE
  USING (
    app.current_role() IN ('moderator', 'admin')
    OR (
      app.current_role() = 'facility_manager'
      AND EXISTS (
        SELECT 1 FROM facility_claims
         WHERE facility_claims.place_id = barrier_events.place_id
           AND facility_claims.user_id = app.current_user_id()
           AND facility_claims.status = 'approved'
      )
    )
  )
  WITH CHECK (
    app.current_role() IN ('moderator', 'admin')
    OR (
      app.current_role() = 'facility_manager'
      AND source_type = 'facility'
      AND EXISTS (
        SELECT 1 FROM facility_claims
         WHERE facility_claims.place_id = barrier_events.place_id
           AND facility_claims.user_id = app.current_user_id()
           AND facility_claims.status = 'approved'
      )
    )
  );

DROP POLICY IF EXISTS outbox_incident_and_facility_insert ON outbox_events;
CREATE POLICY outbox_incident_and_facility_insert
  ON outbox_events FOR INSERT
  WITH CHECK (
    app.current_role() IN ('user', 'facility_manager', 'moderator', 'admin')
    AND (
      (
        aggregate_type = 'incident'
        AND EXISTS (SELECT 1 FROM barrier_events WHERE barrier_events.id = aggregate_id)
      )
      OR (
        aggregate_type = 'facility_response'
        AND EXISTS (SELECT 1 FROM facility_responses WHERE facility_responses.id = aggregate_id)
      )
    )
  );

ALTER TABLE facility_qr_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE facility_qr_codes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS facility_qr_public_read ON facility_qr_codes;
CREATE POLICY facility_qr_public_read
  ON facility_qr_codes FOR SELECT
  USING (revoked_at IS NULL AND expires_at > now());
DROP POLICY IF EXISTS facility_qr_manager_write ON facility_qr_codes;
CREATE POLICY facility_qr_manager_write
  ON facility_qr_codes FOR INSERT
  WITH CHECK (
    app.current_role() IN ('moderator', 'admin')
    OR (
      app.current_role() = 'facility_manager'
      AND created_by = app.current_user_id()
      AND EXISTS (
        SELECT 1 FROM facility_claims
         WHERE facility_claims.place_id = facility_qr_codes.facility_id
           AND facility_claims.user_id = app.current_user_id()
           AND facility_claims.status = 'approved'
      )
    )
  );
DROP POLICY IF EXISTS facility_qr_manager_update ON facility_qr_codes;
CREATE POLICY facility_qr_manager_update
  ON facility_qr_codes FOR UPDATE
  USING (created_by = app.current_user_id() OR app.current_role() IN ('moderator', 'admin'))
  WITH CHECK (created_by = app.current_user_id() OR app.current_role() IN ('moderator', 'admin'));

ALTER TABLE civic_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE civic_api_keys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS civic_api_keys_owner_access ON civic_api_keys;
CREATE POLICY civic_api_keys_owner_access
  ON civic_api_keys FOR ALL
  USING (owner_id = app.current_user_id() OR app.current_role() IN ('moderator', 'admin'))
  WITH CHECK (owner_id = app.current_user_id() OR app.current_role() IN ('moderator', 'admin'));

DROP POLICY IF EXISTS civic_api_keys_service_lookup ON civic_api_keys;
CREATE POLICY civic_api_keys_service_lookup
  ON civic_api_keys FOR SELECT
  USING (status = 'active' AND app.current_role() IN ('worker', 'moderator', 'admin'));

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webhook_deliveries_owner_access ON webhook_deliveries;
CREATE POLICY webhook_deliveries_owner_access
  ON webhook_deliveries FOR ALL
  USING (
    app.current_role() IN ('moderator', 'admin')
    OR EXISTS (
      SELECT 1 FROM webhook_subscriptions
       WHERE webhook_subscriptions.id = webhook_deliveries.subscription_id
         AND webhook_subscriptions.owner_id = app.current_user_id()
    )
  )
  WITH CHECK (
    app.current_role() IN ('moderator', 'admin')
    OR EXISTS (
      SELECT 1 FROM webhook_subscriptions
       WHERE webhook_subscriptions.id = webhook_deliveries.subscription_id
         AND webhook_subscriptions.owner_id = app.current_user_id()
    )
  );

COMMIT;
