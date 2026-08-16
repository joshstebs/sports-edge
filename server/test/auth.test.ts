import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { loadAuthConfig, type AuthConfig } from '../src/auth/config.js';
import { authenticateRequest, requireAuth, requireRole } from '../src/auth/middleware.js';
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { AUTH_COOKIE_NAME, createSessionToken, verifySessionToken } from '../src/auth/session.js';

test('scrypt password records verify the right password only', async () => {
  const password = 'correct horse battery staple';
  const record = await hashPassword(password, { N: 16_384, r: 8, p: 1 });
  assert.match(record, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verifyPassword(password, record), true);
  assert.equal(await verifyPassword('incorrect password', record), false);
  assert.equal(await verifyPassword(password, `${record}corrupt`), false);
  assert.equal(await verifyPassword(password, 'not-a-password-record'), false);
});

test('signed session rejects tampering and expiration', () => {
  const secret = randomBytes(48).toString('base64url');
  const issuedAt = Date.UTC(2026, 7, 16, 12, 0, 0);
  const token = createSessionToken(
    { userId: 'user-1', username: 'admin', role: 'admin' },
    secret,
    600,
    issuedAt,
  );

  assert.deepEqual(verifySessionToken(token, secret, issuedAt + 1_000), {
    userId: 'user-1',
    username: 'admin',
    role: 'admin',
    issuedAt: issuedAt / 1_000,
    expiresAt: issuedAt / 1_000 + 600,
  });
  const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
  assert.equal(verifySessionToken(tampered, secret, issuedAt + 1_000), null);
  assert.equal(verifySessionToken(token, secret, issuedAt + 600_000), null);
  assert.equal(verifySessionToken(token, randomBytes(48).toString('base64url'), issuedAt + 1_000), null);
});

function responseRecorder(): { response: Response; state: { status?: number; body?: unknown } } {
  const state: { status?: number; body?: unknown } = {};
  const response = {
    status(code: number) {
      state.status = code;
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
  } as unknown as Response;
  return { response, state };
}

test('requireAuth and requireRole enforce 401/403 and call next when allowed', () => {
  const request = { headers: {} } as Request;
  let nextCalls = 0;
  const next = (() => { nextCalls += 1; }) as NextFunction;

  const unauthenticated = responseRecorder();
  requireAuth(request, unauthenticated.response, next);
  assert.equal(unauthenticated.state.status, 401);
  assert.equal(nextCalls, 0);

  request.auth = {
    userId: 'tester-1', username: 'tester', role: 'tester', issuedAt: 1, expiresAt: 2,
  };
  const forbidden = responseRecorder();
  requireRole('admin')(request, forbidden.response, next);
  assert.equal(forbidden.state.status, 403);
  assert.equal(nextCalls, 0);

  const allowed = responseRecorder();
  requireRole('admin', 'tester')(request, allowed.response, next);
  assert.equal(allowed.state.status, undefined);
  assert.equal(nextCalls, 1);
});

test('authenticateRequest accepts a current user and rejects removed users', () => {
  const secret = randomBytes(48).toString('base64url');
  const token = createSessionToken(
    { userId: 'admin-1', username: 'admin', role: 'admin' }, secret, 600,
  );
  const config: AuthConfig = {
    sessionSecret: secret,
    sessionTtlSeconds: 600,
    allowedOrigins: ['http://localhost:5180'],
    production: false,
    users: new Map([['admin', {
      id: 'admin-1', username: 'admin', role: 'admin', passwordHash: 'scrypt$placeholder',
    }]]),
  };
  let nextCalls = 0;
  const request = { headers: { cookie: `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}` } } as Request;
  authenticateRequest(config)(request, {} as Response, (() => { nextCalls += 1; }) as NextFunction);
  assert.equal(request.auth?.role, 'admin');
  assert.equal(nextCalls, 1);

  const removedRequest = { headers: { cookie: `${AUTH_COOKIE_NAME}=${token}` } } as Request;
  authenticateRequest({ ...config, users: new Map() })(
    removedRequest, {} as Response, (() => { nextCalls += 1; }) as NextFunction,
  );
  assert.equal(removedRequest.auth, undefined);
  assert.equal(nextCalls, 2);
});

test('Vercel never accepts opt-in development auth credentials', () => {
  const users = JSON.stringify([
    { id: 'admin-1', username: 'admin', role: 'admin', passwordHash: 'scrypt$placeholder' },
    { id: 'tester-1', username: 'tester', role: 'tester', passwordHash: 'scrypt$placeholder' },
  ]);
  const development = {
    AUTH_ALLOW_DEV_CONFIG: 'true', AUTH_DEV_USERS_JSON: users,
    AUTH_DEV_SESSION_SECRET: randomBytes(48).toString('base64url'),
    APP_ORIGIN: 'http://localhost:5180',
  };
  assert.equal(loadAuthConfig(development).users.size, 2);
  assert.throws(
    () => loadAuthConfig({ ...development, VERCEL: '1', APP_ORIGIN: 'https://sports.example' }),
    /Production requires AUTH_USERS_JSON and AUTH_SESSION_SECRET/,
  );
});

test('production requires an HTTPS APP_ORIGIN and normalizes allowed origins', () => {
  const users = JSON.stringify([
    { id: 'admin-1', username: 'admin', role: 'admin', passwordHash: 'scrypt$placeholder' },
    { id: 'tester-1', username: 'tester', role: 'tester', passwordHash: 'scrypt$placeholder' },
  ]);
  const base = {
    NODE_ENV: 'production', AUTH_USERS_JSON: users,
    AUTH_SESSION_SECRET: randomBytes(48).toString('base64url'),
  };
  assert.throws(() => loadAuthConfig(base), /APP_ORIGIN is required/);
  assert.throws(() => loadAuthConfig({ ...base, APP_ORIGIN: 'http://sports.example' }), /must use HTTPS/);
  const config = loadAuthConfig({ ...base, APP_ORIGIN: 'https://sports.example/, https://admin.sports.example' });
  assert.deepEqual(config.allowedOrigins, ['https://sports.example', 'https://admin.sports.example']);
  assert.equal(config.production, true);
});
