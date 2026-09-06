type CsvRow = Record<string, string>;

function normalizeName(name: string): string {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\.?\b/g, '').replace(/[^a-z0-9]/g, '');
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(current); current = '';
    } else current += char;
  }
  values.push(current);
  return values;
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: CsvRow = {};
    headers.forEach((header, index) => { row[header] = values[index] ?? ''; });
    return row;
  });
}

async function loadSeason(season: number): Promise<CsvRow[]> {
  const url = 'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_' + season + '.csv';
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return [];
    return parseCsv(await res.text());
  } catch {
    return [];
  }
}

let cachedRows: Promise<CsvRow[]> | null = null;
async function loadRows(): Promise<CsvRow[]> {
  if (!cachedRows) {
    const current = new Date().getUTCFullYear();
    cachedRows = Promise.all([loadSeason(current), loadSeason(current - 1), loadSeason(current - 2)])
      .then((parts) => parts.flat());
  }
  return cachedRows;
}

function num(row: CsvRow, key: string): number | null {
  const raw = row[key];
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
function playerName(row: CsvRow): string { return row.player_display_name || row.player_name || ''; }
function season(row: CsvRow): number { return Number(row.season) || 0; }
function week(row: CsvRow): number { return Number(row.week) || 0; }

export interface NflverseGame {
  date: string;
  opponent: string | null;
  stats: Record<string, number | null>;
}

export async function getNflversePlayerHistory(player: string, limit = 20): Promise<{ available: boolean; source: string; season: number | null; games: NflverseGame[]; reason?: string }> {
  const rows = await loadRows();
  const target = normalizeName(player);
  const matched = rows
    .filter((row) => (!row.season_type || row.season_type === 'REG') && normalizeName(playerName(row)) === target)
    .sort((a, b) => season(b) - season(a) || week(b) - week(a));
  if (!matched.length) {
    return { available: false, source: 'github.com/nflverse/nflverse-data', season: null, games: [], reason: 'player not found in nflverse weekly stats' };
  }
  const games = matched.slice(0, Math.max(5, Math.min(24, limit))).map((row) => ({
    date: String(row.season) + '-W' + String(row.week),
    opponent: row.opponent_team || null,
    stats: {
      passingYards: num(row, 'passing_yards'),
      passingTouchdowns: num(row, 'passing_touchdowns'),
      rushingYards: num(row, 'rushing_yards'),
      rushingTouchdowns: num(row, 'rushing_touchdowns'),
      receivingYards: num(row, 'receiving_yards'),
      receivingTouchdowns: num(row, 'receiving_touchdowns'),
      receptions: num(row, 'receptions'),
    },
  }));
  return {
    available: games.length > 0,
    source: 'github.com/nflverse/nflverse-data',
    season: season(matched[0]) || null,
    games,
  };
}
