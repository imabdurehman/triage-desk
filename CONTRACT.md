# TriageDesk — Contract

This file and `shared/contract.json` are the agreement between the three parts
of the system. Build against them, not against assumptions. If you need to
change anything here, open a PR that touches all three services at once.

---

## 1. Shared values

All enums live in `shared/contract.json`. Every service reads them from there.

| Name | Values |
|---|---|
| roles | `customer`, `agent`, `manager` |
| categories | `billing`, `technical`, `account`, `refund`, `general` |
| priorities | `low`, `medium`, `high`, `urgent` |
| statuses | `open`, `assigned`, `in_progress`, `waiting_customer`, `resolved`, `closed` |

Always lowercase, always snake_case. Display labels ("In Progress") are a
frontend concern and are derived, never stored.

---

## 2. Error format — every endpoint, every service

```json
{ "error": { "code": "TICKET_NOT_FOUND", "message": "Ticket not found", "details": {} } }
```

- `code` is UPPER_SNAKE_CASE and stable. The frontend switches on it.
- `message` is human-readable and may change.
- `details` is optional (validation errors put field messages here).

HTTP status carries the class of error: 400 validation, 401 not
authenticated, 403 not allowed, 404 not found, 409 conflict, 502 upstream
(ML) failure, 500 everything else.

---

## 3. Server API (Express, `/api`)

Status: planned endpoints are marked; build them in the branch listed.

### Auth — `feature/backend-auth`
| Method | Path | Who | Body | Returns |
|---|---|---|---|---|
| POST | `/api/auth/register` | public | `name, email, password` | `{ user, accessToken }` + refresh cookie |
| POST | `/api/auth/login` | public | `email, password` | `{ user, accessToken }` + refresh cookie |
| POST | `/api/auth/refresh` | refresh cookie | — | `{ accessToken }` + rotated cookie |
| POST | `/api/auth/logout` | auth | — | `204` |
| GET  | `/api/auth/me` | auth | — | `{ user }` |

Access token: JWT, 15 min, sent as `Authorization: Bearer`.
Refresh token: JWT, 7 days, httpOnly cookie, **rotated on every use**.
Public registration always creates a `customer`. Agents and managers are
created by a manager.

### Tickets — `feature/backend-tickets`
| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/api/tickets` | customer | `subject, body`. Server calls ML, never trusts client category. |
| GET | `/api/tickets` | all | Customers see own; agents see assigned; managers see all. Supports `status, category, priority, page, limit`. |
| GET | `/api/tickets/:id` | owner / assigned agent / manager | |
| PATCH | `/api/tickets/:id/status` | agent, manager | Must follow `statusTransitions`. |
| PATCH | `/api/tickets/:id/assign` | manager | `agentId` |
| PATCH | `/api/tickets/:id/triage` | agent, manager | Override `category` / `priority`. Records `overriddenBy`. |
| POST | `/api/tickets/:id/comments` | participants | `body` |

### Users — manager only
| Method | Path | Notes |
|---|---|---|
| GET | `/api/users` | filter by `role` |
| POST | `/api/users` | create agent or manager |
| PATCH | `/api/users/:id` | role, active, categories an agent handles |

### Manager — `feature/backend-tickets`
| Method | Path | Returns |
|---|---|---|
| GET | `/api/manager/metrics` | counts by status/category, SLA breaches, ML accuracy vs overrides |

---

## 4. Ticket shape

```json
{
  "_id": "…",
  "subject": "Charged twice this month",
  "body": "I was charged twice for my subscription…",
  "customer": "<userId>",
  "status": "open",

  "category": "billing",
  "priority": "high",

  "predictedCategory": "billing",
  "predictedPriority": "high",
  "predictionConfidence": { "category": 0.91, "priority": 0.74 },
  "modelVersion": "v3",
  "needsTriage": false,
  "overriddenBy": null,

  "assignedAgent": "<userId> | null",
  "slaDueAt": "2026-09-29T14:00:00.000Z",
  "slaBreached": false,

  "createdAt": "…",
  "updatedAt": "…"
}
```

`category` / `priority` are what the system acts on.
`predicted*` are what the model said. Keeping both is what lets the manager
dashboard measure how often the model is overridden.

---

## 5. Server ↔ ML service

Node owns the product. Python owns the model. They talk over HTTP only.
Base URL: `ML_SERVICE_URL` (default `http://localhost:8000`).

### POST `/predict`
Request
```json
{ "subject": "Charged twice", "body": "I was charged twice for my subscription" }
```
Response `200`
```json
{
  "category": "billing",
  "priority": "high",
  "confidence": { "category": 0.91, "priority": 0.74 },
  "modelVersion": "v3"
}
```
`category` and `priority` MUST be values from `contract.json`.

### GET `/health`
```json
{ "status": "ok", "modelLoaded": true, "modelVersion": "v3" }
```

### POST `/train`
```json
{ "runId": "2026-09-28T02:00:00Z", "status": "started" }
```

### GET `/metrics`
```json
{ "modelVersion": "v3", "accuracy": 0.84, "macroF1": 0.81, "trainedAt": "…", "testSetSize": 400 }
```

### When ML is down or slow — the rule that matters most
Ticket creation must **never** fail because the ML service is unavailable.

If `/predict` errors, or takes longer than `ml.predictTimeoutMs` (3 s):
- save the ticket anyway
- `category: null`, `priority: "medium"`, `needsTriage: true`
- a manager/agent triages it by hand

Same rule if confidence is below `ml.minConfidenceForAutoRoute` (0.6): keep
the prediction, but set `needsTriage: true` instead of auto-routing.
