-- S-008 EvidenceGuard processing state and storage metadata. Apply after 006.
BEGIN;

ALTER TABLE evidence_assets
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'awaiting_upload',
  ADD COLUMN IF NOT EXISTS file_name text,
  ADD COLUMN IF NOT EXISTS content_media_type text,
  ADD COLUMN IF NOT EXISTS size_bytes bigint,
  ADD COLUMN IF NOT EXISTS checksum_sha256 text,
  ADD COLUMN IF NOT EXISTS upload_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS privacy_processed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS privacy_processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata_removed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS private_derivative_key text,
  ADD COLUMN IF NOT EXISTS derivative_media_type text,
  ADD COLUMN IF NOT EXISTS sensitive_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS hold_reason text,
  ADD COLUMN IF NOT EXISTS alt_text_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS public_available boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS failure_code text,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS cleaned_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_version integer NOT NULL DEFAULT 1;

-- Existing sample records predate EvidenceGuard. Preserve their already-approved
-- public behavior while making their processing state explicit.
UPDATE evidence_assets
   SET state = 'approved',
       privacy_processed = true,
       metadata_removed = true,
       public_available = true,
       alt_text_status = CASE WHEN alt_text IS NULL THEN 'pending' ELSE 'available' END,
       approved_at = COALESCE(approved_at, updated_at)
 WHERE moderation_status = 'approved'
   AND public_key IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evidence_assets_state_check') THEN
    ALTER TABLE evidence_assets ADD CONSTRAINT evidence_assets_state_check CHECK (
      state IN (
        'awaiting_upload', 'uploaded', 'processing', 'privacy_processed',
        'held', 'approved', 'rejected', 'failed', 'cleaned'
      )
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evidence_assets_size_check') THEN
    ALTER TABLE evidence_assets ADD CONSTRAINT evidence_assets_size_check CHECK (
      size_bytes IS NULL OR (size_bytes > 0 AND size_bytes <= 104857600)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evidence_assets_checksum_check') THEN
    ALTER TABLE evidence_assets ADD CONSTRAINT evidence_assets_checksum_check CHECK (
      checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-fA-F]{64}$'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evidence_assets_flags_check') THEN
    ALTER TABLE evidence_assets ADD CONSTRAINT evidence_assets_flags_check CHECK (
      jsonb_typeof(sensitive_flags) = 'array'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evidence_assets_alt_text_status_check') THEN
    ALTER TABLE evidence_assets ADD CONSTRAINT evidence_assets_alt_text_status_check CHECK (
      alt_text_status IN ('pending', 'suggested', 'available', 'not_required')
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evidence_assets_public_state_check') THEN
    ALTER TABLE evidence_assets ADD CONSTRAINT evidence_assets_public_state_check CHECK (
      public_available = false
      OR (
        state = 'approved'
        AND privacy_processed = true
        AND moderation_status = 'approved'
        AND public_key IS NOT NULL
        AND (alt_text IS NOT NULL OR alt_text_status = 'pending')
      )
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS evidence_assets_processing_idx
  ON evidence_assets (state, upload_expires_at, created_at);

CREATE INDEX IF NOT EXISTS evidence_assets_observation_state_idx
  ON evidence_assets (observation_id, state, moderation_status);

DROP POLICY IF EXISTS evidence_assets_safe_public_read ON evidence_assets;
CREATE POLICY evidence_assets_safe_public_read
  ON evidence_assets FOR SELECT
  USING (
    (
      state = 'approved'
      AND public_available = true
      AND moderation_status = 'approved'
      AND privacy_processed = true
      AND public_key IS NOT NULL
    )
    OR EXISTS (
      SELECT 1
        FROM observations
       WHERE observations.id = evidence_assets.observation_id
         AND observations.contributor_id = app.current_user_id()
    )
    OR app.current_role() IN ('moderator', 'admin', 'worker')
  );

DROP POLICY IF EXISTS evidence_assets_worker_read ON evidence_assets;
CREATE POLICY evidence_assets_worker_read
  ON evidence_assets FOR SELECT
  USING (app.current_role() = 'worker');

DROP POLICY IF EXISTS evidence_assets_worker_update ON evidence_assets;
CREATE POLICY evidence_assets_worker_update
  ON evidence_assets FOR UPDATE
  USING (app.current_role() = 'worker')
  WITH CHECK (app.current_role() = 'worker');

COMMIT;
