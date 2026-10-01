"""Loads shared/contract.json - the same file the Node server and React client read.

Import labels from here. Never hardcode a category or priority string.
"""
import json
from pathlib import Path

_CONTRACT_PATH = Path(__file__).resolve().parents[2] / "shared" / "contract.json"

with _CONTRACT_PATH.open(encoding="utf-8") as fh:
    CONTRACT: dict = json.load(fh)

CATEGORIES: tuple[str, ...] = tuple(CONTRACT["categories"])
PRIORITIES: tuple[str, ...] = tuple(CONTRACT["priorities"])
CONTRACT_VERSION: int = CONTRACT["version"]
