# Rules for every AI coding assistant on this repo

Paste this file at the start of every session with your assistant. Three of us
use three different assistants; these rules are what keep the code looking
like one team wrote it.

## Read first
1. `CONTRACT.md` — endpoints, shapes, error format, ML fallback rule.
2. `shared/contract.json` — every enum. **Never hardcode a category, priority,
   status or role string.** Import it.

## Server (Node / Express)
- **ES modules** (`import` / `export`). No `require`.
- Layers, and what may live in each:
  - `routes/` — URL + middleware wiring only. No logic.
  - `controllers/` — read `req`, call a service, send `res`. No DB calls, no business rules.
  - `services/` — all business logic. The only place that touches models.
  - `models/` — Mongoose schemas. Enums come from `config/contract.js`.
  - `middleware/` — auth, roles, validation, errors.
  - `jobs/` — scheduled tasks. Each job is one file exporting `run()`.
- Wrap every async controller in `asyncHandler`. Never write try/catch in a controller.
- Throw `new ApiError(status, 'CODE', 'message')` for expected errors. The error
  middleware formats it. Never `res.status(...).json({...})` an error by hand.
- Validate request bodies in `validators/` before they reach a controller.
- Config comes from `config/env.js` only. Never read `process.env` elsewhere.
- Never log passwords, tokens, or full ticket bodies.

## ML service (Python / FastAPI)
- Python 3.11+. Type hints on every function.
- Labels come from `shared/contract.json` via `app/contract.py`. Never hardcode.
- Start simple: TF-IDF + Logistic Regression. Do not introduce BERT or any
  transformer unless the baseline is measured and shown insufficient.
- The frozen test set in `data/test/` is never trained on and never edited.
- A new model version is promoted only if its category macro F1 on the frozen
  test set is at least the live model's. Record the run either way.

## Client (React)
- Functional components and hooks only.
- API calls live in `services/`. Components never call `fetch`/`axios` directly.
- Role-based routing through `RequireRole`. Never hide a page with CSS alone;
  the server enforces permissions, the client only mirrors them.
- Display labels derived from contract values, e.g. `in_progress` → "In Progress".

## Git
- One branch per feature, from `develop`: `feature/*` → `develop` → `main`.
  Never commit to `main` directly.
- Commit messages: `feat:`, `fix:`, `test:`, `docs:`, `refactor:`.
- One PR per feature. Another team member reviews before merge.
- Never commit `.env`, trained model binaries, or raw datasets.

## When the assistant is unsure
Ask the team rather than inventing an endpoint, field name or enum value. An
invented name that "looks right" is the most common way three assistants drift
apart.
