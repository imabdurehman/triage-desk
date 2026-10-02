# TriageDesk

A support-ticket system that reads each new ticket, works out its **category**
and **priority** with a machine-learning model, sends it to an agent who handles
that category, and keeps every ticket on an SLA clock. When the model is unsure,
or unavailable, a person decides instead. Every decision a person makes becomes
training data, and the model retrains itself each night.

| Part | Stack | Owns |
|---|---|---|
| `client/` | React 19, Vite, three.js | Everything people see, including the two 3D views |
| `server/` | Node, Express, MongoDB | Accounts, tickets, routing, SLAs, email, the five scheduled jobs |
| `ml-service/` | Python, FastAPI, scikit-learn | Training, evaluating and serving the model |
| `shared/` | `contract.json` | Every category, priority, status and role, read by all three |

Read `CONTRACT.md` for every endpoint and data shape, and `AI_RULES.md` before
using an AI assistant on this code.

## How a ticket moves

```
Customer ─▶ React ─▶ POST /api/tickets ─▶ Express ─▶ FastAPI /predict
                                            │          { category, priority, confidence }
                                            ▼
                     ML down, or confidence below 0.6? ──yes──▶ needs triage by a person
                                            │ no
                                            ▼
                     routed to an agent: as the managers assign such tickets once they
                     have done it 3 times; else urgent/high to the fastest at that
                     category, the rest to the least busy. Agent and managers emailed.

Every night: tickets people confirmed ─▶ POST /train ─▶ new model
             goes live only if it scores at least as well on the frozen test set
```

## What you need

- **Node** 20.19 or newer (22 recommended)
- **Python** 3.11, 3.12 or 3.13
- **MongoDB** 7, installed locally or a free MongoDB Atlas cluster

## First-time setup

Clone the repository, then set up the three parts in this order. Each part runs
in its own terminal.

### 1. ML service (terminal 1)

```bash
cd ml-service
python -m venv .venv
.venv\Scripts\activate            # Windows
source .venv/bin/activate         # macOS / Linux
pip install -r requirements.txt

python -m training.make_seed_data   # 1,500 generated tickets
python -m training.split            # train set + frozen test set
uvicorn app.main:app --port 8000
```

The service starts without a model; tickets then go to a person for triage.
Train and promote the first model **before loading demo data**, one of two ways:

- Open **http://localhost:8000**, which opens the API docs. Choose
  **POST /train**, press *Try it out*, leave the body as `{ "tickets": [] }`
  and press *Execute*.
- Or, in another PowerShell window:

  ```powershell
  $run = Invoke-RestMethod -Method Post -Uri http://localhost:8000/train -ContentType 'application/json' -Body '{"tickets": []}'
  "Training started: $($run.runId)"
  do { Start-Sleep 3; $r = Invoke-RestMethod "http://localhost:8000/train/$($run.runId)" } while ($r.status -eq 'started')
  "Result: $($r.status), version $($r.version), promoted: $($r.promoted)"
  "Model live: $((Invoke-RestMethod http://localhost:8000/health).modelVersion)"
  ```

Training takes about half a minute; **GET /health** then shows
`"modelLoaded": true`.

Seed data only proves the pipeline works. To train on real tickets, see
"Datasets" below.

### 2. Server (terminal 2)

From the repository root, install the server and the client together (they are
npm workspaces sharing one lock file):

```bash
npm install
cd server
cp .env.example .env              # Windows: copy .env.example .env
```

Open `.env` and set `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` to two
different long random strings. This prints one each time you run it:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

On Windows, this PowerShell block (run inside `server/`) creates `.env` if
needed and fills in both secrets for you:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
$access  = node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
$refresh = node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
(Get-Content .env) -replace '^JWT_ACCESS_SECRET=.*', "JWT_ACCESS_SECRET=$access" -replace '^JWT_REFRESH_SECRET=.*', "JWT_REFRESH_SECRET=$refresh" | Set-Content .env
(Get-Content .env) -match '^JWT_' | ForEach-Object { $_.Substring(0, 30) + '...' }
```

Do not write `.env` with `echo ... > .env` in Windows PowerShell 5.1: that saves
it as UTF-16, which Node cannot read.

Then either load demo data (into an empty database):

```bash
npm run seed:demo
```

`npm run seed:demo:reset` wipes an existing demo database and fills it again,
for example after training a model. It refuses to touch a database without the
demo manager, so real data is safe.

Or create the first real manager account:

```bash
node scripts/createManager.js --name "Your Name" --email you@example.com --password "a-long-password"
```

and start the server:

```bash
npm run dev
```

**http://localhost:5000/api/health** should answer `"db": "connected"`.

### 3. Client (terminal 3)

```bash
cd client
npm run dev
```

Open **http://localhost:5173**. The client forwards `/api` to the server, so
there is nothing to configure.

## Demo accounts

After `npm run seed:demo`, every account's password is `demo-pass-1`.

| Email | Role | Handles |
|---|---|---|
| `maya@demo.test` | Manager | Everything |
| `bilal@demo.test` | Agent | Billing, refund |
| `tariq@demo.test` | Agent | Technical |
| `nadia@demo.test` | Agent | Account, general |
| `sara@demo.test`, `omar@demo.test`, `ayesha@demo.test` | Customer | Their own tickets |

Anyone can also register as a customer from the sign-in screen.

## Server settings (`server/.env`)

| Variable | Default | Meaning |
|---|---|---|
| `MONGO_URI` | local `triagedesk` | The database |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Where the client runs |
| `ML_SERVICE_URL` | `http://localhost:8000` | Where the ML service runs |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | none, required | Two different long random strings |
| `ACCESS_TOKEN_TTL` | `15m` | How long an access token lasts |
| `REFRESH_TOKEN_TTL_DAYS` | `7` | How long someone stays signed in |
| `ENABLE_SCHEDULER` | `true` | Run the five background jobs |
| `STALE_WAITING_DAYS` | `7` | Close tickets whose customer never replied |
| `AUTO_CLOSE_RESOLVED_DAYS` | `3` | Close resolved tickets after this long |
| `UPLOAD_DIR` | `uploads` | Where ticket images are stored |
| `SMTP_URL` | empty | The mail server. Empty: emails are printed in the terminal instead |
| `MAIL_FROM` | `TriageDesk <no-reply@triagedesk.local>` | Sender of every email |
| `MAX_OPEN_TICKETS` | `15` | New tickets skip an agent with this many open, while anyone else has room |
| `MONGO_URI_TEST` | unset | A separate database for the integration tests; they wipe it |

## Tests

```bash
cd server && npm test        # 15 tests; 64 once MONGO_URI_TEST is set
cd ml-service && pytest      # 32 tests
cd client && npm run lint && npm run build
```

Never point `MONGO_URI_TEST` at a database you care about: the suite deletes
everything in it first.

## Datasets

The generated seed data has every category and priority but is not real. For
real tickets, the guide recommends the public *multilingual customer support
tickets* dataset (Kaggle `tobiasbueck`, CC BY-NC 4.0). Download it into
`ml-service/data/raw/`, then:

```bash
python -m training.import_csv data/raw/tickets.csv --inspect
python -m training.make_seed_data
python -m training.import_csv data/raw/tickets.csv --append --only language=en ...
python -m training.split --force
```

(the full import command with its label maps is in the branch guide, section
6.10). The rules that make this merge safe:

- The frozen test set is drawn from real rows only once any exist.
- Seed rows train a class only until real data has 50 rows of it.
- A seed row fills one gap, never two (so "account" words never teach "urgent").

The public CSV is not committed. Everyone on the team needs the same file,
shared outside Git, before running `split`; without it, `split` refuses rather
than training on seed data alone.

## Email and images

| Email | When | To |
|---|---|---|
| **New ticket assigned to you** | A ticket is routed, triaged or reassigned to an agent | That agent |
| **New ticket** | A customer opens a ticket (says who got it, or that it waits for triage) | Managers |
| **Your ticket has been resolved** | An agent resolves it, with their note on how | The customer |
| **Due in ...** | A quarter of the SLA is left (urgent 30 min, high 2 h, medium 6 h, low 18 h) | The agent, or managers if unassigned |
| **SLA missed** | Past due | Managers and the agent |
| **Daily digest** | 08:00 | Managers |

`SMTP_URL` is set once, for the whole server: it is the account that sends. The
people receiving need nothing but a real address on their account. With
`SMTP_URL` empty, each email is printed in the server terminal instead. For
Gmail, turn on 2-Step Verification, create an app password, and set
`SMTP_URL=smtps://you%40gmail.com:app-password@smtp.gmail.com:465` and
`MAIL_FROM=TriageDesk <you@gmail.com>`. Restart the server after changing `.env`.

To check it works, sign in as a manager and press **Send me a test email** on the
*Model and jobs* page. If the mail server refuses, its reason is shown there.
The server terminal also logs every email as `[mail] sent ...` or
`[mail] FAILED ...` with the reason.

Customers and staff can attach up to 10 images to a ticket: PNG, JPEG, GIF or
WebP, 2 MB each, 3 at a time. The server checks the file's content, not its
name, and only people who can see the ticket can see its images.

## How tickets are assigned

The model predicts what a ticket is (category and priority). Who gets it is
learned from the managers: every time a manager assigns or reassigns a ticket by
hand, that choice is remembered. Once a manager has given tickets of the same
priority and category (say, urgent billing) to one agent 3 times, new tickets
like that go to that agent automatically; failing that, the category alone
(billing) is used. Until then, urgent and high tickets go to the agent who
resolves that category fastest, and the rest to whoever has the least open
work. Agents with `MAX_OPEN_TICKETS` open are skipped while anyone else has room.
The reason for every automatic assignment is shown in the ticket's history.

A ticket the model cannot classify (for example "hi, how are you") is not
assigned: it waits in the triage queue, and the manager's or agent's triage then
routes it the same way.

## Learning from production

Each night at 02:00 the server sends every ticket a person has **confirmed**
(triaged by hand, or worked through to resolved) to `POST /train`. Tickets
labelled only by the model are never sent: training on its own unchecked
answers would teach the model its mistakes. Managers can also press
**Retrain now** on the *Model and jobs* page. A new model goes live only if its
category macro F1 on the frozen test set is at least the live model's.

## Project layout

```
client/src/
  components/   ticket list, conversation, staff panel, the two 3D views
  pages/        customer/, agent/, manager/, plus sign-in and the shared ticket page
  context/      signed-in user, shared enums
  services/     one file per API area; api.js renews expired tokens
server/src/
  routes/ controllers/ services/ models/ validators/ middleware/
  jobs/         the five scheduled jobs
ml-service/
  app/          the FastAPI service: predictor, trainer, model store
  training/     data import, split, train, evaluate
  data/test/    the frozen test set (committed)
shared/contract.json
```

## When something goes wrong

| What you see | Why, and what to do |
|---|---|
| Every ticket says "needs triage" | No model is live. Train one (step 1). |
| All demo tickets went to one agent, other queues are empty | The demo data was loaded before a model was live, with an older copy of the demo script. Train a model, then run `npm run seed:demo:reset`. |
| `POST /train` answers 400 in the API docs | The body must be `{"tickets": []}`, not the example with `"string"` values. |
| The manager overview says the ML service is unreachable | Start it in terminal 1; tickets still work meanwhile. |
| `split` refuses: "the local dataset is seed only" | The committed test set is real data. Import the same public CSV first. |
| Signing in says "The server could not be reached" | The server is not running on port 5000, or it cannot reach MongoDB. Check terminal 2. |
| `Missing required environment variables: JWT_ACCESS_SECRET, JWT_REFRESH_SECRET` | `server/.env` exists but the two secrets are empty. Run the PowerShell block in step 2. |
| No emails arrive | Press **Send me a test email** on *Model and jobs*: it shows the mail server's reason. `Invalid login` / `535` means a wrong app password or 2-Step Verification is off. |
| The terminal says `[mail] sent` but the inbox is empty | The mail server accepted it. Check **Spam** and **Promotions**. Check the address for typos (a manager can correct it on *People* with **Change**); Gmail reports a bad address to the sending account's inbox as "Address not found". Email sent to the same Gmail account that sends it (the one in `SMTP_URL`) appears only in **Sent**, never in the inbox, so use a different address for people's accounts. |
| The sending inbox fills with "Address not found" | Demo accounts use `@demo.test` addresses, which do not exist. Deactivate them on *People* once you have real accounts. |
| `npm run seed:demo` refuses | The database already has users. Use `npm run seed:demo:reset` for a demo database, or point `MONGO_URI` at an empty one. |
