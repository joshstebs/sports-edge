import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { createUserRateLimiter } from '../src/auth/rateLimit.js';
import { authenticatedNoStore, enforceTrustedOrigin, requireJsonRequest, securityHeaders } from '../src/auth/security.js';
import { predictionsRouter } from '../src/routes/predictions.js';

interface RecordedResponse {
  status?: number;
  body?: unknown;
  headers: Record<string, string>;
}

function responseRecorder(): { response: Response; state: RecordedResponse } {
  const state: RecordedResponse = { headers: {} };
  const response = {
    setHeader(name: string, value: string) { state.headers[name.toLowerCase()] = String(value); return this; },
    status(code: number) { state.status = code; return this; },
    json(body: unknown) { state.body = body; return this; },
  } as unknown as Response;
  return { response, state };
}

function request(method: string, origin?: string): Request {
  const headers: Record<string, string> = {};
  if (origin) headers.origin = origin;
  return {
    method,
    path: '/api/ledger',
    headers,
    header(name: string) { return headers[name.toLowerCase()]; },
    get(name: string) { return headers[name.toLowerCase()]; },
  } as unknown as Request;
}

test('origin guard allows exact trusted origins and blocks absent or foreign origins', () => {
  const guard = enforceTrustedOrigin(['https://sports.example']);
  let nextCalls = 0;
  const next = (() => { nextCalls++; }) as NextFunction;

  guard(request('POST', 'https://sports.example'), responseRecorder().response, next);
  assert.equal(nextCalls, 1);

  for (const origin of [undefined, 'https://evil.example', 'https://sports.example.evil.test']) {
    const recorded = responseRecorder();
    guard(request('POST', origin), recorded.response, next);
    assert.equal(recorded.state.status, 403);
  }
  guard(request('GET'), responseRecorder().response, next);
  assert.equal(nextCalls, 2);
});

test('origin guard preserves the narrow bearer cron exception', () => {
  const req = request('POST');
  req.path = '/api/evaluate';
  req.headers.authorization = 'Bearer test-value';
  let nextCalls = 0;
  enforceTrustedOrigin(['https://sports.example'])(req, responseRecorder().response, (() => { nextCalls++; }) as NextFunction);
  assert.equal(nextCalls, 1);
});

test('login content-type guard accepts JSON only', () => {
  let nextCalls = 0;
  const next = (() => { nextCalls++; }) as NextFunction;
  const jsonReq = { is: (type: string) => type === 'application/json' } as Request;
  requireJsonRequest()(jsonReq, responseRecorder().response, next);
  assert.equal(nextCalls, 1);

  const recorded = responseRecorder();
  requireJsonRequest()({ is: () => false } as unknown as Request, recorded.response, next);
  assert.equal(recorded.state.status, 415);
});

test('HSTS is emitted only for production HTTPS while frame/CSP headers are always present', () => {
  const insecure = responseRecorder();
  securityHeaders(true)({ secure: false } as Request, insecure.response, (() => undefined) as NextFunction);
  assert.equal(insecure.state.headers['strict-transport-security'], undefined);
  assert.equal(insecure.state.headers['x-frame-options'], 'DENY');
  assert.match(insecure.state.headers['permissions-policy'], /microphone=\(self\)/);
  assert.match(insecure.state.headers['content-security-policy'], /frame-ancestors 'none'/);

  const secure = responseRecorder();
  securityHeaders(true)({ secure: true } as Request, secure.response, (() => undefined) as NextFunction);
  assert.match(secure.state.headers['strict-transport-security'], /max-age=31536000/);
});

test('authenticated responses disable browser and CDN storage', () => {
  const recorded = responseRecorder();
  const req = request('GET');
  req.auth = { userId: 'tester-1', username: 'tester', role: 'tester', issuedAt: 1, expiresAt: 2 };
  let nextCalls = 0;
  authenticatedNoStore(req, recorded.response, (() => { nextCalls++; }) as NextFunction);
  assert.equal(recorded.state.headers['cache-control'], 'private, no-store');
  assert.equal(recorded.state.headers['vercel-cdn-cache-control'], 'no-store');
  assert.equal(nextCalls, 1);
});

test('local per-user limiter rejects requests above the account quota', async () => {
  const previousUrl = process.env.UPSTASH_REDIS_REST_URL;
  const previousToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    const limiter = createUserRateLimiter({ scope: `test_${randomUUID().replaceAll('-', '')}`, windowMs: 60_000, limit: 2 });
    const req = request('POST');
    req.auth = { userId: randomUUID(), username: 'tester', role: 'tester', issuedAt: 1, expiresAt: 2 };
    let nextCalls = 0;
    for (let i = 0; i < 2; i++) await limiter(req, responseRecorder().response, (() => { nextCalls++; }) as NextFunction);
    const blocked = responseRecorder();
    await limiter(req, blocked.response, (() => { nextCalls++; }) as NextFunction);
    assert.equal(nextCalls, 2);
    assert.equal(blocked.state.status, 429);
    assert.equal(blocked.state.headers['ratelimit-remaining'], '0');
  } finally {
    if (previousUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = previousUrl;
    if (previousToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = previousToken;
  }
});

test('prediction history router exposes no client-write method', () => {
  const methods = predictionsRouter.stack.flatMap((layer: any) =>
    layer.route ? Object.keys(layer.route.methods).filter((method) => layer.route.methods[method]) : [],
  );
  assert.deepEqual(methods, ['get']);
});
