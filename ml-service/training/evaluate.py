"""Score a model version on the frozen test set.

    python -m training.evaluate              # latest version
    python -m training.evaluate --version v2

Every number is shown next to the "always predict the most common label"
baseline. A model that does not clearly beat it has learned nothing useful.
"""
import argparse
import json
from pathlib import Path

import pandas as pd

from app.contract import CATEGORIES, PRIORITIES
from app.preprocessing.text import combine_rows
from training import config
from training.metrics import format_report, majority_baseline, score
from training.model_io import list_versions, load_version
from training.split import verify

CONTRACT_LABELS = {"category": CATEGORIES, "priority": PRIORITIES}


def labels_for(target: str, *series) -> list[str]:
    """Contract labels that actually occur in the data, in contract order."""
    seen = set().union(*(set(s) for s in series))
    return [lab for lab in CONTRACT_LABELS[target] if lab in seen]


def evaluate_models(models: dict, train_df: pd.DataFrame, test_df: pd.DataFrame) -> dict:
    """Scores each target on the classes the test set actually contains.

    A class the model was trained on but the test set has no rows of (typically a
    class filled only by seed data) cannot be measured. It is listed under
    "not_measurable" rather than scored as zero, which would be equally wrong.
    """
    x_test = combine_rows(test_df)
    results = {}
    for target, model in models.items():
        labels = labels_for(target, test_df[target])
        trained = set(getattr(model, "classes_", train_df[target].unique()))
        predicted = model.predict(x_test)
        results[target] = {
            "model": score(test_df[target], predicted, labels),
            "majority_baseline": majority_baseline(train_df[target], test_df[target], labels),
            "not_measurable": [c for c in CONTRACT_LABELS[target] if c in trained - set(labels)],
        }
    return results


def print_results(version: str, results: dict, seed_data: bool) -> None:
    print(f"\nModel {version} on the frozen test set")
    for target, r in results.items():
        print(format_report(target, r["model"], r["majority_baseline"]))
        if r.get("not_measurable"):
            print(f"    not measurable yet (no real test rows): {', '.join(r['not_measurable'])}")
    if seed_data:
        print("\n  WARNING: trained on SEED data. These numbers are not a result; "
              "they only show that the pipeline works.")


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description="Evaluate a model version")
    ap.add_argument("--version", help="e.g. v2 (default: latest)")
    ap.add_argument("--versions-dir", type=Path, default=config.VERSIONS_DIR)
    args = ap.parse_args(argv)

    versions = list_versions(args.versions_dir)
    if not versions:
        raise SystemExit("No trained model found. Run: python -m training.train")
    version = args.version or versions[-1]

    verify()
    models, metadata = load_version(version, args.versions_dir)
    results = evaluate_models(models, pd.read_csv(config.TRAIN_CSV),
                              pd.read_csv(config.FROZEN_TEST_CSV))
    print_results(version, results, metadata.get("seed_data", False))
    print("\n" + json.dumps({t: r["model"]["macro_f1"] for t, r in results.items()}))


if __name__ == "__main__":
    main()
