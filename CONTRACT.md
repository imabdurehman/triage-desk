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

Every route except register, login, refresh and `/api/health` needs
`Authorization: Bearer <accessToken>`. An expired token answers
`401 TOKEN_EXPIRED`; the client refreshes once and retries.

### Auth
| Method | Path | Who | Body | Returns |
|---|---|---|---|---|
| POST | `/api/auth/register` | public | `name, email, password` | `201 { user, accessToken }` + refresh cookie |
| POST | `/api/auth/login` | public | `email, password` | `{ user, accessToken }` + refresh cookie |
| POST | `/api/auth/refresh` | refresh cookie | none | `{ user, accessToken }` + rotated cookie |
| POST | `/api/auth/logout` | signed in | none | `204` |
| GET  | `/api/auth/me` | signed in | none | `{ user }` |

Access token: JWT, 15 min (`ACCESS_TOKEN_TTL`). Refresh token: JWT, 7 days,
httpOnly cookie on `/api/auth`, **rotated on every use**; reusing an old one
ends every session of that user. Public registration always creates a
`customer`. Agents and managers are created by a manager.

### Tickets
| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/api/tickets` | customer | `subject` (3 to 300), `body` (10 to 20,000). The server asks the ML service; the client never sends a category. |
| GET | `/api/tickets` | all | See "Who sees what". Query: `status, active, category, priority, needsTriage, page, limit` (limit 1 to 100, default 20). `active=true` means not resolved or closed; ignored when `status` is given. Sorted by SLA due time. Returns `{ items, total, page, pages }`. |
| GET | `/api/tickets/workload` | agent, manager | `{ agents: [{ id, name, categories, pending, resolvedToday }] }`: an agent gets only themselves, a manager every active agent. |
| GET | `/api/tickets/:id` | anyone who can see it | Returns `{ ticket }` with names filled in for customer, agent, comment authors and history. |
| PATCH | `/api/tickets/:id/status` | assigned agent, manager | `status`, and `note`. Must follow `statusTransitions`, else `409 INVALID_TRANSITION`. Moving to `resolved` **requires** a `note` of 10+ characters: it becomes `resolution`, shown to the customer and emailed to them. Leaving `waiting_customer` moves `slaDueAt` later by the time spent waiting. Leaving `resolved` reopens the ticket with a fresh SLA. |
| PATCH | `/api/tickets/:id/assign` | manager | `agentId` of an active agent. |
| PATCH | `/api/tickets/:id/triage` | agent, manager | `category` and/or `priority`. Clears `needsTriage`, recomputes the SLA, routes the ticket, and sets `overriddenBy` only if the answer differs from the model's. |
| POST | `/api/tickets/:id/comments` | anyone who can see it | `body`, and for staff `internal: true` for a note customers never see. A customer reply to a `waiting_customer` or `resolved` ticket moves it back to `in_progress` (a resolved one is reopened). |
| POST | `/api/tickets/:id/images` | anyone who can see it | multipart, field `images`: 1 to 3 files, 2 MB each, at most 10 per ticket, not on a closed ticket. Only PNG, JPEG, GIF and WebP, recognised by their content. Returns `201 { ticket }`. |
| GET | `/api/tickets/:id/images/:filename` | anyone who can see it | The image itself, with its image content type. |

**Who sees what.** Customers see their own tickets. Agents see tickets assigned
to them plus the triage queue (unassigned tickets with `needsTriage`). Managers
see everything. A ticket someone may not see answers `404`, never `403`, so its
existence is not revealed. Customers never receive `predicted*`,
`predictionConfidence`, `modelVersion`, `overriddenBy`, `history` or internal
notes.

### Users (manager only)
| Method | Path | Notes |
|---|---|---|
| GET | `/api/users` | optional `role`; returns `{ users }` |
| POST | `/api/users` | `name, email, password, role` (agent or manager), `categories` |
| PATCH | `/api/users/:id` | any of `email, role, active, categories`. A new email must not belong to another account (`409 EMAIL_TAKEN`). A manager cannot deactivate or demote themselves. Deactivating ends that user's sessions. |

An agent with no `categories` handles every category.

**Who gets a new ticket.** The model decides what the ticket is; routing decides
who takes it. It learns first from the managers, then from each agent's results:

- **As the managers do:** if managers have manually given tickets of this
  priority and category to one agent at least 3 times in the last 90 days, that
  agent gets it; failing that, the same for the category alone. Each ticket counts
  once, by its final manual assignment and its confirmed (triaged) labels.
- Otherwise, candidates are the active agents who handle its category; if nobody
  does, every active agent, so a ticket is never left with nobody.
- Agents with `MAX_OPEN_TICKETS` (default 15) open tickets are skipped while
  anyone else has room.
- **Urgent and high:** the agent who has resolved this category fastest over the
  last 90 days (time from arrival to final resolution, so a reopen counts against
  them). An agent needs 3 resolved tickets in the category to have a record.
- **Medium and low:** the agent with the least open work.

The reason is kept in the ticket's history (`auto: as managers assign urgent
billing tickets`, `auto: fastest at billing`, `auto: least open work`).

### Manager (manager only)
| Method | Path | Returns |
|---|---|---|
| GET | `/api/manager/metrics` | `{ tickets, mlService, yesterday }`; `yesterday` is the latest daily digest, or `null` before the first. `tickets` as follows. `tickets.openMatrix` is `[{ category, priority, count }]` for open tickets (a null category is untriaged); `openBreached` counts open tickets past their SLA by the clock; `model.overrideRate` is corrected ÷ reviewed, over tickets a person actually triaged. |
| GET | `/api/manager/model` | `{ current, runs }`: the live model's metrics (or `null`) and recent training runs, refreshed from the ML service. |
| POST | `/api/manager/model/retrain` | `202 { runId, status, confirmedTickets }`. Sends every human-confirmed ticket to the ML service. |
| GET | `/api/manager/jobs` | `{ jobs, runs }`: the five job names and their recent runs. |
| POST | `/api/manager/jobs/:name/run` | Runs one job now and returns its recorded run. |
| POST | `/api/manager/test-email` | Sends one email to the signed-in manager: `{ sentTo, smtpConfigured }`, or `502 MAIL_FAILED` with the mail server's reason. |

### Scheduled jobs (server, `ENABLE_SCHEDULER`)
| Job | When | What |
|---|---|---|
| `slaEscalation` | every 5 min | With a quarter of the SLA window left (urgent 30 min, high 2 h, medium 6 h, low 18 h), emails the assigned agent, or the managers if nobody is assigned; once per ticket. Once overdue: marks it breached, raises its priority one step, emails the managers and the agent. `waiting_customer` tickets are skipped: their clock is paused. |
| `staleTicketSweep` | hourly | Closes `waiting_customer` tickets after `STALE_WAITING_DAYS` of waiting, and `resolved` tickets after `AUTO_CLOSE_RESOLVED_DAYS`. |
| `nightlyRetrain` | 02:00 | Sends human-confirmed tickets to `POST /train`. |
| `dailyDigest` | 08:00 | Yesterday's new, resolved and SLA-missed tickets, and how many are still open: emailed to managers, shown on the overview. |
| `attachmentCleanup` | 03:30 | Deletes image files older than a day that no ticket refers to (left behind by a failed upload). |

Every run is recorded (`JobRun`), and a failing job is recorded as failed
rather than crashing the server. A job whose emails could not be sent is
recorded as failed with the reason; the work itself is still saved.

### Email
Sent through `SMTP_URL` as plain text and HTML, with the ticket number in the
subject (`#4F2A1C`). Without `SMTP_URL` (development) each email is printed in
the server's terminal instead. Every attempt is logged (`[mail] sent ...` or
`[mail] FAILED ...` with the reason).

| Email | When | To |
|---|---|---|
| New ticket assigned to you | A ticket is routed, triaged or reassigned to an agent | That agent |
| New ticket | A customer opens a ticket; says who got it, or that it waits for triage | Managers |
| Your ticket has been resolved | An agent resolves it, with their note | The customer |
| Due in ... | A quarter of the SLA left | The agent, or managers if unassigned |
| SLA missed | Past due | Managers and the agent |
| Daily digest | 08:00 | Managers |

Ticket emails are sent in the background: a slow or failing mail server never
slows down or undoes the action that caused the email.

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
  "slaBreachedAt": null,
  "slaWarnedAt": null,
  "waitingSince": null,
  "resolution": "Refunded the duplicate charge.",
  "resolvedAt": null,

  "attachments": [{ "filename": "<uuid>.png", "mimetype": "image/png", "size": 48213, "uploadedBy": "<userId>", "uploadedAt": "…" }],

  "comments": [{ "author": "<userId>", "body": "…", "internal": false, "createdAt": "…" }],
  "history": [{ "action": "status", "by": "<userId> | null", "from": "assigned", "to": "in_progress", "note": null, "at": "…" }],

  "createdAt": "…",
  "updatedAt": "…"
}
```

`category` / `priority` are what the system acts on. `predicted*` are what the
model said. Keeping both is what lets the manager dashboard measure how often
people correct the model. History actions: `created`, `assigned`, `status`,
`triaged`, `sla_breached`; `by: null` means the system did it.

---

## 5. Server ↔ ML service

Node owns the product. Python owns the model. They talk over HTTP only.
Base URL: `ML_SERVICE_URL` (default `http://localhost:8000`). Errors use the
same shape as section 2.

### POST `/predict`
Request `{ "subject": "Charged twice", "body": "I was charged twice for my subscription" }`

Response `200`
```json
{
  "category": "billing",
  "priority": "high",
  "confidence": { "category": 0.91, "priority": 0.74 },
  "modelVersion": "v3"
}
```
`category` and `priority` MUST be values from `contract.json`; the service
checks this before answering. With no model promoted yet it answers
`general` / `medium` with confidence `0`, which sends the ticket to a person.

### GET `/health`
`{ "status": "ok", "modelLoaded": true, "modelVersion": "v3", "contractVersion": 1 }`

### POST `/train`
Request: the tickets people confirmed (triaged by a person, or worked through
to `resolved`). Never tickets labelled only by the model.
```json
{ "tickets": [{ "subject": "…", "body": "…", "category": "billing", "priority": "high" }] }
```
Response `202 { "runId": "20260929T020000Z-a1b2c3", "status": "started", "startedAt": "…", "productionTickets": 812 }`.
`409 TRAINING_BUSY` if a run is in progress; `409 NOT_READY` if the dataset
and frozen test set have not been prepared.

The run trains in the background. The new version goes live only if its
category macro F1 on the frozen test set is at least the live model's;
otherwise it is kept on disk but not served.

### GET `/train/{runId}`
`{ "runId", "status": "started | succeeded | failed", "version", "promoted", "previousVersion", "metrics", "error", "finishedAt" }`
or `404 RUN_NOT_FOUND`.

### GET `/metrics`
`{ "modelVersion", "trainedAt", "trainRows", "testRows", "seedData", "results" }`
where `results` holds, per target, the model's and the majority baseline's
scores on the frozen test set. `404 NO_MODEL` before the first promotion.

### When ML is down or slow: the rule that matters most
Ticket creation must **never** fail because the ML service is unavailable.

If `/predict` errors, or takes longer than `ml.predictTimeoutMs` (3 s):
- save the ticket anyway
- `category: null`, `priority: "medium"`, `needsTriage: true`
- an agent or manager triages it by hand

Same rule if confidence is below `ml.minConfidenceForAutoRoute` (0.6): keep
the prediction, but set `needsTriage: true` instead of auto-routing.
