import type { RequestHandler } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requireJsonRequest(): RequestHandler {
  return (req, res, next) => {
    if (!req.is('application/json')) {
      res.status(415).json({ ok: false, error: 'Content-Type must be application/json.' });
      return;
    }
    next();
  };
}

/** Exact Origin validation closes same-site sibling-origin and login-CSRF cases. */
export function enforceTrustedOrigin(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method.toUpperCase())) {
      next();
      return;
    }
    // The cron currently uses GET. Keep a narrow bearer exception if its
    // transport changes; the evaluation route still validates CRON_SECRET.
    if (req.path === '/api/evaluate' && req.header('authorization')?.startsWith('Bearer ')) {
      next();
      return;
    }
    const origin = req.header('origin');
    if (!origin || !allowed.has(origin)) {
      res.status(403).json({ ok: false, error: 'Request origin is not allowed.' });
      return;
    }
    next();
  };
}

export function securityHeaders(production: boolean): RequestHandler {
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; base-uri 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob: https:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
    );
    if (production && req.secure) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  };
}

export const authenticatedNoStore: RequestHandler = (req, res, next) => {
  if (req.auth) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  }
  next();
};
