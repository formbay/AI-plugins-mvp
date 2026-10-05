# mcp-apps-demo — Formbay Solar Jobs

A small demo **MCP App**: instead of answering with text, Claude opens a little
interactive app inside the chat. Uses **fake demo data** only; nothing talks to
Formbay systems.

```
You ask Claude ──► Claude calls a tool in server.py
                       │
                       ▼
          server.py returns: text for Claude + data for the app
                       │
                       ▼
          Claude shows the app (dist/mcp-app.html) inside the chat
                       │
                       ▼
          You click in the app ──► the app calls server.py again ──► app updates
```

## What's inside

| File | What it is |
| ---- | ---------- |
| `server.py` | The server (Python, `mcp` SDK 2.x). Holds the demo jobs and the 4 tools. |
| `mcp-app.html`, `src/` | The app screen (HTML + TypeScript). Runs in the browser inside Claude. |
| `dist/mcp-app.html` | The built screen, one self-contained file. `server.py` sends this to Claude. |
| `.claude-plugin/plugin.json`, `.mcp.json` | Makes it installable as a Claude plugin. |

## Tools

| Tool | Who calls it | What it does |
| ---- | ------------ | ------------ |
| `show_solar_dashboard` | Claude | Opens the dashboard. Optional filters: state, installer. |
| `draft_solar_job` | Claude | Opens the new-job form, pre-filled with whatever Claude knows. |
| `refresh_dashboard` | the app only | Reloads data when you click a filter. |
| `submit_job` | the app only | Saves the form. |

"The app only" tools are hidden from Claude (`visibility: ["app"]`).

## What to ask Claude

- "Show me the solar jobs dashboard"
- "Show QLD jobs done by Aman"
- "Draft a new job for Priya Sharma in Bondi NSW, 8.2 kW"
- Click a job, then: "Is anything unusual about this job?"

## MCP Apps features it shows

| Feature | Where |
| ------- | ----- |
| Tool opens a UI (`_meta.ui.resourceUri`) | both Claude-visible tools |
| Render from tool data (`ontoolresult`) | dashboard, form |
| Live fill-in while Claude types (`ontoolinputpartial`) | form |
| App calls the server (`callServerTool`) + app-only tools | filter chips, Submit |
| Tell Claude what you selected (`updateModelContext`) | click a table row |
| Post a message into the chat (`sendMessage`) | "Ask Claude about this job", after Submit |
| Full screen (`requestDisplayMode`) | button top-right |
| Claude's theme, colours, fonts (host context) | everywhere; transparent background |
| One live copy at a time (supersession) | older copies grey out when a newer one opens |
| Friendly errors (`isError`) | e.g. `{"region":"Tasmania"}` |
| "What this Claude supports" (`getHostCapabilities`) | link at the bottom of the dashboard |

Design follows Claude's [MCP Apps design guidelines](https://claude.com/docs/connectors/building/mcp-apps/design-guidelines):
no tabs, visible chips instead of dropdown menus, at most 4 numbers and 2 actions, transparent background.

## Run locally

Needs [uv](https://docs.astral.sh/uv/). Node.js is only needed if you change the screen.

```bash
uv run server.py            # HTTP: http://localhost:3001/mcp
uv run server.py --stdio    # stdio (how Claude Desktop runs it)

npm install && npm run build   # rebuild dist/mcp-app.html after editing mcp-app.html or src/
```

Test without Claude using the official test page:

```bash
git clone https://github.com/modelcontextprotocol/ext-apps.git
cd ext-apps && npm install && cd examples/basic-host
SERVERS='["http://localhost:3001/mcp"]' npm start   # open http://localhost:8080
```

## Install in Claude

- **Claude Code / Desktop (plugin):** `/plugin marketplace add formbay/AI-plugins-mvp`, then
  `/plugin install mcp-apps-demo@formbay-ai-connectors` (once this is on the default branch).
- **claude.ai (web):** run `uv run server.py`, expose it with
  `npx cloudflared tunnel --url http://localhost:3001`, then add
  `https://<random>.trycloudflare.com/mcp` under Settings → Connectors → Add custom connector.
