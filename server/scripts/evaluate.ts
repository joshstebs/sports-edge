// Next-day automated evaluation of logged predictions (the 6 AM job).
// 1) Loads pending [PREDICTION_LOG] predictions
// 2) Finds each prediction's game on yesterday's real MLB schedule
// 3) Pulls the official box score (statsapi.mlb.com) and grades every leg
//    against the line: won / lost / push
// 4) Computes hit rate, flat-1u ROI (from real implied odds when logged),
//    per-market calibration, and adaptive learning rules
// 5) Saves data/learning.json (injected into the system prompt at chat time)
//    and prints a digest (delivered by the 6 AM cron).
//
// Run: pnpm eval (tsx scripts/evaluate.ts). Deterministic — no LLM in the
// loop; the math is real box scores vs real logged lines.

import 'dotenv/config';
import {
  getPendingPredictions,
  updatePrediction,
  saveLearning,
  Prediction,
  PredictionLeg,
} from '../src/lib/predictionStore.js';

const BASE = 'https://statsapi.mlb.com/api/v1';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function yesterday(): string {
  return dateStr(new Date(Date.now() - 86400000));
}
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}
function round(n: number, d = 1): number {
  return Math.round(n * 10 ** d) / 10 ** d;
}

let lastCall = 0;
async function pacedFetch(url: string): Promise<any> {
  const wait = Math.max(0, lastCall + 800 - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function findGamePk(matchup: string, date: string): Promise<number | null> {
  const tokens = norm(matchup).split(' ').filter((t) => t.length > 3 && t !== 'versus' && t !== 'team');
  if (!tokens.length) return null;
  const data = await pacedFetch(`${BASE}/schedule?sportId=1&date=${date}&gameType=R`);
  for (const day of data?.dates ?? []) {
    for (const g of day.games ?? []) {
      const names = norm(`${g.teams?.away?.team?.name ?? ''} ${g.teams?.home?.team?.name ?? ''}`);
      const hit = tokens.filter((t) => names.includes(t)).length;
      if (hit >= Math.max(1, Math.ceil(tokens.length / 2))) return g.gamePk ?? null;
    }
  }
  return null;
}

async function searchPlayer(name: string): Promise<number | null> {
  try {
    const data = await pacedFetch(`${BASE}/people/search?names=${encodeURIComponent(name)}`);
    const p = data?.people?.[0];
    return p?.id ?? null;
  } catch {
    return null;
  }
}

async function getBoxscore(gamePk: number): Promise<any> {
  return pacedFetch(`${BASE}/game/${gamePk}/boxscore`);
}

function battingStat(player: any, key: string): number {
  const s = player?.stats?.batting ?? {};
  const v = Number(s[key] ?? 0);
  return Number.isFinite(v) ? v : 0;
}
function pitchingStat(player: any, key: string): number {
  const s = player?.stats?.pitching ?? {};
  const v = Number(s[key] ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function inferMarket(leg: PredictionLeg): string {
  const name = (leg.leg_name ?? '').toLowerCase();
  const metric = (leg.key_metric_used ?? '').toLowerCase();
  if (/strikeout|k's|ks\b|k prop/.test(name) || metric.includes('strikeout')) return 'strikeouts';
  if (/total bases/.test(name) || metric.includes('total base')) return 'totalBases';
  if (/home run|hr\b/.test(name) || metric.includes('home run')) return 'homeRuns';
  if (/\brbi\b/.test(name) || metric.includes('rbi')) return 'rbi';
  if (/\bhits?\b/.test(name) || metric.includes('hit')) return 'hits';
  if (/moneyline|\bml\b/.test(name) || metric.includes('moneyline')) return 'moneyline';
  if (/team total|team runs/.test(name)) return 'teamTotal';
  return 'unknown';
}

function parseLineAndSide(leg: PredictionLeg): { line: number | null; over: boolean } {
  const m = /(over|under)\s*([\d.]+)/i.exec(leg.leg_name ?? '');
  if (m) return { line: parseFloat(m[2]), over: m[1].toLowerCase() === 'over' };
  const tl = parseFloat(String(leg.target_line ?? ''));
  if (!Number.isFinite(tl)) return { line: null, over: true };
  return { line: tl, over: !/(under)/i.test(leg.leg_name ?? '') };
}

function outcomeFor(value: number, line: number, over: boolean): 'won' | 'lost' | 'push' {
  if (value > line) return over ? 'won' : 'lost';
  if (value < line) return over ? 'lost' : 'won';
  return 'push';
}

function teamWon(game: any, teamName: string): boolean | null {
  const away = game?.teams?.away ?? {};
  const home = game?.teams?.home ?? {};
  const aName = `${away.team?.name ?? ''} ${away.team?.abbreviation ?? ''}`.toLowerCase();
  const hName = `${home.team?.name ?? ''} ${home.team?.abbreviation ?? ''}`.toLowerCase();
  const t = norm(teamName);
  const isAway = norm(aName).includes(t) || t.split(' ').some((w) => w.length > 3 && norm(aName).includes(w));
  const isHome = norm(hName).includes(t) || t.split(' ').some((w) => w.length > 3 && norm(hName).includes(w));
  const aRuns = Number(teamRuns(away) ?? -1);
  const hRuns = Number(teamRuns(home) ?? -1);
  if (!isAway && !isHome) return null;
  if (aRuns < 0 || hRuns < 0) return null;
  const won = isAway ? aRuns > hRuns : hRuns > aRuns;
  return aRuns === hRuns ? null : won;
}

function teamRuns(team: any): number | null {
  // statsapi boxscore: runs live at teamStats.batting.runs — NOT team.runs.
  const v = team?.teamStats?.batting?.runs;
  return v == null ? null : Number(v);
}

async function evaluateLeg(
  leg: PredictionLeg,
  box: any,
  game: any
): Promise<{ outcome: 'won' | 'lost' | 'push'; actual: number | null; note?: string }> {
  const market = inferMarket(leg);
  const { line, over } = parseLineAndSide(leg);

  if (market === 'moneyline') {
    const teamName = (leg.leg_name ?? '').replace(/moneyline|ml/gi, '').trim();
    const won = teamWon(game, teamName);
    if (won === null) return { outcome: 'push', actual: null, note: 'moneyline: no result' };
    return { outcome: won ? 'won' : 'lost', actual: won ? 1 : 0 };
  }
  if (market === 'teamTotal') {
    return { outcome: 'push', actual: null, note: 'team totals not auto-graded yet' };
  }
  if (line === null) return { outcome: 'push', actual: null, note: 'no line parsed' };

  const playerName = (leg.leg_name ?? '')
    .replace(/(over|under)\s*[\d.]+/gi, '')
    .replace(/\b(total bases|hits?|home runs?|rbis?|strikeouts?|ks?)\b/gi, '')
    .replace(/[.,]/g, '')
    .trim();
  const playerId = await searchPlayer(playerName);
  if (!playerId) return { outcome: 'push', actual: null, note: `player not found: ${playerName}` };

  const allPlayers: any[] = [];
  for (const side of ['away', 'home']) {
    const players = box?.teams?.[side]?.players ?? {};
    for (const key of Object.keys(players)) allPlayers.push(players[key]);
  }
  const player = allPlayers.find((p) => String(p?.person?.id) === String(playerId));
  if (!player) return { outcome: 'push', actual: null, note: `player ${playerName} not in box score` };

  let actual: number;
  switch (market) {
    case 'strikeouts':
      actual = pitchingStat(player, 'strikeOuts');
      break;
    case 'totalBases': {
      const h = battingStat(player, 'hits');
      const d = battingStat(player, 'doubles');
      const t = battingStat(player, 'triples');
      const hr = battingStat(player, 'homeRuns');
      actual = h + d + 2 * t + 3 * hr;
      break;
    }
    case 'homeRuns':
      actual = battingStat(player, 'homeRuns');
      break;
    case 'rbi':
      actual = battingStat(player, 'rbi');
      break;
    case 'hits':
    default:
      actual = battingStat(player, 'hits');
      break;
  }
  return { outcome: outcomeFor(actual, line, over), actual };
}

async function main() {
  const pending = getPendingPredictions();
  const date = yesterday();
  console.log(`SportsEdge evaluation — ${date}`);
  console.log(`Pending predictions: ${pending.length}`);
  if (!pending.length) {
    console.log('Nothing to evaluate. Digest: no picks logged yesterday.');
    return;
  }

  const results: Array<{ pred: Prediction; outcomes: Array<{ leg: string; outcome: string; actual: number | null; note?: string }>; gameDate: string | null }> = [];
  const marketStats = new Map<string, { n: number; hits: number }>();
  let totalPriced = 0;
  let totalWon = 0;
  let totalLost = 0;
  let net = 0;

  for (const pred of pending) {
    // Grade against the game on the PREDICTION's own date (series play the
    // same matchup on consecutive nights — yesterday's game is the wrong one).
    const targetDate = (pred.timestamp ?? '').slice(0, 10) || date;
    const gamePk = await findGamePk(pred.matchup, targetDate);
    if (!gamePk) {
      updatePrediction(pred.prediction_id, { status: 'evaluated', gameDate: null });
      results.push({
        pred,
        outcomes: [{ leg: 'matchup', outcome: 'skipped', actual: null, note: `no ${targetDate} game found for ${pred.matchup}` }],
        gameDate: null,
      });
      continue;
    }
    const box = await getBoxscore(gamePk);
    const game = box?.teams ? { teams: box.teams } : null;
    const awayRuns = teamRuns(box?.teams?.away);
    const homeRuns = teamRuns(box?.teams?.home);
    if (!game || awayRuns == null && homeRuns == null) {
      // pre-game/in-progress boxscore — not gradable yet; STAY PENDING so the
      // next 6 AM run grades it once the game is final.
      updatePrediction(pred.prediction_id, { status: 'pending', gameDate: targetDate });
      results.push({
        pred,
        outcomes: [{ leg: 'matchup', outcome: 'skipped', actual: null, note: `game ${gamePk} on ${targetDate} not final yet — will re-check next run` }],
        gameDate: targetDate,
      });
      continue;
    }
    const legResults: any[] = [];
    for (const leg of pred.legs) {
      const r = await evaluateLeg(leg, box, game);
      legResults.push({ leg: leg.leg_name, outcome: r.outcome, actual: r.actual, note: r.note });
      if (r.outcome === 'won' || r.outcome === 'lost') {
        const market = inferMarket(leg);
        const st = marketStats.get(market) ?? { n: 0, hits: 0 };
        st.n++;
        if (r.outcome === 'won') st.hits++;
        marketStats.set(market, st);
        totalPriced++;
        if (r.outcome === 'won') totalWon++;
        if (r.outcome === 'lost') totalLost++;
        // flat 1u P/L from logged odds
        const odds = Number(leg.implied_odds);
        if (Number.isFinite(odds) && odds !== 0) {
          const dec = odds > 0 ? 1 + odds / 100 : 1 + 100 / -odds;
          net += r.outcome === 'won' ? dec - 1 : -1;
        }
      }
      leg.outcome = r.outcome;
      leg.actual = r.actual;
    }
    updatePrediction(pred.prediction_id, { status: 'evaluated', gameDate: date, legs: pred.legs });
    results.push({ pred, outcomes: legResults, gameDate: date });
  }

  // Learning context
  const hitRate = totalPriced ? round((totalWon / totalPriced) * 100) : null;
  const roi = totalPriced ? round((net / totalPriced) * 100) : null;
  const perMarket: Record<string, { n: number; hitRate: number }> = {};
  const adaptiveRules: string[] = [];
  for (const [m, st] of [...marketStats.entries()].sort()) {
    const hr = round((st.hits / st.n) * 100);
    perMarket[m] = { n: st.n, hitRate: hr };
    if (st.n >= 3 && hr < 45) adaptiveRules.push(`Down-weight ${m}: logged hit rate ${hr}% over ${st.n} picks — reduce confidence one grade until it recovers.`);
    if (st.n >= 3 && hr > 65) adaptiveRules.push(`Up-weight ${m}: logged hit rate ${hr}% over ${st.n} picks — your edge is real; keep confidence.`);
  }
  if (roi !== null && roi < -15) adaptiveRules.push('Bankroll rule: logged ROI is deeply negative — size new picks at 0.5u flat until three consecutive profitable days.');
  if (roi !== null && roi > 20) adaptiveRules.push('Bankroll rule: logged ROI strongly positive — hold 1u sizing, do not chase with larger units.');

  saveLearning({
    updatedAt: new Date().toISOString(),
    evaluated: totalPriced,
    hitRate,
    roi,
    perMarket,
    adaptiveRules,
  });

  // Digest
  console.log(`\n=== EVALUATION DIGEST ===`);
  console.log(`Games found: ${results.filter((r) => r.gameDate).length}/${results.length}`);
  console.log(`Legs graded: ${totalPriced} | Won ${totalWon} / Lost ${totalLost} | Hit rate ${hitRate ?? 'n/a'}% | Flat-1u ROI ${roi ?? 'n/a'}%`);
  if (perMarket && Object.keys(perMarket).length) {
    console.log('Per-market:');
    for (const [m, v] of Object.entries(perMarket)) console.log(`  ${m}: ${v.n} picks, ${v.hitRate}% hit`);
  }
  console.log('\nLearning rules written to data/learning.json:');
  for (const rule of adaptiveRules) console.log(`  - ${rule}`);
  if (!adaptiveRules.length) console.log('  (none — sample too small, rules appear at n>=3 per market)');

  console.log('\nPer prediction:');
  for (const r of results) {
    console.log(`  ${r.pred.prediction_id} [${r.pred.sport}] ${r.pred.matchup} — ${r.gameDate ?? 'no game'}`);
    for (const o of r.outcomes) {
      console.log(`    ${o.outcome.toUpperCase().padEnd(7)} ${o.leg}${o.actual != null ? ` (actual ${o.actual})` : ''}${o.note ? ` — ${o.note}` : ''}`);
    }
  }
}

main().catch((e) => {
  console.error('Evaluation failed:', (e as Error).message);
  process.exit(1);
});
