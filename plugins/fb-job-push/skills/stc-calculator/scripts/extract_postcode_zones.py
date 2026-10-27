#!/usr/bin/env python3
"""Maintainer helper: reproduce the zone CSV from the supplied CER PDF using pypdf."""

import argparse
import csv
import hashlib
import io
import json
import re
from pathlib import Path

SOURCE_URL = "https://cer.gov.au/document/postcode-zone-ratings-and-zones-solar-panel-systems"
RATINGS = {"1": "1.622", "2": "1.536", "3": "1.382", "4": "1.185"}
FIELDS = ["item", "postcode_from", "postcode_to", "zone", "rating", "source_page"]


def extract(pdf):
    from pypdf import PdfReader

    reader = PdfReader(pdf)
    rows = []
    for page_number, page in enumerate(reader.pages, 1):
        for line in page.extract_text(extraction_mode="layout").splitlines():
            match = re.fullmatch(r"(\d+) (\d{1,4}) (\d{1,4}) ([1-4]) (1\.\d{3})", " ".join(line.split()))
            if match:
                item, start, end, zone, rating = match.groups()
                rows.append(dict(zip(FIELDS, [item, start.zfill(4), end.zfill(4), zone, rating, str(page_number)])))
    if len(reader.pages) != 8 or len(rows) != 137:
        raise ValueError("Expected the supplied 8-page document with 137 rows; review a changed source manually.")
    next_postcode = 0
    for index, row in enumerate(rows, 1):
        if int(row["item"]) != index or int(row["postcode_from"]) != next_postcode:
            raise ValueError("Missing, duplicate, overlapping, or out-of-order postcode range.")
        if int(row["postcode_to"]) < next_postcode or row["rating"] != RATINGS[row["zone"]]:
            raise ValueError("Invalid postcode range or zone rating.")
        next_postcode = int(row["postcode_to"]) + 1
    if next_postcode != 10000:
        raise ValueError("Expected complete numeric range 0000-9999.")
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("csv", type=Path)
    parser.add_argument("--check", action="store_true", help="Compare with committed output without writing.")
    args = parser.parse_args()
    rows = extract(args.pdf)
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=FIELDS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    output = buffer.getvalue().encode("utf-8")
    metadata = {
        "source_file": args.pdf.name,
        "source_url": SOURCE_URL,
        "source_sha256": hashlib.sha256(args.pdf.read_bytes()).hexdigest(),
        "document_effective_date": "2020-01-01",
        "extracted_on": "2026-09-22",
        "page_count": 8,
        "range_count": len(rows),
        "csv_sha256": hashlib.sha256(output).hexdigest(),
        "note": "Inclusive numeric ranges; not a register of valid delivery postcodes or suburbs.",
    }
    meta_path = args.csv.with_suffix(".source.json")
    if args.check:
        if args.csv.read_bytes() != output or json.loads(meta_path.read_text(encoding="utf-8")) != metadata:
            raise SystemExit("CSV or provenance differs from the source PDF.")
        print("Verified all 137 source rows and provenance.")
    else:
        args.csv.parent.mkdir(parents=True, exist_ok=True)
        args.csv.write_bytes(output)
        meta_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
        print("Extracted 137 inclusive postcode ranges with source pages and SHA-256 provenance.")


if __name__ == "__main__":
    main()
