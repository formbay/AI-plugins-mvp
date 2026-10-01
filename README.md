# Formbay AI Connectors

AI assistant integrations for customers of **Formbay Trading Pty Ltd**, built to
work with the Formbay platform through Formbay's own (authenticated) MCP server.

This repository hosts Formbay's first round of partner integrations. They deliver
the same Formbay capability to the AI assistants Formbay customers already use:

- **Claude** (Claude Code and Claude Desktop) — as a native **Claude plugin**.
- **OpenAI** (Codex CLI and ChatGPT) — by connecting to the Formbay **MCP server**
  directly, since OpenAI does not support a Claude-style plugin/marketplace
  concept.

> **Access is restricted to Formbay customers.** These integrations do nothing on
> their own — every Formbay action runs through the Formbay MCP server, which sits
> behind authentication. You need valid, active Formbay credentials to use them.
> See [LICENSE](LICENSE) for the full terms.

---

## What's in this round

A single capability, **`formbay-helper`** (the `form-checker` skill), delivered
two ways:

| Assistant                     | How it's delivered                  | Lives in  |
| ----------------------------- | ----------------------------------- | --------- |
| Claude Code / Claude Desktop  | Native Claude plugin + marketplace  | `claude/` |
| OpenAI Codex CLI / ChatGPT    | Custom MCP server connection        | `openai/` |

Both share the **same portable skill**, `form-checker`, defined in a common
`SKILL.md`. The Claude side wraps it in a marketplace plugin; the OpenAI side
registers the Formbay MCP server directly (see the OpenAI install steps below).

> **Why not a Gemini build?** Google Gemini does not yet support a plugin /
> extension mechanism suitable for this integration, so Gemini is out of scope for
> this round. It may be added if and when Google ships the necessary support.

### Capabilities (first round)

- **`form-checker` skill** — helps Formbay customers check and validate Formbay
  forms.
- **`/check-form` command** — the entry point that invokes the skill.

The concrete Formbay operations the skill performs (and how they map to MCP
server tools) are documented in **`CONNECTORS.md`**.

> **Status:** `CONNECTORS.md` is currently a placeholder and the Formbay MCP
> server URL is not yet published — both will be filled in once the MCP server
> ships. Until then the plugins are scaffolding and are not yet functional.

### Demo: MCP Apps showcase (`mcp-apps-demo`)

An exploration of [MCP Apps](https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html):
a Python MCP server whose tools open an interactive UI inside Claude (jobs
dashboard, chart, pre-filled form, live updates) using **fake demo data**. Its
"What works" tab reports which MCP Apps UI features the current Claude host
supports. Requires [uv](https://docs.astral.sh/uv/). See
[`claude/plugins/mcp-apps-demo/README.md`](claude/plugins/mcp-apps-demo/README.md).

```text
/plugin marketplace add formbay/AI-plugins-mvp
/plugin install mcp-apps-demo@formbay-ai-connectors
```

---

## Repository layout

```
ai-connectors/
├── README.md
├── LICENSE
├── CONNECTORS.md                      # tool mapping (placeholder → real)
│
└── claude/                            # Claude Code + Claude Desktop
    ├── .claude-plugin/
    │   └── marketplace.json           # catalog users "add"
    └── plugins/
        └── formbay-helper/
            ├── .claude-plugin/plugin.json
            ├── skills/form-checker/SKILL.md
            ├── commands/check-form.md
            ├── .mcp.json              # optional MCP servers
            └── README.md
```

---

## Prerequisites

- An active **Formbay account** with valid credentials.
- The relevant AI assistant installed:
  - **Claude Code** or **Claude Desktop** for the Claude plugin.
  - **OpenAI Codex CLI** or **ChatGPT** for the OpenAI MCP connection.
- For ChatGPT: a workspace/organization where an **admin has enabled custom
  connectors** (custom MCP servers are admin-gated — see below).
- Network access to the Formbay MCP server (endpoint **TBD**).

---

## Installation

> Connection and authentication details depend on the Formbay MCP server, which
> is still in development. The steps below describe the intended install flow;
> exact MCP URLs and auth steps will be added when the server is published.

### Claude Desktop

Claude Desktop installs the **same Claude plugin** as Claude Code, through its
built-in plugin directory (it reads the `claude/` marketplace in this repo).

1. Open the **Directory** in Claude Desktop and select **Plugins** in the sidebar.
2. Under the **Personal** tab, click the **+** next to *Local uploads* and choose
   **Add marketplace**.
3. In the **URL** field, enter this repository — `formbay/ai-connectors` (or the
   full git URL `https://github.com/formbay/ai-connectors`) — then click **Sync**.
   - Claude Desktop warns that marketplace plugins are not controlled by
     Anthropic and that you should only install plugins you trust. The Formbay
     plugin is published by Formbay; install it only from the official Formbay
     repository.
4. Once the marketplace syncs, install **`formbay-helper`** from the list.
5. The plugin's bundled MCP configuration connects Claude Desktop to the Formbay
   MCP server (URL **TBD**); complete the Formbay authentication prompt, then ask
   Claude to check a form to invoke the `form-checker` tools.

> To install a local build instead of the marketplace, use **+ → Upload plugin**
> and select the `claude/plugins/formbay-helper/` plugin folder.

### OpenAI Codex CLI

OpenAI does not have a Claude-style plugin marketplace. Instead, Codex CLI is
pointed at the **Formbay MCP server**, which provides the `form-checker` tools.
Register the server in your Codex configuration (e.g. the `mcp_servers` section of
your Codex config), supplying the Formbay MCP server URL (**TBD**) and your
Formbay authentication. Once registered, the Formbay tools are available in Codex;
the shared `form-checker` skill and `AGENTS.md` context in `openai/` describe the
intended usage.

> Exact Codex configuration keys and the MCP server URL will be documented when
> the server is published.

### ChatGPT

ChatGPT does not support installing a plugin from a repository. It connects to the
**Formbay MCP server** as a **custom connector**, which surfaces the `form-checker`
tools in chat.

> **Admin required.** Custom connectors / custom MCP servers in ChatGPT are gated
> behind organization settings. A **workspace admin** must enable custom
> connectors (e.g. via developer mode / connector settings) before they can be
> added. Availability also depends on your ChatGPT plan (Business / Enterprise /
> Edu).

1. An admin enables custom connectors for the workspace.
2. In **Settings → Connectors**, choose to add a custom connector.
3. Enter the Formbay MCP server URL (**TBD**) and a name (e.g. `Formbay`).
4. Complete the authentication prompt with your Formbay credentials.
5. Enable the connector in a chat, then ask ChatGPT to check a form to invoke the
   Formbay tools.

---

## Authentication

Every Formbay action is performed by the Formbay MCP server, which is protected
by authentication. The plugins themselves grant no access — they relay requests
to the MCP server, which authorizes them against your Formbay credentials. Access
can be suspended or revoked by Formbay at any time.

*(Exact auth mechanism — login flow / token — to be documented when the MCP
server is published.)*

---

## AI output disclaimer

These integrations use third-party large language models (Anthropic and OpenAI).
**AI-generated output can be inaccurate, incomplete, or misleading and is not
professional, legal, financial, engineering, or compliance advice.** You are
responsible for independently verifying any output before relying on or acting on
it. See section 6 of the [LICENSE](LICENSE).

---

## License

Proprietary. Copyright © 2026 Formbay Trading Pty Ltd (ACN 146 464 995). All
rights reserved. Use is restricted to authorized Formbay customers and is subject
to the terms in [LICENSE](LICENSE). No copying, modification, redistribution, or
reverse engineering is permitted.

For licensing or access inquiries: support@formbay.com.au
