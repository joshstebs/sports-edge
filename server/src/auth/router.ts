import { Router } from 'express';
import { burnPasswordCheck, verifyPassword } from './password.js';
import { AuthConfig, loadAuthConfig } from './config.js';
import { authenticateRequest } from './middleware.js';
import { createSessionToken, expiredSessionCookie, sessionCookie } from './session.js';

function noStore(res: { setHeader(name: string, value: string): unknown }): void {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
}

export function createAuthRouter(config: AuthConfig = loadAuthConfig()): Router {
  const router = Router();

  router.post('/auth/login', async (req, res, next) => {
    noStore(res);
    try {
      const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
      const password = req.body?.password;
      const user = config.users.get(username);
      const valid = user ? await verifyPassword(password, user.passwordHash) : (await burnPasswordCheck(password), false);
      if (!valid || !user) {
        console.warn('[auth] login rejected', {
          username: username || '<empty>',
          configuredUser: Boolean(user),
          role: user?.role ?? null,
        });
        res.status(401).json({ ok: false, error: 'Invalid username or password.' });
        return;
      }

      const token = createSessionToken(
        { userId: user.id, username: user.username, role: user.role },
        config.sessionSecret,
        config.sessionTtlSeconds,
      );
      res.setHeader('Set-Cookie', sessionCookie(token, config.sessionTtlSeconds));
      console.info('[auth] login accepted', { username: user.username, role: user.role });
      res.json({ ok: true, user: { id: user.id, username: user.username, role: user.role } });
    } catch (error) {
      next(error);
    }
  });

  router.post('/auth/logout', (_req, res) => {
    noStore(res);
    res.setHeader('Set-Cookie', expiredSessionCookie());
    res.json({ ok: true });
  });

  router.get('/auth/session', authenticateRequest(config), (req, res) => {
    noStore(res);
    if (!req.auth) {
      res.json({ ok: true, authenticated: false });
      return;
    }
    res.json({
      ok: true,
      authenticated: true,
      user: { id: req.auth.userId, username: req.auth.username, role: req.auth.role },
      expiresAt: req.auth.expiresAt,
    });
  });

  return router;
}
