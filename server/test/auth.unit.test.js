// Unit tests: no database needed. They cover the pieces of auth that are pure logic.
import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

process.env.NODE_ENV = "test";
const { createApp } = await import("../src/app.js");
const tokens = await import("../src/utils/tokens.js");
const { requireRole } = await import("../src/middleware/roleMiddleware.js");
const app = createApp();

const fakeUser = {
  _id: { toString: () => "64b000000000000000000001" },
  role: "agent",
};

test("access token carries the user id and role", () => {
  const token = tokens.signAccessToken(fakeUser);
  const payload = tokens.verifyAccessToken(token);
  assert.equal(payload.sub, "64b000000000000000000001");
  assert.equal(payload.role, "agent");
});

test("refresh token carries a unique id every time", () => {
  const a = tokens.signRefreshToken(fakeUser);
  const b = tokens.signRefreshToken(fakeUser);
  assert.notEqual(a.jti, b.jti);
  assert.equal(tokens.verifyRefreshToken(a.token).jti, a.jti);
});

test("an access token is rejected where a refresh token is expected", () => {
  const access = tokens.signAccessToken(fakeUser);
  assert.throws(() => tokens.verifyRefreshToken(access));
});

test("only the hash of the refresh token id is stored, and it is stable", () => {
  const h1 = tokens.hashTokenId("abc");
  assert.equal(h1, tokens.hashTokenId("abc"));
  assert.notEqual(h1, "abc");
  assert.equal(h1.length, 64);
});

test("refresh cookie is httpOnly and scoped to /api/auth", () => {
  const opts = tokens.refreshCookieOptions();
  assert.equal(opts.httpOnly, true);
  assert.equal(opts.path, "/api/auth");
  assert.ok(opts.maxAge > 0);
  assert.equal("maxAge" in tokens.clearRefreshCookieOptions(), false);
});

test("requireRole lets the right role through and blocks the wrong one", () => {
  let err = "not called";
  requireRole("manager")({ user: { role: "manager" } }, {}, (e) => (err = e));
  assert.equal(err, undefined);

  requireRole("manager")({ user: { role: "customer" } }, {}, (e) => (err = e));
  assert.equal(err.status, 403);
  assert.equal(err.code, "FORBIDDEN");

  requireRole("manager")({}, {}, (e) => (err = e));
  assert.equal(err.status, 401);
});

test("protected route without a token returns 401 in the contract shape", async () => {
  const res = await request(app).get("/api/auth/me");
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, "UNAUTHORIZED");
});

test("a malformed token returns INVALID_TOKEN", async () => {
  const res = await request(app)
    .get("/api/auth/me")
    .set("Authorization", "Bearer not-a-jwt");
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, "INVALID_TOKEN");
});

test("registration input is validated before reaching the database", async () => {
  const res = await request(app)
    .post("/api/auth/register")
    .send({ name: "A", email: "not-an-email", password: "short" });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "VALIDATION_ERROR");
  assert.ok(res.body.error.details.email);
  assert.ok(res.body.error.details.password);
  assert.ok(res.body.error.details.name);
});

test("refresh without a cookie returns NO_REFRESH_TOKEN", async () => {
  const res = await request(app).post("/api/auth/refresh");
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, "NO_REFRESH_TOKEN");
});
