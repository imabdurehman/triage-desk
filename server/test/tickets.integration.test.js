// Integration tests for tickets, users, the manager API and the scheduled jobs,
// run against a real MongoDB. Skipped unless MONGO_URI_TEST is set. This file
// uses its own database, named after the one in MONGO_URI_TEST plus "_tickets"
// (triagedesk_test_tickets), and WIPES it before and after the run.
// The ML service is replaced by a fake fetch.
import 'dotenv/config';
import { test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, utimesSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';
const uploadDir = mkdtempSync(join(tmpdir(), 'td-uploads-'));
process.env.UPLOAD_DIR = uploadDir;
process.env.MAX_OPEN_TICKETS = '3';
const uri = process.env.MONGO_URI_TEST;
const skip = !uri && 'set MONGO_URI_TEST to run integration tests';
// Node runs test files at the same time, each in its own process. If they shared
// one database, one file's dropDatabase() would delete the other file's users
// mid-run (seen as 401 ACCOUNT_INACTIVE). So each integration file uses its own.
const dbName = `${uri?.split('?')[0].split('/')[3] || 'triagedesk_test'}_tickets`;

const { createApp } = await import('../src/app.js');
const { User } = await import('../src/models/User.js');
const { Ticket } = await import('../src/models/Ticket.js');
const { JobRun } = await import('../src/models/JobRun.js');
const { hashPassword } = await import('../src/services/authService.js');
const { confirmedTickets } = await import('../src/services/trainingDataService.js');
const { runJobNow } = await import('../src/jobs/index.js');
const { transport } = await import('../src/services/mailService.js');
const dailyDigest = await import('../src/jobs/dailyDigest.js');
const app = createApp();

// Every email lands here instead of an SMTP server.
const outbox = [];
mock.method(transport, 'sendMail', async (message) => { outbox.push(message); });
// Ticket emails go out in the background, so wait briefly for the one expected.
async function mailFor(address, subject) {
  for (let i = 0; i < 40; i += 1) {
    const found = outbox.filter((m) => m.to.includes(address) && subject.test(m.subject));
    if (found.length) return found;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return [];
}

// ------------------------------------------------------------------ fake ML service
let mlPredict = { category: 'billing', priority: 'high', confidence: { category: 0.9, priority: 0.8 } };
let mlDown = false;
let lastTrainBody = null;
let runCount = 0;
globalThis.fetch = async (url, init = {}) => {
  if (mlDown) throw new Error('connect ECONNREFUSED');
  const path = new URL(url).pathname;
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
  if (path === '/predict') return reply(200, { ...mlPredict, modelVersion: 'v7' });
  if (path === '/health') return reply(200, { status: 'ok', modelLoaded: true, modelVersion: 'v7' });
  if (path === '/train') {
    lastTrainBody = JSON.parse(init.body);
    runCount += 1;
    return reply(202, { runId: `run-${runCount}`, status: 'started' });
  }
  if (path.startsWith('/train/run-')) {
    return reply(200, { runId: path.slice(7), status: 'succeeded', version: 'v8', promoted: true,
                        metrics: { category: { macro_f1: 0.8 } } });
  }
  if (path === '/metrics') return reply(200, { modelVersion: 'v8' });
  return reply(404, { error: { code: 'NOT_FOUND', message: 'no route' } });
};

// ------------------------------------------------------------------ helpers
const PASSWORD = 'password-123';
const tokens = {};

async function makeUser(key, fields) {
  await User.create({ ...fields, passwordHash: await hashPassword(PASSWORD) });
  const res = await request(app).post('/api/auth/login').send({ email: fields.email, password: PASSWORD });
  tokens[key] = res.body.accessToken;
  return res.body.user;
}
const as = (key) => ({ Authorization: `Bearer ${tokens[key]}` });
const ticketBody = { subject: 'Charged twice', body: 'I was charged twice for my plan this month.' };
const createTicket = (key = 'cust1', body = ticketBody) =>
  request(app).post('/api/tickets').set(as(key)).send(body);

const users = {};
before(async () => {
  if (skip) return;
  await mongoose.connect(uri, { dbName });
  await mongoose.connection.dropDatabase();
  await User.init();
  users.manager = await makeUser('manager', { name: 'Maya', email: 'maya@x.com', role: 'manager' });
  users.billA = await makeUser('billA', { name: 'Bilal', email: 'bilal@x.com', role: 'agent',
                                          categories: ['billing'] });
  users.billB = await makeUser('billB', { name: 'Bina', email: 'bina@x.com', role: 'agent',
                                          categories: ['billing'] });
  users.tech = await makeUser('tech', { name: 'Tariq', email: 'tariq@x.com', role: 'agent',
                                        categories: ['technical'] });
  users.cust1 = await makeUser('cust1', { name: 'Sara', email: 'sara@x.com', role: 'customer' });
  users.cust2 = await makeUser('cust2', { name: 'Omar', email: 'omar@x.com', role: 'customer' });
});

beforeEach(async () => {
  if (skip) return;
  await Ticket.deleteMany({});
  outbox.length = 0;
  mlDown = false;
  mlPredict = { category: 'billing', priority: 'high', confidence: { category: 0.9, priority: 0.8 } };
});

after(async () => {
  if (skip) return;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

// ------------------------------------------------------------------ creation and routing
test('a confident prediction routes the ticket to an agent of that category', { skip }, async () => {
  const res = await createTicket();
  assert.equal(res.status, 201);
  const t = await Ticket.findById(res.body.ticket._id);
  assert.equal(t.category, 'billing');
  assert.equal(t.priority, 'high');
  assert.equal(t.needsTriage, false);
  assert.equal(t.status, 'assigned');
  assert.ok([users.billA.id, users.billB.id].includes(t.assignedAgent.toString()));
  const hours = (t.slaDueAt - t.createdAt) / 3_600_000;
  assert.ok(Math.abs(hours - 8) < 0.01, 'high priority is due in 8 hours');
});

test('customers never see the model working or internal fields', { skip }, async () => {
  const res = await createTicket();
  const t = res.body.ticket;
  assert.equal(t.predictedCategory, undefined);
  assert.equal(t.predictionConfidence, undefined);
  assert.equal(t.modelVersion, undefined);
  assert.equal(t.history, undefined);
});

test('assignment goes to the least-loaded agent', { skip }, async () => {
  const a = await createTicket();
  const b = await createTicket();
  const agents = await Ticket.find({ _id: { $in: [a.body.ticket._id, b.body.ticket._id] } })
    .distinct('assignedAgent');
  assert.equal(agents.length, 2, 'two billing tickets go to two different billing agents');
});

test('ML down: the ticket is still created, unrouted, for a person to triage', { skip }, async () => {
  mlDown = true;
  const res = await createTicket();
  assert.equal(res.status, 201);
  const t = await Ticket.findById(res.body.ticket._id);
  assert.equal(t.needsTriage, true);
  assert.equal(t.category, null);
  assert.equal(t.priority, 'medium');
  assert.equal(t.assignedAgent, null);
  assert.equal(t.status, 'open');
});

test('low confidence keeps the prediction but asks a person to confirm it', { skip }, async () => {
  mlPredict = { category: 'technical', priority: 'low', confidence: { category: 0.4, priority: 0.5 } };
  const res = await createTicket();
  const t = await Ticket.findById(res.body.ticket._id);
  assert.equal(t.category, 'technical');
  assert.equal(t.needsTriage, true);
  assert.equal(t.assignedAgent, null);
});

test('a label outside the contract is never stored', { skip }, async () => {
  mlPredict = { category: 'payments', priority: 'high', confidence: { category: 0.99, priority: 0.9 } };
  const res = await createTicket();
  const t = await Ticket.findById(res.body.ticket._id);
  assert.equal(t.category, null);
  assert.equal(t.needsTriage, true);
});

test('only customers open tickets, and input is validated', { skip }, async () => {
  assert.equal((await createTicket('billA')).status, 403);
  const bad = await createTicket('cust1', { subject: 'Hi', body: 'short' });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.error.details.subject && bad.body.error.details.body);
});

// ------------------------------------------------------------------ visibility
test('each role sees only what it should', { skip }, async () => {
  const mine = (await createTicket('cust1')).body.ticket._id;
  mlDown = true;
  const untriaged = (await createTicket('cust2')).body.ticket._id;

  const other = await request(app).get(`/api/tickets/${mine}`).set(as('cust2'));
  assert.equal(other.status, 404, "another customer's ticket does not even appear to exist");

  const t = await Ticket.findById(mine);
  const owner = t.assignedAgent.toString() === users.billA.id ? 'billA' : 'billB';
  const outsider = owner === 'billA' ? 'billB' : 'billA';
  assert.equal((await request(app).get(`/api/tickets/${mine}`).set(as(owner))).status, 200);
  assert.equal((await request(app).get(`/api/tickets/${mine}`).set(as(outsider))).status, 404);
  assert.equal((await request(app).get(`/api/tickets/${untriaged}`).set(as('tech'))).status, 200,
    'every agent can see the triage queue');

  const list = await request(app).get('/api/tickets').set(as('manager'));
  assert.equal(list.body.total, 2);
  const cust = await request(app).get('/api/tickets').set(as('cust1'));
  assert.equal(cust.body.total, 1);
});

test('the list filters and paginates', { skip }, async () => {
  for (let i = 0; i < 3; i += 1) await createTicket();
  mlDown = true;
  await createTicket();
  const triage = await request(app).get('/api/tickets?needsTriage=true').set(as('manager'));
  assert.equal(triage.body.total, 1);
  const page = await request(app).get('/api/tickets?limit=2&page=2').set(as('manager'));
  assert.equal(page.body.items.length, 2);
  assert.equal(page.body.pages, 2);
  const bad = await request(app).get('/api/tickets?status=nonsense').set(as('manager'));
  assert.equal(bad.status, 400);

  await Ticket.updateOne({ needsTriage: false }, { status: 'closed' });
  const active = await request(app).get('/api/tickets?active=true').set(as('manager'));
  assert.equal(active.body.total, 3, 'closed tickets drop out of the active view');
});

// ------------------------------------------------------------------ work on a ticket
test('status follows the contract, and only the assigned agent changes it', { skip }, async () => {
  const id = (await createTicket()).body.ticket._id;
  const t = await Ticket.findById(id);
  const owner = t.assignedAgent.toString() === users.billA.id ? 'billA' : 'billB';
  const other = owner === 'billA' ? 'billB' : 'billA';
  const setStatus = (key, status) =>
    request(app).patch(`/api/tickets/${id}/status`).set(as(key)).send({ status });

  const wrong = await setStatus(owner, 'waiting_customer');
  assert.equal(wrong.status, 409);
  assert.equal(wrong.body.error.code, 'INVALID_TRANSITION');

  assert.equal((await setStatus(other, 'in_progress')).status, 404, 'the other agent cannot see it');

  assert.equal((await setStatus(owner, 'in_progress')).body.ticket.status, 'in_progress');
});

test('triage records a human override and then routes the ticket', { skip }, async () => {
  mlPredict = { category: 'billing', priority: 'low', confidence: { category: 0.45, priority: 0.5 } };
  const id = (await createTicket()).body.ticket._id;

  const res = await request(app).patch(`/api/tickets/${id}/triage`).set(as('tech'))
    .send({ category: 'technical', priority: 'urgent' });
  assert.equal(res.status, 200);
  const t = await Ticket.findById(id);
  assert.equal(t.category, 'technical');
  assert.equal(t.needsTriage, false);
  assert.equal(t.overriddenBy.toString(), users.tech.id);
  assert.equal(t.assignedAgent.toString(), users.tech.id, 'routed to the technical agent');
  const seen = await request(app).get(`/api/tickets/${id}`).set(as('tech'));
  assert.equal(seen.body.ticket.history.find((h) => h.action === 'triaged').by.name, 'Tariq',
    'history says who did it, by name');
  const hours = (t.slaDueAt - t.createdAt) / 3_600_000;
  assert.ok(Math.abs(hours - 2) < 0.01, 'urgent is due 2 hours after the customer asked');
});

test('agreeing with the model is not counted as an override', { skip }, async () => {
  mlPredict = { category: 'billing', priority: 'low', confidence: { category: 0.45, priority: 0.5 } };
  const id = (await createTicket()).body.ticket._id;
  await request(app).patch(`/api/tickets/${id}/triage`).set(as('billA')).send({ category: 'billing' });
  const t = await Ticket.findById(id);
  assert.equal(t.overriddenBy, null);
});

test('internal notes stay internal; a customer reply reopens the conversation', { skip }, async () => {
  const id = (await createTicket()).body.ticket._id;
  const t = await Ticket.findById(id);
  const owner = t.assignedAgent.toString() === users.billA.id ? 'billA' : 'billB';

  await request(app).post(`/api/tickets/${id}/comments`).set(as(owner))
    .send({ body: 'Looks like a duplicate charge from the gateway.', internal: true });
  await request(app).patch(`/api/tickets/${id}/status`).set(as(owner)).send({ status: 'in_progress' });
  await request(app).patch(`/api/tickets/${id}/status`).set(as(owner))
    .send({ status: 'waiting_customer' });

  const seen = await request(app).get(`/api/tickets/${id}`).set(as('cust1'));
  assert.equal(seen.body.ticket.comments.length, 0, 'the internal note is hidden from the customer');

  const reply = await request(app).post(`/api/tickets/${id}/comments`).set(as('cust1'))
    .send({ body: 'Here is the receipt.', internal: true });
  assert.equal(reply.body.ticket.status, 'in_progress', 'the reply puts it back with the agent');
  assert.equal(reply.body.ticket.comments.at(-1).internal, false, 'customers cannot post internal notes');
});

test('a manager reassigns, and only to an active agent', { skip }, async () => {
  const id = (await createTicket()).body.ticket._id;
  const ok = await request(app).patch(`/api/tickets/${id}/assign`).set(as('manager'))
    .send({ agentId: users.tech.id });
  assert.equal(ok.body.ticket.assignedAgent, users.tech.id);
  const bad = await request(app).patch(`/api/tickets/${id}/assign`).set(as('manager'))
    .send({ agentId: users.cust1.id });
  assert.equal(bad.status, 400);
  const forbidden = await request(app).patch(`/api/tickets/${id}/assign`).set(as('billA'))
    .send({ agentId: users.tech.id });
  assert.equal(forbidden.status, 403);
});

// ------------------------------------------------------------------ users and manager
test('managers manage staff; nobody else can', { skip }, async () => {
  assert.equal((await request(app).get('/api/users').set(as('billA'))).status, 403);

  const made = await request(app).post('/api/users').set(as('manager')).send({
    name: 'Nadia', email: 'nadia@x.com', password: PASSWORD, role: 'agent', categories: ['refund'],
  });
  assert.equal(made.status, 201);
  assert.deepEqual(made.body.user.categories, ['refund']);

  const self = await request(app).patch(`/api/users/${users.manager.id}`).set(as('manager'))
    .send({ active: false });
  assert.equal(self.status, 400, 'a manager cannot lock themselves out');

  const agents = await request(app).get('/api/users?role=agent').set(as('manager'));
  assert.equal(agents.body.users.length, 4);
});

test('manager metrics measure how often people override the model', { skip }, async () => {
  await createTicket(); // confident, auto-routed, never reviewed: must not count
  mlPredict = { category: 'billing', priority: 'low', confidence: { category: 0.45, priority: 0.5 } };
  const a = (await createTicket()).body.ticket._id;
  const b = (await createTicket()).body.ticket._id;
  await request(app).patch(`/api/tickets/${a}/triage`).set(as('tech')).send({ category: 'technical' });
  await request(app).patch(`/api/tickets/${b}/triage`).set(as('billA')).send({ category: 'billing' });

  const res = await request(app).get('/api/manager/metrics').set(as('manager'));
  assert.equal(res.status, 200);
  assert.equal(res.body.tickets.model.reviewedTickets, 2);
  assert.equal(res.body.tickets.model.overridden, 1);
  assert.equal(res.body.tickets.model.overrideRate, 0.5);
  assert.equal(res.body.mlService.reachable, true);
  assert.equal(res.body.tickets.openBreached, 0);
  await Ticket.updateOne({ _id: a }, { slaDueAt: new Date(Date.now() - 60_000) });
  const later = await request(app).get('/api/manager/metrics').set(as('manager'));
  assert.equal(later.body.tickets.openBreached, 1, 'overdue counts before the escalation job runs');
  const cell = res.body.tickets.openMatrix.find((c) => c.category === 'technical');
  assert.deepEqual(cell, { category: 'technical', priority: 'low', count: 1 });
});

// ------------------------------------------------------------------ learning from production
test('only human-confirmed tickets are exported for training', { skip }, async () => {
  await createTicket(); // model-labelled and never touched by a person
  mlPredict = { category: 'billing', priority: 'low', confidence: { category: 0.45, priority: 0.5 } };
  const triaged = (await createTicket()).body.ticket._id;
  await request(app).patch(`/api/tickets/${triaged}/triage`).set(as('tech'))
    .send({ category: 'technical' });

  const exported = await confirmedTickets();
  assert.equal(exported.length, 1, 'the untouched, model-labelled ticket is not exported');
  assert.equal(exported[0].category, 'technical');
  assert.deepEqual(Object.keys(exported[0]).sort(), ['body', 'category', 'priority', 'subject']);
});

test('retraining sends confirmed tickets, and the run status is synced back', { skip }, async () => {
  mlPredict = { category: 'billing', priority: 'low', confidence: { category: 0.45, priority: 0.5 } };
  const id = (await createTicket()).body.ticket._id;
  await request(app).patch(`/api/tickets/${id}/triage`).set(as('billA')).send({ category: 'billing' });

  const started = await request(app).post('/api/manager/model/retrain').set(as('manager'));
  assert.equal(started.status, 202);
  assert.equal(started.body.confirmedTickets, 1);
  assert.equal(lastTrainBody.tickets.length, 1);

  const model = await request(app).get('/api/manager/model').set(as('manager'));
  const run = model.body.runs.find((r) => r.runId === started.body.runId);
  assert.equal(run.status, 'succeeded');
  assert.equal(run.promoted, true);
  assert.equal(run.modelVersion, 'v8');
});

// ------------------------------------------------------------------ scheduled jobs
test('slaEscalation marks overdue tickets breached and raises their priority', { skip }, async () => {
  const id = (await createTicket()).body.ticket._id;
  await Ticket.updateOne({ _id: id }, { slaDueAt: new Date(Date.now() - 60_000) });
  const r = await runJobNow('slaEscalation');
  assert.equal(r.status, 'succeeded');
  assert.equal(r.result.escalated, 1);
  const t = await Ticket.findById(id);
  assert.equal(t.slaBreached, true);
  assert.equal(t.priority, 'urgent', 'high -> urgent');
  assert.equal((await mailFor('maya@x.com', /SLA missed/)).length, 1, 'managers hear about a missed SLA');
  assert.equal(await JobRun.countDocuments({ job: 'slaEscalation', status: 'succeeded' }), 1);
});

test('staleTicketSweep closes abandoned and long-resolved tickets', { skip }, async () => {
  const waiting = (await createTicket()).body.ticket._id;
  const resolved = (await createTicket()).body.ticket._id;
  const old = new Date(Date.now() - 30 * 24 * 3_600_000);
  await Ticket.collection.updateOne({ _id: new mongoose.Types.ObjectId(waiting) },
    { $set: { status: 'waiting_customer', waitingSince: old } });
  await Ticket.collection.updateOne({ _id: new mongoose.Types.ObjectId(resolved) },
    { $set: { status: 'resolved', resolvedAt: old } });

  const r = await runJobNow('staleTicketSweep');
  assert.deepEqual(r.result, { closedNoReply: 1, closedResolved: 1 });
  assert.equal((await Ticket.findById(waiting)).status, 'closed');
});

test('nightlyRetrain and dailyDigest run and are recorded', { skip }, async () => {
  await createTicket();
  for (const job of ['nightlyRetrain', 'dailyDigest']) {
    const r = await runJobNow(job);
    assert.equal(r.status, 'succeeded', `${job}: ${r.error}`);
  }
  assert.equal(await JobRun.countDocuments({ status: 'succeeded' }) >= 3, true);
});

test('a failing job is recorded as failed, not crashed', { skip }, async () => {
  mlDown = true;
  const r = await runJobNow('nightlyRetrain');
  assert.equal(r.status, 'failed');
  assert.match(r.error, /Could not start training/);
});

test('attachmentCleanup deletes only old files no ticket refers to', { skip }, async () => {
  const day = 24 * 3_600_000;
  const old = (Date.now() - 2 * day) / 1000;
  for (const f of ['orphan-old.txt', 'kept.txt', 'orphan-new.txt']) writeFileSync(join(uploadDir, f), 'x');
  utimesSync(join(uploadDir, 'orphan-old.txt'), old, old);
  utimesSync(join(uploadDir, 'kept.txt'), old, old);
  const id = (await createTicket()).body.ticket._id;
  await Ticket.updateOne({ _id: id }, { attachments: [{ filename: 'kept.txt', mimetype: 'image/png' }] });

  const r = await runJobNow('attachmentCleanup');
  assert.equal(r.result.deleted, 1);
  assert.equal(existsSync(join(uploadDir, 'orphan-old.txt')), false);
  assert.equal(existsSync(join(uploadDir, 'kept.txt')), true, 'referenced by a ticket');
  assert.equal(existsSync(join(uploadDir, 'orphan-new.txt')), true, 'too new to delete');
});

// ------------------------------------------------------------------ added with emails and images
const ownerOf = async (id) => {
  const t = await Ticket.findById(id);
  return t.assignedAgent.toString() === users.billA.id ? 'billA' : 'billB';
};
const setStatus = (key, id, body) => request(app).patch(`/api/tickets/${id}/status`).set(as(key)).send(body);

test('a category nobody handles still goes to an agent, never to nobody', { skip }, async () => {
  mlPredict = { category: 'account', priority: 'low', confidence: { category: 0.9, priority: 0.8 } };
  const t = await Ticket.findById((await createTicket()).body.ticket._id);
  assert.ok(t.assignedAgent, 'no agent handles account, so any agent gets it');
  assert.equal(t.status, 'assigned');
});

test('resolving needs a note; the customer sees it and is emailed', { skip }, async () => {
  const id = (await createTicket()).body.ticket._id;
  const owner = await ownerOf(id);
  await setStatus(owner, id, { status: 'in_progress' });

  const bare = await setStatus(owner, id, { status: 'resolved' });
  assert.equal(bare.status, 400);
  assert.ok(bare.body.error.details.note);

  const note = 'Refunded the duplicate charge; it reaches your card in 3 days.';
  assert.equal((await setStatus(owner, id, { status: 'resolved', note })).status, 200);
  const seen = await request(app).get(`/api/tickets/${id}`).set(as('cust1'));
  assert.equal(seen.body.ticket.resolution, note);
  const [mail] = await mailFor('sara@x.com', /Your ticket has been resolved/);
  assert.match(mail.text, /Refunded the duplicate charge/);
  assert.match(mail.html, /Open the ticket/);
});

test('a customer reply reopens a resolved ticket with a fresh SLA', { skip }, async () => {
  const id = (await createTicket()).body.ticket._id;
  const owner = await ownerOf(id);
  await setStatus(owner, id, { status: 'in_progress' });
  await setStatus(owner, id, { status: 'resolved', note: 'Reset the billing profile for you.' });
  await Ticket.updateOne({ _id: id }, { slaDueAt: new Date(Date.now() - 60_000), slaBreached: true });

  const r = await request(app).post(`/api/tickets/${id}/comments`).set(as('cust1'))
    .send({ body: 'Still charged twice, sorry.' });
  const t = await Ticket.findById(id);
  assert.equal(r.body.ticket.status, 'in_progress');
  assert.equal(t.resolution, undefined);
  assert.equal(t.resolvedAt, undefined);
  assert.equal(t.slaBreached, false);
  assert.ok(t.slaDueAt > new Date(), 'a reopened ticket gets a new SLA window');
});

test('waiting on the customer really pauses the SLA clock', { skip }, async () => {
  const id = (await createTicket()).body.ticket._id;
  const owner = await ownerOf(id);
  await setStatus(owner, id, { status: 'in_progress' });
  await setStatus(owner, id, { status: 'waiting_customer' });
  const before = (await Ticket.findById(id)).slaDueAt;
  const twoHours = 2 * 3_600_000;
  await Ticket.updateOne({ _id: id }, { waitingSince: new Date(Date.now() - twoHours) });

  await request(app).post(`/api/tickets/${id}/comments`).set(as('cust1')).send({ body: 'Here you go.' });
  const t = await Ticket.findById(id);
  const moved = t.slaDueAt - before;
  assert.ok(Math.abs(moved - twoHours) < 5_000, `deadline moved by the time spent waiting (${moved} ms)`);
  assert.equal(t.waitingSince, null);
});

test('SLA warning: once, to the agent; to managers when nobody is assigned', { skip }, async () => {
  const id = (await createTicket()).body.ticket._id; // high: 8 h window, warned at 2 h left
  const owner = await ownerOf(id);
  await Ticket.updateOne({ _id: id }, { slaDueAt: new Date(Date.now() + 3_600_000) });
  mlDown = true;
  const loose = (await createTicket()).body.ticket._id; // unassigned, medium: warned at 6 h left
  await Ticket.updateOne({ _id: loose }, { slaDueAt: new Date(Date.now() + 3_600_000) });

  const first = await runJobNow('slaEscalation');
  assert.equal(first.result.warned, 2);
  assert.equal((await mailFor(`${owner === 'billA' ? 'bilal' : 'bina'}@x.com`, /Due in 60 minutes/)).length, 1);
  assert.equal((await mailFor('maya@x.com', /Due in/)).length, 1, 'the unassigned ticket warns the managers');
  assert.equal((await runJobNow('slaEscalation')).result.warned, 0, 'never warned twice');
});

test('the daily digest is emailed to managers and shown on the overview', { skip }, async () => {
  await createTicket();
  const r = await runJobNow('dailyDigest');
  assert.equal(r.status, 'succeeded');
  assert.equal((await mailFor('maya@x.com', /^TriageDesk \d{4}-\d{2}-\d{2}: /)).length, 1);
  const overview = await request(app).get('/api/manager/metrics').set(as('manager'));
  assert.deepEqual(overview.body.yesterday, r.result);
  const tomorrow = await dailyDigest.run(new Date(Date.now() + 86_400_000)); // today becomes "yesterday"
  assert.equal(tomorrow.created, 1);
});

// ------------------------------------------------------------------ images
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const upload = (key, id, files) => {
  const req = request(app).post(`/api/tickets/${id}/images`).set(as(key));
  for (const [name, buf] of files) req.attach('images', buf, name);
  return req;
};
const binary = (res, done) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

test('images: checked by content, 2 MB and 3 at a time, private to the ticket', { skip }, async () => {
  const id = (await createTicket()).body.ticket._id;
  const up = await upload('cust1', id, [['screen.png', PNG]]);
  assert.equal(up.status, 201);
  const [image] = up.body.ticket.attachments;
  assert.equal(image.mimetype, 'image/png');

  const owner = await ownerOf(id);
  const got = await request(app).get(`/api/tickets/${id}/images/${image.filename}`).set(as(owner))
    .buffer(true).parse(binary);
  assert.equal(got.status, 200);
  assert.equal(got.headers['content-type'], 'image/png');
  assert.ok(got.body.equals(PNG));
  assert.equal((await request(app).get(`/api/tickets/${id}/images/${image.filename}`).set(as('cust2'))).status, 404);

  const fake = await upload('cust1', id, [['virus.png', Buffer.from('<script>alert(1)</script>')]]);
  assert.equal(fake.status, 400, 'a .png name is not enough');
  const big = await upload('cust1', id, [['big.png', Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)])]]);
  assert.equal(big.body.error.message, 'Each image must be 2 MB or smaller');
  const many = await upload('cust1', id, [['1.png', PNG], ['2.png', PNG], ['3.png', PNG], ['4.png', PNG]]);
  assert.equal(many.body.error.message, 'Upload at most 3 images at a time');

  await Ticket.updateOne({ _id: id }, { status: 'closed' });
  assert.equal((await upload('cust1', id, [['late.png', PNG]])).status, 409);
});

// ------------------------------------------------------------------ new-ticket emails, routing, workload
const agentEmail = { billA: 'bilal@x.com', billB: 'bina@x.com', tech: 'tariq@x.com' };

test('a new ticket emails its agent and the managers', { skip }, async () => {
  const id = (await createTicket()).body.ticket._id;
  const owner = await ownerOf(id);
  const [toAgent] = await mailFor(agentEmail[owner], /New ticket assigned to you: Charged twice/);
  assert.match(toAgent.text, /Please respond by/);
  assert.match(toAgent.text, new RegExp(`/tickets/${id}`));
  const [toManager] = await mailFor('maya@x.com', /New ticket: Charged twice/);
  assert.match(toManager.text, /from Sara/);
  assert.match(toManager.text, /It was assigned to (Bilal|Bina)/);
});

test('an unrouted ticket tells the managers it waits for triage', { skip }, async () => {
  mlDown = true;
  await createTicket();
  const [mail] = await mailFor('maya@x.com', /New ticket/);
  assert.match(mail.text, /waiting for triage/);
});

test('triage and manual assignment both email the agent who now has the ticket', { skip }, async () => {
  mlPredict = { category: 'technical', priority: 'low', confidence: { category: 0.4, priority: 0.5 } };
  const id = (await createTicket()).body.ticket._id;
  await request(app).patch(`/api/tickets/${id}/triage`).set(as('billA')).send({ category: 'technical' });
  assert.equal((await mailFor('tariq@x.com', /assigned to you/)).length, 1);
  await request(app).patch(`/api/tickets/${id}/assign`).set(as('manager')).send({ agentId: users.billB.id });
  assert.equal((await mailFor('bina@x.com', /assigned to you/)).length, 1);
});

// Resolved billing tickets: Bilal takes about 1 hour each, Bina about 20.
async function trackRecords() {
  const day = 24 * 3_600_000;
  const rows = [];
  for (const [agent, hours] of [[users.billA.id, 1], [users.billB.id, 20]]) {
    for (let i = 0; i < 3; i += 1) {
      const createdAt = new Date(Date.now() - 10 * day);
      rows.push({ subject: 'old', body: 'old ticket', category: 'billing', priority: 'medium', status: 'closed',
                  customer: new mongoose.Types.ObjectId(users.cust1.id),
                  assignedAgent: new mongoose.Types.ObjectId(agent),
                  createdAt, resolvedAt: new Date(createdAt.getTime() + hours * 3_600_000) });
    }
  }
  await Ticket.collection.insertMany(rows);
}
const routeOf = async (priority) => {
  mlPredict = { category: 'billing', priority, confidence: { category: 0.9, priority: 0.9 } };
  const t = await Ticket.findById((await createTicket()).body.ticket._id);
  return { agent: t.assignedAgent.toString(), why: t.history.find((h) => h.action === 'assigned').note };
};

test('urgent work goes to the agent with the best record; routine work to the least busy', { skip }, async () => {
  await trackRecords();
  const urgent = await routeOf('urgent');
  assert.equal(urgent.agent, users.billA.id, 'Bilal resolves billing fastest');
  assert.equal(urgent.why, 'auto: fastest at billing');
  const low = await routeOf('low');
  assert.notEqual(low.agent, users.billA.id, 'routine work goes to whoever has less open');
  assert.equal(low.why, 'auto: least open work');
});

test('an agent at capacity is skipped while someone else has room', { skip }, async () => {
  await trackRecords();
  for (let i = 0; i < 3; i += 1) await routeOf('urgent'); // Bilal is fastest, so he takes these
  const fourth = await routeOf('urgent');
  assert.equal(fourth.agent, users.billB.id, 'Bilal has 3 open (the cap), so Bina gets it');
});

test('each agent sees their own pending and resolved-today counts; managers see everyone', { skip }, async () => {
  const id = (await createTicket()).body.ticket._id;
  const owner = await ownerOf(id);
  await setStatus(owner, id, { status: 'in_progress' });
  await setStatus(owner, id, { status: 'resolved', note: 'Fixed the duplicate charge.' });
  await createTicket();

  const mine = await request(app).get('/api/tickets/workload').set(as(owner));
  assert.equal(mine.body.agents.length, 1);
  assert.equal(mine.body.agents[0].resolvedToday, 1);
  const team = await request(app).get('/api/tickets/workload').set(as('manager'));
  const total = team.body.agents.reduce((s, a) => s + a.pending, 0);
  assert.equal(total, 1, 'one ticket is still open');
  assert.equal((await request(app).get('/api/tickets/workload').set(as('cust1'))).status, 403);
});

test('a manager can send a test email and sees the mail server\'s reason if it fails', { skip }, async () => {
  const ok = await request(app).post('/api/manager/test-email').set(as('manager'));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.sentTo, 'maya@x.com');
  assert.equal((await mailFor('maya@x.com', /TriageDesk test email/)).length, 1);

  transport.sendMail.mock.mockImplementationOnce(async () => { throw new Error('Invalid login: 535 5.7.8'); });
  const bad = await request(app).post('/api/manager/test-email').set(as('manager'));
  assert.equal(bad.status, 502);
  assert.match(bad.body.error.message, /Invalid login: 535/);
});

test('routing learns from the managers: after 3 of their picks, it assigns the same way', { skip }, async () => {
  const teach = async () => {
    mlPredict = { category: 'billing', priority: 'urgent', confidence: { category: 0.9, priority: 0.9 } };
    const id = (await createTicket()).body.ticket._id;
    await request(app).patch(`/api/tickets/${id}/assign`).set(as('manager')).send({ agentId: users.tech.id });
    await Ticket.updateOne({ _id: id }, { status: 'closed' }); // done, so Tariq keeps room
  };
  await teach();
  await teach();
  assert.notEqual((await routeOf('urgent')).agent, users.tech.id, 'two picks are not a habit yet');
  await Ticket.updateMany({ status: { $ne: 'closed' } }, { status: 'closed' });

  await teach();
  const urgent = await routeOf('urgent');
  assert.equal(urgent.agent, users.tech.id, 'Tariq does not even handle billing; the managers chose him');
  assert.equal(urgent.why, 'auto: as managers assign urgent billing tickets');
  const low = await routeOf('low');
  assert.equal(low.agent, users.tech.id);
  assert.equal(low.why, 'auto: as managers assign billing tickets', 'no low-priority habit yet, so the category one');
});

test('a manager corrects a mistyped email; the next email goes to the right address', { skip }, async () => {
  const made = await request(app).post('/api/users').set(as('manager')).send({
    name: 'Zoe Ali', email: 'zoe@gmai.com', password: PASSWORD, role: 'agent', categories: ['general'],
  });
  const zoe = made.body.user.id;
  const fixed = await request(app).patch(`/api/users/${zoe}`).set(as('manager')).send({ email: 'zoe@x.com' });
  assert.equal(fixed.body.user.email, 'zoe@x.com');
  const taken = await request(app).patch(`/api/users/${zoe}`).set(as('manager')).send({ email: 'bilal@x.com' });
  assert.equal(taken.status, 409);

  mlPredict = { category: 'general', priority: 'low', confidence: { category: 0.9, priority: 0.9 } };
  await createTicket();
  assert.equal((await mailFor('zoe@x.com', /assigned to you/)).length, 1);
  assert.equal(outbox.filter((m) => m.to.includes('zoe@gmai.com')).length, 0);
  await request(app).patch(`/api/users/${zoe}`).set(as('manager')).send({ active: false }); // leave others' routing as it was
});
