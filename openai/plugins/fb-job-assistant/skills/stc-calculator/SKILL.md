---
name: stc-calculator
description: Calculate or explain Australian solar PV STCs and battery BSTCs, resolve solar postcode zones, and check certificate estimates for Formbay jobs. Use for panel kW, usable battery kWh, deeming periods, or tiered battery factors; not for SWH or VEEC calculations.
---

# Solar STC and battery BSTC calculations

STC means **small-scale technology certificate**. Eligible renewable-energy
equipment installed at an address can generate an entitlement; a Formbay job
or arithmetic estimate does not itself create certificates. In these workflows,
**BSTC** means the battery STC count, calculated separately from solar PV STCs.
**kW** measures power (panels, inverter or battery output); **kWh** measures
energy (battery capacity). Never substitute inverter kW for panel kW, or battery
output kW / nominal capacity for usable kWh.

## Resolve the location and date

- Preserve postcodes as four-digit strings, including leading zeros.
- When only a suburb is supplied, use [Australia Post](https://auspost.com.au/postcode)
  with the suburb and state. Use a delivery-area postcode for the installation
  address, not a PO-box result. If ambiguous or unavailable, report what is
  missing and do not select the first candidate or guess from a nearby city.
- Look up the exact postcode in [postcode-zones.csv](references/postcode-zones.csv).
  Bounds are inclusive. This covers numeric ranges, **not postcode existence**.
  Adjacent postcodes can have different zones; do not infer from city/state or
  reverse-engineer a zone from an existing certificate count.
- For a current estimate with no date, use the current session date/year and
  state that assumption. Do not permanently use 2026. For known installations,
  use the actual installation year for solar and compliance certification date
  for battery factors. Keep these dates separate if they differ. Never turn an
  estimate date into an asserted commissioning date in a Formbay write.

## Calculate deterministically

Run `scripts/calculate.py` relative to this skill's directory (or use its
absolute installed path). Python 3.10+ is sufficient; normal use needs no PDF
parser, network access, credentials, or MCP call.

```sh
python scripts/calculate.py zone --postcode 0800
python scripts/calculate.py solar --pv-kw 6.6 --postcode 2000 --year 2026
python scripts/calculate.py battery --usable-kwh 40 --date 2026-09-22
```

Solar: `floor(panel_kW * zone_rating * (2031 - year))`. Ratings:
zone 1 = 1.622; zone 2 = 1.536; zone 3 = 1.382; zone 4 = 1.185.
The helper supports years 2020-2030 and refuses dates outside that range.

Battery: `floor((tier1 + 0.6*tier2 + 0.15*tier3) * factor)`, where
`tier1=min(usable_kWh,14)`, `tier2=min(max(usable_kWh-14,0),14)`, and
`tier3=min(max(usable_kWh-28,0),22)`. Only capacity above 50 kWh contributes
zero; a 60 kWh system retains the first 50 kWh's calculated contribution.
Round down **once after summing**, not separately per tier. Battery calculations
use neither the solar postcode rating nor the solar deeming period.

Read [battery-factors.csv](references/battery-factors.csv) for the dated factor.
This schedule starts 1 May 2026 and ends 31 December 2030; earlier installations
need historical rules. Do not extrapolate a factor past 2030. For formula details,
scope, and maintained sources read [rules.md](references/rules.md).

If execution is unavailable, use the same CSV range and dated factors with an
available calculator. Show the intermediate arithmetic; do not claim the script
ran. If local resources are inaccessible, use the linked CER sources and report
that fallback. Never fabricate a mapping or a computed result.

## Report and hand off

Show capacity with its unit, postcode/zone/rating for solar, calculation date or
year, deeming period or battery tiers/factor, unrounded result and whole count.
For example: 6.6 kW at 2000 in 2026 gives 45.606 -> **45 solar STCs**;
40 usable kWh on 2026-09-22 gives 164.56 -> **164 BSTCs**.
Keep solar and battery counts separate. Label results as formula estimates;
eligibility, prior claims, and approved equipment are not checked by the helper.
Do not convert certificates to dollars without a supplied dated price.

For Formbay creation, pass the resolved input facts to the bundled `job-push`
skill. Report a stored server count separately from this calculation if they
differ; do not silently overwrite data or create another claim to force a match.
