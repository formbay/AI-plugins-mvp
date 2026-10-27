#!/usr/bin/env python3
"""Offline solar STC / battery BSTC estimates. Python 3.10+, standard library only."""

import argparse
import csv
import json
import re
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_FLOOR, localcontext
from pathlib import Path

REFERENCES = Path(__file__).resolve().parents[1] / "references"
ZONE_RATINGS = {1: "1.622", 2: "1.536", 3: "1.382", 4: "1.185"}


def capacity(value):
    try:
        result = Decimal(str(value))
    except InvalidOperation as exc:
        raise ValueError("Capacity must be a finite, non-negative number.") from exc
    if not result.is_finite() or result < 0:
        raise ValueError("Capacity must be a finite, non-negative number.")
    # Bound numeric input size, not ordinary engineering capacity or precision.
    if len(result.as_tuple().digits) > 28 or abs(result.as_tuple().exponent) > 28:
        raise ValueError("Capacity has excessive precision or exponent.")
    return result


def number(value):
    return format(value, "f")


def zone_for_postcode(postcode):
    if not isinstance(postcode, str) or not re.fullmatch(r"[0-9]{4}", postcode):
        raise ValueError("Postcode must be four digits as text, e.g. 0800.")
    with (REFERENCES / "postcode-zones.csv").open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    matches = [row for row in rows if int(row["postcode_from"]) <= int(postcode) <= int(row["postcode_to"])]
    if len(matches) != 1:
        raise ValueError("Postcode must match exactly one range in the bundled mapping.")
    row = matches[0]
    zone = int(row["zone"])
    if row["rating"] != ZONE_RATINGS.get(zone):
        raise ValueError("Postcode mapping has an invalid zone/rating pair.")
    return {
        "postcode": postcode,
        "zone": zone,
        "zone_rating": row["rating"],
        "source_item": int(row["item"]),
        "source_page": int(row["source_page"]),
        "postcode_range": [row["postcode_from"], row["postcode_to"]],
        "address_validated": False,
    }


def solar(pv_kw, postcode, year):
    if type(year) is not int or not 2020 <= year <= 2030:
        raise ValueError("Supported solar calculation years are 2020-2030; do not extrapolate.")
    kw = capacity(pv_kw)
    result = zone_for_postcode(postcode)
    deeming = 2031 - year
    with localcontext() as context:
        context.prec = 80
        raw = kw * Decimal(result["zone_rating"]) * deeming
    return {
        "kind": "solar_stc_estimate",
        **result,
        "pv_kw": number(kw),
        "calculation_year": year,
        "deeming_period": deeming,
        "raw_certificates": number(raw),
        "certificates": int(raw.to_integral_value(rounding=ROUND_FLOOR)),
        "eligibility_checked": False,
    }


def battery(usable_kwh, certification_date):
    if not isinstance(certification_date, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", certification_date):
        raise ValueError("Battery certification date must be YYYY-MM-DD.")
    when = date.fromisoformat(certification_date)
    with (REFERENCES / "battery-factors.csv").open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    matches = [row for row in rows if date.fromisoformat(row["date_from"]) <= when <= date.fromisoformat(row["date_to"])]
    if len(matches) != 1:
        raise ValueError("Battery schedule covers 2026-05-01 through 2030-12-31 only; use the applicable historical/current rules.")
    period = matches[0]
    cap = capacity(usable_kwh)
    with localcontext() as context:
        context.prec = 80
        tier1 = min(cap, Decimal(14))
        tier2 = min(max(cap - 14, Decimal(0)), Decimal(14))
        tier3 = min(max(cap - 28, Decimal(0)), Decimal(22))
        weighted = tier1 + tier2 * Decimal("0.6") + tier3 * Decimal("0.15")
        raw = weighted * Decimal(period["factor"])
        excluded = max(cap - 50, Decimal(0))
    return {
        "kind": "battery_bstc_estimate",
        "certification_date": certification_date,
        "usable_kwh": number(cap),
        "tier1_kwh": number(tier1),
        "tier2_kwh": number(tier2),
        "tier3_kwh": number(tier3),
        "excluded_above_50_kwh": number(excluded),
        "weighted_kwh": number(weighted),
        "stc_factor": period["factor"],
        "factor_period": [period["date_from"], period["date_to"]],
        "raw_certificates": number(raw),
        "certificates": int(raw.to_integral_value(rounding=ROUND_FLOOR)),
        "eligibility_checked": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    zone = commands.add_parser("zone", help="Look up a solar PV postcode zone.")
    zone.add_argument("--postcode", required=True)
    pv = commands.add_parser("solar", help="Estimate solar STCs, rounded down once.")
    pv.add_argument("--pv-kw", required=True)
    pv.add_argument("--postcode", required=True)
    pv.add_argument("--year", required=True, type=int)
    bstc = commands.add_parser("battery", help="Estimate tiered BSTCs, rounded down once.")
    bstc.add_argument("--usable-kwh", required=True)
    bstc.add_argument("--date", required=True, help="Certification date, or explicitly labelled estimate date.")
    args = parser.parse_args()
    try:
        if args.command == "zone":
            result = zone_for_postcode(args.postcode)
        elif args.command == "solar":
            result = solar(args.pv_kw, args.postcode, args.year)
        else:
            result = battery(args.usable_kwh, args.date)
    except (ValueError, ArithmeticError, OSError, KeyError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
