# Dev — Web Product, Accessibility UX, PWA, and Frontend Delivery Plan

## Mission

Own and deliver the complete user-facing AccessMap experience. By the end of this task plan, a person must be able to use the real application—not a collection of placeholder screens—to:

- Search public places in map and accessible list views.
- Create and use an Accessibility Match Profile.
- Understand confirmed requirements, known barriers, unknowns, stale data, and conflicts.
- View facility details and evidence.
- Plan a barrier-aware route and understand its uncertainty.
- Receive relevant live incident updates.
- Report barriers online or offline.
- Upload evidence safely.
- Confirm or dispute observations.
- Use facility, moderator, and civic-facing workflows through their browser interfaces where applicable.

The frontend must be accessible, mobile-first, resilient on slow networks, and integrated with Sharad’s real APIs and worker-driven status updates.

## Read before starting

Read these documents in order:

1. [`README.md`](../../README.md)
2. [`docs/PRODUCT_PLAN.md`](../PRODUCT_PLAN.md)
3. [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md)
4. [`docs/IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md)
5. [`docs/tasks/sharad.md`](sharad.md)
6. [`docs/tasks/Dhariya.md`](Dhariya.md) when working with `S-008`, `S-009`,
   or `S-010` backend services.

The product rule that must shape every screen is:

> Unknown accessibility information must never be shown as a confirmed match or silently converted into a failure.

## Ownership boundary

### Dev owns

```text
apps/web/**
packages/ui/**
apps/web/e2e/**
apps/web/public/**
frontend fixture adapters and browser test utilities
```

You own route pages, React components, browser state, service workers, IndexedDB, map/list interaction, accessibility behavior, and browser tests.

### Sharad owns the remaining backend scope

```text
apps/api/** except the Dev2- and Dhariya-owned paths in their task plans
workers/** except workers/evidence/** assigned to Dhariya
packages/domain/** except packages/domain/src/matching/** for Dev2 and
packages/domain/src/routing/** for Dhariya
packages/contracts/**
packages/events/**
packages/validation/**
infra/**
.github/workflows/**
```

Dev2 owns `S-004` and `S-005`; Dhariya owns `S-008`, `S-009`, and `S-010`.
Read [`docs/tasks/Dhariya.md`](Dhariya.md) before depending on those backend
services. Dev must not edit any backend implementation path to unblock a
screen; request a contract or API change through the owning backend plan.

Do not edit backend, migration, worker, event, or root infrastructure files to unblock a screen. Use the contract fixtures or request an API change.

### Shared files

The following require agreement before modification:

```text
README.md
docs/PRODUCT_PLAN.md
docs/ARCHITECTURE.md
docs/IMPLEMENTATION_PLAN.md
```

### API contract rule

Import generated types from `packages/contracts/`. Do not duplicate API interfaces in `apps/web`.

If a response is missing a field:

1. Add a local fixture only for visual development.
2. Record the missing field in the handoff.
3. Ask Sharad for a contract change.
4. Do not silently infer a positive accessibility status in the browser.

## Low-conflict working agreement

### Branches and worktrees

Use:

```text
feature/dev/<ticket-id>-short-name
```

Keep your branch/worktree separate from Sharad’s. Do not use a shared dirty working directory.

### Commit rules

- One logical ticket per commit or small commit series.
- Use conventional commits: `feat:`, `fix:`, `test:`, `chore:`, `docs:`, `refactor:`.
- Include the ticket ID in the body, for example `Refs: D-003`.
- Do not mix design-system, route-planning, and offline-sync changes in one unrelated commit.
- Push early, open focused pull requests, and link screenshots or screen recordings when useful.

### Mock-first, contract-later workflow

You can work in parallel with Sharad using fixtures generated from the shared contract:

1. Build the screen against a typed fixture.
2. Add loading, empty, error, stale, conflict, and unknown states.
3. Connect the real API after Sharad publishes the endpoint.
4. Run the same browser tests against fixtures and staging.
5. Remove only the fixture dependency from production code; keep fixtures for tests.

### No shared implementation files

- Do not implement server business logic in Next.js client components.
- Do not duplicate match or trust rules in the browser; render the server’s explanation.
- Keep UI components in `packages/ui` and feature orchestration in `apps/web/features`.
- Keep API calls in typed client modules, not scattered through components.
- Do not change server response shapes locally.

## Definition of frontend complete

Dev’s work is complete only when:

- The core flows work against Sharad’s real local/staging APIs.
- Every critical state has an accessible UI.
- The map is optional; the list and text details are fully usable.
- Match results explain required, preferred, avoid, confirmed, barrier, and unknown states.
- Offline reports are recoverable and clearly labeled until server confirmation.
- Live updates are announced accessibly and do not unexpectedly move users.
- Facility and moderator workflows have role-aware screens.
- Responsive, keyboard, screen-reader, reduced-motion, zoom, and slow-network checks pass.
- Browser tests cover the final user journeys.

---

# Ticket board

Move every ticket through:

```text
NOT STARTED → IN PROGRESS → REVIEW → INTEGRATED → VERIFIED
```

Use fixture mode while an API is unavailable, but do not mark a ticket `VERIFIED` until it passes against the real API where the ticket requires backend integration.

| ID | Ticket | Depends on | Parallel with | Delivery gate |
| --- | --- | --- | --- | --- |
| D-001 | Web shell, design system, and accessibility foundation | S-001 contract package | S-002, S-003 | All pages have stable layout, focus, and responsive primitives. |
| D-002 | Search, map/list, and place details | D-001, S-004 contract | S-002, S-003 | User can discover a real place without map dependence. |
| D-003 | Accessibility Match Profile and explanation UI | D-001, S-005 contract | S-006 | User can compare places against private requirements. |
| D-004 | Auth, account, saved state, and notifications | D-001, S-003 | D-002, D-003 | Protected browser flows have correct session and privacy behavior. |
| D-005 | Report form, offline sync, and evidence UI | D-001, D-004, S-006/S-008 contract | D-003 | User can submit online/offline without duplicate or false success. |
| D-006 | Verification, moderation, and trust timeline UI | D-001, D-004, S-006 | D-005 | Contributor and moderator status changes are understandable. |
| D-007 | Live incidents and barrier-aware route experience | D-002, D-003, S-009 contract | D-006 | Route warnings, SSE updates, and recalculation work accessibly. |
| D-008 | Facility dashboard, QR reporting, and civic developer views | D-004, D-006, S-010 | D-007 | Facility operators can respond without deleting community history. |
| D-009 | Complete accessibility, resilience, and responsive QA | D-001–D-008 | S-011 | Critical tasks pass keyboard, screen reader, zoom, mobile, and slow network checks. |
| D-010 | Final end-to-end product integration and release demo | D-002–D-009, S-012 | S-012 | Entire product works with real services and seeded data. |

---

## D-001 — Web shell, design system, and accessibility foundation

### Objective

Create the stable frontend base so later features can be implemented without repeatedly changing layout, form, status, or accessibility behavior.

### Files owned

```text
apps/web/app/**
apps/web/components/**
apps/web/lib/client/**
apps/web/styles/**
packages/ui/**
apps/web/public/**
```

### Deliverables

- Next.js app shell and route layout.
- Responsive mobile-first layout.
- Skip link and landmark structure.
- Typography, spacing, color, border, focus, and motion tokens.
- Accessible Button, Link, Input, Select, Checkbox, Radio, Dialog, Drawer, Tabs, Alert, Badge, Card, Table, Pagination, Skeleton, and Toast components.
- Form field and error-summary pattern.
- Status component that uses text and icons, never color alone.
- Live-region utilities for asynchronous updates.
- Reduced-motion behavior.
- Loading, empty, error, stale, unknown, conflict, and unauthorized state components.
- API client boundary with fixture mode.
- Service-worker registration shell without feature-specific caching yet.

### Acceptance criteria

- Every interactive control is keyboard reachable.
- Focus is visible and not lost after dialogs, route changes, or validation errors.
- Components have accessible names, labels, descriptions, and error associations.
- Text remains usable at 200% zoom.
- Forced colors/high contrast do not hide status.
- Reduced motion disables nonessential animation.
- The app renders a useful shell on a narrow mobile viewport.
- Fixture mode can render every shared state without hard-coded production-only assumptions.

### Suggested commit

```text
feat: establish accessible web shell and UI foundation
```

## D-002 — Search, map/list, and place details

### Objective

Deliver the public directory experience against fixtures first and Sharad’s real place APIs as soon as available.

### Screens

- Home/search page.
- Search results page.
- Accessible result list.
- Optional map view.
- Place detail page.
- Category browse.
- Location permission denied state.
- No results and service error states.

### Required behavior

- Search by text, category, city, and current location when permission is granted.
- Search manually without location permission.
- Use map and list views independently.
- Keep the list usable before map tiles load.
- Show distance, category, freshness, active incidents, and match summary placeholder/data.
- Support pagination or bounded loading.
- Preserve search state when navigating back.
- Deep-link directly to a place page.
- Render unknown accessibility information explicitly.

### Acceptance criteria

- A keyboard-only user can search, move through results, and open a place.
- A screen-reader user can use the list without the map.
- Map pins and result cards stay synchronized without making the map the source of truth.
- Loading, no-results, invalid-location, and API-error states have recovery actions.
- Place details show feature claims, source labels, observation dates, active incidents, and reporting actions.
- The browser never invents an accessibility status when a field is absent.
- Browser tests pass in fixture mode and real staging mode.

## D-003 — Accessibility Match Profile and explanation UI

### Objective

Make the first suggested feature a visible, compelling product experience: a person can describe what they require, prefer, or want to avoid and understand how a place matches.

### Profile flow

1. Explain that the profile is optional and private.
2. Let the user select plain-language features.
3. Let the user set each selected feature to `required`, `preferred`, or `avoid`.
4. Allow the user to skip, save, edit, clear, or reset the profile.
5. Explain that the profile is not a diagnosis or public identity label.

### Match result UI

Show a result such as:

```text
Accessibility match: needs more information
2 of 3 required features confirmed
1 required feature unknown
1 preferred feature confirmed
No known barrier for your selected requirements
```

Each feature must be expandable to show:

- Requirement level.
- Match result.
- Claim status.
- Source type.
- Observation date.
- Why the result is confirmed, blocked, or unknown.
- Action to report or update the information.

### Rules

- Unknown required features are never counted as confirmed.
- Stale or conflicting claims are shown as unknown/needs information.
- Known barriers are not hidden by a positive older observation.
- Preferred unknown features do not block a place.
- Avoid warnings are visible and understandable.
- Do not show a universal accessibility percentage.

### Acceptance criteria

- User can build a profile without providing a diagnosis.
- Profile remains private in UI, URLs, analytics, and browser storage unless explicitly required for the local experience.
- Result cards show confirmed, blocked, preferred, and unknown counts.
- Required unknown produces “needs more information”, not “meets requirements”.
- Explanation drawer/panel identifies the underlying claim and date.
- Profile can be edited without losing unrelated search state.
- Anonymous one-request comparison works if Sharad exposes it.
- Unit/component/browser tests cover all decision states.

## D-004 — Auth, account, saved state, and notifications

### Objective

Make private and authenticated browser interactions reliable without exposing sensitive data.

### Deliverables

- Sign-in/sign-out and session-expiry screens.
- Authenticated profile settings.
- Private Accessibility Match Profile persistence.
- My observations/contributions page.
- Saved places or saved searches if included in the agreed contract.
- Notification inbox or notification banners.
- Unauthorized and forbidden states.
- Account deletion/correction request entry points.

### Acceptance criteria

- Public discovery works without an account.
- Protected actions redirect to sign-in and return to the intended page.
- Session expiry is handled without losing form data.
- Private profile data is not rendered in public metadata or URLs.
- A suspended or unauthorized user sees a clear explanation and recovery path.
- Browser tests cover login, logout, session expiry, and permission boundaries.

## D-005 — Report form, offline sync, and evidence UI

### Objective

Let a person report a barrier or confirm a feature quickly, including in locations with poor connectivity, while making client state honest and recoverable.

### Online report flow

1. Open a place, access node, QR context, or nearby place selector.
2. Select a feature or barrier type.
3. Select status: available, unavailable, partial, temporary, incorrect, or unknown where applicable.
4. Add observation date, details, and optional measurement.
5. Add optional evidence with privacy guidance.
6. Review public visibility.
7. Submit and wait for server confirmation.

### Offline behavior

Use a service worker and IndexedDB outbox:

```text
Draft locally → Saved on device → Syncing → Server confirmed
                                  └──────→ Retry/failed
```

Every local submission receives a client-generated idempotency key. The user must be able to inspect, retry, edit, or remove a local draft.

Do not show `community reported` until the server confirms persistence.

### Evidence UI

- Explain that evidence is optional.
- Warn not to photograph people, documents, addresses, or private information.
- Show upload progress and processing state.
- Allow the observation to finish without a photo.
- Explain when a photo is waiting for privacy review.
- Render alt text or a pending-description state.

### Acceptance criteria

- A valid online report persists and appears in contribution history.
- Invalid forms preserve entered information and identify fields clearly.
- A report can be saved without network access.
- Reconnect/retry submits one observation, not duplicates.
- The UI distinguishes local, syncing, confirmed, failed, rejected, and changes-requested states.
- Upload failure does not lose the text observation.
- Public image display waits for evidence processing approval.
- The report flow is usable with keyboard, screen reader, and touch.

## D-006 — Verification, moderation, and trust timeline UI

### Objective

Make the community trust system visible and actionable for contributors and moderators.

### Public/contributor screens

- Observation history.
- Confirm/dispute/mark outdated controls.
- Claim source and freshness explanation.
- Timeline: reported, under review, approved, confirmed, disputed, resolved.
- Conflict warning.
- Evidence review state.

### Moderator screens

- Moderation queue with filters.
- Observation review page.
- Evidence review page.
- Related observations and claim history.
- Approve/reject/request changes/escalate actions.
- Duplicate place merge entry point.
- Facility claim review.
- Audit action confirmation.

### UX rules

- Do not hide a conflict because it is inconvenient.
- Separate community observations from facility responses.
- Explain moderator outcomes in plain language.
- Never expose moderator notes to public users.
- Confirm destructive or privacy-affecting actions.
- Make queue priority and status visible.

### Acceptance criteria

- A contributor can confirm or dispute another observation.
- The UI shows the resulting status after the API returns.
- A moderator can review evidence and change moderation state.
- Moderator actions require confirmation and show success/failure.
- A conflict page shows relevant dates and sources.
- Public and moderator data are visibly separated.
- Browser tests cover approval, rejection, dispute, and changes-requested flows.

## D-007 — Live incidents and barrier-aware route experience

### Objective

Turn current accessibility information into a journey-planning experience without making unsupported promises.

### Route screens

- Origin and destination selection.
- Route constraint/profile selection.
- Route alternatives.
- Text/list route explanation.
- Optional map geometry.
- Segment details.
- Active barrier warning.
- Stale/unknown segment warning.
- Recalculate action.

### Route result content

Show:

- Distance and estimated time.
- Constraints satisfied.
- Known stairs, slopes, surfaces, width, curb, lift, or transport issues.
- Unknown and stale segments.
- Active incident source and observation time.
- Calculation time and data freshness.
- Why this route was recommended.

### Live updates

Subscribe to the relevant place or bounded route area using the SSE endpoint. When an incident changes:

1. Announce the update in a live region.
2. Explain what changed.
3. Mark the current route as affected/stale.
4. Offer `Review incident`, `Recalculate`, and `Keep current route`.
5. Preserve the user’s selected constraints.

Do not automatically move the user or replace their route without explicit choice.

### Acceptance criteria

- A no-stairs route does not present a known-stairs-only path as suitable.
- Route explanations work in list mode without the map.
- Unknown segments are not rendered as confirmed accessible.
- Live incidents update the page without a full refresh.
- Screen readers receive a concise update announcement.
- Recalculation keeps the selected profile and destination.
- Route errors and routing-provider timeouts have recovery states.
- Browser tests cover route selection, incident update, and recalculation.

## D-008 — Facility dashboard, QR reporting, and civic developer views

### Objective

Provide usable browser interfaces for verified facility operators and public API consumers while preserving community independence.

### Facility screens

- Facility claim request.
- Facility list and status summary.
- Community observation history.
- Official response form.
- Active incident acknowledgement.
- Repair/resolution update.
- Resolution timeline and repeated-barrier view.
- QR-code creation/context preview.

### QR reporting

- Display the QR target context clearly.
- Preselect facility/feature/access node.
- Let anonymous visitors report when permitted.
- Prevent QR payload tampering from selecting unauthorized private data.

### Civic/developer views

If included in the product release, add:

- API key creation/revocation for authorized owners.
- Webhook subscription event selection.
- Delivery history and failure status.
- Public API documentation page with examples.
- Clear statement of rate limits and data freshness.

### Acceptance criteria

- Unverified facility users cannot publish official responses.
- A verified manager sees only their approved facilities.
- Community reports cannot be deleted from the facility interface.
- Facility responses show source and date.
- QR links open the correct report context.
- Webhook/API keys are never displayed after creation in full.
- API documentation examples match the real contract.

## D-009 — Complete accessibility, resilience, and responsive QA

### Objective

Prove the product works for the people it is intended to serve, across real browsers, devices, assistive technologies, and failure conditions.

### Manual accessibility matrix

- Keyboard-only desktop navigation.
- Screen reader with headings, landmarks, forms, dialogs, live updates, and tables.
- 200% zoom and text resize.
- High contrast/forced colors.
- Reduced motion.
- Touch and small-screen interaction.
- Voice control where available.
- Map-free list operation.
- Error recovery without data loss.

### Resilience matrix

- Slow network.
- Offline report creation.
- Network loss during upload.
- Session expiry during report.
- API 4xx and 5xx errors.
- Redis degraded/fallback behavior as visible to the client.
- Worker-pending states.
- SSE disconnect/reconnect.
- Routing-provider timeout.
- Evidence privacy review delay.

### Performance work

- Render text results before map tiles.
- Lazy-load maps and heavy evidence.
- Paginate or virtualize long lists.
- Avoid unnecessary profile or location payloads.
- Test route and match result loading states.
- Confirm no layout shift makes controls move during keyboard use.

### Acceptance criteria

- Critical journeys pass keyboard and screen-reader tests.
- No critical WCAG violation remains open.
- Mobile layouts work at supported widths.
- Form errors preserve user input.
- Offline state is understandable.
- Live updates are not noisy or inaccessible.
- Performance checks meet the project targets in staging.
- All critical browser tests pass against real services.

## D-010 — Final end-to-end product integration and release demo

### Objective

Run and polish the entire product as one believable, production-ready experience.

### Final demonstration journey

1. User searches for public facilities.
2. User creates an Accessibility Match Profile.
3. User marks step-free entrance and accessible toilet as required, lift as preferred, and stairs as avoid.
4. Search results explain which facilities meet known requirements, have barriers, or need information.
5. User opens a facility and reviews feature-level claims and dates.
6. User requests a barrier-aware route.
7. A live incident affects a route segment.
8. User chooses whether to recalculate.
9. User reports a blocked ramp online or offline.
10. Evidence enters privacy processing.
11. Another contributor confirms the report.
12. A moderator reviews the evidence.
13. Facility manager publishes a response or resolution.
14. The facility page, match result, route warning, and public change feed update.

### Final acceptance criteria

- No final screen relies on placeholder content.
- Fixture mode remains available for tests but is not used in production.
- All required API calls use generated contracts.
- Loading, empty, unknown, stale, conflict, unauthorized, and failure states are implemented.
- Match results do not expose private profile data.
- The route experience does not claim universal accessibility.
- Offline reports are never falsely shown as server-confirmed.
- The full journey works on a mobile browser and desktop keyboard.
- Release demo data is clearly marked as sample data unless actually verified.

### Suggested commit

```text
feat: complete AccessMap user journeys and release experience
```

---

# Dev daily operating checklist

Before coding:

- [ ] Read the ticket and dependency status.
- [ ] Confirm the contract version and fixture shape.
- [ ] Confirm no Sharad-owned file needs modification.
- [ ] Create a ticket branch/worktree.
- [ ] Identify keyboard, screen-reader, mobile, and failure states before implementation.

During coding:

- [ ] Use semantic HTML and existing UI primitives.
- [ ] Keep map functionality optional.
- [ ] Render source/date/status for accessibility claims.
- [ ] Never infer positive accessibility from missing data.
- [ ] Keep API calls in typed client modules.
- [ ] Add loading, empty, error, stale, unknown, conflict, and unauthorized states.
- [ ] Add browser/component tests with the feature.
- [ ] Test reduced motion and keyboard focus for interactive changes.

Before push:

- [ ] Run the smallest ticket tests.
- [ ] Run lint and typecheck.
- [ ] Run accessibility automation for changed screens.
- [ ] Test at mobile width and keyboard-only desktop.
- [ ] Test fixture mode and real API mode when available.
- [ ] Add screenshots or a short recording for UI changes.
- [ ] Write a handoff with contract assumptions and any backend request.

## Dev-to-Sharad handoff template

````markdown
### Ticket
D-___

### Delivered
- ...

### API/event contract used
- ...

### Fixture behavior
- ...

### Real API verification
- Command or environment:
- Result:

### Accessibility checks
- Keyboard:
- Screen reader:
- Mobile/zoom:

### Backend request or gap
- ...
````
