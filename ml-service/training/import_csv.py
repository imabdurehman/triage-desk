"""Import a real ticket dataset and map its labels onto the contract.

External datasets use their own column names and label names ("Billing inquiry",
"Critical"). This script renames the columns, maps every label onto a value from
shared/contract.json, and refuses labels it cannot map, so nothing outside the
contract ever reaches training.

Example, for a CSV with columns "Ticket Subject", "Ticket Description",
"Ticket Type" and "Ticket Priority":

    python -m training.import_csv data/raw/tickets.csv
        --subject-col "Ticket Subject"   --body-col "Ticket Description"
        --category-col "Ticket Type"     --priority-col "Ticket Priority"
        --category-map "Billing inquiry=billing,Technical issue=technical,
                        Refund request=refund,Cancellation request=account,
                        Product inquiry=general"
        --priority-map "Low=low,Medium=medium,High=high,Critical=urgent"

(Written on several lines here for readability; type it as ONE line, and write
each map as one unbroken comma-separated string.)

Add --append to add these rows to the existing dataset instead of replacing it.
Every imported row is tagged with --source (default "public").
Add --only language=en to keep only matching rows of a multilingual dataset.
Run with --inspect first to see the exact column names and label spellings.
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from app.contract import CATEGORIES, PRIORITIES
from training import config


def parse_map(spec: str) -> dict[str, str]:
    """'Billing inquiry=billing,Critical=urgent' -> {'Billing inquiry': 'billing', ...}"""
    pairs = [p for p in (spec or "").split(",") if p.strip()]
    out = {}
    for p in pairs:
        if "=" not in p:
            raise ValueError(f"bad mapping '{p}', expected 'Source=target'")
        src, dst = p.split("=", 1)
        out[src.strip()] = dst.strip()
    return out


def parse_filters(specs) -> dict[str, str]:
    """['language=en'] -> {'language': 'en'}"""
    out = {}
    for spec in specs or []:
        if "=" not in spec:
            raise ValueError(f"bad filter '{spec}', expected 'column=value'")
        col, val = spec.split("=", 1)
        out[col.strip()] = val.strip()
    return out


def import_frame(raw: pd.DataFrame, cols: dict, category_map: dict, priority_map: dict,
                 only: dict | None = None, source: str = config.DEFAULT_IMPORT_SOURCE):
    """Returns (clean dataframe, report). Rows whose labels cannot be mapped are dropped.

    `only` keeps rows where each named column equals the given value, e.g.
    {"language": "en"}. Applied first, so a multilingual dataset can be reduced
    to one language before anything else happens.
    """
    if source == config.SEED_SOURCE:
        raise ValueError(f"'{config.SEED_SOURCE}' is reserved for generated data")
    bad = [v for v in category_map.values() if v not in CATEGORIES]
    bad += [v for v in priority_map.values() if v not in PRIORITIES]
    if bad:
        raise ValueError(f"mapping targets not in contract.json: {sorted(set(bad))}")

    missing = [c for c in [*cols.values(), *(only or {})] if c not in raw.columns]
    if missing:
        raise ValueError(f"columns not found in the CSV: {missing}")

    rows_in_file = len(raw)
    for col, val in (only or {}).items():
        raw = raw[raw[col].astype(str).str.strip() == val]

    df = pd.DataFrame({
        "subject": raw[cols["subject"]].astype(str).str.strip(),
        "body": raw[cols["body"]].astype(str).str.strip(),
        "category": raw[cols["category"]].astype(str).str.strip().map(category_map),
        "priority": raw[cols["priority"]].astype(str).str.strip().map(priority_map),
        "source": source,
    })
    before = len(df)
    unmapped_cat = raw.loc[df["category"].isna(), cols["category"]].value_counts().to_dict()
    unmapped_pri = raw.loc[df["priority"].isna(), cols["priority"]].value_counts().to_dict()
    df = df.dropna(subset=["category", "priority"])
    df = df[(df["subject"].str.len() > 0) & (df["body"].str.len() > 0)]
    report = {"rows_in_file": rows_in_file, "filtered_out": rows_in_file - before,
              "rows_in": before, "rows_out": len(df), "dropped": before - len(df),
              "unmapped_category_values": unmapped_cat, "unmapped_priority_values": unmapped_pri}
    return df.reset_index(drop=True), report


def inspect(raw: pd.DataFrame, max_values: int = 30) -> str:
    """Columns, row count, and the values of every low-cardinality column.

    Run this before writing a --category-map: dataset versions differ, and the
    map must use the exact spelling that is actually in the file.
    """
    lines = [f"{len(raw)} rows", f"columns: {', '.join(map(str, raw.columns))}", ""]
    for col in raw.columns:
        counts = raw[col].value_counts(dropna=False)
        if 1 < len(counts) <= max_values:
            lines.append(f"{col}:")
            lines += [f"  {v!s:<40} {n}" for v, n in counts.items()]
            lines.append("")
    return "\n".join(lines)


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description="Import a real ticket dataset")
    ap.add_argument("input", type=Path)
    ap.add_argument("--inspect", action="store_true",
                    help="only list the columns and their values, then stop")
    ap.add_argument("--subject-col")
    ap.add_argument("--body-col")
    ap.add_argument("--category-col")
    ap.add_argument("--priority-col")
    ap.add_argument("--category-map")
    ap.add_argument("--priority-map")
    ap.add_argument("--only", action="append", metavar="COLUMN=VALUE",
                    help="keep only matching rows, e.g. --only language=en (repeatable)")
    ap.add_argument("--source", default=config.DEFAULT_IMPORT_SOURCE,
                    help="label stored with every imported row (default: public)")
    ap.add_argument("--append", action="store_true", help="add to the existing dataset")
    ap.add_argument("--out", type=Path, default=config.DATASET_CSV)
    args = ap.parse_args(argv)
    raw = pd.read_csv(args.input)

    if args.inspect:
        print(inspect(raw))
        return
    needed = ["subject_col", "body_col", "category_col", "priority_col",
              "category_map", "priority_map"]
    missing = [f"--{n.replace('_', '-')}" for n in needed if not getattr(args, n)]
    if missing:
        ap.error(f"these are required unless --inspect is used: {' '.join(missing)}")

    cols = {"subject": args.subject_col, "body": args.body_col,
            "category": args.category_col, "priority": args.priority_col}
    df, report = import_frame(raw, cols, parse_map(args.category_map),
                              parse_map(args.priority_map), parse_filters(args.only), args.source)

    if args.append and args.out.exists():
        existing = pd.read_csv(args.out)
        if "source" not in existing.columns:
            existing["source"] = "unknown"
        df = pd.concat([existing, df], ignore_index=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.out, index=False)
    args.out.with_name("tickets.source.json").write_text(json.dumps({
        "source": str(args.input.name), "synthetic": False, "appended": args.append,
        "rows_by_source": df["source"].value_counts().to_dict(),
        "rows": len(df), "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }, indent=2))

    if report["filtered_out"]:
        print(f"--only kept {report['rows_in']} of {report['rows_in_file']} rows")
    print(f"imported {report['rows_out']} of {report['rows_in']} rows -> {args.out}")
    if report["dropped"]:
        print(f"  dropped {report['dropped']} rows with labels that are not mapped:")
        print("    category:", report["unmapped_category_values"])
        print("    priority:", report["unmapped_priority_values"])
    print("  category counts:", df["category"].value_counts().to_dict())
    print("  rows by source: ", df["source"].value_counts().to_dict())


if __name__ == "__main__":
    main()
