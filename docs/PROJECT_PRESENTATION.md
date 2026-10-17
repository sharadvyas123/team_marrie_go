# AccessMap — Project Presentation Guide

This document explains the AccessMap project in detail and provides a ready-to-use presentation script. It is written for a project demonstration, hackathon judging session, classroom presentation, or technical review.

The most important idea to communicate is:

> **AccessMap helps people understand what to expect before visiting a public place. It shows specific, dated, source-labelled accessibility information instead of reducing every place to one misleading accessibility score.**

---

## 1. Project in one minute

**AccessMap** is a community-verified accessibility information platform for public places such as community centres, libraries, healthcare facilities, government offices, transport stops, parks, and public toilets.

The platform allows a visitor to:

1. Search for a public place.
2. Filter places using specific access features.
3. Compare a place with a private Accessibility Match Profile.
4. Read feature-level information such as step-free entrances, accessible toilets, working lifts, quiet spaces, ramps, and path conditions.
5. See when the information was observed and where it came from.
6. Distinguish confirmed information, temporary barriers, stale data, conflicting reports, and information that has not been assessed.
7. Report a new observation or barrier.
8. Plan routes using constraints such as avoiding stairs or limiting slope.

The platform also provides the infrastructure needed to process reports, protect uploaded evidence, moderate information, update claims, invalidate affected routes, and expose approved civic change feeds.

---

## 2. The problem AccessMap solves

People with disabilities, older adults, caregivers, people with temporary injuries, and many other visitors often cannot find reliable access information before travelling to a public place.

A generic accessibility icon is not enough. A visitor may need answers to questions such as:

- Is the entrance genuinely step-free?
- Is the ramp usable, or is it blocked or too steep?
- Is the lift working today?
- Is the accessible toilet on the same floor?
- Is the footpath wide enough and free from obstacles?
- Does the transport stop support step-free boarding?
- When was the information last checked?
- Was the information observed by a visitor, confirmed by the facility, or imported from another source?

When this information is missing or inaccurate, the consequences are serious:

- A wasted or unsafe journey.
- Physical exhaustion.
- Loss of independence.
- Missed healthcare, education, work, or community activities.
- A person having to call several facilities to obtain basic information.

The core problem is therefore not simply “finding accessible places.” It is **making a decision with incomplete, changing, and personal information**.

---

## 3. The solution

AccessMap treats accessibility as a collection of specific features and observations rather than a binary property of an entire building.

For example, one place might have:

| Feature | Current information |
| --- | --- |
| Step-free entrance | Recently observed by the community |
| Accessible toilet | Not assessed |
| Working lift | Temporarily unavailable |
| Quiet space | Needs more information |
| Ramp | Exists permanently, but is currently blocked |

This is more useful than saying that the place is simply “accessible” or “not accessible.” Different visitors need different features, and the same feature can change over time.

AccessMap combines six important product ideas:

### 3.1 Accessibility Match Profile

The visitor can choose features that are:

- **Required** — the visitor needs this feature confirmed.
- **Preferred** — the feature is helpful but does not block consideration.
- **Avoid** — the visitor wants to avoid a known condition.

The profile is optional, private by default, and does not ask for a medical diagnosis. It is a personal decision-making tool, not a public identity label.

### 3.2 Feature-level information

The platform stores information about individual features such as:

- Step-free entrance.
- Ramp availability and condition.
- Door width.
- Accessible toilet.
- Lift availability and working status.
- Tactile paving.
- Audio or visual announcements.
- Quiet spaces.
- Path width, slope, surface, and obstructions.

### 3.3 Transparent trust and freshness

Each claim can show its source, status, observation date, supporting observations, disputes, and freshness. The system does not hide uncertainty behind an unexplained score.

### 3.4 Live barriers

A permanent feature and a temporary incident are different things. A building can have a ramp as a permanent feature while a temporary incident says that the ramp is currently blocked.

Incidents can represent:

- A broken lift.
- A blocked ramp.
- Construction on a footpath.
- Flooding.
- A temporarily closed toilet.
- A moved or disrupted transport stop.

### 3.5 Community reporting

Visitors can report one specific observation with a feature, status, date, and optional context. The form encourages useful details rather than asking contributors to complete a long survey.

### 3.6 Barrier-aware routes

The routing system can consider constraints such as avoiding stairs, limiting slope, requiring curb ramps, avoiding known incidents, or warning about unknown and stale segments.

---

## 4. The central product principle: unknown is not unavailable

This is the most important concept to demonstrate.

There are four different situations:

1. **Confirmed available** — a recent observation supports the feature.
2. **Confirmed unavailable** — an observation says the feature is not present or usable.
3. **Temporarily unavailable** — the feature exists but currently cannot be used.
4. **Not assessed / unknown** — there is not enough information to decide.

AccessMap never silently converts an unknown feature into either a positive match or an automatic failure.

For example, if a visitor requires an accessible toilet and the place has never been assessed for one, the result should say:

> “This place needs more information.”

It must not say that the toilet is available, and it must not claim that the place definitely fails. This distinction protects users from false confidence while still showing places that may deserve a phone call or a new observation.

---

## 5. How the matching logic works

The match engine compares a private profile with the current public claims and active incidents.

For each selected feature, the engine determines whether it is:

- Confirmed.
- A known barrier.
- Unknown.
- Stale.
- Conflicting.
- A preferred match.
- An avoidance warning.

The basic rules are:

1. A recent positive claim can confirm a required or preferred feature.
2. A recent negative or temporary-unavailability claim creates a known barrier.
3. Missing, stale, or materially conflicting information remains unknown.
4. An unknown required feature is never counted as confirmed.
5. An unknown preferred feature does not block a place, but remains visible.
6. A known condition that conflicts with an avoid preference creates a warning.
7. A place can be labelled **meets your known requirements** only when every required feature is confirmed and there is no active barrier for those requirements.
8. The engine does not produce a universal accessibility score.

An example explanation is:

```text
Accessibility match: needs more information
3 required features selected
2 required features confirmed
1 required feature unknown
1 preferred feature confirmed
No universal accessibility score assigned
```

Because the matching engine is deterministic and explainable, the result can be tested, replayed, and explained to the visitor.

---

## 6. Main user journey to present

The strongest story is a wheelchair user planning a visit to a community centre.

### Step 1 — Search

The visitor searches for `community centre` and finds **Sample Community Centre** in the sample directory.

The list view is the source of truth. The visual map preview is optional. This is important because the core experience should work for keyboard users, screen-reader users, people who do not want to share their location, and people using a slow connection.

### Step 2 — Inspect evidence

The visitor opens the place page and sees:

- The place is clearly labelled as sample data.
- Step-free entrance information is recently observed.
- The source is a community observation.
- The observation date is visible.
- Supporting observations and disputes are visible.
- Other features such as accessible toilet or quiet space are not assessed.

The visitor can therefore understand both what is known and what still needs confirmation.

### Step 3 — Inspect a temporary barrier

The place page shows a published incident:

```text
Ramp reported blocked
Severity: Major
Status: Published
```

The incident is displayed separately from the permanent ramp feature. This demonstrates that a feature can exist while its current use is affected by a temporary problem.

### Step 4 — Compare with a private profile

The visitor opens the profile page and sees example preferences such as:

- Step-free entrance — Required.
- Accessible toilet — Required.
- Quiet space — Preferred.

The visitor can change a preference and save it. In the browser preview, this is stored locally in the browser and is explicitly labelled as private sample data.

### Step 5 — Create a careful report

The visitor opens **Report an issue** and enters:

- Feature: Ramp available.
- Status: Temporarily unavailable.
- Observation date: the date of the visit.
- Details: “The ramp was blocked near the side entrance during my visit.”

The form validates required fields, prevents future dates, supports a local draft, and gives privacy guidance for evidence.

The current browser preview then says **Fixture preview ready**. It does not claim that the report was submitted or that a public claim changed. In a connected production flow, the server would validate, persist, moderate, and process the report before it affected public information.

---

## 7. Ready-to-speak five-minute script

### Opening — 30 seconds

> “AccessMap is a community-verified accessibility platform for public places. It helps people understand what to expect before visiting a building, facility, or transport stop. Instead of giving every place one accessibility score, AccessMap shows the individual features, sources, observation dates, temporary barriers, and unknown information that affect a real person’s decision.”

Point to the home page statements:

- “Know what to expect before you go.”
- “Specific, not simplistic.”
- “Freshness you can see.”

### Search — 45 seconds

> “I will start by searching for a community centre. The directory can be used as a readable list, and the visual map is optional. This is deliberate: the essential information should not depend on a map, location permission, or heavy map assets.”

Search for `community centre`, then point out:

- Sample Community Centre.
- Sample Street, Pilot District.
- Distance information.
- The accessibility feature filter.
- The distance sorting control.

### Evidence — 90 seconds

> “This place page does not use one green accessibility label. It explains each feature independently.”

Open **Step-free entrance** and point out:

- Recently observed.
- Community observation.
- Observation date.
- Supporting observations.
- Dispute count.

Then open **Accessible toilet** or **Quiet space** and say:

> “Unknown is deliberately different from unavailable. AccessMap does not turn missing information into a confirmed match or an automatic failure.”

### Barrier — 60 seconds

Point to **Current barrier** and say:

> “Permanent features and temporary incidents are kept separate. The place may have a ramp, but a current obstruction can still make that ramp unusable today.”

Point out the incident status, severity, start date, and review date. Then point to the pending community observation:

> “A new observation waits for review before it becomes public truth. This protects visitors from unverified changes while preserving the contribution for moderation.”

### Private profile — 60 seconds

Open **Compare with your profile** or **Edit private profile**.

> “A person can choose what matters to them without declaring a diagnosis. Required, preferred, and avoid settings make the search personal while keeping the profile private.”

Change one setting, save it, and point out:

```text
Saved privately in this browser.
```

Explain that the current preview uses supplied fixture data for the sample explanation and does not pretend that the local profile edit has recalculated a live server result.

### Reporting — 75 seconds

Open **Report an issue** and enter a specific dated report.

> “The form asks for one feature, one status, an observation date, and optional context. It encourages a small, useful observation instead of an exhausting survey.”

Point out the evidence privacy warning and submit the form for validation.

When **Fixture preview ready** appears, say:

> “This preview validates the report locally. It does not pretend that the report was sent to a server or that public information changed. In the connected application, the server would validate, moderate, process evidence, and then update the public claim if appropriate.”

### Closing — 20 seconds

> “AccessMap is designed to help someone make a better-informed visit decision, not to speak for every disabled person with one score. It makes evidence, freshness, uncertainty, temporary barriers, and personal needs visible in the same place.”

---

## 8. Technical architecture

The project is organized as a JavaScript monorepo with separate web, API, domain, contract, validation, event, and worker packages.

```text
User device
  │
  │ Browser, keyboard, screen reader, PWA/offline storage
  ▼
Next.js web application
  │ Search · list · place detail · profile · report
  │
  │ Typed API requests / Server-Sent Events
  ▼
Node.js API
  │ Auth · validation · authorization · domain operations
  ├──────────────► PostgreSQL / PostGIS
  │                Durable source of truth
  ├──────────────► Redis / Valkey
  │                Cache · queues · rate limits · locks · idempotency
  ├──────────────► Object storage
  │                Private originals and public derivatives
  ▼
Background workers
  ├ EvidenceGuard privacy processing
  ├ Claim recomputation
  ├ Route invalidation
  ├ Offline synchronization
  ├ Notifications
  └ Webhook delivery
  │
  ▼
Public place, route, incident, and civic change updates
```

### 8.1 PostgreSQL/PostGIS

PostgreSQL is the durable source of truth for places, observations, claims, incidents, access nodes, route edges, facility responses, moderation records, and audit events.

PostGIS supports:

- Radius searches.
- Bounding-box map searches.
- Distance sorting.
- Duplicate detection near an existing place.
- Geospatial incident and route relationships.

Redis is not treated as the source of truth. If Redis is unavailable, processing may be slower or queued work may be delayed, but a committed observation must not disappear.

### 8.2 Shared contracts and validation

The repository contains shared contract fixtures and validation packages. This allows the web application, API, workers, and tests to agree on the shape of:

- Places.
- Accessibility claims.
- Match profiles and explanations.
- Observations.
- Incidents.
- Routes.
- Evidence upload intents.
- Moderation items.
- Civic changes.

Validation is performed at boundaries so invalid coordinates, feature codes, dates, statuses, page sizes, and request payloads are rejected consistently.

### 8.3 Transactional outbox and workers

When a report is accepted, the API can write the durable observation and its outbox event in the same database transaction:

```text
API transaction
  ├── Observation record
  ├── Moderation record
  └── Outbox event
          │
          ▼
Outbox publisher
          │
          ▼
Redis stream / worker queue
          │
          ├── Claim recomputation
          ├── Cache invalidation
          ├── Route invalidation
          ├── Evidence processing
          ├── Notifications
          └── Civic/webhook delivery
```

This design prevents a common failure mode where the main record is saved but the downstream update is silently lost. Workers use retries, idempotency, and dead-letter handling.

### 8.4 EvidenceGuard

Uploaded evidence is treated as sensitive input. EvidenceGuard is designed to:

1. Validate the file signature and allowed media type.
2. Keep the original in private storage.
3. Remove EXIF and unnecessary metadata.
4. Create a safe derivative for possible public display.
5. Check for faces, documents, license plates, or sensitive text.
6. Suggest alt text.
7. Hold the evidence for moderation when necessary.

Evidence is optional. A person can report a barrier without uploading a photograph.

### 8.5 Barrier-aware routing

Routes are calculated from an access graph rather than treating a place as one point. The graph can contain entrances, lifts, accessible toilets, curb crossings, footpath segments, transport stops, rooms, and connecting edges.

Each route can consider:

- Stairs.
- Slope.
- Minimum path width.
- Surface type.
- Curb ramps.
- Active barriers.
- Unknown or stale segments.

The response explains why a route was selected and warns about uncertainty. A route is a recommendation based on available information, not a permanent guarantee.

---

## 9. Implemented project areas

According to the current release status, the repository contains implementation work in these areas:

### Web experience

- Next.js and React application shell.
- Accessible home page.
- Search and directory list.
- Optional visual preview.
- Place details page.
- Feature-level claim cards.
- Status badges.
- Private profile editor.
- Structured report form.
- Local draft support.
- Sample data transparency notices.
- Keyboard-oriented form error handling and accessible status messaging.

### Domain and contracts

- Deterministic Accessibility Match Profile engine.
- Barrier-aware local routing engine.
- Route constraints and explanations.
- Route cache versioning and selective invalidation.
- Shared contract fixtures.
- Shared validation and event definitions.

### API and operations

- Health, readiness, and metrics endpoints.
- Authentication and session helpers.
- Role and facility-scope authorization.
- Observation validation and synchronization paths.
- Incident lifecycle services.
- Server-Sent Event filtering for public updates.
- Evidence upload validation and serializers.
- Facility responses and QR contexts.
- Civic API serializers and pagination.
- Signed webhook delivery with retry and replay protection.

### Workers and infrastructure

- PostgreSQL outbox publisher.
- Retry policy and dead-letter handling.
- Evidence processing worker.
- Evidence cleanup.
- Webhook worker and HTTP delivery adapter.
- Docker service definitions for API, worker, and scheduler.
- Operational health probes and backup/restore scripts.

---

## 10. What is live in the browser preview versus the backend

This distinction should be explained honestly during a presentation.

### Browser preview currently demonstrates

- The home page and product language.
- Search using sample fixture data.
- Accessible list mode.
- Optional visual preview.
- A sample place detail page.
- Feature-level evidence and unknown states.
- A current barrier card.
- A pending observation card.
- Private profile editing in browser storage.
- Local report validation.
- Local report drafts.
- Privacy guidance for evidence.

### Browser preview intentionally does not claim

- That the sample place is real or verified.
- That a report was submitted to a server.
- That editing the local profile recalculated a live match through the API.
- That a local fixture changed a public claim.
- That a route is guaranteed to be accessible.

### Backend and domain implementation provides

- The API boundaries and health endpoints.
- Deterministic matching logic.
- Route and incident services.
- Observation and evidence boundaries.
- Facility and civic API services.
- Webhook security and retry logic.
- Worker and operational infrastructure.

This separation is a strength for the demonstration: the UI is transparent about sample data, while the repository also shows the engineering foundation for a connected system.

---

## 11. How to run the presentation demo

From the repository root:

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

The application uses the sample directory preview for the main browser walkthrough.

If the local API and infrastructure are configured, the API runs on:

```text
http://127.0.0.1:3001
```

Useful technical verification pages are:

```text
http://127.0.0.1:3001/health
http://127.0.0.1:3001/readyz
http://127.0.0.1:3001/metrics
http://127.0.0.1:3001/api/categories
```

For a clean demonstration:

1. Use a private/incognito browser window.
2. Open `http://localhost:3000`.
3. Search for `community centre`.
4. Open **Sample Community Centre**.
5. Show known and unknown features.
6. Show the current barrier and pending observation.
7. Open the private profile.
8. Return to the place and open the report flow.

The existing detailed walkthrough is available in [`docs/JUDGE_DEMO_GUIDE.md`](JUDGE_DEMO_GUIDE.md).

---

## 12. Questions a reviewer may ask

### “Why not use one accessibility score?”

Because accessibility is personal and multi-dimensional. A place may have a step-free entrance but no accessible toilet, or it may have both features but a broken lift today. One score hides those differences and can create false confidence.

### “How do you know the information is trustworthy?”

AccessMap shows the source, observation date, supporting observations, disputes, freshness, and moderation status. It supports community corroboration and facility responses without allowing either source to silently erase the other.

### “What happens when information is missing?”

Missing information is shown as unknown or not assessed. It is not treated as a positive match and is not automatically treated as proof that the feature is unavailable.

### “Can facilities remove negative community reports?”

No. Verified facility representatives can publish a separate official response or current update, but independent observations and their history remain distinguishable.

### “How is privacy handled?”

Access profiles are private by default and do not require a diagnosis. Evidence processing separates private originals from public derivatives, removes metadata, and can hold sensitive media for moderation.

### “What happens without internet access?”

The planned connected flow supports local report drafts and offline synchronization with client-generated idempotency keys. Retried submissions can be deduplicated so a poor connection does not create duplicate reports.

### “Is the route guaranteed to work?”

No. The route is a recommendation based on current observations, constraints, and incidents. The interface must show data freshness, uncertainty, affected segments, and active barriers.

### “What is the current limitation of the browser demo?”

The main browser walkthrough uses clearly labelled fixture data. The local profile and report interactions demonstrate product behavior but do not pretend that a live server claim was changed. The backend and worker layers provide the connected system foundation.

---

## 13. Verification status

The current release status records these checks as passed:

```text
npm test
npm run lint
npm run build
npm run check:health
bash scripts/check-operational-scripts.sh
```

The recorded test result is:

```text
94 passed, 4 skipped, 0 failed
```

The four skipped tests require external PostgreSQL/Valkey services. Before production use, the project still requires real environment values and deployment verification for database, authentication, evidence storage, routing providers, Docker services, and other external integrations.

---

## 14. Strong closing statement

Use this as the final sentence of the presentation:

> **“AccessMap does not try to speak for every disabled person with one universal score. It gives each visitor the specific, dated, source-labelled information they need to make a better-informed decision, while giving communities and facilities a safe way to improve that information over time.”**
