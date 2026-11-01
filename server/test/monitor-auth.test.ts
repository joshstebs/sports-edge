import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { monitorRouter } from '../src/routes/monitor.js';

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: { handle: RequestHandler }[];
  };
};

function guardsFor(path: string): RequestHandler[] {
  const layers = (monitorRouter as unknown as { stack: RouteLayer[] }).stack;
  const route = layers.find((layer) => layer.route?.path === path && layer.route.methods.post)?.route;
  assert.ok(route, 'Missing POST ' + path);
  assert.equal(route.stack.length, 3, 'Manual monitor action must have auth, role guard and handler');
  return route.stack.slice(0, 2).map((layer) => layer.handle);
}

function checkGuard(path: string, role?: 'admin' | 'tester') {
  const [authenticate, authorize] = guardsFor(path);
  const req = { auth: role ? {
    userId: role + '-id', username: role, role, issuedAt: 1, expiresAt: 9999999999,
  } : undefined } as Request;
  let statusCode: number | undefined;
  let nextCount = 0;
  const res = {
    status(code: number) { statusCode = code; return this; },
    json() { return this; },
  } as unknown as Response;
  const next = (() => { nextCount += 1; }) as NextFunction;
  authenticate(req, res, next);
  if (nextCount === 1) authorize(req, res, next);
  return { statusCode, nextCount };
}

test('manual monitoring endpoints reject anonymous and tester requests', () => {
  for (const path of ['/run', '/watchlist']) {
    assert.deepEqual(checkGuard(path), { statusCode: 401, nextCount: 0 });
    assert.deepEqual(checkGuard(path, 'tester'), { statusCode: 403, nextCount: 1 });
    assert.deepEqual(checkGuard(path, 'admin'), { statusCode: undefined, nextCount: 2 });
  }
});
