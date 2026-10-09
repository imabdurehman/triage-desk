"""Predictions from the live model version.

With no model promoted yet, it answers "general" / "medium" with zero
confidence. That is still a valid answer under the contract, and zero confidence
makes the server send the ticket to a person for triage.
"""
import threading

from app.contract import CATEGORIES, PRIORITIES
from app.preprocessing.text import combine
from app.services import model_store

_lock = threading.Lock()
_state: dict = {"models": None, "version": None}


def reload() -> None:
    """Load whichever version is live. Called at startup and after a promotion."""
    version = model_store.current_version()
    models = model_store.load(version)[0] if version else None
    with _lock:
        _state.update(models=models, version=version)


def status() -> dict:
    with _lock:
        return {"modelLoaded": _state["models"] is not None,
                "modelVersion": _state["version"] or "none"}


def predict(subject: str, body: str) -> dict:
    with _lock:
        models, version = _state["models"], _state["version"]
    if models is None:
        return {
            "category": "general" if "general" in CATEGORIES else CATEGORIES[0],
            "priority": "medium" if "medium" in PRIORITIES else PRIORITIES[0],
            "confidence": {"category": 0.0, "priority": 0.0},
            "modelVersion": "none",
        }
    x = [combine(subject, body)]
    labels, confidence = {}, {}
    for target in ("category", "priority"):
        proba = models[target].predict_proba(x)[0]
        best = int(proba.argmax())
        labels[target] = str(models[target].classes_[best])
        confidence[target] = round(float(proba[best]), 4)
    return {**labels, "confidence": confidence, "modelVersion": version}
