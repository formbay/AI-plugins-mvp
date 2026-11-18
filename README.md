# Formbay AI Connectors

AI assistant integrations for customers of **Formbay Trading Pty Ltd**, using
Formbay's authenticated MCP services.

| Integration | Package | Marketplace |
| --- | --- | --- |
| Claude | [fb-connector](anthropic/plugins/fb-connector/README.md) | [anthropic/.claude-plugin/marketplace.json](anthropic/.claude-plugin/marketplace.json) |
| OpenAI Codex / ChatGPT desktop | [Formbay Job Push](openai/plugins/fb-job-assistant/README.md) | [openai/.agents/plugins/marketplace.json](openai/.agents/plugins/marketplace.json) |

Each assistant has its own marketplace root: register `anthropic/` with Claude
and `openai/` with OpenAI.

The Claude plugin and its marketplace remain independent of the OpenAI package.
The Claude plugin includes its existing `fb-connector` and `pylon-scraper` skills.
The OpenAI plugin connects directly to the current `fb-job-push-mcp-server`
deployment and includes active job lookup, job creation, Pylon import, and
solar STC / battery BSTC calculation skills.

## Layout

```text
AI-plugins-mvp/
|-- anthropic/                                # Claude marketplace root
|   |-- .claude-plugin/marketplace.json       # Claude catalog
|   `-- plugins/fb-connector/                 # Claude package
|-- openai/                                   # OpenAI marketplace root
|   |-- .agents/plugins/marketplace.json      # OpenAI catalog: formbay-openai
|   `-- plugins/fb-job-assistant/             # OpenAI package
|       |-- .codex-plugin/plugin.json
|       |-- .mcp.json                         # authenticated Streamable HTTP
|       |-- examples/app.json.template        # optional registered-app wiring
|       |-- skills/                           # active SKILL.md workflows
|       |   |-- job-lookup/
|       |   |-- job-push/
|       |   |-- pylon-import/
|       |   `-- stc-calculator/               # scripts, postcode CSV/PDF, dated factors
|       |-- LICENSE
|       `-- README.md
`-- LICENSE
```

## Installation

For Claude, register the `anthropic/` folder as a marketplace and install
`fb-connector`. See the [Claude package README](anthropic/plugins/fb-connector/README.md)
for its tools and browser requirements.

For OpenAI, register the `openai/` folder as a marketplace and install
`fb-job-assistant` from `formbay-openai`. See the [OpenAI installation instructions](openai/plugins/fb-job-assistant/README.md#install-the-repository-marketplace).
The bundled `.mcp.json` package supports desktop use. ChatGPT web needs a
registered MCP app and `.app.json` wiring; the OpenAI README documents that
separate setup and includes an inactive template. See
[OpenAI's platform restriction](https://learn.chatgpt.com/docs/enterprise/plugin-management#desktop-only-plugins).

## Access and authentication

Access is restricted to authorized Formbay customers. Complete OAuth with an
account accepted by the configured identity provider. The server verifies tokens,
resolves identity, and scopes job access. Plugin installation alone grants no
Formbay access. Job creation writes records to the connected service.

## AI output disclaimer

AI-generated output can be inaccurate, incomplete, or misleading and is not
professional, legal, financial, engineering, or compliance advice. Independently
verify output before relying on it. See section 6 of [LICENSE](LICENSE).

## License

Proprietary. Copyright (c) 2026 Formbay Trading Pty Ltd (ACN 146 464 995).
Use is restricted to authorized Formbay customers under [LICENSE](LICENSE).
Licensing and access contact: support@formbay.com.au.
