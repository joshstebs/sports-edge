import { createHmac, timingSafeEqual } from 'node:crypto';

export const AUTH_COOKIE_NAME = '__Host-sportsedge_session';

export type AuthRole = 'admin' | 'tester';

export interface AuthSession {
  userId: string;
  username: string;
  role: AuthRole;
  issuedAt: number;
  expiresAt: number;
}

interface SessionPayload {
  v: 1;
  sub: string;
  usr: string;
  role: AuthRole;
  iat: number;
  exp: number;
}

function sign(encodedPayload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(encodedPayload).digest();
}

export function createSessionToken(
  identity: Pick<AuthSession, 'userId' | 'username' | 'role'>,
  secret: string,
  ttlSeconds: number,
  nowMs = Date.now(),
): string {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1) throw new Error('Invalid session TTL.');
  const now = Math.floor(nowMs / 1_000);
  const payload: SessionPayload = {
    v: 1,
    sub: identity.userId,
    usr: identity.username,
    role: identity.role,
    iat: now,
    exp: now + ttlSeconds,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encodedPayload}.${sign(encodedPayload, secret).toString('base64url')}`;
}

function isValidPayload(value: unknown, now: number): value is SessionPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<SessionPayload>;
  return (
    payload.v === 1 &&
    typeof payload.sub === 'string' && payload.sub.length > 0 && payload.sub.length <= 128 &&
    typeof payload.usr === 'string' && payload.usr.length > 0 && payload.usr.length <= 128 &&
    (payload.role === 'admin' || payload.role === 'tester') &&
    Number.isInteger(payload.iat) &&
    Number.isInteger(payload.exp) &&
    (payload.iat as number) <= now + 60 &&
    (payload.exp as number) > now &&
    (payload.exp as number) > (payload.iat as number)
  );
}

export function verifySessionToken(token: unknown, secret: string, nowMs = Date.now()): AuthSession | null {
  if (typeof token !== 'string' || token.length > 4_096) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  try {
    const suppliedSignature = Buffer.from(parts[1], 'base64url');
    // Reject alternate Base64URL spellings that decode to the same bytes.
    // Without canonicalization, unused trailing bits can make a modified token
    // string verify against an unchanged HMAC.
    if (suppliedSignature.toString('base64url') !== parts[1]) return null;
    const expectedSignature = sign(parts[0], secret);
    if (
      suppliedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(suppliedSignature, expectedSignature)
    ) return null;

    const payloadBytes = Buffer.from(parts[0], 'base64url');
    if (payloadBytes.toString('base64url') !== parts[0]) return null;
    const payload = JSON.parse(payloadBytes.toString('utf8')) as unknown;
    const now = Math.floor(nowMs / 1_000);
    if (!isValidPayload(payload, now)) return null;
    return {
      userId: payload.sub,
      username: payload.usr,
      role: payload.role,
      issuedAt: payload.iat,
      expiresAt: payload.exp,
    };
  } catch {
    return null;
  }
}

export function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const pair of cookieHeader.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    const key = pair.slice(0, separator).trim();
    if (key !== name) continue;
    const value = pair.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

export function sessionCookie(token: string, ttlSeconds: number): string {
  return `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${ttlSeconds}; HttpOnly; Secure; SameSite=Strict`;
}

export function expiredSessionCookie(): string {
  return `${AUTH_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}
