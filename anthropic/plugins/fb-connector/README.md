# fb-connector

A Claude plugin that lets Claude read solar-proposal data from partner web apps
and push those projects into the **Formbay** job queue — or look up jobs already
in the Formbay portal.

## What it does

The plugin is organised around a **master skill, `fb-connector`**, which is the
entry point for any "push to Formbay" / "create a Formbay job" / "list Formbay
jobs" request. It:

1. **Figures out the source app** the project lives in.
2. **Routes to the matching source skill** to read the project data. Today the
   only supported source is the **Pylon** web app (`app.getpylon.com`), handled
   by the **`pylon-scraper`** skill.
3. **Pushes the project into the Formbay job queue** or **looks up existing
   jobs** via the `fb-job-push` MCP server.

### Bundled skills

| Skill | Role |
|-------|------|
| **`fb-connector`** | Master router — picks the right source skill and owns the Formbay job push / lookup flow. |
| **`pylon-scraper`** | Reads project data (address, STCs, system size, price, panel model) from the Pylon Vue SPA via the Claude in Chrome browser tools. |

Reading source apps and looking jobs up (`list_jobs` / `get_job` / `whoami`) are
read-only; `push_job` is a **write** action and is always confirmed with the
exact payload before it runs.

## Requirements

- **Claude in Chrome** browser tools, with a browser already logged in to the
  source app (e.g. Pylon).
- Access to the Formbay **`fb-job-push`** MCP server (declared in
  [.mcp.json](.mcp.json)).

The `fb-job-push` MCP server is configured in [.mcp.json](.mcp.json) at
`https://mcp.13-236-107-181.nip.io/mcp`. It is authenticated — you need valid,
active Formbay credentials for the job tools (`list_jobs` / `get_job` /
`push_job` / `whoami`) to work.

## Layout

```
fb-connector/
├── .claude-plugin/plugin.json     # plugin manifest
├── .mcp.json                      # fb-job-push MCP server
├── skills/
│   ├── fb-connector/SKILL.md      # master router skill
│   └── pylon-scraper/SKILL.md     # Pylon source skill
└── README.md
```

## Access

Restricted to authorized Formbay customers. Every Formbay action runs through the
authenticated Formbay MCP server. See the repository [LICENSE](../../../LICENSE).
