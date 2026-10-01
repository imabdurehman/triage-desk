"""Saving and loading model versions.

A version is a folder, models/versions/v<N>/, holding:
  model.joblib   {"category": Pipeline, "priority": Pipeline}
  metadata.json  how it was trained
  metrics.json   how it scored on the frozen test set

feature/ml-api loads these through load_version(); nothing else should read the
files directly.
"""
import json
import re
from pathlib import Path

import joblib

from training import config

_VERSION = re.compile(r"^v(\d+)$")


def list_versions(versions_dir: Path = config.VERSIONS_DIR) -> list[str]:
    if not versions_dir.exists():
        return []
    found = [(int(m.group(1)), p.name) for p in versions_dir.iterdir()
             if p.is_dir() and (m := _VERSION.match(p.name))]
    return [name for _, name in sorted(found)]


def next_version(versions_dir: Path = config.VERSIONS_DIR) -> str:
    existing = list_versions(versions_dir)
    last = int(existing[-1][1:]) if existing else 0
    return f"v{last + 1}"


def save_version(models: dict, metadata: dict, metrics: dict,
                 versions_dir: Path = config.VERSIONS_DIR) -> Path:
    version = metadata["version"]
    folder = versions_dir / version
    folder.mkdir(parents=True, exist_ok=False)  # never overwrite an existing version
    joblib.dump(models, folder / "model.joblib")
    (folder / "metadata.json").write_text(json.dumps(metadata, indent=2))
    (folder / "metrics.json").write_text(json.dumps(metrics, indent=2))
    return folder


def load_version(version: str, versions_dir: Path = config.VERSIONS_DIR):
    folder = versions_dir / version
    if not (folder / "model.joblib").exists():
        raise FileNotFoundError(f"model version {version} not found in {versions_dir}")
    models = joblib.load(folder / "model.joblib")
    metadata = json.loads((folder / "metadata.json").read_text())
    return models, metadata
