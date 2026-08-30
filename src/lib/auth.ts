export type UserRole = 'admin' | 'tester' | 'customer';

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
}

interface SessionPayload {
  authenticated?: boolean;
  user?: AuthUser | null;
  error?: unknown;
  message?: unknown;
}

function errorMessage(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value instanceof Error && value.message) return value.message;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['message', 'error', 'detail', 'reason']) {
      const nested = errorMessage(record[key]);
      if (nested) return nested;
    }
    try {
      const serialized = JSON.stringify(value);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // fall through to generic message
    }
  }
  return null;
}

async function readPayload(res: Response): Promise<SessionPayload> {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await res.json().catch(() => ({}))) as SessionPayload;
  }
  const text = await res.text().catch(() => '');
  return text ? { error: text } : {};
}

function responseError(payload: SessionPayload, fallback: string): string {
  return errorMessage(payload.error) || errorMessage(payload.message) || fallback;
}

export async function fetchSession(): Promise<AuthUser | null> {
  const res = await fetch(`${import.meta.env.BASE_URL}api/auth/session`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (res.status === 401) return null;
  const payload = await readPayload(res);
  if (!res.ok) throw new Error(responseError(payload, `Session check failed (HTTP ${res.status})`));
  return payload.authenticated && payload.user ? payload.user : null;
}

export async function signIn(username: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${import.meta.env.BASE_URL}api/auth/login`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const payload = await readPayload(res);
  if (!res.ok || !payload.user) {
    throw new Error(responseError(payload, 'The username or password was not accepted.'));
  }
  return payload.user;
}

export async function signOut(): Promise<void> {
  const res = await fetch(`${import.meta.env.BASE_URL}api/auth/logout`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const payload = await readPayload(res);
    throw new Error(responseError(payload, `Sign out failed (HTTP ${res.status})`));
  }
}
