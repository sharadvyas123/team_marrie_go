# Sharad Backend Handoff

> Updated from the current FI-S1 integration checkpoint on 2026-10-17.
> `docs/tasks/sharad.md` remains the source of truth for the ticket board and acceptance criteria.

## Goal

Continue the Next.js/Node backend delivery for AccessMap under the Sharad plan in
`docs/tasks/sharad.md`.

The in-scope result remains the complete durable platform: public place discovery,
private Accessibility Match Profiles, observations and moderation, idempotent
offline synchronization, PostgreSQL/PostGIS persistence, Redis/Valkey workers and
events, EvidenceGuard, incidents and barrier-aware routing, facility/civic APIs,
authorization, observability, deployment, backups, and release verification.

The non-negotiable product rule is:

> Unknown accessibility information must never become a confirmed match or a
> universal accessibility score.

The current immediate delivery target is the Sharad-owned `FI-S1` contract,
seed-data, and API-shape handshake from `docs/tasks/sharad.md`, followed by
`FI-S2`–`FI-S4`. Do not mark a ticket VERIFIED until its acceptance checks have
actually run.

## State

### Working now

- The repository is on branch `main`.
- Git HEAD metadata identifies revision
  `aaae774d1e863ab83ecf4274b840b5f60d6133d9`.
- The workspace contains an npm monorepo with `apps/*` and `packages/*`
  workspaces, plus a declared `workers/*` workspace.
- A JavaScript Node API exists at `apps/api/src/server.mjs` with versioned health,
  readiness, session, taxonomy, directory, place detail, matching, reporting,
  incident, route, evidence, and SSE boundaries.
- API health and unknown-resource tests exist at
  `apps/api/test/health.test.mjs`.
- Shared JavaScript packages exist for contracts, domain values, events, and
  validation.
- The contracts package now contains strict JavaScript validation plus 33
  frontend-safe fixtures for the FI-S1 endpoint envelopes and inner payloads.
- The canonical synthetic place for handoff fixtures is
  `13000000-0000-0000-0000-000000000001` (Sample Central Library). The API
  taxonomy is the seeded 18-feature catalog; `ramp_available` is not a valid
  seeded feature code.
- The public route boundary normalizes the internal route result to `route.v1`
  with `estimatedMinutes`, `uncertainSegments`, a string `recommendation`,
  freshness, incidents, and the explicit non-guarantee flag.
- Public incident responses use the API vocabulary `info`, `low`, `medium`,
  `high`, and `critical`; database values remain translated at the repository
  boundary.
- A JavaScript Next.js web shell exists under `apps/web/**`.
- A local Compose definition exists at `infra/docker-compose.yml` for
  PostgreSQL/PostGIS, Valkey, MinIO, and Mailpit.
- `docs/SETUP.md` documents npm commands, local URLs, the JavaScript-only
  decision, and the current S-001/D-001 scope.

### Incomplete

- `FI-S1` still needs a live PostgreSQL/PostGIS migration-and-seed smoke check;
  the committed fixtures and serializers are aligned, but service-backed
  responses were not available in this container.
- `FI-S2` auth/session issuance, profile RLS verification, and the BFF auth
  forwarding decision remain pending.
- `FI-S3` observation/evidence provider readiness and `FI-S4` final route,
  incident, and multi-replica SSE verification remain pending.
- The web client is intentionally unchanged in this Sharad handoff. Priyanka
  should consume the documented contracts through the BFF work in her task plan.
- Compose services were not started during this checkpoint.
- No production provider credentials or deployment environment is configured.

### Blocked or unverified

- The workspace already contained unrelated changes in
  `packages/contracts/fixtures/match-explanation.json` and
  `apps/web/test/match-client.test.mjs`; this checkpoint did not modify either
  file.
- Docker and `psql` are not installed in this container, so database, Valkey,
  migration, seed, outbox, and worker checks remain skipped.
- There is no TypeScript typecheck command; the repository is intentionally
  JavaScript-only. Adding TypeScript or a compiler requires an explicit stack
  decision rather than an implicit change.
- Pilot geography, real facility data, auth provider configuration, and
  production infrastructure choices remain open.

## Files

The following meaningful implementation and planning paths were observed. Their
Git change status was not determined because status/diff commands were prohibited.

- `package.json` — npm workspace definition and root development checks.
- `package-lock.json` — npm dependency lockfile documented by the setup note.
- `apps/api/src/server.mjs` — versioned API health endpoint and server bootstrap.
- `apps/api/test/health.test.mjs` — health and problem-response tests.
- `apps/api/package.json` — API workspace metadata.
- `packages/contracts/src/index.mjs` — initial frontend-safe contract schemas.
- `packages/contracts/fixtures/*.json` — initial contract examples for public,
  authenticated, reporting, incident, route, and session surfaces.
- `packages/domain/src/index.mjs` — shared domain values.
- `packages/events/src/index.mjs` — shared event definitions/envelope support.
- `packages/validation/src/index.mjs` — shared validation and problem-response
  helpers.
- `apps/web/app/**` — initial Next.js JavaScript web shell.
- `apps/web/package.json` and `apps/web/eslint.config.mjs` — web workspace setup.
- `infra/docker-compose.yml` — local PostgreSQL/PostGIS, Valkey, MinIO, and
  Mailpit service definitions.
- `docs/SETUP.md` — existing setup note and historical setup evidence; it is not
  a replacement for the Sharad task plan.
- `docs/tasks/sharad.md` — authoritative backend plan; intentionally unchanged.
- `README.md`, `docs/PRODUCT_PLAN.md`, `docs/ARCHITECTURE.md`, and
  `docs/IMPLEMENTATION_PLAN.md` — shared product and architecture constraints;
  intentionally unchanged.

## Decisions and constraints

- Preserve `docs/tasks/sharad.md` as the task-list source of truth.
- Keep backend ownership within the Sharad-owned paths defined there; do not edit
  Dev-owned frontend implementation files to work around missing APIs.
- Use contract-first changes in `packages/contracts/`, with generated/fixture
  updates and contract tests before server response-shape changes.
- Keep PostgreSQL/PostGIS as the durable source of truth. Redis/Valkey may cache,
  coordinate, rate-limit, and queue work, but Redis loss must not lose committed
  observations.
- Keep private profiles, contributor identity details, moderation notes, evidence
  originals, secrets, and raw sensitive payloads out of public responses, logs,
  queue payloads, cache keys, and analytics.
- Keep independent community observations separate from facility responses.
- Preserve unknown, stale, temporary, and conflicting states explicitly.
- Keep the current JavaScript-only and npm-based setup unless an explicit stack
  change is approved.
- Prefer a ticket branch/worktree before implementation; do not continue backend
  work in a shared dirty working directory when a separate worktree is available.
- Do not claim a local build, deployment, merge, or acceptance criterion without
  current evidence.

## Checks

Working folder for all documented commands:

`/home/sharad/Projects/ycce`

All results below are labeled because they were recorded in `docs/SETUP.md`, not
run in this handoff session.

### Test

- **Not run in this session.**
- Historical setup result, dated 2026-10-16 in `docs/SETUP.md`:
  `npm test` — **passed**, 2 tests passed and 0 failed.

### Lint

- **Not run in this session.**
- Historical setup result: `npm run lint` — **passed**.
- Historical setup result: `npm run lint:web` — **passed**.

### Typecheck

- **Not run / not configured.**
- `docs/SETUP.md` states that the implementation is JavaScript-only and
  intentionally has no `typecheck` command or TypeScript compiler.
- A future typecheck requires an explicit TypeScript/toolchain decision.

### Build

- **Not run in this session.**
- Historical setup result: `npm run build` — **passed**, 12 contract fixtures
  validated.
- Historical setup result: `npm run build:web` — **passed**, Next.js production
  build completed with `/` statically prerendered.
- Historical setup result: `npm run check` — **passed**, lint, tests, and build
  completed in sequence.

### Health/manual smoke

- **Not run in this session.**
- Historical setup result: `npm run check:health` — **passed**, ephemeral API
  returned `health.v1`.
- Historical setup result: `npm run dev` — **passed**, a local smoke request
  returned the AccessMap page.
- `docs/SETUP.md` records the API URL as `http://127.0.0.1:3001` and the web
  URL as `http://localhost:3000` when the corresponding process is running.
- No running process was started or stopped by this handoff.

### Infrastructure

- **Skipped.**
- Compose services were not started during the documented setup and were not
  started in this session. This must be verified before database, cache, storage,
  or mail integration work.

### Git evidence

- Branch and revision were read from Git metadata: `main` at
  `aaae774d1e863ab83ecf4274b840b5f60d6133d9`.
- `git status --short` was run before implementation. Pre-existing changes in
  `packages/contracts/fixtures/match-explanation.json` and
  `apps/web/test/match-client.test.mjs` were preserved.
- This checkpoint changed only Sharad-owned backend, contract, fixture, test,
  script, and handoff paths.

## Next step

After approval of this handoff, run the repository-level Git evidence checks from
`/home/sharad/Projects/ycce`:

1. `git status --short`
2. `git diff --stat`
3. `git diff -- <relevant paths>`

Then reconcile the observed implementation against `FI-S1` in
`docs/tasks/sharad.md`, keeping unrelated local work separate. The next
implementation action should be to choose or create the next Sharad
ticket branch/worktree and verify the documented foundation commands before
starting FI-S2 or the live database checks.

## FI-S1 integration checkpoint

### Ticket

`FI-S1` — Contract, seed-data, and API-shape handshake.

### Delivered

- Added strict contract validation in `packages/contracts/src/index.mjs` and
  changed `scripts/build.mjs` to validate types, enums, nested objects, refs,
  and additional properties rather than only checking required keys.
- Added endpoint fixtures for readiness, taxonomy, search/detail, claims,
  incidents, access graphs, matches, profiles, observations, routes, incident
  events, and SSE payloads. All fixture identifiers use seeded IDs and feature
  codes.
- Selected the canonical seeded handoff place as
  `13000000-0000-0000-0000-000000000001` / Sample Central Library.
- Normalized the public route response at the API boundary to `route.v1` and a
  frontend-safe string recommendation with minutes and explicit uncertainty.
- Added response schema versions for profile, observation, incident, and
  observation list/sync responses.
- Redacted internal incident contributor fields from repository-backed public
  place/detail/list responses while retaining feature codes for internal match
  and routing snapshots.
- Added `packages/contracts/test/contracts.test.mjs` and strengthened the API
  integration assertions for route and SSE payload versions.

### Contract/version

- Contract package: `@accessmap/contracts` `v1`.
- Endpoint versions: `ready.v1`, `session.v1`, `categories.v1`, `features.v1`,
  `place-search.v1`, `place-detail.v1`, `claims.v1`, `incidents.v1`,
  `access-graph.v1`, `match-results.v1`, `profile.v1`, `observation.v1`,
  `observation-list.v1`, `observation-sync.v1`, `route.v1`,
  `incident-event.v1`, and `stream-event.v1`.
- Public incident severity vocabulary: `info`, `low`, `medium`, `high`,
  `critical`. The repository translates database `informational`, `warning`,
  and `major` values to this API vocabulary.
- Database migration: none.

### Run locally

```text
npm run build
npm run lint
npm test
npm run check:health
```

Recorded results for this checkpoint: `npm run check` passed (`111` tests
passed, `4` service-dependent tests skipped), `npm run check:health` passed,
and `git diff --check` passed. The final standalone `npm run build` also
validated all 33 fixtures and completed the web production build.

For a seeded API, apply `supabase/migrations/001_*.sql` through
`008_*.sql`, then `supabase/seed/001_demo_data.sql`, set `DATABASE_URL`, and
run `npm run api`. The API listens on `http://127.0.0.1:3001` by default; the
server-side web BFF should use `ACCESSMAP_API_URL=http://127.0.0.1:3001` and
must not expose that value through `NEXT_PUBLIC_*` configuration.

### Fixtures/accounts

- Canonical fixture place: `13000000-0000-0000-0000-000000000001`.
- Canonical fixture feature examples: `step_free_entrance`,
  `accessible_toilet`, `working_lift`, and the remaining 15 entries in
  `features.json`.
- All fixture records are synthetic and contain no credentials, private storage
  keys, contributor identity, or moderation notes.
- The API still verifies local HMAC bearer tokens but does not issue them.

### Known limitations

- PostgreSQL/PostGIS, Valkey, migration/seed, outbox, and worker checks were
  skipped because Docker and `psql` are unavailable in this container.
- Profile RLS context, token issuance/BFF session translation, evidence attach
  sequencing, and provider availability are FI-S2/FI-S3 work.
- The route engine remains the seeded local graph unless an external routing
  provider is injected. SSE remains process-local and should be treated as a
  refetch hint.

### Dev action required

- Consume the endpoint fixtures and versions above; do not use the old
  `place_sample_community_centre` or `ramp_available` IDs.
- Build the same-origin BFF and public directory against `/api/places` and
  `/api/places/:placeId`; do not call port 3001 directly from browser code.
- Treat `route.v1` recommendations, claims, and reports as uncertainty-aware;
  a pending observation is not a public claim.

### Frontend integration checkpoint

The current workspace also contains the first frontend integration slice:

- `apps/web/lib/api/` provides the server client, browser client, typed
  `ApiError`, and contract-to-view-model normalizers.
- `apps/web/app/api/accessmap/[...path]/route.js` is the same-origin GET-only
  BFF. It forwards `Accept`, trace ID, and an explicitly approved bearer
  header, and does not forward cookies or server secrets.
- Search and place detail consume `/api/places`, `/api/categories`,
  `/api/features`, and `/api/places/:placeId`; the UI distinguishes empty,
  unavailable, not-found, unknown, sample, and published states.
- Frontend transport/BFF coverage is in `apps/web/test/api-client.test.mjs`
  and `apps/web/test/bff-route.test.mjs`.

The web is configured with the server-only variable
`ACCESSMAP_API_URL=http://127.0.0.1:3001`. Do not add this value to a
`NEXT_PUBLIC_*` variable or call port 3001 from browser components. The live
frontend currently renders the intended recovery state until the API has a
PostgreSQL/PostGIS repository with migrations and seed data.
