import type { AuthSession } from '../auth/session.js';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthSession;
    }
  }
}

export {};
