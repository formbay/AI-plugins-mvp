# mcp-apps-demo — Formbay MCP Apps Showcase

A demo **MCP App**: a Python MCP server whose tools open an interactive UI
inside Claude instead of returning plain text. It is built to exercise every
UI feature in the [MCP Apps spec](https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html)
and to show which ones the current host (Claude Desktop, claude.ai, …) supports.

All data is **fake demo data** held in memory. Nothing talks to Formbay systems.

## How it works

```
You ask Claude  →  Claude calls a tool (e.g. show_solar_dashboard)
                     ↓
        server.py returns: text summary + structured data
        and the tool's _meta.ui.resourceUri points at ui://formbay-demo/showcase.html
                     ↓
        Claude loads that HTML (dist/mcp-app.html) in a sandboxed iframe
                     ↓
        The page draws the dashboard and talks back to Claude / the server
```

| Part              | File                    | Language                   |
| ----------------- | ----------------------- | -------------------------- |
| MCP server        | `server.py`             | Python (`mcp` SDK 2.x, `mcp.server.apps`) |
| UI ("View")       | `mcp-app.html`, `src/`  | TypeScript + HTML/CSS (runs in the browser) |
| Built UI          | `dist/mcp-app.html`     | single self-contained file, committed |
| Claude plugin     | `.claude-plugin/plugin.json`, `.mcp.json` | — |

## Tools

| Tool                   | Who can call it | What it does |
| ---------------------- | --------------- | ------------ |
| `show_solar_dashboard` | Claude          | Opens the dashboard (KPI tiles, STC chart, jobs table). Filters: state, installer |
| `draft_solar_job`      | Claude          | Opens a new-job form pre-filled with whatever is known (all fields optional) |
| `refresh_dashboard`    | UI only         | Re-fetches dashboard data |
| `update_job_status`    | UI only         | Changes a job's status from the table |
| `submit_job`           | UI only         | Saves the form |
| `poll_live_stats`      | UI only         | Live numbers for the polling panel |

"UI only" tools use `visibility: ["app"]`, so Claude never sees them.

## Feature map

| MCP Apps feature | Where to see it |
| ---------------- | --------------- |
| Tool → UI resource (`_meta.ui.resourceUri`) | every model-visible tool |
| `ontoolresult` / `structuredContent` | dashboard renders from the tool result |
| `ontoolinputpartial` (streaming args) | New job tab fills in while Claude types |
| `ontoolinput`, `ontoolcancelled` | What works → activity log |
| `callServerTool` | Refresh button, region filter |
| App-only tools (`visibility: ["app"]`) | status dropdown, form submit, polling |
| Polling + pause offscreen | Live tab (IntersectionObserver) |
| `updateModelContext` | click a table row: Claude now knows the selected job |
| `sendMessage` | "Ask Claude about this job", form submit |
| `createSamplingMessage` | "Summarise with AI" (falls back to `sendMessage` if unsupported) |
| `downloadFile` | Export CSV |
| `openLink` | Open CER website |
| `readServerResource` | What works → Load a file from the server |
| `sendLog` | What works → Send a log message |
| `requestDisplayMode` | Inline / Full screen / Float buttons (only the sizes the host offers are shown) |
| `requestTeardown`, `onteardown` | Close button |
| Host context, theme, CSS variables, fonts, safe areas | light/dark styling, What works → host context |
| `viewUUID` + `localStorage` | tab and selection survive a reload |
| `app.registerTool` (View-provided tool) | `get_view_state` |
| Error back to the model (`isError`) | `show_solar_dashboard` with `min_stcs < 0` (shows a friendly banner) |
| Text fallback | every tool returns readable text for non-UI hosts |

The **What works** tab shows a live ✓/– checklist from `getHostCapabilities()`,
which answers "what does Claude support?" directly in the demo.

## Tabs

| Tab | For | What's there |
| --- | --- | ------------ |
| Start here | everyone | what this is in 3 steps, clickable example questions, feature cards |
| Dashboard | everyone | KPI tiles, STC chart with hover, searchable table, status changes, actions on a selected job |
| New job | everyone | form Claude can fill in, live STC estimate, validation |
| Live | everyone | numbers refreshing every 2s with a sparkline |
| What works | everyone + developers | plain-English feature checklist, quick tests, activity log, host context |

## Reliability

- Tool inputs are forgiving: states accept names like "Queensland" or "brisbane", installers
  match on part of the name ("aman"), and a draft opens even with no details at all.
- Mistakes get plain-English answers (e.g. *"Tasmania" isn't a state we have jobs in. Please use
  one of: NSW, VIC, QLD, SA, WA or All.*). Raw validation errors are translated in the View too.

- Every server call has a 15s timeout and a friendly error (toast or banner with "Try again").
- Buttons show a spinner and ignore double clicks while working.
- Failed status changes roll back; live polling never stacks requests and stops after 3 failures.
- Features the host doesn't advertise are marked (dashed) but still tried, with fallbacks
  (e.g. if Claude can't take a message, it's copied for you to paste).
- Charts have a fixed height, so the View can't get into a resize loop with the host.

## Requirements

- [uv](https://docs.astral.sh/uv/) (runs `server.py` and installs its Python deps automatically)
- Node.js 20+ **only if you change the UI** (to rebuild `dist/mcp-app.html`)

## Run locally

```bash
uv run server.py            # HTTP: http://localhost:3001/mcp
uv run server.py --stdio    # stdio, as Claude Desktop runs it
```

Rebuild the UI after editing `mcp-app.html` or `src/`:

```bash
npm install
npm run build               # or: npm run watch
```

### Test with the reference host (basic-host)

```bash
git clone https://github.com/modelcontextprotocol/ext-apps.git
cd ext-apps && npm install
cd examples/basic-host
SERVERS='["http://localhost:3001/mcp"]' npm start   # open http://localhost:8080
```

## Install in Claude

### Claude Code / Claude Desktop (as a plugin)

```bash
/plugin marketplace add formbay/AI-plugins-mvp
/plugin install mcp-apps-demo@formbay-ai-connectors
```

The plugin starts `server.py` over stdio with `uv`.

### claude.ai (web) — as a remote connector

claude.ai cannot run local processes or reach `localhost`, so expose the HTTP
server with a tunnel and add it as a custom connector:

```bash
uv run server.py
npx cloudflared tunnel --url http://localhost:3001
# Settings → Connectors → Add custom connector → https://<random>.trycloudflare.com/mcp
```

The tunnel URL changes every restart. For a permanent setup, deploy
`server.py` somewhere public (`HOST=0.0.0.0 PORT=... uv run server.py`).

## Try it

- "Show me the solar jobs dashboard"
- "Show only QLD jobs"
- "Show me QLD jobs done by Aman"
- "Draft a solar job for Priya Sharma in Bondi NSW, 8.2 kW, notes: two-storey, tile roof"
- Click a row, then ask "what's the status of the job I selected?"
