-- S-007 durable worker idempotency and dead-letter state. Apply after 003.
BEGIN;

ALTER TABLE outbox_events
  ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz;

ALTER TABLE worker_dead_letters
  ADD COLUMN IF NOT EXISTS source_stream text,
  ADD COLUMN IF NOT EXISTS source_message_id text,
  ADD COLUMN IF NOT EXISTS source_job_id text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open';

ALTER TABLE worker_dead_letters
  DROP CONSTRAINT IF EXISTS worker_dead_letters_status_check;

ALTER TABLE worker_dead_letters
  ADD CONSTRAINT worker_dead_letters_status_check
  CHECK (status IN ('open', 'resolved'));

CREATE TABLE IF NOT EXISTS worker_idempotency (
  idempotency_key text PRIMARY KEY,
  state text NOT NULL DEFAULT 'processing',
  owner text NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT worker_idempotency_key_check CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 512),
  CONSTRAINT worker_idempotency_owner_check CHECK (length(btrim(owner)) BETWEEN 1 AND 128),
  CONSTRAINT worker_idempotency_state_check CHECK (state IN ('processing', 'completed')),
  CONSTRAINT worker_idempotency_result_check CHECK (
    state = 'processing' OR result IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS outbox_events_dead_letter_idx
  ON outbox_events (dead_lettered_at, created_at, id)
  WHERE published_at IS NULL;

CREATE INDEX IF NOT EXISTS worker_dead_letters_open_idx
  ON worker_dead_letters (created_at DESC)
  WHERE status = 'open';

CREATE UNIQUE INDEX IF NOT EXISTS worker_dead_letters_source_message_idx
  ON worker_dead_letters (source_stream, source_message_id)
  WHERE source_stream IS NOT NULL AND source_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS worker_idempotency_processing_idx
  ON worker_idempotency (lease_expires_at)
  WHERE state = 'processing';

CREATE OR REPLACE FUNCTION app.touch_worker_idempotency_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS worker_idempotency_touch_updated_at ON worker_idempotency;
CREATE TRIGGER worker_idempotency_touch_updated_at
BEFORE UPDATE ON worker_idempotency
FOR EACH ROW EXECUTE FUNCTION app.touch_worker_idempotency_updated_at();

ALTER TABLE worker_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_idempotency FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS outbox_private_role_access ON outbox_events;
CREATE POLICY outbox_private_role_access
  ON outbox_events FOR ALL
  USING (app.current_role() IN ('worker', 'moderator', 'admin'))
  WITH CHECK (app.current_role() IN ('worker', 'moderator', 'admin'));

DROP POLICY IF EXISTS worker_dead_letters_operator_access ON worker_dead_letters;
CREATE POLICY worker_dead_letters_operator_access
  ON worker_dead_letters FOR ALL
  USING (app.current_role() IN ('worker', 'moderator', 'admin'))
  WITH CHECK (app.current_role() IN ('worker', 'moderator', 'admin'));

CREATE POLICY worker_idempotency_worker_access
  ON worker_idempotency FOR ALL
  USING (app.current_role() IN ('worker', 'moderator', 'admin'))
  WITH CHECK (app.current_role() IN ('worker', 'moderator', 'admin'));

COMMIT;
