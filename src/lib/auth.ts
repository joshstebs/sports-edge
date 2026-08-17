export type UserRole = 'admin' | 'tester' | 'customer';

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
}

interface SessionPayload {
  authenticated?: boolean;
  user?: AuthUser | null;
  error?: string;
}

async function readPayload(res: Response): Promise<SessionPayload> {
  return (await res.json().catch(() => ({}))) as SessionPayload;
}

export async function fetchSession(): Promise<AuthUser | null> {
  const res = await fetch(`${import.meta.env.BASE_URL}api/auth/session`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (res.status === 401) return null;
  const payload = await readPayload(res);
  if (!res.ok) throw new Error(payload.error || `Session check failed (HTTP ${res.status})`);
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
    throw new Error(payload.error || 'The username or password was not accepted.');
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
    throw new Error(payload.error || `Sign out failed (HTTP ${res.status})`);
  }
}
