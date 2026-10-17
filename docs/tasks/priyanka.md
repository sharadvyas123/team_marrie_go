# Priyanka — Frontend API Integration Delivery Plan

## Mission

Own the browser-facing half of the AccessMap frontend-backend integration.
Replace the current fixture-only web preview with an accessible Next.js
experience that consumes Sharad's real API contracts safely and transparently.

By the end of this focused track, a user should be able to:

- Search real places and open real place details.
- Compare a private local or saved match profile with real claims.
- Understand loading, empty, unknown, stale, conflict, unavailable, and
  asynchronous states.
- Submit an authenticated observation with an idempotency key.
- Recover offline reports and synchronize them without duplicates.
- Use the non-map route, incident, and live-update experience.

This is a scoped delegation for the integration work described in
[`docs/FRONTEND_BACKEND_INTEGRATION_PLAN.md`](../FRONTEND_BACKEND_INTEGRATION_PLAN.md).
The broader product frontend roadmap remains documented in `docs/tasks/Dev.md`.

## Current integration checkpoint

FI-P1 and the public-directory portion of FI-P2 are implemented in the current
workspace. The web app now uses a server-only `ACCESSMAP_API_URL` client and a
same-origin `/api/accessmap/*` BFF for approved GET requests. `/search`, place
detail, and the report context route load API data rather than importing the
fixture client for displayed place data. Search pagination, category/city
filters, empty results, typed unavailable states, trace references, dynamic
place IDs, claims, incidents, taxonomy, and access-graph summaries are wired.

The API is currently running at `http://127.0.0.1:3001` without a configured
PostgreSQL repository in this container, so the live UI correctly shows a
recoverable `503` directory state. The web production server is available at
`http://127.0.0.1:3000`. Seeded search/detail verification remains blocked on
the PostgreSQL/PostGIS migration and seed setup.

## Read before starting

Read these documents in order:

1. [`README.md`](../../README.md)
2. [`docs/PRODUCT_PLAN.md`](../PRODUCT_PLAN.md)
3. [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md)
4. [`docs/FRONTEND_BACKEND_INTEGRATION_PLAN.md`](../FRONTEND_BACKEND_INTEGRATION_PLAN.md)
5. [`docs/tasks/sharad.md`](sharad.md), especially `FI-S1` through `FI-S4`
6. [`docs/tasks/Dev.md`](Dev.md) for the existing accessibility and frontend
   quality expectations

The product rule that must shape every screen is:

> Unknown accessibility information must never be shown as a confirmed match
> or silently converted into a failure.

## Ownership boundary

### Priyanka owns for this integration track

```text
apps/web/app/**
apps/web/components/**
apps/web/lib/**
apps/web/test/**
apps/web/e2e/**
apps/web/public/**
apps/web/package.json             # only when a frontend test dependency is agreed
docs/tasks/priyanka.md
```

This includes Next.js route handlers used as the same-origin BFF, API client
modules, browser state, form behavior, IndexedDB/offline queue, SSE client,
accessible UI states, and frontend/browser tests.

### Sharad owns the backend boundary

```text
apps/api/**
apps/api/test/**
packages/contracts/**
packages/domain/**
packages/events/**
packages/validation/**
workers/**
supabase/**
infra/**
```

Do not modify backend implementation, migrations, worker, contract, or
infrastructure files to make a screen pass. Record the missing field or
behavior in the handoff and ask Sharad for a contract-first/API change.

For this focused work, this file delegates the listed frontend paths from the
broader Dev frontend plan to Priyanka. Remaining design-system and unrelated
frontend roadmap work stays under `docs/tasks/Dev.md`.

## Non-negotiable integration rules

1. Browser code must not call `http://127.0.0.1:3001` directly. Use the
   same-origin Next.js BFF or a server-side API client.
2. Never expose `AUTH_SECRET`, `DATABASE_URL`, API keys, private storage keys,
   or long-lived bearer tokens in browser bundles, URLs, analytics, or
   `localStorage`.
3. Consume `@accessmap/contracts`; do not create competing response interfaces
   or duplicate match/trust rules in React.
4. Use real `problem.v1` status/detail/code/trace information for recovery
   states. Do not replace a `503` or missing provider with sample data.
5. Treat a successful observation write as pending until the API and worker
   statuses say otherwise.
6. Keep unknown, unavailable, stale, conflicted, facility-confirmed, and
   community-reported states visibly distinct.
7. Do not mark a ticket verified from a fixture-only result when its acceptance
   criteria require a real API.

## Required handoffs from Sharad

Before using a real endpoint, receive the matching `FI-S` handoff:

| Priyanka ticket | Required Sharad handoff |
| --- | --- |
| FI-P1 | FI-S1: base URL, problem contract, approved proxy behavior |
| FI-P2 | FI-S1: canonical place IDs, search/detail fixtures, taxonomy |
| FI-P3 | FI-S1 and FI-S2: match/profile shapes, session and RLS result |
| FI-P4 | FI-S2 and FI-S3: auth flow, observation mapping, idempotency states |
| FI-P5 | FI-S3: sync limits and tested evidence association/provider status |
| FI-P6 | FI-S4: route/incident shapes, SSE events, provider/topology limits |

If a handoff is incomplete, continue in fixture mode and record the exact gap;
do not invent a backend field or silently change the UI semantics.

## Branch and commit rules

Use a separate branch/worktree for each focused ticket:

```text
feature/priyanka/<ticket-id>-short-name
```

Use conventional commits and include the ticket ID in the commit body:

```text
feat: connect directory to real API

Refs: FI-P2
```

Keep transport, directory, profile, reporting, and offline changes in separate
logical commits where possible.

## Ticket board

Move every ticket through:

```text
NOT STARTED → IN PROGRESS → REVIEW → INTEGRATED → VERIFIED
```

| ID | Ticket | Depends on | Sharad handoff | Delivery gate |
| --- | --- | --- | --- | --- |
| FI-P1 | Web API client, errors, and same-origin BFF | Current web app | FI-S1 | Browser can call approved API paths without CORS or secret leakage. |
| FI-P2 | Real search, taxonomy, and place details | FI-P1 | FI-S1 | Anonymous users can browse real places and details. |
| FI-P3 | Anonymous match and private profile UI | FI-P1, FI-P2 | FI-S1, FI-S2 | Profile edits produce server explanations without exposing needs. |
| FI-P4 | Session, online reporting, and contribution history | FI-P1, FI-P2 | FI-S2, FI-S3 | Authenticated reports are pending, retryable, and idempotent. |
| FI-P5 | Offline sync and evidence experience | FI-P4 | FI-S3 | Offline reports survive reload and sync once; evidence is provider-gated. |
| FI-P6 | Routes, incidents, SSE, and integration QA | FI-P2, FI-P3 | FI-S4 | Core journey explains uncertainty and live changes safely. |

---

## FI-P1 — Web API client, errors, and same-origin BFF

### Objective

Create one transport boundary so pages and components do not scatter `fetch`
calls, duplicate error parsing, or call the API cross-origin.

### Suggested files

```text
apps/web/lib/api/server-client.js
apps/web/lib/api/browser-client.js
apps/web/lib/api/errors.js
apps/web/lib/api/normalizers.js
apps/web/app/api/accessmap/[...path]/route.js
apps/web/test/api-client.test.mjs
apps/web/test/bff-route.test.mjs
```

### Deliverables

- Server-only API base URL from `ACCESSMAP_API_URL` with a documented local
  default.
- Browser client that calls same-origin `/api/accessmap/*` routes only.
- BFF route handler that forwards approved methods, body, content type, trace
  ID, and session authorization without forwarding unsafe headers.
- Bounded timeout/abort behavior for server requests.
- `ApiError` that preserves HTTP status, safe problem fields, and trace ID.
- Consistent handling for JSON, empty responses, malformed responses, 401, 403,
  404, 409, 429, and 503.
- No private server environment variable imported by a client component.

### Acceptance criteria

- A browser request never requires API CORS.
- A failed API response renders a recoverable error rather than fixture data.
- Tests prove that cookies/tokens/secrets are not leaked to the browser or
  upstream API outside the approved forwarding contract.
- The client can be replaced by fixture mode in tests without changing UI
  components.

### Handoff to Sharad

Report the exact forwarded methods/headers, error behavior, environment name,
and tests run. Ask for a backend change if a required response is not covered
by the agreed contract.

## FI-P2 — Real search, taxonomy, and place details

### Objective

Replace the fixture-only public directory with real anonymous API data while
keeping the accessible list independent from the map.

### Files to update

```text
apps/web/app/search/page.js
apps/web/components/SearchExperience.js
apps/web/components/PlaceCard.js
apps/web/app/places/[placeId]/page.js
apps/web/app/places/[placeId]/report/page.js
apps/web/components/ClaimCard.js
apps/web/lib/fixture-client.js   # retain only for tests/fixture mode
```

### Deliverables

- Search through `/api/places` with query, category, city, location/bbox,
  page, page size, and sort parameters as supported by the API.
- Taxonomy loading from `/api/categories` and `/api/features` rather than the
  four-feature local catalog.
- Server-rendered place detail loading from `/api/places/:placeId`.
- Search cards adapted to `claimSummary` and `activeIncidents`.
- Dynamic place IDs and 404 handling with `notFound()`.
- Real claims, incidents, dates, sources, contact information, and access graph
  presentation where fields are available.
- Loading, empty, retryable error, unavailable, and pagination states.
- Explicit unknown/not-assessed presentation when a claim is absent.

### Acceptance criteria

- Anonymous users can search a seeded place and open the returned ID directly.
- No production directory screen depends on `place_sample_community_centre`.
- The UI does not locally reimplement backend search, distance, freshness, or
  match semantics.
- The accessible list works without map assets or location permission.
- A 404 is different from an unavailable API and both have recovery behavior.

### Handoff to Sharad

Record which fields are rendered, which are intentionally unavailable, and any
contract mismatch that blocked a screen. Include browser and real-API check
results.

## FI-P3 — Anonymous match and private profile UI

### Objective

Connect profile editing to the backend match engine without making a private
profile public or requiring sign-in for anonymous comparison.

### Deliverables

- Feature editor populated from the canonical `/api/features` response.
- Local anonymous profile represented as deduplicated
  `{ featureCode, level }` requirements.
- `POST /api/matches/places` integration for current place(s).
- Server explanation rendering for decision, counts, warnings, and per-feature
  results.
- Request cancellation or stale-response protection when profile edits happen
  quickly.
- Local storage retained only as an explicitly local anonymous convenience.
- Unknown, stale, conflicted, blocked, and confirmed states rendered distinctly.

When FI-S2 is ready, add:

- `GET /api/session` session state.
- `GET/PATCH /api/me/access-match-profile` saved profile behavior.
- Private save, clear, logout, and expired-session states.

### Acceptance criteria

- Editing a profile changes the server-produced explanation.
- Unknown claims never count as confirmed requirements.
- Requirements are absent from public links, page metadata, SSE topics, and
  analytics payloads.
- A user can browse anonymously even when saved-profile auth is unavailable.
- RLS or auth failures are visible and do not silently fall back to a public
  or sample profile.

## FI-P4 — Session, online reporting, and contribution history

### Objective

Submit one real observation with correct status mapping, idempotency, and
asynchronous-state communication.

### Deliverables

- Session-aware UI using the agreed BFF/session contract.
- Authentication-required, expired-session, forbidden, and suspended states.
- Real place/feature context on the report page.
- UI-to-API mapping:

  | UI value | API value |
  | --- | --- |
  | `available` | `yes` |
  | `partial` | `partial` |
  | `unavailable` | `no` |
  | `temporarily_unavailable` | `temporarily_unavailable` |
  | `unknown` | `unknown` |

- A product decision before enabling the current `incorrect` option because it
  has no direct observation value in the API.
- ISO `observedAt` serialization and a stable generated `clientRequestId`.
- `POST /api/observations` submission and `GET /api/me/observations` history.
- Submitting, pending, duplicate, rate-limited, unavailable, and retry states.
- A clear statement that pending reports have not changed the public claim.

### Acceptance criteria

- One report reaches the API and displays its server state.
- Retrying the same request does not create a duplicate observation.
- An unauthenticated visitor is prompted to authenticate rather than seeing a
  false success message.
- The report form remains keyboard and screen-reader usable through validation,
  submission, and success/error states.

### Handoff to Sharad

Include the submitted payload mapping, client-request-ID behavior, response
states rendered, and any missing API capability. Do not request a server change
without a concrete request/response example and the user-facing reason.

## FI-P5 — Offline sync and evidence experience

### Objective

Make reporting resilient to poor connectivity and integrate evidence only
through a complete, privacy-safe backend sequence.

### Deliverables

- IndexedDB outbox replacing report-draft-only `localStorage` for queued
  observations.
- Queue records containing the complete payload, `clientRequestId`, attempt
  state, and last safe error.
- Batch synchronization through `POST /api/observations/sync`, never exceeding
  50 items.
- Removal only after a successful response; duplicate responses are reconciled
  as successful outcomes.
- Accessible offline banner, queue count, retry action, and sync progress.
- Reload/reconnect behavior that preserves queued reports.
- Evidence UI gated on Sharad's confirmed storage and association flow.
- Client file type/size guidance plus server-driven processing, rejected,
  sensitive-content, alt-text, and public-derivative states.

The current backend has an important sequencing gap: upload intent requires an
existing observation, observation creation accepts evidence references, and no
attach route is currently registered. Do not build an apparently complete
upload flow until FI-S3 supplies a tested draft/attach or create-with-intent
sequence.

### Acceptance criteria

- A queued report survives a page reload and browser restart in supported
  environments.
- Reconnection syncs each item once by `clientRequestId`.
- A failed item remains available for retry with a safe explanation.
- Private storage keys and original-private URLs never appear in UI state or
  logs.
- Evidence processing is clearly asynchronous and never presented as public
  before backend approval.

### Handoff to Sharad

Report IndexedDB schema, sync results, retry behavior, browser limitations, and
the exact evidence UI state machine. If the evidence API is not ready, record
that the evidence control remains disabled with an honest explanation.

## FI-P6 — Routes, incidents, SSE, and integration QA

### Objective

Finish the core journey with an accessible non-map route view, public incident
context, safe live updates, and repeatable integration verification.

### Deliverables

- Accessible route page and list representation; map enhancement is optional.
- `/api/routes` request serialization using the canonical origin, destination,
  constraints, mode, locale, alternatives, and timeout fields.
- Route rendering for distance, time, constraints, uncertain/stale segments,
  incidents, graph/incident versions, and non-guarantee language.
- Public incident display separate from permanent feature claims.
- SSE client for place/map scope only after FI-S4 provides event examples and
  deployment constraints.
- Bounded reconnect backoff and authoritative refetch after an event.
- Accessible live-region announcement and a user-controlled refresh/recalculate
  action. Never move the user silently while reading a route.
- Final fixture-to-real API browser test matrix.

### Acceptance criteria

- A route result never presents accessibility as a permanent guarantee.
- Unknown and active-barrier route segments remain visible.
- An incident update prompts a safe refresh rather than replacing content
  unexpectedly.
- SSE reconnects within bounded limits and does not expose private fields.
- The non-map flow works with keyboard navigation and a screen reader.

## Frontend verification matrix

Run the smallest relevant check after each ticket, then run the full set before
requesting integration:

| Area | Check |
| --- | --- |
| JavaScript/JSON | `npm run lint` |
| Web lint | `npm run lint:web` |
| Frontend tests | `node --test apps/web/test` plus new BFF/browser tests |
| Production build | `npm run build:web` or `npm run build` |
| API health | `npm run check:health` |
| Real service integration | Sharad's documented migration/seed and API commands |
| Browser accessibility | Keyboard, 200% zoom, reduced motion, screen reader smoke test; Playwright/axe when agreed |

Do not call a skipped database, Valkey, storage, or browser check passed. Record
the command, working directory, result, and any external-service gap in the
ticket handoff.

## Priyanka handoff template

Use this in the PR or integration note:

````markdown
### Ticket
FI-P___

### Delivered
- ...

### Sharad contract consumed
- API/contract version:
- Endpoints:
- Fixtures:

### User-visible states
- Loading:
- Empty/unknown:
- Error/unavailable:
- Auth/session:
- Async/pending:

### Checks run
```text
commands and results
```

### Known limitations or backend requests
- ...

### Next Sharad dependency
- ...
````

## Final integration definition

Priyanka's frontend track is complete when:

- Public search and place detail work against real seeded API data.
- Anonymous matching uses server explanations and preserves private needs.
- Authenticated reporting is idempotent and communicates pending state.
- Offline reports are recoverable and sync without duplicates.
- Evidence is gated behind a verified backend association/provider flow.
- Route and incident views explain uncertainty and do not overpromise.
- SSE updates are public-only, reconnectable, and user-controlled.
- `npm run lint`, frontend tests, production build, and available browser/API
  checks have recorded results.
- No screen silently replaces missing backend data with a positive accessibility
  claim or fixture success message.
