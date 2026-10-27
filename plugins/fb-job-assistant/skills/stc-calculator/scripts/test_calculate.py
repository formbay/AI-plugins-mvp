"""Run with python -B -m unittest discover -s scripts -p test_calculate.py -v."""

import csv
import json
import subprocess
import sys
import unittest
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

import calculate


class ZoneTests(unittest.TestCase):
    def test_city_examples_and_northern_territory_exceptions(self):
        for postcode, zone in {"2000": 3, "4000": 3, "2600": 3, "5000": 3,
                               "6000": 3, "3000": 4, "7000": 4, "0800": 2,
                               "0854": 3, "0870": 1, "3045": 3, "3046": 4}.items():
            with self.subTest(postcode=postcode):
                result = calculate.zone_for_postcode(postcode)
                self.assertEqual(result["zone"], zone)
                self.assertEqual(result["postcode"], postcode)
                self.assertFalse(result["address_validated"])

    def test_every_range_endpoint_and_complete_nonoverlapping_coverage(self):
        with (calculate.REFERENCES / "postcode-zones.csv").open(newline="", encoding="utf-8") as handle:
            rows = list(csv.DictReader(handle))
        self.assertEqual(len(rows), 137)
        next_postcode = 0
        for i, row in enumerate(rows, 1):
            self.assertEqual(int(row["item"]), i)
            self.assertEqual(int(row["postcode_from"]), next_postcode)
            self.assertGreaterEqual(int(row["postcode_to"]), next_postcode)
            for postcode in [row["postcode_from"], row["postcode_to"]]:
                self.assertEqual(calculate.zone_for_postcode(postcode)["source_item"], i)
            next_postcode = int(row["postcode_to"]) + 1
        self.assertEqual(next_postcode, 10000)

    def test_invalid_postcodes_are_not_silently_normalised(self):
        for value in [800, "800", "20000", "-001", " 2000", "20A0", "٢٠٠٠", ""]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                calculate.zone_for_postcode(value)


class SolarTests(unittest.TestCase):
    def test_sydney_current_year_example(self):
        result = calculate.solar("6.6", "2000", 2026)
        self.assertEqual(Decimal(result["raw_certificates"]), Decimal("45.606"))
        self.assertEqual(result["certificates"], 45)
        self.assertEqual(result["deeming_period"], 5)

    def test_exact_integer_and_deeming_change(self):
        self.assertEqual(calculate.solar("12.5", "0800", 2026)["certificates"], 96)
        self.assertEqual(calculate.solar("6.6", "2000", 2027)["certificates"], 36)
        self.assertEqual(calculate.solar("6.6", "2000", 2030)["certificates"], 9)
        self.assertEqual(calculate.solar("6.6", "2000", 2020)["deeming_period"], 11)

    def test_rejects_unsupported_years(self):
        for year in [2019, 2031, 2026.0, True]:
            with self.subTest(year=year), self.assertRaises(ValueError):
                calculate.solar("6.6", "2000", year)


class BatteryTests(unittest.TestCase):
    def test_tier_edges_and_capacity_cap(self):
        expected = {"0": 0, "13.9": 94, "14": 95, "14.1": 95, "14.2": 96,
                    "27.9": 151, "28": 152, "28.1": 152, "40": 164,
                    "49.9": 174, "50": 174, "60": 174}
        for cap, count in expected.items():
            with self.subTest(cap=cap):
                self.assertEqual(calculate.battery(cap, "2026-09-22")["certificates"], count)
        self.assertEqual(calculate.battery("60", "2026-09-22")["excluded_above_50_kwh"], "10")

    def test_rounds_only_after_sum(self):
        result = calculate.battery("14.2", "2026-09-22")
        self.assertEqual(Decimal(result["raw_certificates"]), Decimal("96.016"))
        self.assertEqual(result["certificates"], 96)  # Flooring each tier would incorrectly give 95.

    def test_every_factor_period_and_transition(self):
        periods = [
            ("2026-05-01", "2026-12-31", "6.8", 164),
            ("2027-01-01", "2027-06-30", "5.7", 137),
            ("2027-07-01", "2027-12-31", "5.2", 125),
            ("2028-01-01", "2028-06-30", "4.6", 111),
            ("2028-07-01", "2028-12-31", "4.1", 99),
            ("2029-01-01", "2029-06-30", "3.6", 87),
            ("2029-07-01", "2029-12-31", "3.1", 75),
            ("2030-01-01", "2030-06-30", "2.6", 62),
            ("2030-07-01", "2030-12-31", "2.1", 50),
        ]
        for start, end, factor, expected in periods:
            for when in [start, end]:
                with self.subTest(when=when):
                    result = calculate.battery("40", when)
                    self.assertEqual(result["stc_factor"], factor)
                    self.assertEqual(result["certificates"], expected)
        for previous, current in zip(periods, periods[1:]):
            self.assertEqual(date.fromisoformat(previous[1]) + timedelta(days=1), date.fromisoformat(current[0]))

    def test_rejects_unsupported_and_invalid_dates(self):
        for when in ["2026-04-30", "2031-01-01", "2027-02-29", "20260922", "2026-9-22", "2026-09-22T00:00:00Z"]:
            with self.subTest(when=when), self.assertRaises(ValueError):
                calculate.battery("14", when)


class InputAndCliTests(unittest.TestCase):
    def test_invalid_capacities(self):
        for cap in ["NaN", "Infinity", "-1", "bad", "6.6 kW", "1e9999"]:
            with self.subTest(cap=cap), self.assertRaises(ValueError):
                calculate.solar(cap, "2000", 2026)
            with self.subTest(cap=cap), self.assertRaises(ValueError):
                calculate.battery(cap, "2026-09-22")

    def test_cli_works_outside_skill_directory(self):
        script = Path(calculate.__file__).resolve()
        result = subprocess.run([sys.executable, "-B", str(script), "zone", "--postcode", "0800"],
                                cwd=script.anchor, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["zone"], 2)

    def test_cli_rejects_bad_input_without_success_json(self):
        result = subprocess.run([sys.executable, "-B", calculate.__file__, "battery", "--usable-kwh", "NaN", "--date", "2026-09-22"],
                                text=True, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")


if __name__ == "__main__":
    unittest.main()
