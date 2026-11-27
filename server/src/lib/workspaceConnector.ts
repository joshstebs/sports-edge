import type { Connector } from '../workspace.js';

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
  return value as Record<string, unknown>;
}

export function number(value: unknown): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) throw new Error('Expected a number');
  return parsed;
}

export function string(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Expected text');
  return value;
}

export async function readConnector<T>(
  origin: string | undefined,
  path: string,
  parse: (data: unknown) => T,
  signal: AbortSignal,
  token?: string,
): Promise<Connector<T>> {
  if (!origin) return { status: 'unconfigured' };
  try {
    const response = await fetch(new URL(path, origin), {
      headers: token ? { Accept: 'application/json', Authorization: `Bearer ${token}` } : { Accept: 'application/json' },
      signal,
      redirect: 'error',
    });
    if (!response.ok) return { status: 'unavailable' };
    return { status: 'ready', data: parse(await response.json()) };
  } catch {
    return { status: 'unavailable' };
  }
}
