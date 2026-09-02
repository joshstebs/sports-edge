import type { AuthRole } from './session.js';

export interface AuthUser {
  id: string;
  username: string;
  role: AuthRole;
  passwordHash: string;
}

export interface AuthConfig {
  users: ReadonlyMap<string, AuthUser>;
  sessionSecret: string;
  sessionTtlSeconds: number;
  allowedOrigins: readonly string[];
  production: boolean;
}

const DEFAULT_TTL_SECONDS = 8 * 60 * 60;
const MAX_TTL_SECONDS = 30 * 24 * 60 * 60;

function nonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function parseUsers(raw: string): ReadonlyMap<string, AuthUser> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('AUTH_USERS_JSON must be valid JSON.');
  }
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new Error('AUTH_USERS_JSON must be a non-empty array with at most 100 users.');
  }

  const users = new Map<string, AuthUser>();
  const ids = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') throw new Error('Invalid auth user.');
    const input = candidate as Partial<AuthUser>;
    if (
      !nonEmptyString(input.id, 128) ||
      !nonEmptyString(input.username, 128) ||
      (input.role !== 'admin' && input.role !== 'tester') ||
      !nonEmptyString(input.passwordHash, 512) ||
      !input.passwordHash.startsWith('scrypt$')
    ) {
      throw new Error('Each auth user requires a valid id, username, role, and scrypt passwordHash.');
    }
    const username = input.username.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) {
      throw new Error(`Invalid auth username: ${input.username}`);
    }
    if (users.has(username) || ids.has(input.id)) throw new Error('Auth user ids and usernames must be unique.');
    const user: AuthUser = { id: input.id, username, role: input.role, passwordHash: input.passwordHash };
    users.set(username, Object.freeze(user));
    ids.add(input.id);
  }

  if (![...users.values()].some((user) => user.role === 'admin')) {
    throw new Error('AUTH_USERS_JSON must include at least one admin.');
  }
  if (![...users.values()].some((user) => user.role === 'tester')) {
    throw new Error('AUTH_USERS_JSON must include at least one tester.');
  }
  return users;
}

function configuredValue(primaryName: string, developmentName: string, env: NodeJS.ProcessEnv): string | undefined {
  if (env[primaryName]) return env[primaryName];
  if (!isHostedProduction(env) && env.AUTH_ALLOW_DEV_CONFIG === 'true') return env[developmentName];
  return undefined;
}

export function isHostedProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production' || Boolean(env.VERCEL) || Boolean(env.VERCEL_ENV);
}

function parseAllowedOrigins(raw: string | undefined, production: boolean, env: NodeJS.ProcessEnv): readonly string[] {
  if (!raw) throw new Error('APP_ORIGIN is required for CSRF protection.');
  const origins = raw.split(',').map((value) => value.trim()).filter(Boolean);
  if (env.VERCEL_ENV === 'preview') {
    for (const hostname of [env.VERCEL_URL, env.VERCEL_BRANCH_URL]) {
      if (hostname) origins.push(`https://${hostname}`);
    }
  }
  if (!origins.length || origins.length > 12) throw new Error('APP_ORIGIN must contain 1-10 origins plus optional Vercel preview origins.');
  const parsed = origins.map((value) => {
    let url: URL;
    try { url = new URL(value); }
    catch { throw new Error(`APP_ORIGIN contains an invalid URL: ${value}`); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error(`APP_ORIGIN must contain only HTTP(S) origins: ${value}`);
    }
    if (production && url.protocol !== 'https:') throw new Error('APP_ORIGIN must use HTTPS in production.');
    if (url.origin !== value.replace(/\/$/, '')) {
      throw new Error(`APP_ORIGIN entries cannot contain paths, queries, or fragments: ${value}`);
    }
    return url.origin;
  });
  return Object.freeze([...new Set(parsed)]);
}

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const production = isHostedProduction(env);
  const usersJson = configuredValue('AUTH_USERS_JSON', 'AUTH_DEV_USERS_JSON', env);
  const sessionSecret = configuredValue('AUTH_SESSION_SECRET', 'AUTH_DEV_SESSION_SECRET', env);
  if (!usersJson || !sessionSecret) {
    const suffix = production
      ? 'Production requires AUTH_USERS_JSON and AUTH_SESSION_SECRET.'
      : 'Set AUTH_USERS_JSON/AUTH_SESSION_SECRET, or explicitly enable AUTH_ALLOW_DEV_CONFIG=true and set AUTH_DEV_USERS_JSON/AUTH_DEV_SESSION_SECRET.';
    throw new Error(`Authentication is not configured. ${suffix}`);
  }
  if (Buffer.byteLength(sessionSecret, 'utf8') < 32) {
    throw new Error('AUTH_SESSION_SECRET must contain at least 32 bytes of entropy.');
  }

  const ttlRaw = env.AUTH_SESSION_TTL_SECONDS;
  const sessionTtlSeconds = ttlRaw === undefined ? DEFAULT_TTL_SECONDS : Number(ttlRaw);
  if (!Number.isInteger(sessionTtlSeconds) || sessionTtlSeconds < 300 || sessionTtlSeconds > MAX_TTL_SECONDS) {
    throw new Error(`AUTH_SESSION_TTL_SECONDS must be an integer from 300 to ${MAX_TTL_SECONDS}.`);
  }

  return Object.freeze({
    users: parseUsers(usersJson),
    sessionSecret,
    sessionTtlSeconds,
    allowedOrigins: parseAllowedOrigins(env.APP_ORIGIN, production, env),
    production,
  });
}
