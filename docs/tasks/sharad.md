# Sharad — Platform, Backend, Data, and Production Delivery Plan

## Mission

Own and deliver the complete durable platform behind AccessMap. By the end of this task plan, the web client must have production-quality APIs and infrastructure for:

- Public place discovery and PostGIS search
- Private Accessibility Match Profiles
- Observations, verification, moderation, and trust claims
- Offline report synchronization with idempotency
- Redis/Valkey caching, rate limiting, queues, locks, and live events
- Evidence privacy processing
- Barrier incidents and barrier-aware route calculation
- Facility operations, QR reporting, civic APIs, and webhooks
- Authentication, authorization, monitoring, deployment, backups, and release operations

This is not a prototype assignment. “Done” means the platform is usable by the final frontend, safe for real pilot data, observable in production, and covered by meaningful tests.

## Read before starting

Read these documents in order:

1. [`README.md`](../../README.md)
2. [`docs/PRODUCT_PLAN.md`](../PRODUCT_PLAN.md)
3. [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md)
4. [`docs/IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md)
5. [`docs/tasks/Dev.md`](Dev.md)
6. [`docs/tasks/Dev2.md`](Dev2.md) when working on the transferred API tickets.
7. [`docs/tasks/Dhariya.md`](Dhariya.md) when working on the transferred backend tickets.

The product rule that must not be violated is:

> AccessMap must never turn unknown accessibility information into a confirmed match or a universal accessibility score.

## Ownership boundary

### Sharad owns

```text
apps/api/** except the Dev2- and Dhariya-owned paths listed below
workers/** except the Dhariya-owned evidence worker path listed below
packages/domain/** except the Dev2-owned matching and Dhariya-owned routing modules listed below
packages/contracts/**
packages/events/**
packages/validation/**
supabase/**
infra/**
.github/workflows/**
docs/api/**
root package/tooling/configuration files
```

The exact directories can be created during `S-001`, but ownership must remain stable after the foundation commit.

### Dev2 owns the transferred backend scope

```text
apps/api/src/places/**
apps/api/src/matches/**
apps/api/test/places/**
apps/api/test/matches/**
packages/domain/src/matching/**
```

Dev2 owns implementation and tests for `S-004` and `S-005` only. Database
migrations, authentication middleware, shared API contracts, event definitions,
and infrastructure remain Sharad-owned unless both plans explicitly agree to a
contract-first change.

### Dhariya owns the transferred backend scope

```text
apps/api/src/evidence/**
apps/api/test/evidence/**
workers/evidence/**
apps/api/src/incidents/**
apps/api/test/incidents/**
apps/api/src/routing/**
apps/api/test/routing/**
packages/domain/src/routing/**
packages/domain/test/routing/**
apps/api/src/facility/**
apps/api/test/facility/**
apps/api/src/civic/**
apps/api/test/civic/**
apps/api/src/webhooks/**
apps/api/test/webhooks/**
```

Dhariya owns implementation modules and focused tests for `S-008`, `S-009`,
and `S-010`. The shared API server entry point, database repository, auth
middleware, migrations, contracts, event names, infrastructure, and existing
Sharad work remain Sharad-owned. Dhariya must provide an explicit integration
handoff instead of editing those shared files.

### Dev owns

```text
apps/web/**
packages/ui/**
apps/web/e2e/**
apps/web/public/**
```

Do not edit Dev-owned files to “make integration easier”. Change the contract or add an adapter in the owning backend plan instead.

### Shared files

The following are shared and require agreement before modification:

```text
README.md
docs/PRODUCT_PLAN.md
docs/ARCHITECTURE.md
docs/IMPLEMENTATION_PLAN.md
```

The task files are planning artifacts and can be updated by either person, but implementation ownership must remain clear.

## Low-conflict working agreement

### Branches and worktrees

Use separate branches and preferably separate worktrees:

```text
feature/sharad/<ticket-id>-short-name
feature/dev/<ticket-id>-short-name
feature/dev2/<ticket-id>-short-name
feature/dhariya/<ticket-id>-short-name
```

Never develop both people’s changes in one working directory if it can be avoided.

### Commit rules

- One logical ticket per commit or small commit series.
- Use conventional commits: `feat:`, `fix:`, `test:`, `chore:`, `docs:`, `refactor:`.
- Include the ticket ID in the commit body, for example `Refs: S-004`.
- Do not mix database migrations, unrelated UI changes, and infrastructure changes in one commit.
- Push branches before requesting review.

### Contract-first rule

Sharad owns the machine-readable API and event contracts in `packages/contracts/`. Dev and Dev2 consume generated types and fixtures from that package.

If an API needs to change:

1. Open a contract-change note in the pull request.
2. Update the OpenAPI/schema contract first.
3. Update generated types and contract tests.
4. Notify the affected frontend owner and Dev2 before changing the server implementation.
5. Keep backward compatibility where possible.

Do not make unannounced response-shape changes that force Dev to rewrite completed screens.

### No shared implementation files

- Sharad does not implement React components, route pages, or browser state management.
- Dev does not implement database migrations, worker consumers, API authorization, or server-side business rules.
- Dev2 may implement the server-side business rules explicitly assigned to `S-004` and `S-005`, but does not bypass Sharad's database or authorization boundaries.
- Dhariya may implement the server-side modules explicitly assigned to `S-008`, `S-009`, and `S-010`, but does not edit Sharad's shared integration files or bypass the database, authorization, contract, event, or infrastructure boundaries.
- Dev may create mock adapters against the contract; Sharad may create API contract fixtures.
- Shared domain behavior belongs in `packages/domain/`, not duplicated in the browser.

### Integration cadence

At the end of each ticket:

1. Run the ticket checks.
2. Publish the API/event changes.
3. Add a short handoff comment to the pull request:
   - What changed
   - Contract version
   - How to run it
   - Known limitations
   - Exact next dependency for Dev

Do not wait until the entire backend is complete before integrating.

## Definition of platform complete

Platform delivery is complete only when Sharad's, Dev2's, and Dhariya's backend work together satisfies:

- Dev can run the web client against a documented local stack.
- Every required public and authenticated screen has a real API.
- PostgreSQL remains the source of truth.
- Redis loss does not lose committed observations.
- Retries do not duplicate reports, notifications, claims, or webhooks.
- Private profiles and evidence are protected by authorization and storage policies.
- Claim and match results are deterministic and explainable.
- Route and incident updates propagate through workers.
- Workers expose queue health and dead-letter failures.
- Database backup and restore have been exercised.
- Staging and production deployment are documented and smoke-tested.

---

# Ticket board

Move each ticket through:

```text
NOT STARTED → IN PROGRESS → REVIEW → INTEGRATED → VERIFIED
```

Never mark a ticket `VERIFIED` from code existence alone. Its acceptance checks must be run.

| ID | Ticket | Owner | Depends on | Parallel with | Delivery gate |
| --- | --- | --- | --- | --- | --- |
| S-001 | Workspace, contracts, and local platform | Sharad | None | Dev design work | Dev can consume stable schemas and start the web app. |
| S-002 | PostgreSQL/PostGIS schema, migrations, and seed data | Sharad | S-001 | D-001, D-002 | Clean and populated databases migrate successfully. |
| S-003 | Authentication, authorization, and security controls | Sharad | S-001, S-002 | D-001, D-002 | Unauthorized reads/writes are denied. |
| S-006 | Observations, verification, claims, and moderation API | Sharad | S-002, S-003 | D-005, D-006 | Reports persist, verify, and update claims. |
| S-007 | Redis, outbox, workers, and live event platform | Sharad | S-002, S-003 | D-004, D-005 | Events are durable, retryable, observable, and idempotent. |
| S-008 | EvidenceGuard and secure media pipeline | Dhariya | S-003, S-007 | D-005 | Public media is safe and moderation-aware. |
| S-009 | Barrier incidents, access graph, and routing API | Dhariya | S-004, S-005, S-007 | D-007 | Routes explain constraints and current barriers. |
| S-010 | Facility operations, QR workflow, civic API, and webhooks | Dhariya | S-006, S-007 | D-008 | Verified facilities can respond and integrations are safe. |
| S-011 | Observability, deployment, backups, and resilience | Sharad | S-001–S-010 incrementally | All frontend tickets | Production can be deployed, monitored, restored, and tested. |
| S-012 | Final backend integration and release verification | Sharad | S-004–S-011 | D-010 | All final user journeys pass against real services. |

> `S-004` and `S-005` were removed from this plan and transferred to
> `docs/tasks/Dev2.md`. Their ticket IDs and acceptance criteria remain stable
> so existing frontend dependencies continue to refer to the same contracts.

> `S-008`, `S-009`, and `S-010` are transferred to
> `docs/tasks/Dhariya.md`. Their ticket IDs, dependencies, and acceptance
> criteria remain stable. Shared integration files remain with Sharad so the
> transfer does not conflict with active foundation and API work.

---

## S-001 — Workspace, contracts, and local platform

### Objective

Create the stable foundation that both people can use without editing the same implementation files.

### Files owned

```text
package.json
pnpm-workspace.yaml or equivalent
tsconfig.base.json
eslint/prettier configuration
apps/api/** (foundation only; S-004/S-005 implementation paths belong to Dev2)
packages/contracts/**
packages/domain/** (foundation only; matching module belongs to Dev2)
packages/events/**
packages/validation/**
infra/docker-compose.yml
infra/env/**
.github/workflows/ci.yml
```

### Deliverables

- Monorepo/workspace setup.
- `apps/api` health endpoint.
- `packages/contracts` with initial OpenAPI or typed contract schemas.
- `packages/domain` with shared enums and IDs.
- `packages/events` with event envelope and event names.
- `packages/validation` with shared request validation.
- Local PostgreSQL/PostGIS, Redis/Valkey, MinIO or S3-compatible storage, and Mailpit services.
- Environment variable schema and `.env.example` with placeholders only.
- CI skeleton for lint, typecheck, tests, and build.
- Mock/fixture provider that Dev can use before all APIs are implemented.

### Initial contract surface

Define schemas for:

- Place result and place detail
- Accessibility feature and claim
- Accessibility Match Profile
- Match explanation
- Observation and observation status
- Incident
- Route request and route result
- Pagination and problem/error response
- Authentication/session summary

### Acceptance criteria

- `pnpm install` or the documented package command works from a clean checkout.
- Local services start with one documented command.
- `/health` returns a versioned response.
- Contract schemas compile and have example fixtures.
- Dev can import frontend-safe generated types without importing server secrets.
- CI runs on a clean environment.
- No credentials or private payloads are committed.

### Handoff to Dev

Send:

- The exact package manager and commands.
- The contract package import path.
- Fixture names for every initial screen.
- The first API base URL and environment variables.
- The rule for changing contracts.

### Suggested commit

```text
chore: bootstrap shared workspace and API contracts
```

## S-002 — PostgreSQL/PostGIS schema, migrations, and seed data

### Objective

Implement the durable relational model described in `ARCHITECTURE.md`.

### Tables and database objects

- `users`
- `user_access_profiles` including profile requirements and versioning
- `places`
- `place_categories`
- `accessibility_features`
- `observations`
- `claims`
- `verification_events`
- `access_nodes`
- `access_edges`
- `barrier_events`
- `route_profiles`
- `evidence_assets`
- `facility_claims`
- `facility_responses`
- `moderation_items`
- `outbox_events`
- `webhook_subscriptions`
- `audit_logs`

### Required database behavior

- UUID primary keys.
- UTC timestamps.
- PostGIS geography/geometry with a documented SRID.
- GiST indexes for spatial queries.
- Foreign keys and check constraints.
- Stable feature codes.
- Soft visibility states for moderated content.
- Indexes for current claims, active incidents, recent observations, and moderation queues.
- Seed data clearly marked as sample data.

### Seed dataset

Seed enough data for a complete demo:

- At least 8 facilities across multiple categories.
- At least 4 facilities with different match outcomes.
- At least one unknown required feature.
- At least one known barrier.
- At least one stale claim.
- At least one conflicting claim.
- At least one active and one resolved incident.
- Access nodes and edges for at least two route examples.
- Sample observations with dates and source types.

Do not present seed data as real-world verified information.

### Acceptance criteria

- A clean database applies all migrations in order.
- A populated database can apply the same migrations safely.
- Rollback/forward-fix behavior is documented for migration failures.
- Radius and bounding-box queries use indexes.
- RLS or equivalent database authorization policies exist for private and moderated data.
- Seed data can be reset deterministically.
- Schema tests cover required constraints.

## S-003 — Authentication, authorization, and security controls

### Objective

Make every protected operation safe before the client connects to real data.

### Deliverables

- Auth provider integration using the chosen project configuration.
- Session validation middleware.
- Role model: user, moderator, admin, facility manager.
- Ownership checks for profiles and observations.
- Facility-scope checks for manager actions.
- Moderator checks for moderation actions.
- Row-level security or equivalent database policies.
- Public/private response serializers.
- Secure headers and input sanitization.
- Rate limits for login, reports, uploads, verification, claims, APIs, and webhooks.
- Secrets validation at startup.

### Security rules

- Match profiles are never public.
- Contributor emails and exact private locations are never public.
- Evidence originals are private.
- Moderation notes are private.
- Facilities cannot delete independent observations.
- Users cannot confirm their own observations where independence matters.
- API keys and webhook secrets are never sent to the browser.

### Acceptance criteria

- Anonymous public read operations work only for approved public data.
- A user cannot read or mutate another user's private profile.
- A facility manager cannot edit an unclaimed or unapproved place.
- A moderator action is authenticated, authorized, validated, and audited.
- A suspended user cannot submit new content.
- Rate limits return a documented problem response.
- Security tests fail when a policy is intentionally violated.

## S-006 — Observations, verification, claims, and moderation API

### Objective

Deliver the complete community data lifecycle from submission through moderation, verification, claim aggregation, and public display.

### Endpoints

```text
GET  /api/me/observations
POST /api/observations
POST /api/observations/sync
GET  /api/observations/:observationId
PATCH /api/observations/:observationId
POST /api/observations/:observationId/verify
POST /api/observations/:observationId/dispute
POST /api/observations/:observationId/outdated

GET  /api/moderation/queue
GET  /api/moderation/items/:itemId
POST /api/moderation/items/:itemId/approve
POST /api/moderation/items/:itemId/reject
POST /api/moderation/items/:itemId/request-changes
POST /api/moderation/items/:itemId/escalate
```

### Observation behavior

- Require place, feature, status, and observation date.
- Support descriptions, measurements, temporary status, and evidence references.
- Preserve observation history.
- Use client idempotency keys for online and offline submission.
- Return `pending`, `approved`, `rejected`, `changes_requested`, or `synced` state explicitly.
- Never return successful submission before the durable transaction commits.

### Claim aggregation

The claim engine must:

1. Read approved observations and verification events.
2. Exclude hidden or rejected observations.
3. Apply feature freshness windows.
4. Detect independent contributors.
5. Count supporting and disputing events.
6. Detect conflicts.
7. Calculate current claim status.
8. Persist calculation version and source counts.
9. Emit a `claim.recomputed` event.

### Moderation behavior

- Every moderation decision is authenticated and audited.
- Evidence can be moderated separately from the observation.
- Moderators can hide sensitive material without destroying the observation history.
- Conflicts remain visible until resolved or stale.
- Facility responses are never treated as deletion commands.

### Acceptance criteria

- A valid observation can be read back by its contributor.
- Duplicate retries produce one observation.
- A second independent confirmation updates the claim.
- A dispute creates a visible conflict when appropriate.
- Rejected observations do not support public claims.
- Moderation decisions create audit entries.
- Public serializers exclude private moderation data.
- Claim recomputation is repeatable and idempotent.

## S-007 — Redis, outbox, workers, and live event platform

### Objective

Turn committed database changes into reliable asynchronous side effects without making Redis the source of truth.

### Redis responsibilities

- Cache-aside place, search, claims, matches, incidents, and routes.
- Distributed rate limiting.
- Idempotency records.
- Short-lived locks.
- Redis Streams or BullMQ queues.
- Live incident fan-out to the SSE layer.

Suggested key namespaces:

```text
accessmap:place:{placeId}:summary
accessmap:claims:{placeId}:v{version}
accessmap:match:{placeId}:{claimsVersion}:{profileHash}
accessmap:route:{routeHash}
accessmap:incident:cell:{h3Cell}
ratelimit:{scope}:{identity}:{action}
idempotency:{userId}:{clientRequestId}
lock:{resource}:{resourceId}
```

### Transactional outbox

Every mutation that needs downstream work must write its business row and outbox event in the same PostgreSQL transaction.

Example:

```text
observation row
moderation item
outbox event: observation.submitted
```

An outbox publisher sends events to Redis Streams. Workers acknowledge events only after successful, idempotent processing.

### Core workers

- Claim recomputation worker.
- Cache invalidation worker.
- Route invalidation worker.
- EvidenceGuard worker.
- Offline synchronization worker.
- Notification worker.
- Webhook delivery worker.
- Import/freshness worker.

### Retry behavior

- Exponential backoff.
- Maximum attempts.
- Dead-letter stream/queue.
- Operator-visible failure reason.
- Idempotency key for every external side effect.
- No private payloads in queue logs.

### Live updates

Publish only approved public events to the SSE layer. Support place-scoped and bounded geographic subscriptions.

### Acceptance criteria

- A committed observation always has a durable outbox record.
- An outbox publisher can resume after restart.
- A worker retry does not duplicate a claim, notification, or webhook.
- Redis outage falls back safely for reads and reports a degraded operational state.
- Queue lag and dead-letter counts are measurable.
- Live updates contain only public, authorized data.

## S-008 — EvidenceGuard and secure media pipeline

> **Transferred to Dhariya.** Use `docs/tasks/Dhariya.md` as the implementation
> plan. This section remains as the original platform acceptance reference;
> Sharad owns only shared integration, contracts, storage/infrastructure, and
> final verification paths.

### Objective

Accept optional evidence without exposing private data or blocking the durable report lifecycle.

### Pipeline

```text
Upload request
  ↓
Private object storage
  ↓
File signature and malware checks
  ↓
EXIF removal
  ↓
Resize/compress derivative
  ↓
Face, license plate, document, and sensitive text flags
  ↓
Alt-text suggestion
  ↓
Moderator review when needed
  ↓
Approved public derivative
```

### Rules

- Original evidence remains private.
- Public derivatives use random immutable keys.
- Do not publish a photo before privacy processing succeeds.
- AI or computer vision may suggest, never finalize, accessibility claims.
- A user can submit an observation without evidence.
- Every public image has alt text or an approved description.

### Acceptance criteria

- Unsupported and malicious files are rejected.
- Metadata is removed from public derivatives.
- Sensitive images are held for moderation.
- Evidence failures do not erase the observation.
- Public URLs cannot access originals.
- Retry processing is idempotent.
- Storage cleanup handles abandoned uploads.

## S-009 — Barrier incidents, access graph, and routing API

> **Transferred to Dhariya.** Use `docs/tasks/Dhariya.md` as the implementation
> plan. This section remains as the original platform acceptance reference;
> Sharad owns only shared integration, database, cache/event wiring, and final
> verification paths.

### Objective

Provide route recommendations that consider a user's constraints and current accessibility evidence. Do not implement shortest-path-only routing and do not promise universal accessibility.

### Data behavior

Use `access_nodes` and `access_edges` for:

- Entrances
- Lifts
- Accessible toilets
- Transport stops
- Curb crossings
- Footpath segments
- Indoor connectors

Use `barrier_events` for temporary or time-bounded changes such as a blocked ramp, broken lift, flooding, construction, or closed toilet.

### Endpoints

```text
GET  /api/routes
GET  /api/places/:placeId/access-graph
GET  /api/incidents
GET  /api/places/:placeId/incidents
POST /api/incidents
PATCH /api/incidents/:incidentId
GET  /api/stream/places/:placeId
GET  /api/stream/map?bbox=...
```

### Routing adapter

Hide the external engine behind an interface such as:

```ts
interface RoutingEngine {
  calculate(request: RouteRequest): Promise<RouteResult>;
}
```

The adapter can call Valhalla, GraphHopper, OSRM, or another compliant engine. AccessMap then enriches the base route with:

- Stairs and slope constraints.
- Path width and surface observations.
- Curb-ramp status.
- Active barrier events.
- Stale and unknown segments.
- Lift and transport availability.

### Route behavior

- Hard constraints exclude incompatible segments.
- Soft preferences add route cost or a warning.
- Every route includes distance, time, constraints, data freshness, active incidents, and uncertain segments.
- Route cache keys include a normalized request and graph/incident version.
- A barrier event invalidates nearby affected route keys only.
- A route is a recommendation based on current information, not a guarantee.

### Acceptance criteria

- A route request is validated and bounded.
- A no-stairs profile does not return a known-stairs-only route.
- Unknown segments are shown as unknown.
- An active barrier appears in the route result.
- Incident creation/resolution invalidates only affected route keys.
- Route results are cached and recover correctly after Redis loss.
- SSE sends an accessible public update for an affected place or route.
- Route calculations are traced and measured.

## S-010 — Facility operations, QR workflow, civic API, and webhooks

> **Transferred to Dhariya.** Use `docs/tasks/Dhariya.md` as the implementation
> plan. This section remains as the original platform acceptance reference;
> Sharad owns only shared integration, authorization, contracts, workers, and
> final verification paths.

### Objective

Give verified facilities and external civic partners useful, bounded tools without allowing them to erase community history.

### Facility APIs

```text
POST  /api/places/:placeId/claim
GET   /api/facility/places
GET   /api/facility/places/:placeId
POST  /api/facility/responses
PATCH /api/facility/responses/:responseId
POST  /api/facility/incidents
PATCH /api/facility/incidents/:incidentId
POST  /api/facility/qr-codes
```

### QR behavior

A QR code can be associated with:

- Facility
- Entrance
- Lift
- Toilet
- Transport stop
- Feature or access node

Scanning it opens a public or authenticated report form with the context preselected. QR payloads must not contain private user data.

### Civic API

Version public integrations independently:

```text
GET  /api/v1/places/:placeId/accessibility
GET  /api/v1/incidents?bbox=...
GET  /api/v1/changes?since=...
POST /api/v1/webhooks
```

### Webhook behavior

- HTTPS endpoints only.
- Signed payloads.
- Timestamp and replay protection.
- Exponential retry.
- Dead-letter visibility.
- Pause/revoke controls.
- Public approved events only.

### Acceptance criteria

- Unverified facility users cannot publish official responses.
- Verified managers can act only within their approved facility scope.
- Facility responses remain separate from community observations.
- A QR code opens the correct context.
- Civic API pagination and rate limits work.
- Private profiles, emails, moderation notes, and evidence originals never leave public APIs.
- Webhooks retry safely and expose failure status to authorized owners.

## S-011 — Observability, deployment, backups, and resilience

### Objective

Make the entire platform deployable and operable as a real application rather than a local demo.

### Local environment

Docker Compose should provide:

- API
- Worker
- Scheduler
- PostgreSQL/PostGIS
- Redis/Valkey
- MinIO or equivalent object storage
- Mailpit
- Optional OpenTelemetry collector

### Staging and production

- Stateless API containers.
- Independently scalable workers.
- Managed PostgreSQL/PostGIS.
- Managed Redis/Valkey with TLS and ACLs.
- Object storage with public/private buckets.
- Secret management.
- Automated database backups.
- Migration rehearsal.
- Preview, staging, and production environment separation.

### Observability

Trace:

```text
browser → API → PostgreSQL → Redis → worker → external service
```

Measure and alert on:

- API error rate.
- Search and route p95 latency.
- Redis cache hit ratio and connection failures.
- Queue lag, retry count, and dead-letter count.
- Report synchronization failures.
- Evidence processing delay.
- Claim recomputation delay.
- Route invalidation delay.
- SSE delivery failures.
- Webhook delivery failures.
- Database backup status.

### Resilience tests

- Stop Redis and verify durable reads/writes degrade safely.
- Restart workers with pending jobs.
- Re-deliver an outbox event.
- Restore a database backup in an isolated environment.
- Simulate an external routing-provider timeout.
- Simulate a storage-processing failure.
- Confirm no private data appears in logs or traces.

### Acceptance criteria

- A documented production deployment starts API, workers, scheduler, database, Redis, and storage correctly.
- CI runs lint, typecheck, unit, integration, end-to-end, accessibility, migration, and build checks.
- A deploy smoke test covers health, auth, search, match, report, incident, and queue processing.
- Backup restore is tested and documented.
- Operators can identify failed jobs and retry them safely.
- Secrets are absent from repository files and logs.

## S-012 — Final backend integration and release verification

### Objective

Integrate every backend capability with the final Dev frontend and prove the complete product journey.

### Final flow to verify

1. Anonymous user searches a seeded place.
2. User creates a private Accessibility Match Profile.
3. User sees required/preferred/avoid match explanations.
4. User opens place details and sees dated claims.
5. User requests a barrier-aware route.
6. A live incident affects the route.
7. The route is marked affected and can be recalculated.
8. User submits a report online or offline.
9. Duplicate retry produces one observation.
10. Evidence is processed privately.
11. Moderator approves or requests changes.
12. Claim status recomputes.
13. Facility responds or resolves an incident.
14. Public API and webhook receive approved change data.

### Final acceptance criteria

- All API contracts used by Dev match generated types.
- No frontend screen depends on a hard-coded backend-only field.
- All protected endpoints enforce role and ownership rules.
- All asynchronous side effects are retryable and observable.
- All public statuses contain source/date/uncertainty where relevant.
- All seeded examples are clearly marked as sample data.
- Production build and deployment smoke test pass.
- No known critical accessibility, privacy, security, or data-loss issue remains.

### Suggested commit

```text
chore: verify backend release readiness
```

---

# Sharad daily operating checklist

Before coding:

- [ ] Read the ticket and its dependencies.
- [ ] Confirm no Dev-owned file needs modification.
- [ ] Confirm the contract version.
- [ ] Create a ticket branch/worktree.

During coding:

- [ ] Keep business logic out of route handlers where possible.
- [ ] Validate at API and database boundaries.
- [ ] Add tests with the feature.
- [ ] Add or update contract fixtures.
- [ ] Add audit and observability behavior for privileged/async actions.
- [ ] Avoid private data in logs, queues, metrics, and cache values.

Before push:

- [ ] Run the smallest ticket tests.
- [ ] Run typecheck and lint.
- [ ] Run migration tests if schema changed.
- [ ] Verify Redis outage/retry behavior if Redis changed.
- [ ] Update the handoff notes.
- [ ] Push the branch and open a focused PR.

## Sharad-to-Dev handoff template

````markdown
### Ticket
S-___

### Delivered
- ...

### Contract/version
- API:
- Events:
- Database migration:

### Run locally
```text
commands
```

### Fixtures/accounts
- ...

### Known limitations
- ...

### Dev action required
- ...
````
