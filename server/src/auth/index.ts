export { isHostedProduction, loadAuthConfig, type AuthConfig, type AuthUser } from './config.js';
export { authenticateRequest, requireAuth, requireRole } from './middleware.js';
export { createUserRateLimiter } from './rateLimit.js';
export { hashPassword, verifyPassword } from './password.js';
export { createAuthRouter } from './router.js';
export { authenticatedNoStore, enforceTrustedOrigin, requireJsonRequest, securityHeaders } from './security.js';
export {
  AUTH_COOKIE_NAME,
  createSessionToken,
  verifySessionToken,
  type AuthRole,
  type AuthSession,
} from './session.js';
