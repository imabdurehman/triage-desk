"""Tests for the training pipeline. Everything runs inside a temporary folder,
so the real data/ and models/ directories are never touched."""
import json

import pandas as pd
import pytest

from app.contract import CATEGORIES, PRIORITIES
from app.preprocessing.text import clean, combine, combine_rows
from training import make_seed_data
from training.import_csv import import_frame, parse_map
from training.model_io import list_versions, load_version, next_version
from training.split import FrozenTestSetError, make_split, verify
from training.train import train


@pytest.fixture
def workspace(tmp_path):
    """A throwaway copy of the data/ and models/ layout, filled with seed data."""
    paths = {
        "dataset": tmp_path / "processed" / "tickets.csv",
        "source": tmp_path / "processed" / "tickets.source.json",
        "train": tmp_path / "processed" / "train.csv",
        "test": tmp_path / "test" / "frozen_test.csv",
        "meta": tmp_path / "test" / "frozen_test.meta.json",
        "versions": tmp_path / "models" / "versions",
    }
    paths["dataset"].parent.mkdir(parents=True)
    make_seed_data.generate(rows=600).to_csv(paths["dataset"], index=False)
    paths["source"].write_text(json.dumps({"source": "seed", "synthetic": True}))
    return paths


def split(ws, **kw):
    return make_split(ws["dataset"], ws["train"], ws["test"], ws["meta"], **kw)


# ------------------------------------------------------------------ preprocessing
def test_clean_replaces_volatile_tokens():
    out = clean("Charged TWICE for order 48213! See https://x.co or mail a.b@c.com")
    assert out == "charged twice for order <num> see <url> or mail <email>"


def test_combine_weights_the_subject_twice():
    assert combine("Refund", "please") == "refund refund please"


# ------------------------------------------------------------------ data
def test_seed_data_only_uses_contract_labels():
    df = make_seed_data.generate(rows=300)
    assert set(df["category"]) <= set(CATEGORIES)
    assert set(df["priority"]) <= set(PRIORITIES)
    assert len(df) == 300


def test_import_maps_labels_and_drops_what_it_cannot_map():
    raw = pd.DataFrame({
        "Subj": ["a", "b", "c"], "Desc": ["x", "y", "z"],
        "Type": ["Billing inquiry", "Technical issue", "Something odd"],
        "Prio": ["Critical", "Low", "Low"],
    })
    cols = {"subject": "Subj", "body": "Desc", "category": "Type", "priority": "Prio"}
    df, report = import_frame(
        raw, cols,
        parse_map("Billing inquiry=billing,Technical issue=technical"),
        parse_map("Critical=urgent,Low=low"),
    )
    assert list(df["category"]) == ["billing", "technical"]
    assert list(df["priority"]) == ["urgent", "low"]
    assert report["dropped"] == 1
    assert report["unmapped_category_values"] == {"Something odd": 1}


def test_import_rejects_mapping_targets_outside_the_contract():
    raw = pd.DataFrame({"s": ["a"], "b": ["x"], "c": ["Bill"], "p": ["Low"]})
    cols = {"subject": "s", "body": "b", "category": "c", "priority": "p"}
    with pytest.raises(ValueError, match="not in contract"):
        import_frame(raw, cols, {"Bill": "payments"}, {"Low": "low"})


# ------------------------------------------------------------------ frozen test set
def test_split_has_no_overlap_and_refuses_to_overwrite(workspace):
    meta = split(workspace)
    train_df = pd.read_csv(workspace["train"])
    test_df = pd.read_csv(workspace["test"])
    train_keys = set(combine_rows(train_df))
    test_keys = set(combine_rows(test_df))
    assert not train_keys & test_keys, "a ticket must never be in both train and test"
    assert meta["rows"] == len(test_df)

    with pytest.raises(FrozenTestSetError, match="already exists"):
        split(workspace)


def test_editing_the_frozen_test_set_is_detected(workspace):
    split(workspace)
    verify(workspace["test"], workspace["meta"])  # untouched: passes
    with open(workspace["test"], "a") as fh:
        fh.write("tampered,row,billing,low\n")
    with pytest.raises(FrozenTestSetError, match="edited"):
        verify(workspace["test"], workspace["meta"])


# ------------------------------------------------------------------ training
def test_train_end_to_end_and_versioning(workspace):
    split(workspace)
    out = train(workspace["train"], workspace["test"], workspace["meta"], workspace["source"],
                workspace["versions"], c_grid=(1.0,), cv_folds=3)

    assert out["version"] == "v1"
    assert list_versions(workspace["versions"]) == ["v1"]
    assert next_version(workspace["versions"]) == "v2"
    assert out["metadata"]["seed_data"] is True

    models, metadata = load_version("v1", workspace["versions"])
    preds = models["category"].predict(["i was charged twice for my plan"])
    assert preds[0] in CATEGORIES
    proba = models["category"].predict_proba(["cannot log in to my account"])
    assert abs(proba.sum() - 1.0) < 1e-6

    cat = out["results"]["category"]
    assert cat["model"]["macro_f1"] > cat["majority_baseline"]["macro_f1"], \
        "the model must beat always-predict-the-most-common-label"
    assert set(metadata["labels"]["priority"]) <= set(PRIORITIES)


def test_training_refuses_without_a_frozen_test_set(workspace):
    with pytest.raises(FrozenTestSetError):
        train(workspace["train"], workspace["test"], workspace["meta"], workspace["source"],
              workspace["versions"], c_grid=(1.0,), cv_folds=3)


def test_fresh_clone_rebuilds_train_without_touching_the_test_set(workspace):
    from training.split import fingerprint, rebuild_train
    split(workspace)
    before = fingerprint(workspace["test"])
    workspace["train"].unlink()  # train.csv is not committed, so a clone lacks it

    ws = workspace
    r = rebuild_train(ws["dataset"], ws["train"], ws["test"], ws["meta"])
    assert workspace["train"].exists()
    assert r["train_rows"] > 0
    assert fingerprint(workspace["test"]) == before, "the frozen test set must be untouched"

    train_df = pd.read_csv(workspace["train"])
    test_df = pd.read_csv(workspace["test"])
    tk = set(combine_rows(train_df))
    sk = set(combine_rows(test_df))
    assert not tk & sk


def test_import_only_keeps_matching_rows():
    raw = pd.DataFrame({
        "subject": ["Charged twice", "Doppelt belastet", "App crashes"],
        "body": ["x", "y", "z"],
        "queue": ["Billing and Payments", "Billing and Payments", "Technical Support"],
        "priority": ["high", "high", "low"],
        "language": ["en", "de", "en"],
    })
    cols = {"subject": "subject", "body": "body", "category": "queue", "priority": "priority"}
    df, report = import_frame(
        raw, cols,
        {"Billing and Payments": "billing", "Technical Support": "technical"},
        {"high": "high", "low": "low"},
        only={"language": "en"},
    )
    assert list(df["subject"]) == ["Charged twice", "App crashes"]
    assert report["filtered_out"] == 1


def test_inspect_lists_the_values_a_map_must_match():
    from training.import_csv import inspect
    queues = ["Billing and Payments", "Technical Support", "Billing and Payments"]
    raw = pd.DataFrame({"queue": queues, "body": ["a", "b", "c"]})
    out = inspect(raw)
    assert "3 rows" in out
    assert "Billing and Payments" in out and "Technical Support" in out


# ------------------------------------------------------------------ seed + real data
def _public_rows(rows=900):
    """Stand-in for a public dataset: real-looking rows with NO account and NO urgent,
    the same gaps the tobiasbueck dataset has."""
    df = make_seed_data.generate(rows=rows, seed=7)
    df = df[(df["category"] != "account") & (df["priority"] != "urgent")].copy()
    df["source"] = "public"
    return df


@pytest.fixture
def merged(tmp_path):
    """Seed data plus the public stand-in, merged the way the guide describes."""
    paths = {
        "dataset": tmp_path / "processed" / "tickets.csv",
        "source": tmp_path / "processed" / "tickets.source.json",
        "train": tmp_path / "processed" / "train.csv",
        "test": tmp_path / "test" / "frozen_test.csv",
        "meta": tmp_path / "test" / "frozen_test.meta.json",
        "versions": tmp_path / "models" / "versions",
    }
    paths["dataset"].parent.mkdir(parents=True)
    seed = make_seed_data.generate(rows=600)
    pd.concat([seed, _public_rows()]).to_csv(paths["dataset"], index=False)
    paths["source"].write_text(json.dumps({"source": "merged", "synthetic": False}))
    return paths


def test_seed_rows_never_enter_the_test_set_once_real_data_exists(merged):
    meta = split(merged)
    test_df = pd.read_csv(merged["test"])
    train_df = pd.read_csv(merged["train"])
    assert set(test_df["source"]) == {"public"}, "the test set must be real data only"
    assert meta["test_from_seed"] is False
    assert (train_df["source"] == "seed").sum() > 0, "seed rows belong in training"


def test_seed_only_dataset_still_splits_and_says_so(workspace):
    meta = split(workspace)
    assert meta["test_from_seed"] is True


def test_duplicates_keep_the_real_copy(tmp_path):
    from training.split import _prepare
    row = {"subject": "Charged twice", "body": "I was charged twice", "category": "billing",
           "priority": "high"}
    path = tmp_path / "t.csv"
    pd.DataFrame([{**row, "source": "seed"}, {**row, "source": "public"}]).to_csv(path, index=False)
    df, removed = _prepare(path)
    assert removed == 1
    assert list(df["source"]) == ["public"]


def test_seed_phases_out_per_class(merged):
    from training.train import rows_for
    split(merged)
    train_df = pd.read_csv(merged["train"])
    rows, usage = rows_for(train_df, "category", phase_out_at=50)
    assert usage["classes_using_seed"] == ["account"], "seed fills only the class real data lacks"
    kept_seed = rows[rows["source"] == "seed"]
    assert set(kept_seed["category"]) == {"account"}
    assert usage["seed_rows_dropped"] > 0

    rows, usage = rows_for(train_df, "priority", phase_out_at=50)
    assert usage["classes_using_seed"] == ["urgent"]


def test_merged_training_learns_the_gap_class_and_reports_it_honestly(merged):
    split(merged)
    out = train(merged["train"], merged["test"], merged["meta"], merged["source"],
                merged["versions"], c_grid=(1.0,), cv_folds=3)
    models, metadata = load_version(out["version"], merged["versions"])

    assert "account" in models["category"].classes_, "seed data taught the missing class"
    assert "urgent" in models["priority"].classes_
    assert metadata["seed_usage"]["category"]["classes_using_seed"] == ["account"]
    assert metadata["seed_data"] is False

    # account has no real test rows, so it is reported as unmeasurable, not scored as zero.
    assert out["results"]["category"]["not_measurable"] == ["account"]
    assert out["results"]["priority"]["not_measurable"] == ["urgent"]
    assert "account" not in out["results"]["category"]["model"]["per_class"]


def test_import_tags_source_and_reserves_seed():
    raw = pd.DataFrame({"s": ["a"], "b": ["x"], "c": ["Bill"], "p": ["Low"]})
    cols = {"subject": "s", "body": "b", "category": "c", "priority": "p"}
    df, _ = import_frame(raw, cols, {"Bill": "billing"}, {"Low": "low"}, source="tobiasbueck")
    assert list(df["source"]) == ["tobiasbueck"]
    with pytest.raises(ValueError, match="reserved"):
        import_frame(raw, cols, {"Bill": "billing"}, {"Low": "low"}, source="seed")


def test_a_seed_row_fills_one_gap_never_two(merged):
    """account and urgent are both missing from real data. An account+urgent seed row
    must not train either model, or priority learns 'account words mean urgent'."""
    from training.train import rows_for
    split(merged)
    train_df = pd.read_csv(merged["train"])

    cat_rows, _ = rows_for(train_df, "category", phase_out_at=50)
    seed_cat = cat_rows[cat_rows["source"] == "seed"]
    assert "urgent" not in set(seed_cat["priority"])

    pri_rows, _ = rows_for(train_df, "priority", phase_out_at=50)
    seed_pri = pri_rows[pri_rows["source"] == "seed"]
    assert set(seed_pri["priority"]) == {"urgent"}
    assert "account" not in set(seed_pri["category"])


def test_rebuild_refuses_when_the_real_dataset_is_missing_locally(merged, tmp_path):
    """Teammate clones: the committed test set is public data, but they only generated
    seed data. Rebuilding would silently train on seed alone, so it must refuse."""
    from training.split import rebuild_train
    split(merged)
    seed_only = tmp_path / "seed_only.csv"
    make_seed_data.generate(rows=300).to_csv(seed_only, index=False)
    with pytest.raises(FrozenTestSetError, match="Import the same dataset"):
        rebuild_train(seed_only, tmp_path / "train.csv", merged["test"], merged["meta"])


def test_a_handful_of_real_rows_does_not_discard_the_seed(workspace):
    """First days in production: two confirmed tickets must not wipe out the seed."""
    from training.train import rows_for
    split(workspace)
    train_df = pd.read_csv(workspace["train"])
    early = pd.DataFrame([{"subject": "Locked out", "body": "Cannot sign in", "category": "account",
                           "priority": "high", "source": "production"}])
    rows, usage = rows_for(pd.concat([train_df, early]), "category", phase_out_at=50)
    assert usage["seed_rows_dropped"] == 0
    assert len(rows) == len(train_df) + 1
