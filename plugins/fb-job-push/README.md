# Formbay Job Push for OpenAI

An OpenAI plugin for the existing `job-push/fb-job-push-mcp-server` service.
The package contains connection metadata and four active workflow skills. It uses
the deployed service; it does not bundle or start a second server or database.

## Connection

The bundled [.mcp.json](.mcp.json) connects to:

```text
https://mcp.13-236-107-181.nip.io/mcp
```

Transport: Streamable HTTP. Authentication: OAuth through the authorization
server advertised by the MCP endpoint. Complete the client's browser login
flow with an account accepted by that identity provider. No bearer token,
password, client secret, or Claude-specific client ID belongs in this package.

On 2026-09-22 the public resource metadata advertised
`https://identity.iit1.formbay.com.au` as its authorization server. The identity
metadata advertised S256 PKCE and client ID metadata documents (CIMD).
These are discovery observations, not an end-to-end OpenAI login test.

The MCP server owns `AUTH_ISSUER`, `JWKS_URL`, `MCP_AUTH_CONFIG_FILE`, identity
resolution, and scope enforcement. Switching between Formbay and Better Auth
happens on the server; no provider profile is copied into the plugin.
The MCP resource audience is the complete endpoint URL, including `/mcp`.

## Install the repository marketplace

The OpenAI catalog is [../../.agents/plugins/marketplace.json](../../.agents/plugins/marketplace.json).
Its name is `formbay-openai`; install `fb-job-push` from that source.

For an unpublished local checkout, register the repository root:

```powershell
codex plugin marketplace add C:/path/to/AI-plugins-mvp
```

Open the Plugins directory in the desktop app, select the `Formbay Openai`
source, and install **Formbay Job Push**. Complete OAuth and start a new chat.
The CLI command registers a catalog; it does not itself install the plugin.

After these files are published to a Git branch, the equivalent Git source is:

```powershell
codex plugin marketplace add git@github.com:formbay/AI-plugins-mvp.git --ref <published-branch>
```

Use `main` only after the changes have been merged there. Private repository
access is required. Workspace administrators can also import the repository
through OpenAI's GitHub marketplace management, selecting the repository root.

The bundled MCP configuration is supported by Codex and ChatGPT desktop.
OpenAI marks imported plugins containing `.mcp.json` as **Desktop only**,
even for remote HTTPS endpoints. See [OpenAI plugin management](https://learn.chatgpt.com/docs/enterprise/plugin-management).

## ChatGPT web: registered app wiring

ChatGPT web requires a registered MCP app instead of this package's direct
`.mcp.json` configuration. The repository does not contain a verified shared
OpenAI app ID. To prepare a web-compatible copy:

1. Register the endpoint above in ChatGPT's developer-mode Plugins UI using
   OAuth. Complete login and verify the connection's tools.
2. Obtain its technical app ID. A URL containing `plugin_asdk_app_<value>`
   corresponds to app ID `asdk_app_<value>`; do not include `plugin_`.
3. In a copy of this plugin, copy [examples/app.json.template](examples/app.json.template)
   to `.app.json` and replace `REPLACE_WITH_REGISTERED_APP_ID` with that ID.
4. In `.codex-plugin/plugin.json`, remove `mcpServers` and add
   `"apps": "./.app.json"`. Remove `.mcp.json` from that copy as well: default
   discovery can still find it if only the manifest reference is removed.
5. Distribute/import the resulting plugin through the workspace's supported
   plugin flow. Ensure the registered app is shared with the intended users.

The `.app.json` template is intentionally inactive. Do not publish an invented
app ID or assume a developer's private registration is accessible to customers.
See [OpenAI packaging instructions](https://developers.openai.com/plugins/build/plugins)
and [registered app mapping format](https://learn.chatgpt.com/docs/enterprise/plugin-management#reference-an-existing-app-with-appjson).

## Current server capabilities

Tool schemas come from MCP discovery. These names reflect the inspected local
server source; verify the deployed tool list after connecting.

| Tool | Behavior |
| --- | --- |
| `whoami` | Reports verified identity, client, scopes, and `identity_resolved`. |
| `list_jobs` | Lists jobs belonging to the authenticated user. |
| `get_job` | Fetches the caller's job by integer `form_id`. |
| `push_job` | Creates an original PV-type job. |
| `push_pv_battery_job` | Creates a combined PV and battery claim job. |
| `push_pv_only_job` | Creates a PV-only claim job. |
| `push_bstc_job` | Creates a battery-only claim job, optionally linked by `pv_form_id`. |
| `push_swh_job` | Creates a solar water heater / heat pump claim job. |
| `push_swh_veecs_job` | Creates a Victorian SWH + VEECs claim job. |

The six creation tools write database records. OAuth mode derives the caller
from the verified token; it does not accept a user-supplied `pushed_by` email.
The service also exposes `formbay://portal/url`, containing `portal_url` for
portal links. This resource avoids hard-coding a portal hostname.

## Active skills

| Skill | Purpose |
| --- | --- |
| [job-lookup](skills/job-lookup/SKILL.md) | Read the authenticated user's identity and jobs. |
| [job-push](skills/job-push/SKILL.md) | Prepare and create an authorized job using live MCP schemas. |
| [pylon-import](skills/pylon-import/SKILL.md) | Extract a selected Pylon project through available browser tools, an export or manual input. |
| [stc-calculator](skills/stc-calculator/SKILL.md) | Calculate solar STCs and battery BSTCs with postcode and date evidence. |

Each is a discoverable `skills/<name>/SKILL.md`, with automatic selection enabled.
Pylon browser access depends on the host's available tools and the user's login;
the plugin does not install a browser tool. The Claude skills remain separate.

The calculator includes a 137-range [postcode CSV](skills/stc-calculator/references/postcode-zones.csv),
the original source PDF, extraction provenance, and a dated battery-factor CSV.
Normal calculations use Python 3.10+ and the standard library; PDF extraction
requires `pypdf` only when reproducing the mapping. No MCP calls or credentials
are needed for standalone estimates.

From this plugin directory:

```powershell
python skills/stc-calculator/scripts/calculate.py solar --pv-kw 6.6 --postcode 2000 --year 2026
python skills/stc-calculator/scripts/calculate.py battery --usable-kwh 40 --date 2026-09-22
python -B -m unittest discover -s skills/stc-calculator/scripts -p test_calculate.py -v
```

Use Australia Post for suburb-to-postcode resolution. The bundled CSV maps
postcodes to solar zones; it does not establish that an address/postcode exists.
Known installations use installation/certification dates. Undated estimates use
the current session date with that assumption disclosed. Capacities above
50 usable kWh retain the first 50 kWh's contribution; round down once after
summing battery tiers. See [calculation rules](skills/stc-calculator/references/rules.md).

These are estimates, not eligibility checks or certificate registrations. SWH
and VEEC entitlements need other methods. See the job-push skill's
[server notes](skills/job-push/references/tool-notes.md) for stored-count differences.

## Verification

Without logging in, verify OAuth discovery and rejection of unauthenticated calls:

```powershell
curl.exe -i https://mcp.13-236-107-181.nip.io/.well-known/oauth-protected-resource/mcp
curl.exe -i -X POST -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" --data '{}' https://mcp.13-236-107-181.nip.io/mcp
```

Expect resource metadata with the exact `/mcp` audience, then HTTP 401 with a
`WWW-Authenticate` resource-metadata URL. After installation and OAuth login,
call `whoami` and verify `identity_resolved: true`, then `list_jobs`. Only use
`get_job` with an ID returned for the connected account. An empty list is valid.
If identity is unresolved, the server operator must fix the configured token
claims or identity mapping; supplying an email to a push tool is not a workaround.

Job creation requires a separately authorized smoke test with real input.
No test job is created merely to install or validate this package. A timeout
after a push is ambiguous; inspect existing jobs before retrying to avoid duplicates.

## Other deployments

Change the URL in `.mcp.json` to the intended deployment's public HTTPS `/mcp`
endpoint before distribution. The authorization server must issue tokens for
that exact resource. For a registered app, update the app connection itself.
Local stdio mode is a different trust model and is not bundled here.

## License

Restricted to authorized Formbay customers. See [LICENSE](LICENSE), copied from
the repository license so standalone plugin archives carry the terms.
