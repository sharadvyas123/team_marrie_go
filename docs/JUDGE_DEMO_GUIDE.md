# AccessMap: Judge Demo Guide

This is a short, browser-first walkthrough for showing AccessMap to judges,
reviewers, or visitors. It is designed to take about **five minutes** and to
make the product idea easy to understand without requiring a technical
explanation.

## What this demo shows

AccessMap helps someone decide whether a public place may meet their personal
access needs. It does not reduce accessibility to one universal score. Instead,
it shows:

- the specific feature being described;
- where the information came from;
- when it was observed;
- current barriers or incidents;
- what is still unknown; and
- a private profile for the visitor's own priorities.

The browser demo uses clearly labelled **sample data**. It is a product preview,
not a claim that the sample place has been verified in the real world.

## Before the demo

### 1. Start the local application

The API and local infrastructure should already be running. From the project
root, confirm the services are up:

```bash
docker compose -f infra/docker-compose.yml ps
```

The API should be available at `http://127.0.0.1:3001` and the web app at
`http://localhost:3000`.

If the web app is not running, open a second terminal in the project root and
run:

```bash
npm run dev
```

Keep that terminal open during the presentation. Open this URL in the browser:

```text
http://localhost:3000
```

### 2. Start with a clean browser session

Use a private/incognito window if possible. This prevents an earlier demo's
profile or saved report draft from appearing.

If you are reusing the same browser, the profile page has **Reset sample** and
**Clear all** buttons. Avoid saving a report draft unless you want to show that
feature.

## The five-minute presentation

### Opening: explain the problem — 30 seconds

Start on the home page and say:

> “AccessMap is for people who need to know what to expect before visiting a
> public place. Instead of giving every place one accessibility score, it shows
> the individual access details, dates, sources, barriers, and unknowns that
> affect a real decision.”

Point out the two ideas visible on the home page:

- **“Know what to expect before you go.”** — the user outcome.
- **“Specific, not simplistic”** and **“Freshness you can see.”** — the trust
  model behind the product.

Do not spend long on the decorative map illustration. The useful demo starts
with the directory.

### Step 1: search for a place — 45 seconds

1. Click **Explore accessible places**.
2. In the search box, type:

   ```text
   community centre
   ```

3. Click **Search** if needed.
4. Point out that the result is:

   ```text
   Sample Community Centre
   Sample Street, Pilot District
   420 m away
   ```

5. Briefly demonstrate the controls:
   - **Filter → Step-free entrance observed**;
   - **Sort → Distance**;
   - **Visual preview** to show the optional map-style view.

Say:

> “The list is the source of truth. The visual preview is optional; the product
> does not force someone to share their location or depend on a map to make the
> information understandable.”

Click **View place details** on the sample place card.

### Step 2: show evidence instead of a misleading score — 90 seconds

On the place page, first point out the **Sample data mode** notice. This is a
good moment to be transparent:

> “This walkthrough uses a contract fixture, so I am showing the product
> behavior without presenting synthetic data as a real-world accessibility
> verification.”

In **What is known about access**, open the **Step-free entrance** item. Show:

- **Recently observed**;
- **Community observation**;
- the observation date;
- **2 supporting observations**;
- **0 disputes**.

Say:

> “This is more useful than a green label. A visitor can see exactly what was
> observed, by whom, and how much supporting information exists.”

Now open one of the **Not assessed** items, such as **Accessible toilet** or
**Quiet space**. Say:

> “Unknown is deliberately different from unavailable. AccessMap does not turn
> missing information into either a confirmed match or an automatic failure.”

This is the most important product principle to demonstrate.

### Step 3: show a changing barrier and a pending report — 60 seconds

Scroll to **Current barrier**. Point out:

- **Ramp reported blocked**;
- **Published**;
- **Major** severity;
- the start date; and
- the review-by date.

Say:

> “Permanent feature information and temporary incidents are kept separate. A
> ramp may exist as a feature, while a current delivery trolley or construction
> issue temporarily makes that route unusable.”

Then point to **Community activity** and the **Pending review** observation:

> “A new observation is not immediately promoted into public truth. It waits for
> review, which protects visitors from unverified changes.”

### Step 4: demonstrate a private access profile — 60 seconds

1. Click **Compare with your profile** or **Edit private profile**.
2. Show the three sample preferences:
   - **Step-free entrance → Required**;
   - **Accessible toilet → Required**;
   - **Quiet space → Preferred**.
3. Change one visible selection, for example change **Accessible toilet** from
   **Required** to **Preferred**.
4. Click **Save profile**.
5. Point out the confirmation:

   ```text
   Saved privately in this browser.
   ```

Say:

> “The profile is a private decision-making tool, not a diagnosis and not a
> public identity. It stays in this browser in the preview.”

Point out that the sample explanation remains honest about its source. The
preview explicitly says it comes from supplied fixture data and is not
recalculated by the unfinished live match API in this browser demo.

### Step 5: demonstrate a careful report — 75 seconds

1. Return to the place page and click **Report an issue**.
2. Choose:

   ```text
   Feature or area: Ramp available
   Status: Temporarily unavailable
   When: 2026-10-15
   ```

   Any valid past date is acceptable; do not choose a future date.

3. In the details box, type something specific, such as:

   ```text
   The ramp was blocked near the side entrance during my visit.
   ```

4. Click **Review report**.
5. Show the **Fixture preview ready** message.

Say:

> “The form asks for one specific feature, a status, a date, and optional
> context. It also warns people not to include private information in evidence.”

Then make the boundary explicit:

> “This browser preview validates the report locally. It tells us that the
> report is ready, but it does not pretend that it was submitted or changed a
> public claim. In the connected application, the server would review and
> process it before it affects public information.”

This honest boundary is part of the demo, not a failure state.

## Closing statement — 20 seconds

Finish with:

> “AccessMap is designed to help someone make a better-informed visit decision,
> not to speak for every disabled person with one score. The product makes
> evidence, freshness, uncertainty, temporary barriers, and personal needs
> visible in the same place.”

If there is time, return to the place page and leave the judge on the **Current
barrier** and **What is known about access** sections. Those sections communicate
the product idea most clearly.

## Optional technical proof for technical judges

If a judge wants to see that the local backend is also running, open these URLs
in a second browser tab:

```text
http://127.0.0.1:3001/health
http://127.0.0.1:3001/readyz
http://127.0.0.1:3001/metrics
http://127.0.0.1:3001/api/categories
```

Expected results:

- `/health` returns HTTP 200 and reports the process and database as healthy.
- `/readyz` returns HTTP 200 and reports the database and cache as healthy.
- `/metrics` returns Prometheus-style operational metrics without secrets.
- `/api/categories` returns the seeded sample categories.

If the judge is interested in the infrastructure, show the compact service
status rather than large logs:

```bash
docker compose -f infra/docker-compose.yml ps
```

## Important wording to use

Use **sample**, **fixture**, **observed**, **pending review**, **unknown**, and
**needs more information**.

Avoid saying:

- “This place is fully accessible.”
- “The green status guarantees access.”
- “The report has been submitted” while using the browser fixture flow.
- “The sample place is real or verified.”

The demo is strongest when it shows that AccessMap is careful about what it
knows and what it does not know.

## Quick reset after the presentation

For another clean run:

1. Open a new private/incognito window; or
2. On **My access profile**, click **Reset sample**; and
3. Do not save a report draft unless you want to demonstrate local drafts.

The Docker services can remain running between demos. Stop them after the event
with:

```bash
docker compose -f infra/docker-compose.yml down
```
