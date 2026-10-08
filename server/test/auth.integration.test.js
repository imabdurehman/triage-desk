// Integration tests: run the full auth flow against a real MongoDB.
// Skipped unless MONGO_URI_TEST is set. This file uses its own database, named
// after the one in MONGO_URI_TEST plus "_auth" (triagedesk_test_auth), and WIPES
// it before and after the run, so never point it at data you care about.
import 'dotenv/config'; // lets MONGO_URI_TEST come from server/.env
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';
const uri = process.env.MONGO_URI_TEST;
const skip = !uri && 'set MONGO_URI_TEST to run integration tests';
// Node runs test files at the same time, each in its own process. If they shared
// one database, one file's dropDatabase() would delete the other file's users
// mid-run (seen as 401 ACCOUNT_INACTIVE). So each integration file uses its own.
const dbName = `${uri?.split('?')[0].split('/')[3] || 'triagedesk_test'}_auth`;

const { createApp } = await import('../src/app.js');
const { User } = await import('../src/models/User.js');
const { createManager } = await import('../scripts/createManager.js');
const { REFRESH_COOKIE } = await import('../src/utils/tokens.js');
const app = createApp();

/** Pulls the refresh cookie value out of a Set-Cookie header. */
const refreshCookieOf = (res) =>
  (res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${REFRESH_COOKIE}=`))?.split(';')[0];

const customer = { name: 'Sara Ahmed', email: 'sara@example.com', password: 'correct-horse-9' };

before(async () => {
  if (skip) return;
  await mongoose.connect(uri, { dbName });
  await mongoose.connection.dropDatabase();
  await User.init(); // builds the unique email index before tests rely on it
});

after(async () => {
  if (skip) return;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test('register creates a customer and sets an httpOnly refresh cookie', { skip }, async () => {
  const res = await request(app).post('/api/auth/register').send(customer);
  assert.equal(res.status, 201);
  assert.equal(res.body.user.role, 'customer');
  assert.equal(res.body.user.email, 'sara@example.com');
  assert.ok(res.body.accessToken);
  assert.equal(res.body.refreshToken, undefined, 'refresh token must never be in the JSON body');
  assert.equal(res.body.user.passwordHash, undefined, 'password hash must never leave the server');
  const cookie = res.headers['set-cookie'].find((c) => c.startsWith(REFRESH_COOKIE));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Path=\/api\/auth/);
});

test('public registration cannot choose its own role', { skip }, async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Sneaky', email: 'sneaky@example.com', password: 'password-123', role: 'manager' });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.role, 'customer');
});

test('registering the same email twice returns EMAIL_TAKEN', { skip }, async () => {
  const res = await request(app).post('/api/auth/register').send(customer);
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'EMAIL_TAKEN');
});

test('email is matched case-insensitively at login', { skip }, async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'SARA@Example.com', password: customer.password });
  assert.equal(res.status, 200);
});

test('wrong password and unknown email give the same answer', { skip }, async () => {
  const wrongPw = await request(app)
    .post('/api/auth/login').send({ email: customer.email, password: 'nope-nope-nope' });
  const noUser = await request(app)
    .post('/api/auth/login').send({ email: 'ghost@example.com', password: 'nope-nope-nope' });
  assert.equal(wrongPw.status, 401);
  assert.equal(noUser.status, 401);
  assert.equal(wrongPw.body.error.code, 'INVALID_CREDENTIALS');
  assert.equal(noUser.body.error.message, wrongPw.body.error.message);
});

test('the access token opens /me', { skip }, async () => {
  const login = await request(app).post('/api/auth/login').send(customer);
  const res = await request(app)
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${login.body.accessToken}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.user.email, customer.email);
});

test('refresh rotates the token, and replaying an old one revokes the session', { skip }, async () => {
  const login = await request(app).post('/api/auth/login').send(customer);
  const first = refreshCookieOf(login);

  const r1 = await request(app).post('/api/auth/refresh').set('Cookie', first);
  assert.equal(r1.status, 200);
  assert.ok(r1.body.accessToken);
  const second = refreshCookieOf(r1);
  assert.ok(second && second !== first, 'a new refresh token must be issued');

  // Someone replays the first token: that is theft, so everything is revoked.
  const replay = await request(app).post('/api/auth/refresh').set('Cookie', first);
  assert.equal(replay.status, 401);
  assert.equal(replay.body.error.code, 'REFRESH_TOKEN_REUSED');

  // ...including the legitimate latest token.
  const afterRevoke = await request(app).post('/api/auth/refresh').set('Cookie', second);
  assert.equal(afterRevoke.status, 401);
});

test('logout ends the session', { skip }, async () => {
  const login = await request(app).post('/api/auth/login').send(customer);
  const cookie = refreshCookieOf(login);
  const out = await request(app)
    .post('/api/auth/logout')
    .set('Authorization', `Bearer ${login.body.accessToken}`);
  assert.equal(out.status, 204);
  const res = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
  assert.equal(res.status, 401);
});

test('a deactivated account loses access immediately', { skip }, async () => {
  const login = await request(app).post('/api/auth/login').send(customer);
  await User.updateOne({ email: customer.email }, { active: false });

  const me = await request(app)
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${login.body.accessToken}`);
  assert.equal(me.status, 401, 'a still-valid access token must stop working');
  assert.equal(me.body.error.code, 'ACCOUNT_INACTIVE');

  const again = await request(app).post('/api/auth/login').send(customer);
  assert.equal(again.status, 403);
  assert.equal(again.body.error.code, 'ACCOUNT_INACTIVE');

  await User.updateOne({ email: customer.email }, { active: true });
});

test('createManager script creates a manager, and promotes an existing user', { skip }, async () => {
  const made = await createManager({ name: 'Ali', email: 'ali@example.com', password: 'manager-pass-1' });
  assert.equal(made.created, true);
  assert.equal(made.user.role, 'manager');

  const login = await request(app)
    .post('/api/auth/login').send({ email: 'ali@example.com', password: 'manager-pass-1' });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.role, 'manager');

  const promoted = await createManager({ email: customer.email, password: 'ignored-for-existing' });
  assert.equal(promoted.created, false);
  assert.equal(promoted.user.role, 'manager');
});
