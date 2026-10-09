"""Training runs started through the API: one at a time, in a background thread.

A finished run is promoted to live only if its category macro F1 on the frozen
test set is at least the live model's. A worse model is kept on disk but never
served. Every run is recorded in models/runs.json, promoted or not.
"""
import json
import threading
import uuid
from datetime import datetime, timezone

import pandas as pd

from app.services import model_store, predictor
from training import config
from training.train import train


class TrainingBusy(Exception):
    """A run is already in progress."""


class NotReady(Exception):
    """The dataset or the frozen test set has not been prepared yet."""


_lock = threading.Lock()
_active: dict = {"run_id": None}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _load_runs() -> dict:
    f = config.RUNS_FILE
    return json.loads(f.read_text()) if f.exists() else {}


def _save_run(run: dict) -> None:
    with _lock:
        runs = _load_runs()
        runs[run["runId"]] = run
        config.RUNS_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = config.RUNS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(runs, indent=2))
        tmp.replace(config.RUNS_FILE)


def get_run(run_id: str) -> dict | None:
    return _load_runs().get(run_id)


def _production_rows(tickets: list[dict]) -> pd.DataFrame:
    """Writes the server's confirmed tickets to production.csv and returns them."""
    df = pd.DataFrame(tickets, columns=["subject", "body", "category", "priority"])
    df["source"] = "production"
    config.PRODUCTION_CSV.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(config.PRODUCTION_CSV, index=False)
    return df


def _execute(run: dict, tickets: list[dict]) -> None:
    try:
        out = train(config.TRAIN_CSV, config.FROZEN_TEST_CSV, config.FROZEN_TEST_META,
                    config.DATASET_SOURCE, config.VERSIONS_DIR, config.C_GRID, config.CV_FOLDS,
                    extra_rows=_production_rows(tickets))
        live = model_store.current_version()
        new_f1 = out["results"]["category"]["model"]["macro_f1"]
        promoted = live is None or new_f1 >= model_store.category_macro_f1(live)
        if promoted:
            model_store.set_current(out["version"])
            predictor.reload()
        run.update(status="succeeded", version=out["version"], promoted=promoted,
                   previousVersion=live,
                   metrics={t: r["model"]["macro_f1"] for t, r in out["results"].items()})
    except Exception as err:  # recorded, never raised: this runs in a background thread
        run.update(status="failed", error=str(err))
    finally:
        run["finishedAt"] = _now()
        _save_run(run)
        with _lock:
            _active["run_id"] = None


def start(tickets: list[dict]) -> dict:
    if not config.TRAIN_CSV.exists() or not config.FROZEN_TEST_CSV.exists():
        raise NotReady("No training data yet. "
                       "Run training.make_seed_data and training.split first.")
    with _lock:
        if _active["run_id"]:
            raise TrainingBusy(_active["run_id"])
        run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:6]
        _active["run_id"] = run_id
    run = {"runId": run_id, "status": "started", "startedAt": _now(),
           "productionTickets": len(tickets)}
    _save_run(run)
    threading.Thread(target=_execute, args=(run, tickets), daemon=True).start()
    return run
