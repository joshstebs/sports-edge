// API-Sports provider for NBA/NFL with strict quota/error handling.
// The key is server-only: API_SPORTS_KEY. Every call fails closed and callers
// can fall back to ESPN. NHL remains on ESPN/NHL web data because API-Hockey's
// published coverage does not currently promise NHL player-stat depth.

const BASES = {
  nba: 'https://v2.nba.api-sports.io',
  nfl: 'https://v1.american-football.api-sports.io',
} as const;

export type ApiSportsLeague = keyof typeof BASES;

export interface ApiSportsEnvelope<T = any> {
  get?: string;
  parameters?: Record<string, unknown>;
  errors?: Record<string, unknown> | unknown[];
  results?: number;
  paging?: { current?: number; total?: number };
  response?: T;
}

export interface ApiSportsResult<T = any> {
  available: boolean;
  source: 'api-sports.io';
  league: ApiSportsLeague;
  reason?: string;
  data?: T;
  remainingDaily?: number | null;
  remainingMinute?: number | null;
}

let lastRemainingDaily: number | null = null;
let lastRemainingMinute: number | null = null;

export function apiSportsConfigured(): boolean {
  return Boolean(process.env.API_SPORTS_KEY);
}

export function apiSportsQuota(): { daily: number | null; minute: number | null } {
  return { daily: lastRemainingDaily, minute: lastRemainingMinute };
}

function hasErrors(errors: ApiSportsEnvelope['errors']): boolean {
  if (Array.isArray(errors)) return errors.length > 0;
  return Boolean(errors && typeof errors === 'object' && Object.keys(errors).length);
}

function errorText(errors: ApiSportsEnvelope['errors']): string {
  if (Array.isArray(errors)) return errors.map(String).join('; ');
  if (errors && typeof errors === 'object') return Object.entries(errors).map(([k, v]) => `${k}: ${String(v)}`).join('; ');
  return '';
}

export async function apiSportsGet<T = any>(
  league: ApiSportsLeague,
  path: string,
  params: Record<string, string | number | boolean | null | undefined>,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiSportsResult<T>> {
  const key = process.env.API_SPORTS_KEY;
  if (!key) return { available: false, source: 'api-sports.io', league, reason: 'API_SPORTS_KEY not configured' };
  if (lastRemainingDaily !== null && lastRemainingDaily <= 2) {
    return { available: false, source: 'api-sports.io', league, reason: 'API-Sports daily quota nearly exhausted', remainingDaily: lastRemainingDaily, remainingMinute: lastRemainingMinute };
  }

  const url = new URL(`${BASES[league]}${path.startsWith('/') ? path : `/${path}`}`);
  for (const [name, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && String(value).trim() !== '') url.searchParams.set(name, String(value));
  }
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { 'x-apisports-key': key },
      signal: AbortSignal.timeout(12_000),
    });
    const daily = response.headers.get('x-ratelimit-requests-remaining');
    const minute = response.headers.get('x-ratelimit-remaining');
    if (daily != null && Number.isFinite(Number(daily))) lastRemainingDaily = Number(daily);
    if (minute != null && Number.isFinite(Number(minute))) lastRemainingMinute = Number(minute);
    const body = await response.json().catch(() => null) as ApiSportsEnvelope<T> | null;
    if (!response.ok) {
      return { available: false, source: 'api-sports.io', league, reason: `API-Sports HTTP ${response.status}${body?.errors ? `: ${errorText(body.errors)}` : ''}`, remainingDaily: lastRemainingDaily, remainingMinute: lastRemainingMinute };
    }
    if (!body || hasErrors(body.errors)) {
      return { available: false, source: 'api-sports.io', league, reason: body ? `API-Sports error: ${errorText(body.errors) || 'unknown error'}` : 'API-Sports returned invalid JSON', remainingDaily: lastRemainingDaily, remainingMinute: lastRemainingMinute };
    }
    return { available: true, source: 'api-sports.io', league, data: body.response as T, remainingDaily: lastRemainingDaily, remainingMinute: lastRemainingMinute };
  } catch (error) {
    return { available: false, source: 'api-sports.io', league, reason: `API-Sports fetch failed: ${(error as Error).message}`, remainingDaily: lastRemainingDaily, remainingMinute: lastRemainingMinute };
  }
}

export async function findPlayer(
  league: ApiSportsLeague,
  name: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiSportsResult<any>> {
  const search = String(name ?? '').trim();
  if (search.length < 2) return { available: false, source: 'api-sports.io', league, reason: 'player name too short' };
  const result = await apiSportsGet<any[]>(league, '/players', { search }, fetchImpl);
  if (!result.available) return result;
  const players = Array.isArray(result.data) ? result.data : [];
  const lowered = search.toLowerCase();
  const hit = players.find((p: any) => String(p?.name ?? p?.player?.name ?? '').toLowerCase() === lowered)
    ?? players.find((p: any) => String(p?.name ?? p?.player?.name ?? '').toLowerCase().includes(lowered));
  return hit
    ? { ...result, data: hit }
    : { ...result, available: false, reason: `player "${search}" not found`, data: undefined };
}

export async function getSeasonPlayerStats(
  league: ApiSportsLeague,
  playerId: string | number,
  season: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiSportsResult<any[]>> {
  return apiSportsGet<any[]>(league, '/players/statistics', { id: playerId, season }, fetchImpl);
}

export async function getNflInjuries(
  playerId?: string | number | null,
  teamId?: string | number | null,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiSportsResult<any[]>> {
  return apiSportsGet<any[]>('nfl', '/injuries', { player: playerId ?? undefined, team: teamId ?? undefined }, fetchImpl);
}

export function apiSportsSeasonForNow(now = new Date()): number {
  // NBA/NFL seasons are conventionally keyed by the year in which the season starts.
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return month >= 7 ? year : year - 1;
}
