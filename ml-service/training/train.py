"""Train the baseline: TF-IDF + Logistic Regression, one model per target.

    python -m training.train

Two separate classifiers are trained, one for category and one for priority,
because the two are different questions: category depends on WHAT the ticket is
about, priority on HOW urgent it sounds. One model per target keeps each simple
and lets each be tuned on its own.

The regularisation strength C is chosen by cross-validation on the TRAINING rows
only. The frozen test set is used once, at the end, to report the result. It is
never used to make a choice; if it were, the score would stop being honest.

Seed rows fill gaps and never compete with real data. For each target, a class
that already has SEED_PHASE_OUT_AT real rows trains on real rows only; seed rows
are used just for classes that real data does not cover yet. As real tickets
accumulate, seed data drops out on its own, class by class.

The result is saved as a new version (models/versions/v<N>/) and is NOT put into
service here. Promotion to the live API is feature/ml-api's job.
"""
import argparse
import json
import platform
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import sklearn
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GridSearchCV, StratifiedKFold
from sklearn.pipeline import Pipeline

from app.contract import CONTRACT_VERSION
from app.preprocessing.text import combine_rows
from training import config
from training.evaluate import CONTRACT_LABELS, evaluate_models, print_results
from training.model_io import next_version, save_version
from training.split import fingerprint, verify


def build_pipeline(C: float = 1.0) -> Pipeline:
    return Pipeline([
        # Word unigrams and bigrams: "charged twice" means more than "charged" + "twice".
        # sublinear_tf dampens a word repeated ten times in one long ticket.
        ("tfidf", TfidfVectorizer(ngram_range=(1, 2), min_df=2, max_df=0.95,
                                  sublinear_tf=True, max_features=50_000)),
        # class_weight="balanced" stops the model ignoring rare categories.
        ("clf", LogisticRegression(C=C, max_iter=2000, class_weight="balanced")),
    ])


def rows_for(train_df: pd.DataFrame, target: str, phase_out_at: int):
    """Training rows for one target: all real rows, plus seed rows for thin classes only.

    A class is "covered" once real data has phase_out_at rows of it; covered
    classes train on real rows only.

    When real data covers SOME classes of this target, a seed row may fill one
    gap, never two. If real data lacks both a category (say "account") and a
    priority (say "urgent"), an account + urgent seed row trains neither model.
    Otherwise the priority model learns "account words mean urgent", because the
    only urgent rows it sees that mention accounts are seed rows. Found by testing.

    When real data covers NONE of this target's classes yet (the first days in
    production), seed is still the whole training set, and that rule is skipped:
    applying it then would throw away every seed row.
    """
    is_seed = train_df["source"] == config.SEED_SOURCE
    real = train_df[~is_seed]
    covered = {}
    for t in config.TARGETS:
        counts = real[t].value_counts()
        covered[t] = set(counts[counts >= phase_out_at].index)

    keep_seed = ~train_df[target].isin(covered[target])
    if covered[target]:
        for other in config.TARGETS:
            if other != target and covered[other]:
                keep_seed &= train_df[other].isin(covered[other])

    keep = ~is_seed | keep_seed
    used = train_df[is_seed & keep]
    return train_df[keep], {
        "seed_rows_used": int(len(used)),
        "seed_rows_dropped": int((is_seed & ~keep).sum()),
        "classes_using_seed": sorted(used[target].unique().tolist()),
    }


def train(train_csv: Path = config.TRAIN_CSV, test_csv: Path = config.FROZEN_TEST_CSV,
          test_meta: Path = config.FROZEN_TEST_META, source_file: Path = config.DATASET_SOURCE,
          versions_dir: Path = config.VERSIONS_DIR, c_grid=config.C_GRID,
          cv_folds: int = config.CV_FOLDS, seed: int = config.RANDOM_SEED,
          phase_out_at: int = config.SEED_PHASE_OUT_AT,
          extra_rows: pd.DataFrame | None = None) -> dict:
    """Trains a new version. `extra_rows` adds rows to training only (never to the
    test set): the human-confirmed production tickets sent by the server."""
    verify(test_csv, test_meta)
    train_df = pd.read_csv(train_csv)
    test_df = pd.read_csv(test_csv)
    for d in (train_df, test_df):
        if "source" not in d.columns:
            d["source"] = "unknown"
    test_keys = set(combine_rows(test_df))
    if extra_rows is not None and len(extra_rows):
        extra = extra_rows[[k not in test_keys for k in combine_rows(extra_rows)]]
        merged = pd.concat([train_df, extra[config.COLUMNS]], ignore_index=True)
        merged["_key"] = combine_rows(merged)
        # When a production ticket duplicates an older row, the production copy wins.
        train_df = merged.drop_duplicates(subset="_key", keep="last").drop(columns="_key")

    x_train = combine_rows(train_df)
    leaked = test_keys.intersection(x_train)
    if leaked:
        raise RuntimeError(f"{len(leaked)} tickets appear in both train and test. "
                           "Re-run training.split to deduplicate.")

    models, tuning, seed_usage = {}, {}, {}
    for target in config.TARGETS:
        rows, seed_usage[target] = rows_for(train_df, target, phase_out_at)
        x_rows = combine_rows(rows)
        y = rows[target]
        unknown = set(y) - set(CONTRACT_LABELS[target])
        if unknown:
            raise ValueError(f"{target} labels not in contract.json: {sorted(unknown)}")

        # Every fold needs every class, so folds are capped by the rarest class.
        folds = max(2, min(cv_folds, int(y.value_counts().min())))
        search = GridSearchCV(
            build_pipeline(), {"clf__C": list(c_grid)}, scoring="f1_macro",
            cv=StratifiedKFold(n_splits=folds, shuffle=True, random_state=seed),
        )
        search.fit(x_rows, y)
        models[target] = search.best_estimator_
        tuning[target] = {"best_C": search.best_params_["clf__C"],
                          "cv_macro_f1": round(float(search.best_score_), 4), "cv_folds": folds}

    results = evaluate_models(models, train_df, test_df)

    source = json.loads(source_file.read_text()) if source_file.exists() else {}
    test_meta_info = json.loads(test_meta.read_text())
    version = next_version(versions_dir)
    metadata = {
        "version": version,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "algorithm": "tfidf + logistic_regression",
        "train_rows": len(train_df), "test_rows": len(test_df),
        "tuning": tuning,
        "labels": {t: sorted(set(train_df[t])) for t in config.TARGETS},
        "contract_version": CONTRACT_VERSION,
        "frozen_test_sha256": fingerprint(test_csv),
        "data_source": source.get("source", "unknown"),
        "train_rows_by_source": train_df["source"].value_counts().to_dict(),
        "seed_usage": seed_usage,
        "seed_phase_out_at": phase_out_at,
        # True when there is no real data at all: the scores are then not a result.
        "seed_data": bool(test_meta_info.get("test_from_seed", source.get("synthetic", False))),
        "sklearn_version": sklearn.__version__, "python_version": platform.python_version(),
    }
    folder = save_version(models, metadata, results, versions_dir)
    return {"version": version, "folder": folder, "metadata": metadata, "results": results}


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description="Train the baseline model")
    ap.add_argument("--cv-folds", type=int, default=config.CV_FOLDS)
    args = ap.parse_args(argv)
    out = train(cv_folds=args.cv_folds)
    for target, t in out["metadata"]["tuning"].items():
        print(f"  {target}: best C = {t['best_C']}, cross-validated macro F1 = {t['cv_macro_f1']}")
    for target, u in out["metadata"]["seed_usage"].items():
        if u["seed_rows_used"]:
            print(f"  {target}: {u['seed_rows_used']} seed rows used for "
                  f"{', '.join(u['classes_using_seed'])} ({u['seed_rows_dropped']} dropped)")
    print_results(out["version"], out["results"], out["metadata"]["seed_data"])
    print(f"\nsaved {out['folder']}  (not promoted; feature/ml-api does that)")


if __name__ == "__main__":
    main()
