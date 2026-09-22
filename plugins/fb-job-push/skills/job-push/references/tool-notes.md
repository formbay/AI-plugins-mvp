# Current job-push tool contract

Inspected from `job-push/fb-job-push-mcp-server/src/core/server.ts` and
`src/core/store.ts` on 2026-09-22. The connected tool schemas remain authoritative.

- All creation tools require owner name/type, street, suburb, state, postcode
  and numeric `zone` (1-4). Site ownership is distinct from caller identity.
- Typed creation tools use installation slugs `first_time`, `additional`,
  `replacement`, `extension`; the optional value defaults to `first_time`.
  Do not silently accept that default when source facts say otherwise.
- Legacy `push_job` uses display values `First time install` and
  `Additional install`. Its equipment flags differ from typed tools.
- `push_pv_only_job` requires `pv_kw`; `push_pv_battery_job` also requires
  `battery_kwh`. Panel count and inverter power are optional. The MCP field's
  battery-capacity description is generic; establish usable kWh separately
  before estimating BSTCs and disclose any input-semantics mismatch.
- `push_bstc_job` requires `battery_kwh`; optional `pv_form_id` links an owned
  PV job and updates that record. Do not guess the link from an address alone.
- `push_swh_job` requires `swh_litres`, with optional `swh_model`.
- `push_swh_veecs_job` requires tank litres and explicit `veec_count`, with
  optional model and `stc_count`. Only use it for a verified Victorian job.
- `commissioning_date` is optional. The server currently substitutes today's
  UTC date if omitted. Make that default explicit before a creation where no
  actual date is known. Do not overwrite a known date with today's estimate date.

## Estimates versus stored counts

The server computes solar counts using commissioning year. Its current formula
clamps the deeming period to at least one, even after 2030, and its battery
factor falls through to 2.1 after 2030. The skill calculator rejects unsupported
dates. Do not treat the server's out-of-range result as verified entitlement.

Current combined PV+battery creation stores zero BSTCs until a separate BSTC
claim is linked. A battery-only job computes a BSTC count; linking it can update
the PV record's count. Do not manufacture that extra claim merely to make the
display match the independent battery estimate.

Most PV/battery creation tools do not accept certificate-count overrides.
Do not add invented `stc_count` / `bstc_count` fields to those payloads.
The simulation does not model SWH entitlement calculations; the available
SWH/VEEC tools and their stored counts do not prove regulatory eligibility.
