"""The live ML API: training through HTTP, promotion, and predictions from the
promoted model. Every path is redirected to a temporary folder."""
import time

import pytest
from fastapi.testclient import TestClient

from app.contract import CATEGORIES
from app.main import app
from app.services import model_store, predictor, trainer
from training import config, make_seed_data
from training.split import make_split


@pytest.fixture
def ml_home(tmp_path, monkeypatch):
    """A fresh data/ and models/ layout with seed data and a frozen test set."""
    paths = {
        "DATASET_CSV": tmp_path / "processed" / "tickets.csv",
        "DATASET_SOURCE": tmp_path / "processed" / "tickets.source.json",
        "TRAIN_CSV": tmp_path / "processed" / "train.csv",
        "PRODUCTION_CSV": tmp_path / "processed" / "production.csv",
        "FROZEN_TEST_CSV": tmp_path / "test" / "frozen_test.csv",
        "FROZEN_TEST_META": tmp_path / "test" / "frozen_test.meta.json",
        "MODELS_DIR": tmp_path / "models",
        "VERSIONS_DIR": tmp_path / "models" / "versions",
        "CURRENT_FILE": tmp_path / "models" / "current" / "VERSION",
        "RUNS_FILE": tmp_path / "models" / "runs.json",
    }
    for name, value in paths.items():
        monkeypatch.setattr(config, name, value)
    monkeypatch.setattr(config, "C_GRID", (1.0,))
    monkeypatch.setattr(config, "CV_FOLDS", 3)
    paths["DATASET_CSV"].parent.mkdir(parents=True)
    make_seed_data.generate(rows=600).to_csv(paths["DATASET_CSV"], index=False)
    make_split(paths["DATASET_CSV"], paths["TRAIN_CSV"], paths["FROZEN_TEST_CSV"],
               paths["FROZEN_TEST_META"])
    with TestClient(app) as client:
        yield client
    monkeypatch.undo()
    predictor.reload()  # back to whatever is live outside the test


CONFIRMED = [
    {"subject": "Locked out", "body": "I cannot sign in to my account at all.",
     "category": "account", "priority": "high"},
    {"subject": "Refund please", "body": "Please refund my last payment, it failed.",
     "category": "refund", "priority": "medium"},
]


def wait_for(client, run_id, timeout=60):
    deadline = time.time() + timeout
    while time.time() < deadline:
        run = client.get(f"/train/{run_id}").json()
        if run["status"] != "started":
            return run
        time.sleep(0.2)
    raise AssertionError(f"run {run_id} did not finish in {timeout}s")


def test_no_model_yet(ml_home):
    assert ml_home.get("/health").json()["modelLoaded"] is False
    r = ml_home.get("/metrics")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "NO_MODEL"
    pred = ml_home.post("/predict", json={"subject": "x", "body": "y"}).json()
    assert pred["confidence"]["category"] == 0.0, "zero confidence sends it to a person"


def test_first_training_run_is_promoted_and_served(ml_home):
    started = ml_home.post("/train", json={"tickets": CONFIRMED})
    assert started.status_code == 202
    run = wait_for(ml_home, started.json()["runId"])
    assert run["status"] == "succeeded", run.get("error")
    assert run["promoted"] is True
    assert run["productionTickets"] == 2

    health = ml_home.get("/health").json()
    assert health == {**health, "modelLoaded": True, "modelVersion": run["version"]}

    pred = ml_home.post("/predict", json={"subject": "Charged twice",
                                          "body": "I was charged twice this month"}).json()
    assert pred["modelVersion"] == run["version"]
    assert pred["category"] in CATEGORIES
    assert pred["confidence"]["category"] > 0

    metrics = ml_home.get("/metrics").json()
    assert metrics["modelVersion"] == run["version"]
    assert "category" in metrics["results"]

    production = config.PRODUCTION_CSV.read_text()
    assert "Locked out" in production and "production" in production


def test_a_worse_model_is_kept_but_not_served(ml_home, monkeypatch):
    first = wait_for(ml_home, ml_home.post("/train", json={"tickets": []}).json()["runId"])
    monkeypatch.setattr(model_store, "category_macro_f1", lambda version: 1.01)  # unbeatable
    second = wait_for(ml_home, ml_home.post("/train", json={"tickets": []}).json()["runId"])
    assert second["status"] == "succeeded"
    assert second["promoted"] is False
    assert model_store.current_version() == first["version"]
    assert (config.VERSIONS_DIR / second["version"]).exists(), "kept on disk for inspection"


def test_one_run_at_a_time(ml_home, monkeypatch):
    monkeypatch.setitem(trainer._active, "run_id", "run-in-progress")
    r = ml_home.post("/train", json={"tickets": []})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "TRAINING_BUSY"


def test_training_needs_prepared_data(ml_home):
    config.TRAIN_CSV.unlink()
    r = ml_home.post("/train", json={"tickets": []})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "NOT_READY"


def test_confirmed_tickets_must_use_contract_labels(ml_home):
    bad = [{**CONFIRMED[0], "category": "payments"}]
    r = ml_home.post("/train", json={"tickets": bad})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_docs_prefill_a_training_request_that_works(ml_home):
    schema = ml_home.get("/openapi.json").json()["components"]["schemas"]["TrainRequest"]
    example = schema["examples"][0]
    started = ml_home.post("/train", json=example)
    assert started.status_code == 202
    wait_for(ml_home, started.json()["runId"])  # finish inside the temporary folder
    assert ml_home.get("/", follow_redirects=False).headers["location"] == "/docs"


def test_unknown_run(ml_home):
    r = ml_home.get("/train/nope")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "RUN_NOT_FOUND"
