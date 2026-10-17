-- S-007 durable outbox claim leases. Apply after 002_security_and_operations.sql.
BEGIN;

ALTER TABLE outbox_events
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.outbox_events'::regclass
       AND conname = 'outbox_events_lease_state_check'
  ) THEN
    ALTER TABLE outbox_events
      ADD CONSTRAINT outbox_events_lease_state_check
      CHECK (
        (lease_owner IS NULL AND lease_expires_at IS NULL)
        OR
        (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.outbox_events'::regclass
       AND conname = 'outbox_events_lease_owner_check'
  ) THEN
    ALTER TABLE outbox_events
      ADD CONSTRAINT outbox_events_lease_owner_check
      CHECK (
        lease_owner IS NULL
        OR length(btrim(lease_owner)) BETWEEN 1 AND 128
      );
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS outbox_events_lease_idx
  ON outbox_events (lease_expires_at, created_at, id)
  WHERE published_at IS NULL;

COMMIT;
