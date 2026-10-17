# AccessMap frontend-backend integration plan

**Status:** Proposed
**Date:** 2026-10-17
**Scope:** Connect `apps/web` to the implemented API without changing the
existing product principles or replacing the current JavaScript/Next.js stack.

## 1. Desired result

Turn the current fixture-only web preview into a usable vertical slice:

1. An anonymous visitor can search the real directory and open a real place
   detail page.
2. A visitor can compare a locally edited access profile with real place
   claims while keeping the profile private.
3. An authenticated contributor can submit a dated observation and see its
   server-side pending state.
4. A later visit can show public claim/incident changes without treating
   unknown information as a negative or confirmed result.

The integration should be delivered in gates. Each gate must leave the
application usable, tested, and capable of falling back to an explicit error
state; it must not silently fall back to sample data after the real API is
enabled.

## Ownership split for the two-person delivery

The implementation is divided into two non-overlapping tracks:

- **Sharad — backend and integration readiness:** contracts, seeded data,
  serializers, auth/session decisions, profile RLS, observation/idempotency,
  evidence association, provider wiring, incidents, routes, SSE payloads, and
  backend verification. See [`docs/tasks/sharad.md`](tasks/sharad.md),
  `FI-S1`–`FI-S4`.
- **Priyanka — frontend consumption and browser behavior:** the Next.js API
  client/BFF, directory pages, match/profile UI, session/reporting UI, offline
  queue, evidence UI, routes, SSE client, accessibility states, and frontend
  tests. See [`docs/tasks/priyanka.md`](tasks/priyanka.md),
  `FI-P1`–`FI-P6`.

Dependency order is:

```text
FI-S1 ──▶ FI-P1 ──▶ FI-P2 ──▶ FI-P3 ──▶ FI-P4 ──▶ FI-P5
   └──────────────────────────────▶ FI-P6 ◀──────── FI-S4
FI-S2 ────────────────────────────▶ FI-P3/FI-P4
FI-S3 ────────────────────────────▶ FI-P4/FI-P5
```

Sharad changes backend contracts and behavior; Priyanka consumes those contracts
without patching server code in the frontend. Each handoff must include the
contract version, run commands, fixtures/accounts, checks run, and known gaps.

## 2. What the backend currently provides

### Runtime and data flow

- `apps/api/src/server.mjs` is a Node built-in HTTP API, normally on
  `http://127.0.0.1:3001`.
- PostgreSQL/PostGIS is the durable source of truth. The ordered migrations are
  in `supabase/migrations/001_*.sql` through `008_*.sql`, with demo data in
  `supabase/seed/001_demo_data.sql`.
- A committed observation, facility change, or incident can create a
  PostgreSQL outbox event. The worker publishes it to a Valkey/Redis stream;
  consumers then recompute claims, process evidence, or deliver integrations.
  Therefore a successful write does not necessarily mean the public claim has
  already changed.
- Public live updates are in-process SSE through `EventHub` at
  `/api/stream/places/:placeId` and `/api/stream/map`.
- Object storage, evidence processing, external routing, and webhook delivery
  are dependency-injected. The default CLI/Compose path does not fully wire
  all of those providers, so the web must display a typed unavailable state
  rather than assume every endpoint is ready.

### API groups to integrate

| Product area | API surface | Access |
| --- | --- | --- |
| Health/session | `GET /health`, `GET /readyz`, `GET /api/session` | Public |
| Taxonomy | `GET /api/categories`, `GET /api/features` | Public, database required |
| Directory | `GET /api/places` or `/api/search` | Public |
| Place detail | `GET /api/places/:placeId`, `/claims`, `/incidents`, `/access-graph` | Public |
| Anonymous matching | `POST /api/matches/places` | Public |
| Saved profile | `GET/PATCH /api/me/access-match-profile` | Active session |
| Reporting | `POST /api/observations`, `/api/observations/sync` | Active session |
| Contribution history | `GET /api/me/observations` and observation detail/amendment routes | Active session |
| Evidence | Upload intent and evidence status routes under `/api/observations/:id/evidence` | Active session or public derivative |
| Incidents | `GET /api/incidents`, `POST/PATCH /api/incidents/:id` | Read public; write authenticated/role-scoped |
| Routes | `GET /api/routes` | Public, routing provider/service required |
| Live changes | `GET /api/stream/places/:placeId`, `/api/stream/map` | Public SSE |
| Operations | Moderation, facility, QR, civic, and webhook routes | Role/API-key scoped |

### API behavior the frontend must respect

- Authenticated calls use `Authorization: Bearer <token>`. The API validates a
  local HMAC `S-003` token and has no login, signup, refresh, or token-issuance
  endpoint.
- Most failures are `problem.v1` JSON responses with `status`, `title`,
  `detail`, `code`, and `traceId`. The client must preserve the trace ID in
  user-supportable errors and logs without exposing secrets.
- Mutating JSON requests need `Content-Type: application/json`. Observation
  writes require a client-generated `clientRequestId` (8–128 characters) for
  idempotency.
- `/api/places` returns `claimSummary` and `activeIncidents` on each summary;
  it does not return the fixture card's `claims` array.
- The place detail response contains claims, incidents, and an access graph;
  detailed claims should be rendered from the real response instead of being
  reconstructed from the search summary.
- `POST /api/matches/places` accepts `requirements` or
  `profile.requirements`, and returns one explanation per place.
- `POST /api/observations` returns a pending/private observation. Moderation,
  claim recomputation, and public visibility are later states.
- `POST /api/observations/sync` accepts 1–50 items and returns duplicate/sync
  information. The client must retain the idempotency key until the server
  confirms the item.
- SSE starts with a `ready` event and then sends allowlisted public events. It
  is not a durable replay log, and the current hub is process-local.

## 3. Current frontend baseline

`apps/web` is a Next.js 16 / React 19 JavaScript App Router application. It is
currently a visual fixture preview:

- `apps/web/lib/fixture-client.js` imports JSON fixtures and exposes one sample
  place, four local features, and local search/match helpers.
- `app/search/page.js` calls `searchPlaces()` and passes results into
  `SearchExperience`; filters and sorting happen in the browser.
- `app/places/[placeId]/page.js` rejects every ID except
  `place_sample_community_centre` and renders hard-coded sample sections.
- `ProfileEditor.js` saves to `localStorage` and explicitly does not recalculate
  a match.
- `ReportForm.js` validates locally, saves a local draft, and explicitly does
  not submit anything.
- There is no frontend API client, auth/session state, API base URL, SSE client,
  IndexedDB queue, evidence input, browser E2E suite, or API integration test.

The first integration must remove the sample-only assumptions from the public
directory and place routes before adding advanced reporting or operations UI.

## 4. Decisions and assumptions for this plan

These are the recommended defaults. They should be confirmed at the first
integration gate because changing them later affects transport and auth code.

### 4.1 Use a same-origin Next.js BFF/proxy

Use Next.js route handlers as the browser-facing boundary, for example:

```text
Browser → Next.js /api/accessmap/* → API http://127.0.0.1:3001/api/*
```

Server-rendered pages may use the same shared server client with a private
`ACCESSMAP_API_URL`. Browser components should not call port 3001 directly.
This avoids the current API's missing CORS and `OPTIONS` handling, keeps the API
origin private in deployment, and gives one place to normalize errors, attach
trace IDs, and forward auth.

Do not expose `AUTH_SECRET`, `DATABASE_URL`, or a long-lived bearer token in a
`NEXT_PUBLIC_*` variable. If the chosen identity provider uses a browser
session, keep the session in a secure, HttpOnly, SameSite cookie and let the
BFF translate it to the backend authorization header. Add CSRF protection for
cookie-authenticated mutations.

### 4.2 Keep the JavaScript stack

Do not introduce TypeScript, a new data-fetching framework, or a replacement
starter kit as part of this integration. Use the existing npm workspaces,
Next.js App Router, React components, and `@accessmap/contracts` package.

### 4.3 Make contracts the integration boundary

Before building UI adapters, reconcile the current implementation with the
shared contracts. Known examples are:

- Route results use `durationSeconds`/`unknownSegments` and a boolean
  recommendation in the implementation, while the contract names
  `estimatedMinutes`/`uncertainSegments` and a string recommendation.
- Incident severity values differ between the contract (`informational`,
  `warning`, `major`, `critical`) and API input (`info`, `low`, `medium`,
  `high`, `critical`).
- Several authenticated response shapes do not consistently include a
  `schemaVersion`.
- The web fixture ID and seeded database place IDs are not currently the same.

Choose one canonical shape per endpoint, update the contract/fixture and API
serializer together, then make the web client consume that shape. Do not hide
these differences in ad hoc component conditionals.

### 4.4 Authentication is a gate, not a frontend guess

Public search and place detail can be integrated immediately. Protected profile
persistence and reporting cannot be completed until the team decides how a
user receives a token. The backend currently verifies local signed tokens but
does not issue them. For local development, use test-minted tokens only behind
a development/test boundary; for a real deployment, define an identity
provider or a backend auth adapter that produces the claims the API expects.

## 5. Phased implementation plan

### Gate 0 — Contract and environment handshake

**Outcome:** The team can run a real seeded API and knows which shapes/auth
strategy the web will target.

1. Start PostgreSQL, Valkey, and storage only when required; apply migrations
   in order and load the demo seed. Compose does not apply migrations or seed
   automatically.
2. Verify anonymous API behavior with a real database:
   `/health`, `/readyz`, `/api/features`, `/api/categories`, `/api/places`, and
   `/api/places/:placeId`.
3. Reconcile the known contract mismatches listed in section 4.3. Add or
   update fixtures for actual search, detail, match, observation, incident,
   route, and problem payloads.
4. Verify the profile path under forced RLS using the same user context the API
   will use. `getProfile()` and `upsertProfile()` must not be enabled in the UI
   until this read/write check passes.
5. Decide and document: identity provider/token issuer, BFF session mechanism,
   canonical seeded place ID, feature taxonomy source, and whether route and
   evidence providers are available in the target environment.
6. Resolve the evidence association sequence before promising photo upload.
   The current API requires an existing observation for upload intent, while
   observation creation accepts evidence references and there is no explicit
   HTTP endpoint to attach a newly uploaded evidence asset afterward. Choose a
   backend-supported draft/attach flow before starting Gate 5.

**Exit criteria:** The API can return seeded public data; the contract fixtures
match the response serializers; auth and deployment assumptions are written
down; no secrets are placed in frontend configuration.

### Gate 1 — Shared web transport and public directory

**Outcome:** Anonymous users can search real places and open any returned place.

Add a small web integration layer, keeping transport out of presentation
components:

```text
apps/web/lib/api/
  server-client.js       # server-side API fetch, base URL, timeout, trace ID
  browser-client.js      # same-origin calls to the Next BFF
  errors.js              # problem.v1 parsing and user-safe messages
  normalizers.js         # contract-to-view-model adaptation only
apps/web/app/api/accessmap/[...path]/route.js
                         # same-origin proxy; forwards approved methods/headers
```

Implementation steps:

1. Add a server-only `ACCESSMAP_API_URL` configuration with a safe local
   default, never bundled into browser code.
2. Implement GET forwarding first. Forward `Accept`, trace ID, and only the
   approved auth/session headers; return the backend status and content type.
3. Add bounded timeout/abort behavior and parse `problem.v1` into a stable
   `ApiError` used by pages and forms.
4. Replace `searchPlaces()` in `app/search/page.js` with a server request to
   `/api/places`, passing `query`, `category`, `city`, coordinates/bbox when
   available, `page`, `pageSize`, and `sort`.
5. Update `SearchExperience` to use server results and server pagination. Do
   not locally reimplement relevance, distance, or feature filtering once the
   API owns those semantics.
6. Update `PlaceCard` to read `claimSummary` and `activeIncidents`, remove the
   unconditional “Sample” label, and handle missing/unknown claims explicitly.
7. Replace the hard-coded ID check in `app/places/[placeId]/page.js` with a
   real detail request. Map API 404 to `notFound()` and render real claims,
   incidents, contact data, dates, source labels, and access graph data.
8. Add loading, empty, unavailable, and retry states. Keep the accessible list
   as the source of truth while map rendering remains a later enhancement.

**Exit criteria:** `GET /search?query=...` and `/places/:placeId` work against
seeded data; no public page imports the fixture client for displayed data; 404,
503, empty, and pagination states are covered by tests.

### Gate 2 — Anonymous matching and real taxonomy

**Outcome:** Profile edits produce a real explanation without exposing or
requiring a saved private profile.

1. Load the canonical feature catalog from `GET /api/features`; remove the
   frontend's four-feature, `slice(0, 3)` limitation.
2. Preserve the current local profile behavior for anonymous visitors, but
   convert selected values into `{ featureCode, level }` requirements and call
   `POST /api/matches/places` for the current place(s).
3. Render the server's `decision`, required/preferred counts, avoidance
   warnings, and per-feature items. Keep confirmed, blocked, stale, conflicted,
   and unknown values distinct.
4. Debounce or explicitly submit recalculation so every request is cancellable
   and stale responses cannot overwrite newer profile edits.
5. Keep local storage only as an anonymous convenience. Label it as local and
   never send the stored profile unless the user submits it.

**Exit criteria:** Editing a local profile changes a real match explanation;
unknown claims are not counted as confirmed; the UI uses the backend taxonomy
and does not duplicate matching rules.

### Gate 3 — Session and authenticated profile persistence

**Outcome:** A signed-in user can inspect and save a private match profile.

1. Implement the chosen sign-in/session adapter. Provide a development-only
   way to obtain a test user session without shipping `AUTH_SECRET` to the
   browser.
2. Call `GET /api/session` on the server/BFF and expose only
   `{ authenticated, role }` to UI code.
3. Add session-expired handling for `401` and forbidden handling for `403`;
   preserve anonymous browsing when the session is absent.
4. On sign-in, load `GET /api/me/access-match-profile`; on save, send
   `PATCH /api/me/access-match-profile` with the deduplicated requirements.
5. Treat profile persistence as private. Never put requirements in public URLs,
   place links, analytics payloads, or SSE topics.
6. Re-run the Gate 0 RLS verification after any auth/session change.

**Exit criteria:** A real authenticated user can load, update, clear, and
recover a private profile; logging out returns the UI to anonymous behavior;
expired sessions do not cause repeated failed requests.

### Gate 4 — Online observation reporting

**Outcome:** An authenticated contributor can submit one observation and see its
pending state.

1. Define the UI-to-API value mapping before wiring submission:

   | Current UI value | API `value` |
   | --- | --- |
   | `available` | `yes` |
   | `partial` | `partial` |
   | `unavailable` | `no` |
   | `temporarily_unavailable` | `temporarily_unavailable` |
   | `unknown` | `unknown` |

   `incorrect` has no direct observation value. Decide whether it becomes an
   observation amendment, a separate incident/correction flow, or is removed
   before enabling the real submit button.

2. Replace the sample-place guard in the report page with a real place lookup
   and pass the canonical feature catalog to `ReportForm`.
3. Serialize a date-only input to a valid ISO `observedAt` value and generate a
   stable `crypto.randomUUID()` `clientRequestId` before the first attempt.
4. Submit `POST /api/observations` through the BFF with the place, feature,
   mapped value, details, and idempotency key. Never include an auth token in
   local storage or the form URL.
5. Show clear states: authentication required, validating, submitting,
   pending review, duplicate/already synced, rate limited, unavailable, and
   retryable failure. A pending report must not be presented as a public claim.
6. Add a contribution-history route using `GET /api/me/observations` so the
   user can find the returned observation ID and status.

**Exit criteria:** One online report is stored by the API; retrying the same
   submission does not create a second observation; the UI communicates that
   moderation and claim recomputation are asynchronous.

### Gate 5 — Offline sync and evidence

**Outcome:** Poor connectivity does not discard a report, and optional evidence
uses the backend's privacy boundary.

1. Replace report-draft-only `localStorage` with an IndexedDB outbox containing
   the complete observation payload, generated `clientRequestId`, attempt
   state, and last error. Keep the payload append-only until sync succeeds.
2. When online or on an explicit retry, send batches of at most 50 to
   `POST /api/observations/sync`. Remove an item only after a successful server
   response; preserve duplicate results as successful reconciliation.
3. Add an offline queue status and an accessible retry/sync control. A service
   worker/background sync is optional after the foreground queue is reliable.
4. Add evidence selection only after the target environment wires an evidence
   storage adapter **and** the backend exposes a complete association flow.
   The current routes issue upload intent only for an existing observation and
   have no attach endpoint; implement and test either an observation-draft /
   attach sequence or a create-with-upload-intent sequence. Then upload using
   the returned URL/headers and track the returned `evidenceId`.
5. Enforce client-side size/type limits for usability, but rely on the API for
   final validation. Render processing, rejected, sensitive-content hold, and
   public-derivative states from the evidence status endpoint.

**Exit criteria:** Offline items survive reload, sync exactly once by
`clientRequestId`, and evidence never exposes a private storage key or
original-private URL.

### Gate 6 — Incidents, routes, and live updates

**Outcome:** The core journey can explain route constraints and react to public
barrier changes.

1. Add a route page with accessible origin/destination controls and a no-map
   list representation. Serialize `/api/routes` query parameters exactly as
   the API expects (`origin`, `destination`, `constraints`, or place aliases).
2. Normalize the chosen route contract before rendering. Show distance,
   estimated time, satisfied/unsatisfied constraints, uncertain or stale
   segments, incidents, graph/incident versions, and the explicit statement
   that a route is not an accessibility guarantee.
3. Add public incident display using `/api/incidents` and place incidents.
   Keep a temporary incident visibly separate from permanent feature claims.
4. Add an SSE client for a place page only after public event payloads and
   deployment topology are confirmed. Prefer a same-origin streaming proxy;
   otherwise CORS and preflight support must be added to the API.
5. Reconnect with bounded backoff, announce updates through an accessible live
   region, and let the user choose whether to refresh/recalculate. Do not
   silently replace a route while the user is reading or navigating it.
6. Treat SSE as a hint to refetch authoritative place/route data. Do not rely
   on the current process-local event hub for durable replay or multi-replica
   delivery.

**Exit criteria:** A user can request a route, understand uncertainty, see a
public incident, and receive a safe live-update prompt without private event
fields leaking into the browser.

### Gate 7 — Role-specific operations and release hardening

Implement only after the public/contributor journey is stable:

- Moderator queue and approve/reject/request-changes/escalate actions.
- Facility place scope, official responses, facility incidents, and QR flows.
- Civic/API-key views and webhook subscription management if the product needs
  them in the web app.
- Observation verification/dispute/outdated actions and history.
- Shared browser accessibility checks, session/role matrix, rate-limit UI,
  privacy review, and production deployment configuration.

## 6. Proposed endpoint-to-UI mapping

| Frontend area | Read operations | Write operations | First implementation location |
| --- | --- | --- | --- |
| Search page | `/api/features`, `/api/categories`, `/api/places` | None | `app/search/page.js`, `SearchExperience.js` |
| Place page | `/api/places/:id`, `/claims`, `/incidents`, `/access-graph`, `/api/incidents` | None initially | `app/places/[placeId]/page.js` |
| Profile | `/api/features`, `/api/session`, `/api/me/access-match-profile` | `PATCH /api/me/access-match-profile` | `app/profile/page.js`, `ProfileEditor.js` |
| Anonymous match | Claims from place page | `POST /api/matches/places` | `ProfileEditor.js` or match feature module |
| Report | Place/features/session | `POST /api/observations` | `app/places/[placeId]/report`, `ReportForm.js` |
| My contributions | `/api/me/observations`, observation/evidence status | Amend/verify/dispute/outdated | New `app/contributions` route |
| Route | Place search/detail and `/api/incidents` | None | New `app/route` route |
| Live place updates | SSE stream, then authoritative place refetch | None | Place-page client boundary |
| Moderation/facility | Role-specific queue/place APIs | Role-specific action routes | New protected route groups |

## 7. Test and verification plan

### Tests to add with the integration

1. **API client unit tests:** successful JSON, empty responses, timeout,
   malformed JSON, `problem.v1`, trace ID, 401, 403, 404, 409, 429, and 503.
2. **Contract tests:** representative API payloads validate against the shared
   schemas/fixtures, including real search/detail/match/observation/route
   shapes. Include tests for schema-version presence.
3. **BFF integration tests:** verify path forwarding, method/body forwarding,
   approved header forwarding, auth cookie-to-bearer behavior, blocked header
   leakage, and same-origin error handling.
4. **Frontend behavior tests:** search query/pagination, 404 place, empty and
   unavailable states, match recalculation race, profile privacy, report
   value mapping, idempotent retry, and session expiry.
5. **Browser accessibility tests:** keyboard-only search/report flows, focus on
   validation summaries, semantic headings/labels, live-region announcements,
   reduced-motion behavior, and a full non-map path. Add Playwright/axe only
   when the repository agrees to that new test dependency.
6. **Real-service checks:** run the existing `npm test`, `npm run lint`,
   `npm run build`, `npm run check:health`, and web lint/build. For integration
   gates, also run migrations/seed plus the disposable database/outbox checks
   and Compose validation; skipped service checks are not passes.

### Acceptance gates

- **Public directory gate:** anonymous search and real place detail work from a
  clean browser session, including empty, 404, and API-unavailable states.
- **Match gate:** local and saved profile flows distinguish unknown from
  confirmed and do not expose private requirements.
- **Report gate:** an authenticated report returns a pending observation,
  retries idempotently, and appears in contribution history.
- **Offline gate:** a queued report survives reload and syncs once after
  reconnection.
- **Journey gate:** a route shows constraints/uncertainty and a public incident
  can trigger a safe refresh prompt.
- **Release gate:** lint, tests, production builds, database/outbox checks,
  contract checks, and keyboard/screen-reader smoke checks all have recorded
  results.

## 8. Risks and required decisions

| Risk | Evidence | Mitigation/decision |
| --- | --- | --- |
| No login/token issuance | `apps/api/src/auth/session.mjs`, `token.mjs`, no auth route in `server.mjs` | Choose provider/adapter before protected UI; use test-only local tokens in development |
| Direct browser cross-origin calls fail | API has no CORS or `OPTIONS` branch; web defaults to 3000 and API to 3001 | Use the same-origin BFF, or explicitly add/test CORS before direct calls |
| Profile RLS may deny reads/writes | Profile repository methods do not visibly set the user DB context while RLS policies require it | Run a real RLS integration test before enabling persistence |
| Contracts drift from implementation | Route, incident, and schema-version differences in `packages/contracts` and serializers | Reconcile contract-first at Gate 0; add response contract tests |
| Evidence endpoint unavailable by default | Upload service is dependency-injected and may be null | Keep evidence UI behind capability detection; wire storage/processor first |
| Evidence cannot currently be attached end-to-end | Upload intent needs an existing observation; create accepts evidence refs; no attach route is registered | Add a tested draft/attach or create-with-intent API flow before the web upload UI |
| Seed IDs differ from web fixture ID | Fixture uses `place_sample_community_centre`; seed has database IDs | Use API-returned IDs and remove hard-coded sample guards |
| Claims update asynchronously | Transactional outbox and worker pipeline | Show pending/moderation status; refetch after events rather than promising immediate public change |
| SSE is process-local | `EventHub` is in-memory | Treat events as refetch hints and confirm multi-replica fan-out before production |
| Frontend has no browser/API tests | Only fixture-client tests currently exist | Add client/BFF/behavior tests at each gate, not only at release |

## 9. First implementation slice

Start with **Gate 0 plus the first half of Gate 1**:

1. Confirm the canonical API payloads and seeded place ID.
2. Add the server-side API client, `ApiError`, and same-origin BFF route.
3. Connect `/search` to `GET /api/places` with loading/error/empty/pagination
   behavior.
4. Connect `/places/[placeId]` to `GET /api/places/:placeId` and render real
   claim/incident data.
5. Add API client, BFF, search, and detail tests.
6. Run the real checks and record any database/provider gap before starting
   profile persistence or reporting.

This slice gives the team a visible, low-risk proof that the frontend and
backend communicate correctly while preserving the existing accessibility and
privacy principles.
