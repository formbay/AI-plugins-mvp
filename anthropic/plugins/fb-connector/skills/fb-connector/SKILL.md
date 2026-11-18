---
name: fb-connector
description: >-
  Master router for the Formbay connector. Use this whenever the user wants to
  move a solar/PV project from a partner source app into Formbay, or query
  Formbay jobs: "push this to Formbay", "create a Formbay job", "send this to
  the installer queue", "list Formbay jobs", "get job 1140167", "is there a job
  for this address", "who am I logged in as". It decides WHICH source the
  project lives in and delegates the reading to the matching source skill — for
  the Pylon web app (app.getpylon.com / "Pylon" / "getpylon") it uses the
  pylon-scraper skill — then handles the Formbay job push or lookup via the
  fb-job-push MCP server. Triggers: any Formbay job intent, or a project on a
  supported source app. Looking jobs up is read-only; pushing a job is a WRITE
  action, always confirmed with the user first.
---

# fb-connector (master router)

This is the **entry point** for the Formbay connector. Its job is to (1) work
out which **source app** a project lives in, (2) delegate the reading of that
project to the right **source skill**, and (3) run the Formbay job action
(**push** or **look up**) via the `fb-job-push` MCP server.

Think of this skill as a dispatcher: it does not itself scrape any website. It
picks the correct scraper skill and then owns the Formbay side.

## 1. Identify the source app

Work out where the project data comes from, in this order:

1. **Explicit URL / app name in the request.** e.g. an `app.getpylon.com` URL,
   or the words "Pylon" / "getpylon".
2. **The active browser tab**, if Claude in Chrome is available — check the
   current page URL.
3. **Ask the user** if it is still ambiguous ("Which app is this project in —
   e.g. Pylon?").

If the request is **only about Formbay jobs** (e.g. "list Formbay jobs", "get
job 1140167", "who am I") with no source project to read, skip straight to
section 3 — no source skill is needed.

## 2. Route to the source skill

| Source app | Match on | Skill to use |
|------------|----------|--------------|
| **Pylon** | `app.getpylon.com`, "Pylon", "getpylon" | **`pylon-scraper`** |

- **Pylon → invoke the `pylon-scraper` skill.** It knows how to read the Pylon
  Vue SPA (address, STCs, system size, price, panel model) and already
  documents the full Formbay `push_job` field mapping, address splitting, and
  zone cross-check. Follow it end-to-end for Pylon sources.
- **Unsupported source.** If the source app is not in the table above, tell the
  user it is not yet supported and list what is (currently: Pylon). Do **not**
  attempt to scrape an unknown site or guess job fields from it.

Adding a new source later means adding a row here plus a new source skill — this
router stays the same.

## 3. The Formbay job action (`fb-job-push` MCP server)

All Formbay reads/writes go through the **`fb-job-push`** MCP server. The
authoritative field-by-field mapping, address splitting, zone derivation, the
STC cross-check, the exact confirmation payload, and worked examples live in the
**`pylon-scraper`** skill (section 8). Reuse that — do not re-derive it here.

Quick reference:

| Tool | Type | Params | Use |
|------|------|--------|-----|
| `list_jobs` | read | none | List every Formbay job. Duplicate guard before pushing. |
| `get_job` | read | `form_id` (int) | Fetch one job by its `form_id` (not `id`). |
| `push_job` | **WRITE** | structured fields | Create a new installation job in the **live** portal. |
| `whoami` | read | none | Which Formbay account the token is authenticated as. |

### Golden rules (apply regardless of source)

- **Reads are free.** `list_jobs` / `get_job` / `whoami` are read-only — run
  them without asking.
- **`push_job` is a WRITE.** Always: read the project, map the fields, run
  `list_jobs` as a duplicate guard, **show the exact payload**, and wait for
  explicit confirmation ("yes / push it") before calling `push_job`.
- **One project per confirmation.** Never bulk-push the source library. If the
  user wants several, loop and confirm each individually.
- After pushing, report the returned **`form_id`** and optionally `get_job` it
  to confirm the portal's STC figure matches the source.

## 4. End-to-end flow

```
1. Identify the source app        (section 1)
2. Formbay-only request?          → go to step 4
3. Read the project via the       (section 2 → e.g. pylon-scraper)
   matching source skill
4. Run the Formbay action         (section 3)
   - lookup  → read-only, just do it
   - push    → map fields, dedupe-check, confirm payload, then push_job
```

## 5. Worked examples

```
User:   push this Pylon project to Formbay  (app.getpylon.com/... open)
Router: source = Pylon → use pylon-scraper to read the project;
        map fields, list_jobs dedupe check, show payload, confirm, push_job.

User:   list Formbay jobs
Router: Formbay-only, no source needed → list_jobs (read-only).

User:   push the project from <some other app>
Router: source not supported yet — supported sources: Pylon. Ask the user to
        use a supported source or provide the details manually.
```
