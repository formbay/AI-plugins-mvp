---
name: pylon-scraper
description: >-
  Read project data from the Pylon web app (app.getpylon.com) via the Claude in
  Chrome browser tools, AND push a Pylon project into the Formbay job queue — or
  look up existing Formbay jobs — via the fb-job-push MCP server. Use whenever
  the user wants to find, list, or extract data from Pylon projects/proposals —
  especially project ADDRESS and NUMBER OF STCs, plus system size, price, and
  panel model. ALSO use it to turn a Pylon project into a Formbay installation
  job ("push this to Formbay", "create a Formbay job"), OR to get info on jobs
  already in the Formbay portal ("list Formbay jobs", "look up job 1140167",
  "is there a job for this address"). Triggers: "Pylon", "getpylon", "STCs for
  this project", "push to Formbay", "formbay job", "list jobs", "get job", or
  any app.getpylon.com URL. The browser is already logged in for Pylon; this
  skill reads the rendered DOM (no public JSON API). Reading Pylon and
  listing/getting jobs are read-only; pushing a job is a WRITE action, always
  confirmed with the user first.
---

# Pylon Scraper

How to read the Pylon solar-proposal web app (`app.getpylon.com`) and pull out
project data — primarily **project address** and **number of STCs** — and,
optionally, **push a project into the Formbay job queue** as an installation
job, or **look up jobs already in the Formbay portal**, via the
`fb-job-push` MCP server (see section 8).

## 0. Key facts about this app

- Pylon is a **Vue single-page app**. Data is hydrated client-side; there is
  **no clean public REST/JSON API** to hit. Network requests are only
  analytics (Google, Datadog, Segment, Algolia). **Scrape the rendered DOM** —
  do not look for an `/api/` endpoint.
- The browser session is **already logged in**. Just navigate.
- Because it is a SPA, prefer `navigate` to a known URL, then
  `get_page_text` once the route has rendered. If text looks empty/stale,
  wait ~1s and re-read.

## 1. Where the projects live

| Page | URL | What you get |
|------|-----|--------------|
| Home | `https://app.getpylon.com/app` | "Recent projects" widget + a **View all** link (`/library`) |
| Library (project list) | `https://app.getpylon.com/library` | The full table of projects |
| Project detail | `https://app.getpylon.com/library/{projectId}/view/{viewId}` | Full proposal: pricing, STCs, customer details, stats |

**Always start at `/library`** — that is the canonical project list. The home
page only shows a few recent ones.

### Library list columns
The `/library` table shows, per project row: **Project** (address + customer
name/contact/email + price + system size, e.g. `1.85kW Canadian`), **Signed
at**, **Updated at**, **Created at**. A count like `1–1` shows the page range.

### Library filters (left sidebar)
`Active`, `Archived`, `Sold` — each with `Standard` / `Pro` sub-filters — plus
`Signature requests` (`All` / `Pending` / `Signed`). The default view is
`Active / All`. **To scrape everything, visit each filter**, because the
default view hides Archived and Sold projects.

## 2. How to traverse projects

1. Navigate to `https://app.getpylon.com/library`.
2. Collect every project link. Each project row is an anchor whose `href`
   matches `/library/{projectId}/view/{viewId}`. Use the `find` tool
   ("project row link") or the JS snippet in section 4 to harvest all hrefs.
3. The **address is the link text** of each row (cleanest source of the
   address — already formatted as `Street, Suburb State Postcode`).
4. For each project, navigate to its detail URL to read STCs and everything
   else.
5. If the row-count footer (e.g. `1–1`, `1–25`) indicates more pages, page
   through (scroll / pagination control) and repeat.

## 3. Where the target fields are

### Address
- **Best source:** the `/library` row link text, e.g.
  `3 Kenna Place, Cromer New South Wales 2099`.
- On the **detail page** the address is split across customer-detail form
  inputs (Street and Number / City, suburb or town / Postcode / State) and is
  harder to read cleanly — prefer the list row text.

### Number of STCs
- Only on the **detail page**, not in the list.
- Appears as **`STCs × N`** in two places: the *Pricing* line-item block
  (sometimes with a year, e.g. `STCs × 12 (2026)`) and the *QUOTE* summary box.
- `N` is the STC count. Extract with regex: `/STCs?\s*[×x*]\s*(\d+)/i`.
- The STC count depends on the selected **Installation period** (year buttons
  on the detail page) — the page note says "The period of installation
  determines how many STCs this project is eligible for." Read whichever
  period is currently selected.

### Other useful fields on the detail page
System size (DC), battery size, annual production, self-consumption, annual
bill, payback/ROI/NPV/IRR (PROJECT STATS box); subtotal, GST, STC rebate
value, total (QUOTE box); panel model (e.g. `Canadian Solar HiKu CS3L-370MS`).

## 4. Ready-to-run extraction snippets (javascript_tool)

**Harvest all project links + addresses from `/library`:**
```js
[...document.querySelectorAll('a[href*="/view/"]')]
  .filter(a => /\/library\/[^/]+\/view\//.test(a.getAttribute('href')))
  .map(a => ({
    address: a.innerText.trim().split('\n')[0],
    href: a.getAttribute('href')
  }));
```

**On a project detail page, pull address + STC count:**
```js
(() => {
  const t = document.body.innerText;
  const stc = (t.match(/STCs?\s*[×x*]\s*(\d+)/i) || [])[1] || null;
  const size = t.match(/System size \(DC\)\s*([\d.]+\s*kW)/i);
  return {
    url: location.href,
    stcs: stc ? Number(stc) : null,
    systemSize: size ? size[1] : null,
    title: document.title // detail title is the street, e.g. "3 Kenna Place - Pylon"
  };
})();
```

## 5. Recommended workflow for "extract address + STCs for all projects"

1. `navigate` to `/library` (loop the Active/Archived/Sold filters if a full
   sweep is needed).
2. Run the harvest snippet (section 4) to get `[{address, href}]` for every
   project.
3. For each `href`: `navigate` to `https://app.getpylon.com` + href, then run
   the detail snippet to read `stcs`.
4. Assemble `{address, stcs, systemSize, href}` rows. Present as a table /
   save to CSV or xlsx if asked.

## 6. Notes & gotchas

- One project may legitimately show the same `STCs × N` twice (Pricing + Quote)
  — dedupe; it is one value.
- Changing the Installation-period buttons changes `N`. Don't click them unless
  asked — just read the current value.
- **Reading Pylon is read-only.** Do not edit designs, change customer data,
  or click Share / Proposal / Send controls in Pylon. The one write action this
  skill performs is **pushing a job to Formbay** (`push_job`, section 8), which
  always shows the exact payload and waits for explicit confirmation first.
  Looking jobs up (`list_jobs` / `get_job` / `whoami`) is read-only and safe.
- Stay on `app.getpylon.com`; do not follow off-domain links.

## 7. Worked example (verified 2026-06-16)

Library had one Active project:

| Address | STCs | System size |
|---------|------|-------------|
| 3 Kenna Place, Cromer New South Wales 2099 | 12 | 1.85 kW |

## 8. Formbay jobs — push & look up (`fb-job-push` MCP server)

Use the **`fb-job-push`** MCP server for two things:

- **Looking up jobs** already in the Formbay portal — "list Formbay jobs", "get
  job 1140167", "is there already a job for this address", "who am I logged in
  as". These are **read-only** and need no confirmation.
- **Pushing a Pylon project into the Formbay queue** as a new installation job —
  "push this to Formbay", "send this to the installer queue", "create a Formbay
  job". This is a **WRITE** action — read the project from Pylon (sections 1–4),
  map its fields onto the structured job, **confirm the exact payload with the
  user**, then create it.

### Tools
| Tool | Type | Params | Use |
|------|------|--------|-----|
| `list_jobs` | read | none | List every job in the Formbay portal DB. Use as a duplicate guard before pushing (check for the same site address). |
| `get_job` | read | `form_id` (integer, e.g. `1140167`) | Fetch one job by its **`form_id`** — e.g. to read back a job you just pushed. NB: the key is `form_id`, not `id`. |
| `push_job` | **WRITE** | structured fields below | Create a new installation job in the **live** Formbay portal. The caller identity comes from the OAuth token. Returns the created job (including its `form_id`). |
| `whoami` | read | none | Confirm which Formbay account the OAuth token is authenticated as. |

### `push_job` fields
**Required:**

| Field | Type | Source in Pylon / how to set |
|---|---|---|
| `street` | string | Street part of the `/library` row address (e.g. `3 Kenna Place`) |
| `suburb` | string | Suburb part (e.g. `Cromer`) |
| `state` | string | State **abbreviation** — convert `New South Wales` → `NSW`, `Victoria` → `VIC`, etc. |
| `postcode` | string | Postcode part (e.g. `2099`) |
| `owner_name` | string | Customer name from the Pylon row / detail customer block |
| `owner_type` | enum | `Residential` or `Commercial`. Pylon residential proposals → `Residential`; confirm if unclear |
| `install_type` | enum | `First time install` or `Additional install`. Pylon doesn't state this — default `First time install` and **confirm with the user** |
| `zone` | integer 1–4 | Climate zone, derived from the **postcode** (see "Determining the zone" below). Required and affects the STC count |

**Optional (include when you can read them; omit rather than guess):**

| Field | Type | Source / notes |
|---|---|---|
| `has_pv` | boolean | `true` for a solar proposal |
| `pv_kw` | number | System size (DC) in kW, e.g. `1.85` |
| `pv_panels` | integer | Panel count if Pylon shows it; else estimate `pv_kw·1000 / panelWatts` (e.g. 370 W panels) and flag as estimated, else omit |
| `has_inverter` | boolean | `true` if an inverter is listed |
| `inverter_kw` | number | Inverter capacity in kW if shown |
| `has_battery` | boolean | `true` if a battery is in the design |
| `battery_kwh` | number | Battery capacity in kWh if shown |
| `has_hotwater` | boolean | `true` only if a hot-water system is part of the job |
| `off_grid` | boolean | `true` only if the design is off-grid |
| `commissioning_date` | string `YYYY-MM-DD` | Leave **blank** unless the user supplies it. Pylon's "Signed at" / "Created at" are NOT commissioning dates — never map them |
| `job_stage` | string | Defaults to `Unscheduled`. Only set if the user asks (e.g. `Ready to submit`) |
| `ref_id` | string | Optional client reference — e.g. the Pylon project id, if the user wants traceability |
| `team` | string | Team initials (e.g. `PK`) only if the user specifies |

**Note on STCs:** `push_job` does **not** take an STC count — Formbay computes
STCs itself from `zone`, `pv_kw`, and the deeming period. Pylon's `STCs × N`
(section 3) is therefore a **cross-check**, not an input: after pushing, you can
`get_job` and confirm the portal's STC figure matches Pylon's. A mismatch
usually means the `zone` was wrong.

### Determining the zone (from postcode)
Australia has 4 SRES climate zones; the zone follows from the postcode. For the
authoritative postcode→zone mapping and ratings, use the **`formbay-kb-full`**
skill (reference `02-stc-zone-ratings.md`). Quick orientation:

- **Zone 3** (rating 1.382) — Sydney & most of NSW, Brisbane/Gold/Sunshine
  Coast & most of QLD, Adelaide, Perth, Canberra (the most common metro zone).
- **Zone 4** (rating 1.185) — Melbourne, Hobart, Tasmania, southern Victoria.
- **Zone 2** (1.536) and **Zone 1** (1.622) — inland/remote/northern areas.

**Cross-check before trusting a zone:** in 2026 the deeming period is 5 years and
`STCs ≈ pv_kw × zoneRating × 5`, rounded down. Pylon's STC count must line up
with the zone you pick. Worked check: 1.85 kW at Zone 3 → 1.85 × 1.382 × 5 =
12.78 → **12 STCs**, which matches Pylon's `STCs × 12`. If the arithmetic doesn't
land on Pylon's number, the zone (or the system size) is wrong — confirm with
the user before pushing.

### Read the system fields off the detail page (best-effort)
Extend section 4's detail snippet to grab the address, system size, panel model
and count, inverter, battery and price. These regexes are **best-effort** —
verify against the rendered page and drop any `null` rather than inventing one:
```js
(() => {
  const t = document.body.innerText;
  const pick = re => { const m = t.match(re); return m ? m[1].trim() : null; };
  return {
    address: document.title.replace(/\s*-\s*Pylon\s*$/i, '').trim(),
    stcs:       pick(/STCs?\s*[×x*]\s*(\d+)/i),
    systemSize: pick(/System size \(DC\)\s*([\d.]+)\s*kW/i),
    panel:      pick(/((?:Canadian Solar|Jinko|Trina|LONGi|REC|SunPower|Q ?CELLS|Tongwei|Risen)[^\n]*)/i),
    battery:    pick(/Battery(?:\s*size)?\s*([\d.]+)\s*kWh/i),
    inverter:   pick(/Inverter[^\n]*?([\d.]+)\s*kW\b/i),
    total:      pick(/Total\s*\$?([\d,]+(?:\.\d{2})?)/i)
  };
})();
```

### Splitting the address
The `/library` row text is `Street, Suburb State Postcode`, e.g.
`3 Kenna Place, Cromer New South Wales 2099`. Split it:
- `street` = text before the first comma → `3 Kenna Place`
- the remainder `Cromer New South Wales 2099` → trailing 4-digit `postcode`
  (`2099`), the state name immediately before it (`New South Wales` → `NSW`),
  and whatever precedes the state is the `suburb` (`Cromer`).

### Workflow — ALWAYS one project per confirmation
1. Identify the **single** project the user means (ask if ambiguous). Do **not**
   bulk-push the library — push one job at a time, each with its own
   confirmation. If the user wants several, loop, confirming each individually.
2. Read its address (from the `/library` row text) and its detail fields
   (snippet above). Split the address; convert the state to its abbreviation;
   derive and **cross-check** the zone.
3. *(Recommended)* run `list_jobs` and check whether a job for the same address
   already exists. If one does, surface it and ask before creating a duplicate.
4. Assemble the job and **show the user the exact payload** before sending:
   ```
   About to push to Formbay (this WRITES to the live job queue):
     street:        3 Kenna Place
     suburb:        Cromer
     state:         NSW
     postcode:      2099
     owner_name:    Jane Smith
     owner_type:    Residential
     install_type:  First time install   ← confirm
     zone:          3                     (→ ~12 STCs, matches Pylon)
     has_pv:        true
     pv_kw:         1.85
     pv_panels:     5  (estimated from 1.85 kW / 370 W)
     has_battery:   false
   ```
5. **Wait for explicit confirmation** (e.g. "yes / push it"). This is a
   state-changing action in an external system: never call `push_job` without a
   clear go-ahead, and never bundle multiple pushes into one approval.
6. Call `push_job`. Report the returned **`form_id`** to the user, then
   optionally `get_job(form_id)` to read it back and confirm the portal's STC
   count matches Pylon's.

### Why the gate matters
`push_job` mutates Formbay's live installer queue and can't be silently undone
from here, so confirming the exact payload first guards against pushing the
wrong project, a duplicate, a mis-classified `install_type`, or a wrong `zone`
(which would mis-calculate the STCs) — and keeps the action auditable. Reading
Pylon and the `list_jobs` / `get_job` / `whoami` calls are safe and need no
confirmation.

### Worked example (push)
```
User:   push 3 Kenna Place to Formbay
Claude: [reads the project detail; splits the address; postcode 2099 → Zone 3;
         cross-check 1.85 kW × 1.382 × 5 = 12 STCs ✓ matches Pylon]
        [runs list_jobs — no existing job at this address]
        [shows the payload above]
        install_type defaults to "First time install" — is that right, and OK to
        push to the live Formbay queue?
User:   yes
Claude: [push_job → returns form_id 1140210]
        Done — created Formbay job 1140210 for 3 Kenna Place, Cromer NSW 2099.
        [get_job(1140210) → portal shows 12 STCs, matching Pylon]
```

### Worked example (look up — read-only, no confirmation needed)
```
User:   what jobs are in Formbay, and show me job 1140167
Claude: [list_jobs → renders the job list]
        [get_job(form_id=1140167) → shows that job's details]
```
