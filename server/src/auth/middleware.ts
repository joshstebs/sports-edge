import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AuthConfig } from './config.js';
import { AUTH_COOKIE_NAME, readCookie, verifySessionToken } from './session.js';
import type { AuthRole } from './session.js';

export function authenticateRequest(config: AuthConfig): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = readCookie(req.headers.cookie, AUTH_COOKIE_NAME);
    const session = verifySessionToken(token, config.sessionSecret);
    if (session && config.users.has(session.username)) {
      const currentUser = config.users.get(session.username)!;
      // Reconcile signed claims with current config so changing a role or deleting
      // an account takes effect without waiting for existing cookies to expire.
      if (currentUser.id === session.userId && currentUser.role === session.role) req.auth = session;
    }
    next();
  };
}

export const requireAuth: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  if (!req.auth) {
    res.status(401).json({ ok: false, error: 'Authentication required.' });
    return;
  }
  next();
};

export function requireRole(...roles: AuthRole[]): RequestHandler {
  const allowed = new Set(roles);
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    if (!allowed.has(req.auth.role)) {
      res.status(403).json({ ok: false, error: 'Insufficient permissions.' });
      return;
    }
    next();
  };
}
