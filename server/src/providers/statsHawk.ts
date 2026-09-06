const BASE = 'https://api.statshawk.ai';
const SOURCE = 'api.statshawk.ai';

type Row = Record<string, unknown>;
export type StatsHawkSport = 'mlb' | 'nfl';

function key(): string { return process.env.STATSHAWK_API_KEY ?? ''; }
export function statsHawkConfigured(): boolean { return Boolean(key()); }

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\.?\b/g, '').replace(/[^a-z0-9]/g, '');
}
function num(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function record(value: unknown): Row | null { return value && typeof value === 'object' ? value as Row : null; }

async function request(path: string): Promise<any> {
  if (!key()) throw new Error('STATSHAWK_API_KEY not configured');
  const res = await fetch(BASE + path, {
    headers: { 'X-API-Key': key(), 'User-Agent': 'SportsEdge/0.3' },
    signal: AbortSignal.timeout(6500),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error('StatsHawk HTTP ' + res.status + ': ' + String(body?.error?.message ?? body?.error?.code ?? 'request failed'));
  if (!body) throw new Error('StatsHawk returned an empty response');
  return body;
}

const personCache = new Map<string, Promise<any | null>>();
async function findPerson(name: string): Promise<any | null> {
  const cacheKey = normalize(name);
  if (!cacheKey) return null;
  const cached = personCache.get(cacheKey);
  if (cached) return cached;
  const pending = (async () => {
    const response = await request('/v1/persons?q=' + encodeURIComponent(name) + '&limit=8');
    const items = response?.data?.items ?? [];
    return items.find((item: any) => normalize(String(item?.bio?.full_name ?? item?.bio?.display_name ?? '')) === cacheKey) ?? items[0] ?? null;
  })();
  personCache.set(cacheKey, pending);
  return pending;
}

export async function getStatsHawkGameLog(name: string, sport: StatsHawkSport, season: number): Promise<{ available: boolean; source: string; rows: any[]; reason?: string }> {
  try {
    if (!statsHawkConfigured()) return { available: false, source: SOURCE, rows: [], reason: 'STATSHAWK_API_KEY not configured' };
    const person = await findPerson(name);
    const id = String(person?.id ?? '');
    if (!id) return { available: false, source: SOURCE, rows: [], reason: 'player not found' };
    const response = await request('/v1/persons/' + encodeURIComponent(id) + '/game-log?competition=' + sport + '&season=' + season);
    const rows = Array.isArray(response?.data?.items) ? response.data.items : [];
    return rows.length ? { available: true, source: SOURCE, rows } : { available: false, source: SOURCE, rows: [], reason: 'no game-log rows' };
  } catch (error) {
    return { available: false, source: SOURCE, rows: [], reason: (error as Error).message };
  }
}

function phaseMeasures(item: any, hints: string[]): Row | null {
  const phases = Array.isArray(item?.line?.phases) ? item.line.phases : [];
  const hit = phases.find((phase: any) => hints.some(hint => String(phase?.phase ?? '').toLowerCase().includes(hint)));
  return record(hit?.measures);
}
function measure(measures: Row | null, aliases: string[]): number | null {
  if (!measures) return null;
  for (const alias of aliases) { const direct = num(measures[alias]); if (direct != null) return direct; }
  const normalizedAliases = aliases.map(alias => normalize(alias));
  for (const [name, value] of Object.entries(measures)) {
    if (normalizedAliases.includes(normalize(name))) { const parsed = num(value); if (parsed != null) return parsed; }
  }
  return null;
}

export function statsHawkObservation(sport: StatsHawkSport, market: string, item: any): number | null {
  if (sport === 'mlb') {
    const batting = phaseMeasures(item, ['bat']);
    const pitching = phaseMeasures(item, ['pitch']);
    if (market === 'hits') return measure(batting, ['h', 'hits', 'batting.h']);
    if (market === 'totalBases') {
      const direct = measure(batting, ['total_bases', 'totalBases']); if (direct != null) return direct;
      const hits = measure(batting, ['h', 'hits']) ?? 0, doubles = measure(batting, ['2b', 'b2', 'doubles']) ?? 0;
      const triples = measure(batting, ['3b', 'b3', 'triples']) ?? 0, homers = measure(batting, ['hr', 'home_runs']) ?? 0;
      return hits + doubles + 2 * triples + 3 * homers;
    }
    if (market === 'strikeouts') return measure(pitching, ['so', 'k', 'strikeouts']);
    if (market === 'outsRecorded') {
      const outs = measure(pitching, ['outs_recorded', 'outs']); if (outs != null) return outs;
      const ip = measure(pitching, ['ip', 'innings_pitched']); return ip == null ? null : Math.round(ip * 3);
    }
    return null;
  }
  const passing = phaseMeasures(item, ['pass']);
  const rushing = phaseMeasures(item, ['rush']);
  const receiving = phaseMeasures(item, ['receiv']);
  if (market === 'passingYards') return measure(passing, ['yards', 'pass_yards', 'passing_yards']);
  if (market === 'passingTouchdowns') return measure(passing, ['td', 'touchdowns', 'passing_touchdowns']);
  if (market === 'rushingYards') return measure(rushing, ['yards', 'rush_yards', 'rushing_yards']);
  if (market === 'receivingYards') return measure(receiving, ['yards', 'receiving_yards', 'rec_yards']);
  if (market === 'receptions') return measure(receiving, ['receptions', 'rec', 'catches']);
  return null;
}
