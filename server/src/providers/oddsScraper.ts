// Keyless sportsbook odds via OddsTrader's embedded __INITIAL_STATE__ blob.
// OddsTrader publishes every game's moneyline / spread / total inside a
// window.__INITIAL_STATE__ JSON object on the /<league>/ board page. No API key,
// no per-request auth. Used as a LAST-RESORT odds source so the model can still
// compute implied probability / edge when The Odds API, SGO and ESPN all fail.
// This is a real scrape of a public board (same data a human sees), NOT a
// fabricated price. If the page shape changes the parser returns available:false
// and the caller must not invent odds.

import { normalizeName } from './http.js';

const SOURCE = 'oddstrader.com';
const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0';

export interface ScrapedGameOdds {
  available: boolean;
  source: string;
  reason?: string;
  sport?: string;
  event?: string;
  away?: string;
  home?: string;
  moneyline?: { away?: string | null; home?: string | null };
  runline?: { away?: string | null; home?: string | null };
  total?: { line?: string | null; over?: string | null; under?: string | null };
}

function parseState(html: string): any | null {
  const m = html.match(/window\.__INITIAL_STATE__=(\{[\s\S]*?\});\s*<\/script>/);
  if (!m) return null;
  try {
    // The blob ends at the first ";\n" that closes the assignment; decode safely.
    const json = m[1];
    const dec = new Function('return ' + json)();
    return dec;
  } catch {
    return null;
  }
}

export async function scrapeOddsTrader(teamA?: string, teamB?: string, sport = 'mlb'): Promise<ScrapedGameOdds> {
  const path = sport === 'nfl' || sport === 'football' ? 'nfl' : sport === 'nba' || sport === 'basketball' ? 'nba' : sport === 'nhl' || sport === 'hockey' ? 'nhl' : 'mlb';
  const url = `https://www.oddstrader.com/${path}/`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(9000) });
    if (!res.ok) return { available: false, source: SOURCE, reason: `board HTTP ${res.status}` };
    const html = await res.text();
    const state = parseState(html);
    if (!state) return { available: false, source: SOURCE, reason: 'no __INITIAL_STATE__ blob' };
    const events = state?.events?.events ?? {};
    const list = Object.values(events) as any[];
    if (!list.length) return { available: false, source: SOURCE, reason: 'no events parsed' };

    let hit: any = null;
    const a = teamA ? normalizeName(teamA) : '';
    const b = teamB ? normalizeName(teamB) : '';
    if (a || b) {
      hit = list.find((e: any) => {
        const des = (e?.des ?? '').toLowerCase();
        const pa = Object.values(e?.participants ?? {}) as any[];
        const names = pa.map((p: any) => normalizeName(p?.source?.nam ?? p?.source?.nn ?? '')).join(' ').toLowerCase();
        const hay = (des + ' ' + names).toLowerCase();
        return (a && hay.includes(a)) || (b && hay.includes(b));
      });
    } else {
      hit = list[0];
    }
    if (!hit) return { available: false, source: SOURCE, reason: `no match for "${teamA} vs ${teamB}"` };

    const cl = hit.currentLines ?? {};
    const ml: any = cl.moneyline ?? cl.ml ?? {};
    const sp: any = cl.spread ?? cl.sp ?? {};
    const tot: any = cl.total ?? cl.tot ?? {};
    const pa = Object.values(hit.participants ?? {}) as any[];
    const awayName = pa.find((p: any) => p?.ih === false)?.source?.nam ?? hit.des?.split('@')[0];
    const homeName = pa.find((p: any) => p?.ih === true)?.source?.nam ?? hit.des?.split('@')[1];

    const out: ScrapedGameOdds = {
      available: true,
      source: SOURCE,
      sport,
      event: `${awayName} @ ${homeName}`,
      away: awayName,
      home: homeName,
      moneyline: { away: ml.away ?? ml.awayOdds ?? null, home: ml.home ?? ml.homeOdds ?? null },
      runline: { away: sp.away ?? sp.awayOdds ?? null, home: sp.home ?? sp.homeOdds ?? null },
      total: { line: tot.line ?? tot.total ?? null, over: tot.over ?? tot.overOdds ?? null, under: tot.under ?? tot.underOdds ?? null },
    };
    return out;
  } catch (e: any) {
    return { available: false, source: SOURCE, reason: `scrape error: ${e?.message ?? e}` };
  }
}
