"""Which model version is live, and switching it.

The live version's name lives in models/current/VERSION. Paths are read from
training.config at call time, so tests can point them at a temporary folder.
"""
import json

from training import config
from training.model_io import load_version


def current_version() -> str | None:
    f = config.CURRENT_FILE
    if not f.exists():
        return None
    return f.read_text().strip() or None


def set_current(version: str) -> None:
    f = config.CURRENT_FILE
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(".tmp")
    tmp.write_text(version)
    tmp.replace(f)  # atomic: a reader never sees a half-written file


def load(version: str):
    return load_version(version, config.VERSIONS_DIR)


def metrics_of(version: str) -> dict:
    return json.loads((config.VERSIONS_DIR / version / "metrics.json").read_text())


def category_macro_f1(version: str) -> float:
    """The number promotion is decided on."""
    return metrics_of(version)["category"]["model"]["macro_f1"]
