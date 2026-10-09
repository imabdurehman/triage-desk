"""Create the frozen test set, ONCE.

The frozen test set is the only honest measure of the model: it is never trained
on, never tuned on, and never edited. Every model version is scored against the
same rows, so versions can be compared fairly.

Four protections are built in:
  1. Refuses to overwrite an existing frozen test set unless --force is given.
  2. Removes duplicate tickets BEFORE splitting. A ticket that appears in both
     train and test lets the model score well by memorising, not learning.
  3. Writes a fingerprint (SHA-256) of the test file. Training and evaluation
     check it and stop if the file has been changed by hand.
  4. Seed rows never enter the test set once real data exists. The test set is
     then drawn from real rows only, and every seed row goes to training. A test
     set containing seed rows would reward the model for recognising the seed
     generator's wording, not for understanding tickets.

    python -m training.split
    python -m training.split --force     # only when the dataset itself was replaced

After a fresh clone the frozen test set already exists (it is in git) but
train.csv does not. Running split then rebuilds train.csv only, and leaves the
frozen test set exactly as it is.
"""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
from sklearn.model_selection import train_test_split

from app.preprocessing.text import combine_rows
from training import config


class FrozenTestSetError(RuntimeError):
    """Raised when the frozen test set is missing, would be overwritten, or was edited."""


def _prepare(dataset: Path) -> tuple[pd.DataFrame, int]:
    """Load, tag missing sources, and deduplicate, keeping the REAL copy of any duplicate."""
    df = pd.read_csv(dataset)
    if "source" not in df.columns:
        df["source"] = "unknown"
    rows_in = len(df)
    df["_key"] = combine_rows(df)
    df["_seed"] = df["source"] == config.SEED_SOURCE
    df = df.sort_values("_seed", kind="stable").drop_duplicates(subset="_key")
    return df.reset_index(drop=True), rows_in - len(df)


def fingerprint(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def make_split(dataset: Path = config.DATASET_CSV, train_out: Path = config.TRAIN_CSV,
               test_out: Path = config.FROZEN_TEST_CSV, meta_out: Path = config.FROZEN_TEST_META,
               test_fraction: float = config.TEST_FRACTION, seed: int = config.RANDOM_SEED,
               force: bool = False) -> dict:
    if test_out.exists() and not force:
        raise FrozenTestSetError(
            f"{test_out} already exists. The frozen test set must not change between model "
            "versions. Use --force only if the whole dataset has been replaced."
        )

    df, duplicates = _prepare(dataset)

    # Draw the test set from real rows whenever any exist; seed only as a last resort.
    real, seeded = df[~df["_seed"]], df[df["_seed"]]
    seed_only = real.empty
    pool = df if seed_only else real

    # Stratify on category so every class appears in the test set in proportion
    # (only possible when every class has at least two rows).
    counts = pool["category"].value_counts()
    stratify = pool["category"] if counts.min() >= 2 else None
    train_part, test_df = train_test_split(
        pool, test_size=test_fraction, random_state=seed, stratify=stratify
    )
    train_df = train_part if seed_only else pd.concat([train_part, seeded])
    for d, out in ((train_df, train_out), (test_df, test_out)):
        out.parent.mkdir(parents=True, exist_ok=True)
        d[config.COLUMNS].to_csv(out, index=False)

    meta = {
        "rows": len(test_df), "train_rows": len(train_df),
        "test_from_seed": seed_only,
        "train_rows_by_source": train_df["source"].value_counts().to_dict(),
        "test_rows_by_source": test_df["source"].value_counts().to_dict(),
        "duplicates_removed": duplicates, "test_fraction": test_fraction, "seed": seed,
        "sha256": fingerprint(test_out), "source_dataset": dataset.name,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    meta_out.write_text(json.dumps(meta, indent=2))
    return meta


def rebuild_train(dataset: Path = config.DATASET_CSV, train_out: Path = config.TRAIN_CSV,
                  test_path: Path = config.FROZEN_TEST_CSV,
                  meta_path: Path = config.FROZEN_TEST_META) -> dict:
    """Recreate train.csv from the dataset WITHOUT touching the frozen test set.

    Used after a fresh clone: the frozen test set comes from git, but train.csv is
    not committed (it may hold customer data), so it is rebuilt locally as
    "every ticket in the dataset that is not in the frozen test set".
    """
    verify(test_path, meta_path)
    df, _ = _prepare(dataset)
    test = pd.read_csv(test_path)
    test_sources = set(test.get("source", pd.Series(dtype=str)).dropna()) - {config.SEED_SOURCE}
    if test_sources and df["_seed"].all():
        # The committed test set is real data, but this machine only has seed data.
        # Rebuilding now would train on seed alone and test on real rows: no error,
        # just a useless model. Stop and say what is missing.
        raise FrozenTestSetError(
            f"the frozen test set contains {sorted(test_sources)} data, but the local dataset "
            "is seed only. Import the same dataset first (python -m training.import_csv ... "
            "--append), then run split again."
        )
    frozen = set(combine_rows(test))
    train_df = df[~df["_key"].isin(frozen)]
    train_out.parent.mkdir(parents=True, exist_ok=True)
    train_df[config.COLUMNS].to_csv(train_out, index=False)
    return {"train_rows": len(train_df), "excluded_as_test": len(df) - len(train_df)}


def verify(test_path: Path = config.FROZEN_TEST_CSV, meta_path: Path = config.FROZEN_TEST_META):
    """Stop if the frozen test set is missing or has been edited since it was made."""
    if not test_path.exists() or not meta_path.exists():
        raise FrozenTestSetError("No frozen test set. Run: python -m training.split")
    expected = json.loads(meta_path.read_text())["sha256"]
    if fingerprint(test_path) != expected:
        raise FrozenTestSetError(
            f"{test_path} does not match its recorded fingerprint: it has been edited. "
            "Restore it from git rather than regenerating it."
        )


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description="Create the frozen test set")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args(argv)

    if config.FROZEN_TEST_CSV.exists() and not config.TRAIN_CSV.exists() and not args.force:
        try:
            r = rebuild_train()
        except FrozenTestSetError as e:
            raise SystemExit(f"refused: {e}") from None
        print(f"frozen test set found and left untouched: {config.FROZEN_TEST_CSV}")
        print(f"train.csv rebuilt: {r['train_rows']} rows "
              f"({r['excluded_as_test']} excluded because they are in the test set)")
        return

    try:
        meta = make_split(force=args.force)
    except FrozenTestSetError as e:
        raise SystemExit(f"refused: {e}") from None
    print(f"train: {meta['train_rows']} rows -> {config.TRAIN_CSV}")
    print(f"   by source: {meta['train_rows_by_source']}")
    print(f"frozen test: {meta['rows']} rows -> {config.FROZEN_TEST_CSV}")
    print(f"   by source: {meta['test_rows_by_source']}")
    if meta["test_from_seed"]:
        print("   (no real data yet, so the test set is seed data: scores are not a result)")
    print(f"duplicates removed before splitting: {meta['duplicates_removed']}")
    print("Commit data/test/ to git so the whole team scores against the same rows.")


if __name__ == "__main__":
    main()
