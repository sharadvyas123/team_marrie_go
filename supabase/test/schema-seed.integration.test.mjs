import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const migrationPaths = [
  fileURLToPath(new URL('../migrations/001_initial_schema.sql', import.meta.url)),
  fileURLToPath(new URL('../migrations/002_security_and_operations.sql', import.meta.url)),
  fileURLToPath(new URL('../migrations/003_outbox_leases.sql', import.meta.url)),
  fileURLToPath(new URL('../migrations/004_worker_durability.sql', import.meta.url)),
  fileURLToPath(new URL('../migrations/005_s006_authorization.sql', import.meta.url)),
  fileURLToPath(new URL('../migrations/006_s006_observation_history.sql', import.meta.url)),
  fileURLToPath(new URL('../migrations/007_s008_evidence_pipeline.sql', import.meta.url)),
  fileURLToPath(new URL('../migrations/008_s009_s010_shared_state.sql', import.meta.url))
];
const seedPath = fileURLToPath(new URL('../seed/001_demo_data.sql', import.meta.url));

async function commandAvailable(command) {
  try {
    await execFileAsync(command, ['--version']);
    return true;
  } catch {
    return false;
  }
}

async function runPsql(databaseUrl, args) {
  try {
    return await execFileAsync(
      'psql',
      ['-X', '-v', 'ON_ERROR_STOP=1', databaseUrl, ...args],
      { maxBuffer: 1024 * 1024 }
    );
  } catch (error) {
    const detail = typeof error.stderr === 'string' ? error.stderr.trim() : '';
    throw new Error(detail || 'psql failed while running the schema integration check');
  }
}

const assertions = String.raw`
DO $$
DECLARE
  sample_places integer;
  sample_observations integer;
  sample_edges integer;
  sample_nodes integer;
  required_rls_tables integer;
   expected_rls_tables constant integer := 25;
BEGIN
  SELECT count(*) INTO sample_places FROM places WHERE is_sample;
  SELECT count(*) INTO sample_observations FROM observations WHERE is_sample;
  SELECT count(*) INTO sample_edges FROM access_edges WHERE is_sample;
  SELECT count(*) INTO sample_nodes FROM access_nodes WHERE is_sample;

  IF sample_places <> 8 THEN
    RAISE EXCEPTION 'expected 8 sample places, found %', sample_places;
  END IF;

  IF sample_observations < 15 THEN
    RAISE EXCEPTION 'expected at least 15 sample observations, found %', sample_observations;
  END IF;

  IF sample_edges < 5 OR sample_nodes < 8 THEN
    RAISE EXCEPTION 'expected two seeded route graphs';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM claims WHERE status = 'conflicting_information' AND is_sample
  ) OR NOT EXISTS (
    SELECT 1 FROM claims WHERE status = 'needs_reverification' AND is_sample
  ) OR NOT EXISTS (
    SELECT 1 FROM claims WHERE status = 'temporarily_unavailable' AND is_sample
  ) THEN
    RAISE EXCEPTION 'required claim scenarios are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM barrier_events WHERE status = 'published' AND is_sample
  ) OR NOT EXISTS (
    SELECT 1 FROM barrier_events WHERE status = 'resolved' AND is_sample
  ) THEN
    RAISE EXCEPTION 'active and resolved incident scenarios are missing';
  END IF;

  SELECT count(*)
    INTO required_rls_tables
    FROM pg_class
   WHERE relnamespace = 'public'::regnamespace
     AND relkind = 'r'
     AND relrowsecurity;

  IF required_rls_tables <> expected_rls_tables THEN
    RAISE EXCEPTION 'expected RLS on %, found % public tables', expected_rls_tables, required_rls_tables;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'places_geom_gist'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'access_edges_geometry_gist'
  ) THEN
    RAISE EXCEPTION 'required spatial indexes are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'outbox_events'
       AND column_name = 'lease_owner' AND data_type = 'text'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'outbox_events'
       AND column_name = 'lease_expires_at' AND data_type = 'timestamp with time zone'
  ) THEN
    RAISE EXCEPTION 'outbox lease columns are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'outbox_events'::regclass
       AND conname = 'outbox_events_lease_state_check'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'outbox_events'::regclass
       AND conname = 'outbox_events_lease_owner_check'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'outbox_events_lease_idx'
  ) THEN
    RAISE EXCEPTION 'outbox lease constraints or index are missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM outbox_events
     WHERE is_sample AND (
       lease_owner IS NOT NULL
       OR lease_expires_at IS NOT NULL
       OR dead_lettered_at IS NOT NULL
     )
  ) THEN
    RAISE EXCEPTION 'seeded outbox events must start without an active lease';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class
      WHERE relname = 'worker_idempotency'
        AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'worker idempotency table must have RLS enabled';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class
      WHERE relname = 'observation_amendments'
        AND relrowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'audit_logs'
       AND policyname = 'audit_moderation_actor_insert'
  ) THEN
    RAISE EXCEPTION 'S-006 history and moderation audit policies are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'evidence_assets'
       AND column_name = 'privacy_processed'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'evidence_assets_processing_idx'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'evidence_assets'
       AND policyname = 'evidence_assets_worker_update'
  ) THEN
    RAISE EXCEPTION 'S-008 evidence processing state or worker policy is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'facility_qr_codes' AND relrowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'civic_api_keys' AND relrowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'webhook_deliveries' AND relrowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'barrier_events'
       AND column_name = 'source_type'
  ) THEN
    RAISE EXCEPTION 'S-009/S-010 durable state or incident source metadata is missing';
  END IF;

  BEGIN
    INSERT INTO verification_events (observation_id, user_id, event_type, is_sample)
    VALUES (
      '14000000-0000-0000-0000-000000000001',
      '12000000-0000-0000-0000-000000000001',
      'confirmed',
      true
    );
    RAISE EXCEPTION 'self-verification was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM = 'self-verification was accepted' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    UPDATE observations
       SET value = 'no'
     WHERE id = '14000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'observation identity mutation was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM = 'observation identity mutation was accepted' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    INSERT INTO facility_responses
      (place_id, feature_id, manager_id, response, status_value, is_sample)
    VALUES (
      '13000000-0000-0000-0000-000000000001',
      '11000000-0000-0000-0000-000000000001',
      '12000000-0000-0000-0000-000000000004',
      'This response must be rejected without an approved facility claim.',
      'yes',
      true
    );
    RAISE EXCEPTION 'unapproved facility response was accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM = 'unapproved facility response was accepted' THEN
      RAISE;
    END IF;
  END;
END;
$$;
`;

test('S-002 migration and seed persist required data and enforce boundaries', async (t) => {
  const databaseUrl = process.env.TEST_DATABASE_URL;

  if (!databaseUrl) {
    t.skip('set TEST_DATABASE_URL to a disposable PostgreSQL/PostGIS database');
    return;
  }

  if (!(await commandAvailable('psql'))) {
    t.skip('psql is required for the PostgreSQL integration test');
    return;
  }

  for (const migrationPath of migrationPaths) await access(migrationPath);
  await access(seedPath);

  const migrationArgs = migrationPaths.flatMap((migrationPath) => ['-f', migrationPath]);
  await runPsql(databaseUrl, [...migrationArgs, '-f', seedPath, '-f', seedPath]);
  await runPsql(databaseUrl, ['-c', assertions]);
  assert.ok(true, 'migration, repeatable seed, read-back, and boundary checks passed');
});
