"""Paths and constants for the training pipeline.

Every function in training/ takes its paths as arguments and falls back to these
defaults, so tests can run the whole pipeline inside a temporary folder.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]  # ml-service/

DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
TEST_DIR = DATA_DIR / "test"

DATASET_CSV = PROCESSED_DIR / "tickets.csv"          # every labelled row
DATASET_SOURCE = PROCESSED_DIR / "tickets.source.json"  # where those rows came from
TRAIN_CSV = PROCESSED_DIR / "train.csv"              # dataset minus the frozen test set
FROZEN_TEST_CSV = TEST_DIR / "frozen_test.csv"       # never trained on, never edited
FROZEN_TEST_META = TEST_DIR / "frozen_test.meta.json"  # fingerprint that detects edits

PRODUCTION_CSV = PROCESSED_DIR / "production.csv"    # human-confirmed tickets from the server

MODELS_DIR = ROOT / "models"
VERSIONS_DIR = MODELS_DIR / "versions"
CURRENT_FILE = MODELS_DIR / "current" / "VERSION"    # name of the live version, e.g. "v3"
RUNS_FILE = MODELS_DIR / "runs.json"                 # history of training runs started via the API

COLUMNS = ["subject", "body", "category", "priority", "source"]

# Where a row came from. "seed" is synthetic filler; everything else is real
# data of some kind ("public" dataset, later "production" tickets).
SEED_SOURCE = "seed"
DEFAULT_IMPORT_SOURCE = "public"

# Seed rows for a class are dropped from training once real data has at least
# this many rows of that class. Seed fills gaps; it never competes with real data.
SEED_PHASE_OUT_AT = 50
TARGETS = ("category", "priority")
RANDOM_SEED = 42
TEST_FRACTION = 0.2
C_GRID = (0.3, 1.0, 3.0, 10.0)   # regularisation strengths tried by cross-validation
CV_FOLDS = 5
