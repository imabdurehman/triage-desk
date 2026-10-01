"""Prediction service.

STUB until feature/ml-baseline lands. It returns a contract-valid answer with
zero confidence, so the server can build and test the full ticket flow -
including the low-confidence -> needsTriage path - before any model exists.

feature/ml-baseline replaces `predict()` with a real TF-IDF + LogisticRegression
pipeline loaded from models/current/. The function signature stays the same.
"""
from app.contract import CATEGORIES, PRIORITIES

MODEL_VERSION = "stub-0"
MODEL_LOADED = False


def predict(subject: str, body: str) -> dict:
    return {
        "category": "general" if "general" in CATEGORIES else CATEGORIES[0],
        "priority": "medium" if "medium" in PRIORITIES else PRIORITIES[0],
        "confidence": {"category": 0.0, "priority": 0.0},
        "modelVersion": MODEL_VERSION,
    }
