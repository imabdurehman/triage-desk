import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.NODE_ENV = 'test';
const { createApp } = await import('../src/app.js');
const { canTransition, CATEGORIES } = await import('../src/config/contract.js');
const app = createApp();

test('GET /api/health responds ok', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.contractVersion, 1);
});

test('GET /api/meta exposes the shared enums', async () => {
  const res = await request(app).get('/api/meta');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.categories, CATEGORIES);
  assert.ok(res.body.roles.includes('manager'));
});

test('unknown route returns the contract error shape', async () => {
  const res = await request(app).get('/api/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'ROUTE_NOT_FOUND');
  assert.ok(res.body.error.message);
});

test('malformed JSON returns INVALID_JSON, not a 500', async () => {
  const res = await request(app)
    .post('/api/health')
    .set('Content-Type', 'application/json')
    .send('{bad json');
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_JSON');
});

test('status transitions follow the contract', () => {
  assert.equal(canTransition('open', 'assigned'), true);
  assert.equal(canTransition('closed', 'open'), false);
  assert.equal(canTransition('open', 'resolved'), false);
});
