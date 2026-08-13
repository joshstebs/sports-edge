// Baseball Savant advanced metrics (baseballsavant.mlb.com) — keyless CSV.
// Verified live: the leaderboard CSV endpoints below return quoted
// 'Last, First' names. expected_statistics exposes est_ba/est_slg/est_woba
// (the "x" columns); the statcast leaderboard exposes brl_percent (barrel%)
// and ev95percent (hard-hit%). Both are matched by normalized name.

import { cacheGet, cacheSet, normalizeName, parseCsv } from './http.js';

const SAVANT = 'https://baseballsavant.mlb.com';
const SOURCE = 'baseballsavant.mlb.com';
const CACHE_TTL = 30 * 60 * 1000;

const EXPECTED_URL =
  `${SAVANT}/leaderboard/expected_statistics?type=batter&year=2026&min_pa=50&csv=true`;
const STATCAST_URL = `${SAVANT}/leaderboard/statcast?type=batter&year=2026&csv=true`;

interface ExpRow {
  lastName: string;
  firstName: string;
  playerId: string;
  pa: number;
  bip: number;
  ba: number;
  estBa: number;
  slg: number;
  estSlg: number;
  woba: number;
  estWoba: number;
}

interface StatcastRow {
  lastName: string;
  firstName: string;
  playerId: string;
  barrelRate: number | null; // brl_percent
  hardHitRate: number | null; // ev95percent
  avgExitVelo: number | null;
}

function num(v: any): number | null {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

/** Parse Savant CSV rows -> first/last split from the quoted "Last, First" cell. */
function rowsToPlayers(rows: string[][], header: string[]): Array<Record<string, any>> {
  const out: Array<Record<string, any>> = [];
  for (const row of rows.slice(1)) {
    if (!row.length || (row.length === 1 && row[0].trim() === '')) continue;
    const rec: Record<string, any> = {};
    for (let i = 0; i < header.length && i < row.length; i++) {
      let key = header[i];
      let val = row[i];
      if (key === 'last_name, first_name' || key === 'last_name,first_name') {
        const parts = val.split(',');
        rec.lastName = (parts[0] ?? '').trim();
        rec.firstName = (parts.slice(1).join(',') ?? '').trim();
        continue;
      }
      rec[key] = val;
    }
    if (rec.lastName || rec.firstName) out.push(rec);
  }
  return out;
}

async function getCsvText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function loadExpectedRows(): Promise<ExpRow[]> {
  const cached = cacheGet<ExpRow[]>('savant:expected', CACHE_TTL);
  if (cached) return cached;
  const text = await getCsvText(EXPECTED_URL);
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('expected_statistics CSV empty');
  const header = rows[0].map((h) => h.trim());
  const players = rowsToPlayers(rows, header);
  const out: ExpRow[] = players.map((p) => ({
    lastName: p.lastName,
    firstName: p.firstName,
    playerId: p.playerId,
    pa: num(p.pa) ?? 0,
    bip: num(p.bip) ?? 0,
    ba: num(p.ba) ?? 0,
    estBa: num(p.est_ba) ?? 0,
    slg: num(p.slg) ?? 0,
    estSlg: num(p.est_slg) ?? 0,
    woba: num(p.woba) ?? 0,
    estWoba: num(p.est_woba) ?? 0,
  }));
  cacheSet('savant:expected', out);
  return out;
}

async function loadStatcastRows(): Promise<StatcastRow[]> {
  const cached = cacheGet<StatcastRow[]>('savant:statcast', CACHE_TTL);
  if (cached) return cached;
  const text = await getCsvText(STATCAST_URL);
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('statcast CSV empty');
  const header = rows[0].map((h) => h.trim());
  const players = rowsToPlayers(rows, header);
  const out: StatcastRow[] = players.map((p) => ({
    lastName: p.lastName,
    firstName: p.firstName,
    playerId: p.playerId,
    barrelRate: num(p.brl_percent),
    hardHitRate: num(p.ev95percent),
    avgExitVelo: num(p.avg_hit_speed),
  }));
  cacheSet('savant:statcast', out);
  return out;
}

export interface AdvancedMetrics {
  available: boolean;
  reason?: string;
  source: string;
  year: number;
  playerName?: string;
  pa?: number;
  xba?: number | null;
  xslg?: number | null;
  xwoba?: number | null;
  barrelRate?: number | null;
  hardHitRate?: number | null;
  avgExitVelo?: number | null;
  note?: string;
}

export async function getAdvancedMetrics(name: string): Promise<AdvancedMetrics> {
  try {
    const target = normalizeName(name);
    if (!target) return { available: false, reason: 'no player name provided', source: SOURCE, year: 2026 };

    const [expected, statcast] = await Promise.all([
      loadExpectedRows().catch(() => [] as ExpRow[]),
      loadStatcastRows().catch(() => [] as StatcastRow[]),
    ]);

    const exp = expected.find((r) => normalizeName(`${r.firstName} ${r.lastName}`) === target)
      ?? expected.find((r) => normalizeName(`${r.firstName} ${r.lastName}`).includes(target));
    const stc = statcast.find((r) => normalizeName(`${r.firstName} ${r.lastName}`) === target)
      ?? statcast.find((r) => normalizeName(`${r.firstName} ${r.lastName}`).includes(target));

    if (!exp && !stc) {
      return {
        available: false,
        reason: `no Savant leaderboard row for "${name}" (2026, min 50 PA)`,
        source: SOURCE,
        year: 2026,
      };
    }

    return {
      available: true,
      source: SOURCE,
      year: 2026,
      playerName: exp ? `${exp.firstName} ${exp.lastName}` : stc ? `${stc.firstName} ${stc.lastName}` : name,
      pa: exp ? exp.pa : undefined,
      xba: exp ? exp.estBa : null,
      xslg: exp ? exp.estSlg : null,
      xwoba: exp ? exp.estWoba : null,
      barrelRate: stc?.barrelRate ?? null,
      hardHitRate: stc?.hardHitRate ?? null,
      avgExitVelo: stc?.avgExitVelo ?? null,
      note: 'est_ba/est_slg/est_woba from Savant expected_statistics leaderboard; barrel% = brl_percent and hard-hit% = ev95percent from Savant statcast leaderboard (2026). Savant CSV has no separate xISO column.',
    };
  } catch (e) {
    return { available: false, reason: `Savant fetch failed: ${(e as Error).message}`, source: SOURCE, year: 2026 };
  }
}

export const savantStatus = () => ({
  baseUrl: SAVANT,
  endpoints: [EXPECTED_URL, STATCAST_URL],
  available: true,
  note: 'leaderboard CSVs, quoted-field names',
});
