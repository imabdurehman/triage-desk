# TriageDesk

Support-ticket system that classifies incoming tickets by **category** and
**priority** with an ML model, routes them to the right agent, and tracks SLAs.

| Part | Stack | Owns |
|---|---|---|
| `client/` | React + Vite | Everything the user sees |
| `server/` | Node + Express + MongoDB | Product logic, auth, tickets, scheduler |
| `ml-service/` | Python + FastAPI + scikit-learn | Training and prediction |
| `shared/` | `contract.json` | Every enum all three read |

**Start here:** `CONTRACT.md` (what talks to what, and in which shape) and
`AI_RULES.md` (paste into your AI assistant at the start of every session).

## How a ticket flows

```
Customer ─▶ React ─▶ POST /api/tickets ─▶ Express
                                            │  subject + body
                                            ▼
                                   FastAPI /predict ─▶ { category, priority, confidence }
                                            │
                           ML down or low confidence?  ──yes──▶ needsTriage = true
                                            │ no
                                            ▼
                                  MongoDB ─▶ routed to an agent for that category
```

## Setup

Requirements: Node 20+, Python 3.11+, MongoDB running locally (or an Atlas URI).

```bash
# server
cd server
cp .env.example .env          # set MONGO_URI
npm install
npm run dev                   # http://localhost:5000/api/health

# ml-service  (second terminal)
cd ml-service
python -m venv .venv
source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000     # http://localhost:8000/health
```

## Tests

```bash
cd server && npm test                         # node:test + supertest
cd ml-service && python -m pytest -q          # pytest
```

## Branches

Never commit to `main`. One branch per feature, one PR each, reviewed by
another member before merge.

| Branch | Owner | Delivers |
|---|---|---|
| `feature/backend-auth` | Backend | User model, register/login, JWT access + rotating refresh, role guards |
| `feature/backend-tickets` | Backend | Ticket model, CRUD, assignment, status transitions, ML integration |
| `feature/frontend-auth` | Frontend | Login/register, AuthContext, ProtectedRoute, RoleRoute |
| `feature/frontend-tickets` | Frontend | Customer, agent and manager ticket pages |
| `feature/ml-baseline` | ML | Dataset, TF-IDF + Logistic Regression, frozen test set, evaluation |
| `feature/ml-api` | ML | Real /predict, /train, /metrics, model versioning and promotion |
| `feature/scheduler` | Shared | The six scheduled jobs |

## Status

- [x] Repo structure, shared contract, AI rules
- [x] Server foundation: config, error format, health, meta — 5 tests
- [x] ML service stub returning contract-valid predictions — 3 tests
- [ ] Everything in the branch table above

The ML stub returns `confidence: 0`, so until `feature/ml-baseline` lands every
ticket goes down the `needsTriage` path. That is deliberate: the backend can
build and test the whole flow, including the fallback, from day one.
