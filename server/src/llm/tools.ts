// Function-calling tool definitions + handlers. Handlers NEVER throw:
// every failure becomes {available:false, reason} so the LLM can honestly
// report "live data unavailable". Derived arithmetic on real fields is
// labeled as computed.

import * as mlb from '../providers/mlbStatsApi.js';
import * as savant from '../providers/savant.js';
import * as espn from '../providers/espn.js';
import * as odds from '../providers/oddsApi.js';
import * as sgo from '../providers/sportsGameOdds.js';
import * as sharp from '../providers/sharpApi.js';
import * as weather from '../providers/weather.js';
import * as news from '../providers/news.js';
import * as espnOdds from '../providers/espnOdds.js';
import * as oddsScraper from '../providers/oddsScraper.js';
import * as availability from '../providers/playerAvailability.js';
import {
  buildPlayerPropModel,
  espnObservation,
  isRealisticLine,
  mlbObservation,
  normalizeMarket,
  type HistoricalObservation,
  type ModelSport,
} from '../models/playerPropModel.js';
import { getParkFactor } from '../providers/parkFactors.js';
import { normalizeName, round } from '../providers/http.js';
import { loadLearning } from '../lib/predictionStore.js';

export interface ToolOutcome {
  available: boolean;
  reason?: string;
  summary: string;
  data: any;
  payload: any;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: any;
  handler: (args: any) => Promise<ToolOutcome>;
}

const dateStr = (d: Date) => d.toISOString().slice(0, 10);
const today = () => dateStr(new Date());
const daysFromNow = (n: number) => dateStr(new Date(Date.now() + n * 86400000));

function ok(summary: string, payload: any, data?: any): ToolOutcome {
  return { available: true, summary, data: data ?? payload, payload };
}
function unavail(reason: string): ToolOutcome {
  return { available: false, reason, summary: `unavailable: ${reason}`, data: { available: false, reason }, payload: { available: false, reason } };
}

// --- predictive engine: empirical P(over) at half-lines (real-data-derived) ---
// Half-line rule (book standard): ALWAYS X.5 so pushes are structurally impossible.
// P(over) = Beta-shrunk empirical hit rate (hits + 1) / (n + 2) over the rolling
// window vs that line. Grades calibrated from walk-forward backtests:
// A >= .65, B >= .58, C >= .5, D < .5 (D = no edge).
function halfLine(avg: number): number {
  let raw = Math.round(avg * 2) / 2;
  if (raw % 1 === 0) raw += 0.5;
  return Math.max(0.5, raw);
}
function pOver(vals: number[], line: number): number {
  const n = vals.length;
  if (!n) return 0.5;
  const hits = vals.filter((v) => v > line).length;
  return round((hits + 1) / (n + 2), 3);
}
function gradeOf(p: number): string {
  return p >= 0.65 ? 'A' : p >= 0.58 ? 'B' : p >= 0.5 ? 'C' : 'D';
}
function stddev(vals: number[], mean: number): number {
  if (vals.length < 2) return 0;
  return Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length - 1));
}
function projection(vals: number[]): {
  line: number; pOver: number; grade: string; edgeTier: string;
  cv: number | null; formTrend: number | null; n: number; avg: number;
} {
  const n = vals.length;
  const avg = n ? vals.reduce((a, b) => a + b, 0) / n : 0;
  const line = halfLine(avg);
  const p = pOver(vals, line);
  const dev = stddev(vals, avg);
  const cv = avg > 0 ? round(dev / avg, 2) : null; // consistency: lower = more predictable
  const halfN = Math.max(1, Math.ceil(n / 2));
  const recentAvg = vals.slice(0, halfN).reduce((a, b) => a + b, 0) / halfN; // window is recent-first
  const delta = Math.abs(p - 0.5);
  const edgeTier = delta >= 0.2 ? 'elite' : delta >= 0.12 ? 'high' : delta >= 0.06 ? 'mid' : 'low';
  return {
    line, pOver: p, grade: gradeOf(p), edgeTier,
    cv, formTrend: round(recentAvg - avg, 3), n, avg: round(avg, 3),
  };
}

// --- mlb_batter_stats -------------------------------------------------------

const batterStats = async (args: any): Promise<ToolOutcome> => {
  const name: string = args?.name ?? '';
  if (!name) return unavail('no player name provided');
  const found = await mlb.searchPlayer(name);
  if (!found.available || !found.data) return unavail(found.reason ?? 'player not found');
  const id = found.data.id;

  const [seasonRes, logRes, splitRes] = await Promise.all([
    mlb.getSeasonStats(id, 'hitting'),
    mlb.getGameLog(id, 'hitting', mlb.CURRENT_SEASON, 15),
    mlb.getPlatoonSplits(id, 'hitting'),
  ]);
  const season = seasonRes.available ? seasonRes.data.split.stat : null;
  const games: any[] = logRes.available ? (logRes.data ?? []) : [];
  const platoon = splitRes.available ? (splitRes.data ?? []) : [];

  // rolling window aggregates (real arithmetic on real fields)
  const w = { ab: 0, h: 0, d: 0, t: 0, hr: 0, rbi: 0, bb: 0, hbp: 0, sf: 0, k: 0, tb: 0, pa: 0, g: 0 };
  for (const g of games) {
    const s = g.stat ?? {};
    const tb = (s.hits ?? 0) + (s.doubles ?? 0) + 2 * (s.triples ?? 0) + 3 * (s.homeRuns ?? 0);
    w.g++;
    w.ab += s.atBats ?? 0;
    w.h += s.hits ?? 0;
    w.d += s.doubles ?? 0;
    w.t += s.triples ?? 0;
    w.hr += s.homeRuns ?? 0;
    w.rbi += s.rbi ?? 0;
    w.bb += s.baseOnBalls ?? 0;
    w.hbp += s.hitByPitch ?? 0;
    w.sf += s.sacFlies ?? 0;
    w.k += s.strikeOuts ?? 0;
    w.tb += tb;
    w.pa += (s.atBats ?? 0) + (s.baseOnBalls ?? 0) + (s.hitByPitch ?? 0) + (s.sacFlies ?? 0);
  }
  const rolling = w.g
    ? {
        games: w.g,
        hits: w.h,
        homeRuns: w.hr,
        rbi: w.rbi,
        totalBases: w.tb,
        avg: w.ab ? round(w.h / w.ab, 3) : null,
        obp: w.pa ? round((w.h + w.bb + w.hbp) / (w.ab + w.bb + w.hbp + w.sf || 1), 3) : null,
        slg: w.ab ? round(w.tb / w.ab, 3) : null,
        ops: w.ab ? round((w.h + w.bb + w.hbp) / (w.ab + w.bb + w.hbp + w.sf || 1) + w.tb / w.ab, 3) : null,
        kPercent: w.pa ? round((100 * w.k) / w.pa, 1) : null,
        note: 'rolling aggregates computed from statsapi gameLog (last 15 games, atBats>0)',
      }
    : null;

  const recent = games.slice(0, 5).map((g) => ({
    date: g.date,
    summary: g.stat?.summary ?? null,
    hits: g.stat?.hits ?? 0,
    hr: g.stat?.homeRuns ?? 0,
    rbi: g.stat?.rbi ?? 0,
    tb: (g.stat?.hits ?? 0) + (g.stat?.doubles ?? 0) + 2 * (g.stat?.triples ?? 0) + 3 * (g.stat?.homeRuns ?? 0),
  }));

  const payload = {
    available: true,
    source: 'statsapi.mlb.com',
    player: found.data.fullName,
    playerId: id,
    season: mlb.CURRENT_SEASON,
    seasonStats: season
      ? {
          gamesPlayed: season.gamesPlayed,
          plateAppearances: season.plateAppearances,
          atBats: season.atBats,
          hits: season.hits,
          doubles: season.doubles,
          triples: season.triples,
          homeRuns: season.homeRuns,
          rbi: season.rbi,
          baseOnBalls: season.baseOnBalls,
          strikeOuts: season.strikeOuts,
          avg: season.avg,
          ops: season.ops,
        }
      : null,
    last15Rolling: rolling,
    propProjections: {
      totalBases: projection(games.map((g) => { const s = g.stat ?? {}; return (s.hits ?? 0) + (s.doubles ?? 0) + 2 * (s.triples ?? 0) + 3 * (s.homeRuns ?? 0); })),
      hits: projection(games.map((g) => g.stat?.hits ?? 0)),
      homeRuns: projection(games.map((g) => g.stat?.homeRuns ?? 0)),
      rbi: projection(games.map((g) => g.stat?.rbi ?? 0)),
      note: 'empirical model: line = half-line of rolling avg (always X.5, floor 0.5); P(over) = Beta-shrunk (hits+1)/(n+2) over last 15 real games vs that line; grade A>=.65 B>=.58 C>=.5 D<.5 (D = no edge); edgeTier from |P-0.5| (elite>=.2 high>=.12 mid>=.06); cv = coefficient of variation, lower = more predictable; formTrend = recent-half avg - window avg (positive = hot)',
    },
    recentGames: recent,
    platoonSplits: platoon,
  };
  return ok(`Fetched season + last-15-game log for ${found.data.fullName}`, payload, {
    player: found.data.fullName,
    season: payload.seasonStats ? `${payload.seasonStats.avg} / ${payload.seasonStats.ops} OPS, ${payload.seasonStats.homeRuns} HR` : 'n/a',
    last15: rolling ? `${rolling.avg} AVG, ${rolling.homeRuns} HR, ${rolling.rbi} RBI` : 'n/a',
  });
};

// --- mlb_pitcher_stats ------------------------------------------------------

const pitcherStats = async (args: any): Promise<ToolOutcome> => {
  const name: string = args?.name ?? '';
  if (!name) return unavail('no player name provided');
  const found = await mlb.searchPlayer(name);
  if (!found.available || !found.data) return unavail(found.reason ?? 'player not found');
  const id = found.data.id;

  const [seasonRes, logRes, splitRes] = await Promise.all([
    mlb.getSeasonStats(id, 'pitching'),
    mlb.getGameLog(id, 'pitching', mlb.CURRENT_SEASON, 10),
    mlb.getPlatoonSplits(id, 'pitching'),
  ]);
  const season = seasonRes.available ? seasonRes.data.split.stat : null;
  const starts: any[] = logRes.available ? (logRes.data ?? []) : [];
  const platoon = splitRes.available ? (splitRes.data ?? []) : [];

  const startsDetail = starts.map((g) => {
    const s = g.stat ?? {};
    const ip = parseFloat(s.inningsPitched ?? '0');
    return {
      date: g.date,
      opponent: g.opponent?.team?.name ?? null,
      ip: s.inningsPitched ?? null,
      k: s.strikeOuts ?? 0,
      bb: s.baseOnBalls ?? 0,
      er: s.earnedRuns ?? 0,
      hr: s.homeRuns ?? 0,
      era: s.era ?? null,
      k9: ip ? round((s.strikeOuts * 9) / ip, 2) : null,
      note: 'K/9 computed from K and IP',
    };
  });

  const agg = { k: 0, ip: 0, bb: 0, hr: 0, g: starts.length };
  for (const st of starts) {
    const s = st.stat ?? {};
    agg.k += s.strikeOuts ?? 0;
    agg.bb += s.baseOnBalls ?? 0;
    agg.hr += s.homeRuns ?? 0;
    agg.ip += parseFloat(s.inningsPitched ?? '0');
  }

  let fip: number | null = null;
  if (season) {
    const ip = parseFloat(season.inningsPitched ?? '0');
    if (ip > 0) fip = round(((13 * (season.homeRuns ?? 0) + 3 * (season.baseOnBalls ?? 0) - 2 * (season.strikeOuts ?? 0)) / ip) + 3.1, 2);
  }
  const kPct = season?.plateAppearances ? round((100 * (season.strikeOuts ?? 0)) / season.plateAppearances, 1) : null;
  const bbPct = season?.plateAppearances ? round((100 * (season.baseOnBalls ?? 0)) / season.plateAppearances, 1) : null;

  const payload = {
    available: true,
    source: 'statsapi.mlb.com',
    player: found.data.fullName,
    playerId: id,
    season: mlb.CURRENT_SEASON,
    seasonStats: season
      ? {
          gamesStarted: season.gamesStarted,
          inningsPitched: season.inningsPitched,
          strikeOuts: season.strikeOuts,
          baseOnBalls: season.baseOnBalls,
          homeRuns: season.homeRuns,
          earnedRuns: season.earnedRuns,
          era: season.era,
          whip: season.whip,
          avgAgainst: season.avg,
          kPer9: season.inningsPitched ? round((season.strikeOuts * 9) / parseFloat(season.inningsPitched), 2) : null,
          kPercent: kPct,
          bbPercent: bbPct,
          cswProxy: kPct !== null && bbPct !== null ? round(kPct + bbPct, 1) : null,
          fip,
          notes: ['FIP = (13*HR + 3*BB - 2*K)/IP + 3.10, computed from real fields',
                  'CSW proxy = K% + BB% (not true CSW — label honestly)'],
        }
      : null,
    last10Starts: startsDetail,
    propProjections: {
      strikeouts: projection(starts.map((g) => g.stat?.strikeOuts ?? 0)),
      note: 'empirical model: line = half-line of rolling K/start (always X.5, floor 0.5); P(over) = Beta-shrunk (hits+1)/(n+2) over last 10 real starts vs that line; grade A>=.65 B>=.58 C>=.5 D<.5 (D = no edge); edgeTier from |P-0.5| (elite>=.2 high>=.12 mid>=.06); cv = coefficient of variation, lower = more predictable; formTrend = recent-half avg - window avg (positive = hot)',
    },
    last10Aggregate: agg.g
      ? { starts: agg.g, k: agg.k, bb: agg.bb, hr: agg.hr, ip: round(agg.ip, 1), k9: agg.ip ? round((agg.k * 9) / agg.ip, 2) : null }
      : null,
    platoonSplits: platoon,
  };
  return ok(`Fetched season + last-10-start log for ${found.data.fullName}`, payload, {
    player: found.data.fullName,
    season: season ? `${season.era} ERA, ${season.strikeOuts} K, FIP ${fip}` : 'n/a',
    last10: agg.g ? `${agg.k} K in ${round(agg.ip, 1)} IP` : 'n/a',
  });
};

// --- mlb_advanced_metrics ---------------------------------------------------

const advancedMetrics = async (args: any): Promise<ToolOutcome> => {
  const name: string = args?.name ?? '';
  if (!name) return unavail('no player name provided');
  const m = await savant.getAdvancedMetrics(name);
  if (!m.available) return unavail(m.reason ?? 'no Savant metrics');
  return ok(`Savant expected stats for ${m.playerName}`, m, {
    player: m.playerName,
    xwoba: m.xwoba,
    xba: m.xba,
    xslg: m.xslg,
    barrel: m.barrelRate != null ? `${m.barrelRate}%` : null,
    hardHit: m.hardHitRate != null ? `${m.hardHitRate}%` : null,
  });
};

// --- mlb_schedule -----------------------------------------------------------

const schedule = async (args: any): Promise<ToolOutcome> => {
  const team: string | undefined = args?.team ?? undefined;
  const canonical = team ? mlb.matchTeamName(team) : null;
  const res = await mlb.getSchedule(today(), daysFromNow(7));
  if (!res.available || !res.data) return unavail(res.reason ?? 'no schedule');
  let games = res.data;
  if (canonical) {
    games = games.filter((g) => g.away.name === canonical || g.home.name === canonical);
    if (!games.length) return unavail(`no games for ${canonical} in the next 7 days`);
  }
  const payload = {
    available: true,
    source: 'statsapi.mlb.com',
    window: `${today()}..${daysFromNow(7)}`,
    teamFilter: canonical ?? null,
    games: games.map((g) => ({
      gamePk: g.gamePk,
      officialDate: g.officialDate,
      timeLocal: g.gameDate ? new Date(g.gameDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null,
      away: g.away.name,
      home: g.home.name,
      awayProbable: g.awayProbable,
      homeProbable: g.homeProbable,
      venue: g.venue,
      status: g.status,
    })),
  };
  const n = payload.games.length;
  return ok(`Schedule: ${n} game${n === 1 ? '' : 's'}${canonical ? ` for ${canonical}` : ''} in next 7 days`, payload, {
    count: n,
    sample: payload.games.slice(0, 3).map((g) => `${g.away} @ ${g.home}`),
  });
};

// --- mlb_lineups ------------------------------------------------------------

const lineups = async (args: any): Promise<ToolOutcome> => {
  let gamePk: number | undefined = args?.gamePk ? Number(args.gamePk) : undefined;
  if (!gamePk && (args?.team || args?.date)) {
    const team = mlb.matchTeamName(args.team);
    const day = args.date ?? today();
    const res = await mlb.getSchedule(day, day);
    if (res.available && res.data) {
      const match = res.data.find(
        (g) => !team || g.away.name === team || g.home.name === team
      );
      if (match) gamePk = match.gamePk;
    }
  }
  if (!gamePk) return unavail('no gamePk or matching team+date game found');
  const res = await mlb.getLineups(gamePk);
  if (!res.available || !res.data) return unavail(res.reason ?? 'boxscore unavailable');
  const d = res.data;
  const payload = {
    available: true,
    source: 'statsapi.mlb.com boxscore',
    gamePk,
    status: d.status,
    lineupsPosted: d.away.lineupsPosted || d.home.lineupsPosted,
    away: {
      team: d.away.team?.name,
      battingOrder: d.away.battingOrder.map((p: any) => p.fullName),
      probablePitcher: d.away.probablePitcher?.fullName ?? null,
    },
    home: {
      team: d.home.team?.name,
      battingOrder: d.home.battingOrder.map((p: any) => p.fullName),
      probablePitcher: d.home.probablePitcher?.fullName ?? null,
    },
    note: d.away.lineupsPosted || d.home.lineupsPosted
      ? 'confirmed batting order from boxscore'
      : 'lineups not yet posted (boxscore battingOrder empty pre-game)',
  };
  return ok(`Lineups for game ${gamePk}: ${payload.note}`, payload, {
    gamePk,
    posted: payload.lineupsPosted,
    awayOrder: payload.away.battingOrder.length,
    homeOrder: payload.home.battingOrder.length,
  });
};

// --- game_weather -----------------------------------------------------------

const gameWeather = async (args: any): Promise<ToolOutcome> => {
  const venue: string | undefined = args?.venue ?? undefined;
  const team: string | undefined = args?.team ?? undefined;
  const date: string | undefined = args?.date ?? undefined;
  const w = await weather.getWeather(venue, team, date);
  if (!w.available) return unavail(w.reason ?? 'weather unavailable');
  const pf = getParkFactor(w.venue);
  const payload = {
    ...w,
    parkFactor: pf
      ? { venue: pf.venue, hrFactor: pf.hrFactor, runsFactor: pf.runsFactor, label: '3-yr park factor, public data' }
      : null,
  };
  return ok(`Weather at ${w.venue}: ${w.tempF}°F, wind ${w.windMph} mph ${w.windDir ?? ''}`, payload, {
    venue: w.venue,
    tempF: w.tempF,
    windMph: w.windMph,
    windDir: w.windDir,
    precipPct: w.precipPct,
    hrFactor: pf?.hrFactor ?? null,
  });
};

// --- game_odds --------------------------------------------------------------

const gameOdds = async (args: any): Promise<ToolOutcome> => {
  const teams: string | undefined = args?.teams ?? undefined;
  const sport: string = args?.sport ?? 'mlb';
  const markets: string[] = args?.markets
    ? String(args.markets).split(',').map((s) => s.trim()).filter(Boolean)
    : ['h2h', 'spreads', 'totals'];

  let teamA: string | undefined;
  let teamB: string | undefined;
  if (teams) {
    const parts = teams.split(/\s+(?:vs\.?|@|versus)\s+|\s*,\s*/i).map((s) => s.trim()).filter(Boolean);
    teamA = parts[0];
    teamB = parts[1];
  }

  // Primary: The Odds API (multi-book). Fallback: ESPN summary (DraftKings, keyless).
  const r = await odds.getGameOdds(teamA, teamB, sport, markets);
  if (r.available) {
    const payload = {
      available: true,
      source: 'api.the-odds-api.com',
      sport: r.sport,
      event: r.event,
      markets: r.markets,
      props: r.props,
      remainingRequests: r.remaining,
    };
    return ok(`Odds for ${r.event?.away} @ ${r.event?.home} (${r.reason ?? ''})`, payload, {
      event: r.event ? `${r.event.away} @ ${r.event.home}` : null,
      h2h: payload.markets?.h2h ?? null,
      propsAvailable: r.props?.available ?? false,
    });
  }

  // Secondary: SportsGameOdds (multi-book, keyless-style scoring/results bundled).
  const s = await sgo.getSgoGameOdds(teamA, teamB, sport);
  if (s.available) {
    const payload = {
      available: true,
      source: 'api.sportsgameodds.com',
      sport: s.sport,
      event: s.event,
      markets: s.markets,
      props: s.props,
      notice: s.notice ?? undefined,
    };
    return ok(`Odds for ${s.event?.away} @ ${s.event?.home} (SportsGameOdds)`, payload, {
      event: s.event ? `${s.event.away} @ ${s.event.home}` : null,
      h2h: payload.markets?.h2h ?? null,
      propsAvailable: s.props?.available ?? false,
    });
  }

  // Tertiary: SharpApi real player props (MLB/NBA/NFL/NHL, DraftKings+FanDuel).
  const sh = await sharp.getSharpGameOdds(teamA, teamB, sport);
  if (sh.available) {
    const payload = {
      available: true,
      source: 'api.sharpapi.io',
      sport: sh.sport,
      event: sh.event,
      markets: sh.markets,
      props: sh.props,
      notice: sh.notice ?? undefined,
    };
    return ok(`Player props via ${sh.event?.away} @ ${sh.event?.home} (SharpApi)`, payload, {
      event: sh.event ? `${sh.event.away} @ ${sh.event.home}` : null,
      h2h: null,
      propsAvailable: sh.props?.available ?? false,
    });
  }

  // Fallback: ESPN keyless odds (DraftKings via ESPN summary payload).
  const e = await espnOdds.getGameOdds(teamA, teamB, sport);
  if (e.available) {
    const ml = e.moneyline;
    const payload = {
      available: true,
      source: e.source,
      provider: e.provider,
      sport: e.sport,
      eventId: e.eventId,
      away: e.away,
      home: e.home,
      moneyline: ml
        ? {
            away: ml.away ? { odds: ml.away, implied: impliedProb(espnOdds.parseAmerican(ml.away)) } : null,
            home: ml.home ? { odds: ml.home, implied: impliedProb(espnOdds.parseAmerican(ml.home)) } : null,
            open: { away: ml.awayOpen, home: ml.homeOpen },
          }
        : null,
      runline: e.runline,
      total: e.total,
      retrievedAt: e.retrievedAt,
      note: 'single book (DraftKings) via ESPN summary payload; open/close prices included when posted. Add ODDS_API_KEY for multi-book (FanDuel, Bet365, BetMGM, Caesars).',
    };
    return ok(
      `Odds for ${e.away} @ ${e.home} (${e.provider ?? 'ESPN'}, via ESPN)`,
      payload,
      {
        event: `${e.away} @ ${e.home}`,
        provider: e.provider,
        moneyline: ml ? { away: ml.away, home: ml.home } : null,
        total: e.total?.line ?? null,
      }
    );
  }

  // Fallback 3: OddsTrader keyless board scrape (last resort; real public odds).
  const sc = await oddsScraper.scrapeOddsTrader(teamA, teamB, sport);
  if (sc.available && sc.moneyline) {
    const ml = sc.moneyline;
    const payload = {
      available: true,
      source: 'oddstrader.com',
      provider: 'OddsTrader (scraped public board)',
      sport: sc.sport,
      event: sc.event,
      away: sc.away,
      home: sc.home,
      moneyline: ml
        ? {
            away: ml.away ? { odds: ml.away, implied: impliedProb(espnOdds.parseAmerican(ml.away)) } : null,
            home: ml.home ? { odds: ml.home, implied: impliedProb(espnOdds.parseAmerican(ml.home)) } : null,
          }
        : null,
      runline: sc.runline ?? null,
      total: sc.total ?? null,
      retrievedAt: new Date().toISOString(),
      note: 'keyless scrape of public OddsTrader board; single consolidated price, not multi-book. Treat as indicative, confirm on your book before wagering.',
    };
    return ok(
      `Odds for ${sc.away} @ ${sc.home} (OddsTrader scrape)`,
      payload,
      {
        event: `${sc.away} @ ${sc.home}`,
        provider: 'OddsTrader',
        moneyline: ml ? { away: ml.away, home: ml.home } : null,
        total: sc.total?.line ?? null,
      }
    );
  }

  return unavail(
    `The Odds API: ${r.reason ?? 'unavailable'}${e.reason ? ` | ESPN odds: ${e.reason}` : ''}${sc.reason ? ` | OddsTrader: ${sc.reason}` : ''}`
  );
};

// american odds → implied probability (0..1). -105 → 0.512, +150 → 0.400.
function impliedProb(american: number | null): number | null {
  if (american == null) return null;
  const dec = american > 0 ? 1 + american / 100 : 1 + 100 / -american;
  return Math.round((1 / dec) * 1000) / 1000;
}

// --- player_news ------------------------------------------------------------

const playerNews = async (args: any): Promise<ToolOutcome> => {
  const player = String(args?.player ?? '').trim();
  const sportKey = String(args?.sport ?? 'mlb').toLowerCase();
  if (!player) return unavail('no player name provided');
  const r = await news.getLeagueNews(sportKey, player, 8);
  if (!r.available) return unavail(r.reason ?? 'news unavailable');
  const payload = {
    available: true,
    source: r.source,
    sport: r.sport,
    player,
    articles: r.articles.map((a) => ({
      published: a.published,
      headline: a.headline,
      description: a.description,
      type: a.type,
      url: a.url,
      mentionsPlayer: a.mentionsPlayer,
    })),
    note: 'Real league headlines. mentionsPlayer=true when the player name appears in headline/description. No mention = absence of news, NOT a claim about injury or playing status.',
  };
  const mentions = r.articles.filter((a) => a.mentionsPlayer).length;
  return ok(
    `ESPN ${r.sport.toUpperCase()} news (${r.articles.length} headlines${mentions ? `, ${mentions} mentioning ${player}` : ''})`,
    payload,
    { player, articles: r.articles.length, mentions }
  );
};

// --- player_availability ---------------------------------------------------

const playerAvailability = async (args: any): Promise<ToolOutcome> => {
  const player = String(args?.player ?? '').trim();
  const sport = availability.parseSportKey(args?.sport ?? 'mlb');
  if (!player) return unavail('no player name provided');
  if (!sport) return unavail(`unsupported sport "${String(args?.sport ?? '')}" (use mlb, nfl, nba or nhl)`);

  const status = await availability.verifyRecommendationAvailability({
    player,
    sport,
    team: args?.team,
    date: args?.date ?? today(),
    gamePk: Number(args?.gamePk) || null,
    eventId: args?.eventId ?? null,
  });
  const recommendationEligible = status.recommendationEligible;
  const payload = {
    available: true,
    source: status.sources,
    ...status,
  };
  return ok(
    recommendationEligible
      ? `${status.player} passed current ${sport.toUpperCase()} availability checks`
      : `${status.player} is NOT eligible for a betting recommendation: ${!status.rosterAndInjuryEligible ? status.reason : status.gameDay.reason}`,
    payload,
    {
      player: status.player,
      team: status.team,
      playingStatus: status.playingStatus,
      recommendationEligible,
      reason: recommendationEligible ? payload.rule : `${status.reason} ${status.gameDay.reason}`,
      checkedAt: status.checkedAt,
    }
  );
};

// --- espn_gamelog -----------------------------------------------------------

const ESPN_SPORTS: Record<string, espn.EspnSport> = {
  nfl: 'football/nfl', football: 'football/nfl', nba: 'basketball/nba', basketball: 'basketball/nba',
  nhl: 'hockey/nhl', hockey: 'hockey/nhl',
};

const espnGamelog = async (args: any): Promise<ToolOutcome> => {
  const player: string = args?.player ?? '';
  const sportKey: string = String(args?.sport ?? 'nba').toLowerCase();
  const sport = ESPN_SPORTS[sportKey];
  if (!sport) return unavail(`unsupported sport "${sportKey}" (use nfl, nba or nhl)`);
  const gamesN = Math.min(Number(args?.games ?? 10) || 10, 20);
  if (!player) return unavail('no player name provided');

  const found = await espn.findPlayer(player, sport);
  if (!found.available || !found.player) return unavail(found.reason ?? 'player not found');
  const gl = await espn.getGamelog(found.player.id, sport, gamesN);
  if (!gl.available || !gl.games) return unavail(gl.reason ?? 'gamelog unavailable');

  const readable = gl.games.map((g) => {
    const s = g.stats;
    let out: Record<string, any> = {
      gameDate: g.gameDate,
      opponent: g.opponent,
      atVs: g.atVs,
      score: g.score,
      result: g.result,
    };
    if (sport === 'basketball/nba') {
      const fgm = s['fieldGoalsMade-fieldGoalsAttempted'] ?? '';
      const tpm = s['threePointFieldGoalsMade-threePointFieldGoalsAttempted'] ?? '';
      out = {
        ...out,
        minutes: s.minutes ?? null,
        points: s.points ?? null,
        rebounds: s.totalRebounds ?? null,
        assists: s.assists ?? null,
        steals: s.steals ?? null,
        blocks: s.blocks ?? null,
        turnovers: s.turnovers ?? null,
        fg: fgm || null,
        threePt: tpm || null,
        threePtMade: tpm ? parseInt(tpm.split('-')[0], 10) : null,
        ft: s['freeThrowsMade-freeThrowsAttempted'] ?? null,
      };
    } else if (sport === 'football/nfl') {
      out = {
        ...out,
        passing: s.completions !== undefined
          ? { completions: s.completions, attempts: s.passingAttempts, yards: s.passingYards, tds: s.passingTouchdowns, ints: s.interceptions, qbr: s.QBRating ?? s.adjQBR ?? null }
          : undefined,
        rushing: s.rushingAttempts !== undefined && Number(s.rushingAttempts) > 0
          ? { attempts: s.rushingAttempts, yards: s.rushingYards, tds: s.rushingTouchdowns }
          : undefined,
        receiving: s.receptions !== undefined && Number(s.receptions) > 0
          ? { receptions: s.receptions, targets: s.receivingTargets, yards: s.receivingYards, tds: s.receivingTouchdowns }
          : undefined,
        fumbles: s.fumbles ?? null,
      };
    } else {
      out = {
        ...out,
        goals: s.goals ?? null,
        assists: s.assists ?? null,
        points: s.points ?? null,
        shotsOnGoal: s.shots ?? s.shotsOnGoal ?? null,
        blockedShots: s.blockedShots ?? s.blocked ?? null,
        saves: s.saves ?? null,
        goalsAgainst: s.goalsAgainst ?? null,
        timeOnIce: s.timeOnIce ?? null,
      };
    }
    return out;
  });

  const payload = {
    available: true,
    source: 'site.web.api.espn.com (v3 gamelog)',
    player: found.player.displayName,
    espnId: found.player.id,
    team: found.player.teamName,
    position: found.player.position,
    sport: sportKey.toUpperCase(),
    season: gl.season,
    seasonNote: 'season label as reported by ESPN (off-season: shows most recent completed season)',
    games: readable,
    statKeyNames: gl.games[0]?.stats ? Object.keys(gl.games[0].stats) : [],
  };
  const last = readable[0];
  const line = last ? `${last.points ?? last.passing?.yards ?? last.receiving?.yards ?? '?'} in last game vs ${last.opponent}` : 'no games';
  return ok(`${sportKey.toUpperCase()} gamelog for ${found.player.displayName}: ${gl.season}`, payload, {
    player: found.player.displayName,
    season: gl.season,
    games: readable.length,
    lastGame: line,
  });
};

// --- player_prop_model ------------------------------------------------------

const playerPropModel = async (args: any): Promise<ToolOutcome> => {
  const sport = availability.parseSportKey(args?.sport) as ModelSport | null;
  const player = String(args?.player ?? '').trim();
  const market = normalizeMarket(String(args?.market ?? ''));
  const side = String(args?.side ?? 'over').toLowerCase() === 'under' ? 'under' : 'over';
  const line = Number(args?.line);
  const oddsValue = args?.odds == null || String(args.odds).trim() === ''
    ? null : Number(String(args.odds).replace(/−/g, '-').replace('+', ''));
  const americanOdds = Number.isFinite(oddsValue) && oddsValue !== 0 ? oddsValue : null;
  if (!sport) return unavail(`unsupported sport "${String(args?.sport ?? '')}" (use mlb, nfl, nba or nhl)`);
  if (!player) return unavail('no player name provided');
  if (!market) return unavail('no prop market provided');
  if (!Number.isFinite(line) || line < 0) return unavail('a valid non-negative sportsbook line is required');
  if (!isRealisticLine(sport, market, line)) {
    return unavail(`line ${line} is not a bookable ${market} line (ask at a standard line instead)`);
  }

  // Models are intentionally downstream of the mandatory live status gate.
  const status = await availability.verifyRecommendationAvailability({
    player, sport, team: args?.team,
    date: typeof args?.date === 'string' ? args.date : today(),
    gamePk: Number(args?.gamePk) || null,
    eventId: args?.eventId ?? null,
  });
  if (!status.recommendationEligible) {
    return unavail(`availability gate failed for ${status.player}: ${status.reason} ${status.gameDay.reason}`);
  }

  let observations: HistoricalObservation[] = [];
  let source = '';
  let playerId: string | number | null = null;
  let playerName = status.player;
  if (sport === 'mlb') {
    const found = await mlb.searchPlayer(player);
    if (!found.available || !found.data) return unavail(found.reason ?? 'official MLB player not found');
    playerId = found.data.id;
    playerName = found.data.fullName;
    const pitcherMarkets = new Set(['strikeouts', 'earnedRuns', 'hitsAllowed', 'walksAllowed', 'outsRecorded']);
    const group = pitcherMarkets.has(market) ? 'pitching' : 'hitting';
    const log = await mlb.getGameLog(found.data.id, group, mlb.CURRENT_SEASON, 20);
    if (!log.available || !Array.isArray(log.data)) return unavail(log.reason ?? 'official MLB game log unavailable');
    observations = log.data.flatMap((game: any): HistoricalObservation[] => {
      const value = mlbObservation(market, game.stat ?? {});
      return value == null || !Number.isFinite(value) ? [] : [{ date: game.date ?? null, value }];
    });
    source = 'statsapi.mlb.com official gameLog';
  } else {
    const espnSport = ESPN_SPORTS[sport];
    const found = await espn.findPlayer(player, espnSport);
    if (!found.available || !found.player) return unavail(found.reason ?? 'current ESPN roster player not found');
    playerId = found.player.id;
    playerName = found.player.displayName;
    const log = await espn.getGamelog(found.player.id, espnSport, 20);
    if (!log.available || !Array.isArray(log.games)) return unavail(log.reason ?? 'official ESPN game log unavailable');
    observations = log.games.flatMap((game): HistoricalObservation[] => {
      const value = espnObservation(sport, market, game.stats);
      return value == null || !Number.isFinite(value) ? [] : [{ date: game.gameDate, value }];
    });
    source = 'site.web.api.espn.com v3 official game log';
  }

  let calibration = null;
  try {
    const learning = await loadLearning();
    const learned = learning?.perSportMarket?.[`${sport.toUpperCase()}:${market}`];
    if (learned) calibration = { n: learned.n, averageConfidence: learned.averageConfidence ?? null, hitRate: learned.hitRate };
  } catch {
    // Model remains usable from official history when optional learning state is unavailable.
  }
  const model = buildPlayerPropModel({ sport, market, side, line, observations, americanOdds, source, calibration });
  const payload = {
    ...model, player: playerName, playerId,
    availability: {
      recommendationEligible: status.recommendationEligible,
      playingStatus: status.playingStatus,
      checkedAt: status.checkedAt,
      reason: status.reason,
      gameDay: status.gameDay,
    },
    observations: observations.map((row) => ({ date: row.date ?? null, value: row.value })),
    rule: 'Use probability only for this exact market side and line. A grade D is no recommendation. Positive EV requires verified odds and estimatedEdge > 0.',
  };
  if (!model.available) {
    return { available: false, reason: model.reason, summary: `model unavailable: ${model.reason}`, data: payload, payload };
  }
  return ok(
    `${sport.toUpperCase()} ${playerName} ${side} ${line} ${market}: ${round((model.probability ?? 0) * 100, 1)}% from ${model.sampleSize} real games (${model.grade})`,
    payload,
    {
      player: playerName, sport, market, side, line,
      probability: model.probability, grade: model.grade, sampleSize: model.sampleSize,
      impliedProbability: model.impliedProbability, estimatedEdge: model.estimatedEdge,
      modelVersion: model.modelVersion, source: model.source,
      eventDate: String(args?.date ?? today()).slice(0, 10),
      eventId: String(status.gameDay.eventId ?? status.gameDay.gamePk ?? ''),
    },
  );
};

// --- team_efficiency --------------------------------------------------------

const teamEfficiency = async (args: any): Promise<ToolOutcome> => {
  const sportKey: string = String(args?.sport ?? 'nba').toLowerCase();
  const sport = ESPN_SPORTS[sportKey];
  if (!sport || sport === 'hockey/nhl') return unavail(`unsupported sport "${sportKey}" (use nfl or nba)`);
  const team: string = args?.team ?? '';
  if (!team) return unavail('no team name provided');
  const r = await espn.getTeamStats(sport, team);
  if (!r.available) return unavail(r.reason ?? 'team stats unavailable');
  return ok(`${sportKey.toUpperCase()} efficiency for ${r.team}`, r, {
    team: r.team,
    pace: r.pace?.possessionsPerGame ?? null,
    yardsPerPlay: r.offense?.yardsPerPlay ?? null,
    defenseAvailable: r.defense?.available ?? false,
  });
};

// --- registry ---------------------------------------------------------------

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'player_prop_model',
    description:
      'Deterministic evidence-only player prop model for MLB/NFL/NBA/NHL. REQUIRED for every player-prop recommendation after supplying the exact sportsbook market, side and line. It first runs the mandatory current player_availability gate, then estimates probability from official recent game logs with transparent shrinkage. Returns unavailable instead of inventing missing history. Grade D means do not recommend; +EV requires verified odds and positive estimatedEdge.',
    parameters: {
      type: 'object',
      properties: {
        player: { type: 'string', description: 'Full player name' },
        sport: { type: 'string', description: 'mlb, nfl, nba or nhl' },
        market: { type: 'string', description: 'Exact market, e.g. hits, strikeouts, points, rebounds, passing_yards, shots_on_goal, saves' },
        side: { type: 'string', enum: ['over', 'under'] },
        line: { type: 'number', description: 'Exact current sportsbook prop line' },
        odds: { type: 'number', description: 'Optional verified American odds for this exact prop, e.g. -110' },
        team: { type: 'string', description: 'Optional team name for availability resolution' },
        date: { type: 'string', description: 'Event date YYYY-MM-DD' },
        gamePk: { type: 'number', description: 'Optional MLB official gamePk' },
        eventId: { type: 'string', description: 'Official ESPN event ID for NFL/NBA/NHL game-day verification' },
      },
      required: ['player', 'sport', 'market', 'side', 'line'],
    },
    handler: playerPropModel,
  },
  {
    name: 'player_availability',
    description:
      'MANDATORY final safety gate before recommending or adding ANY player prop. Verifies current active roster plus league and exact-event injury status for MLB/NFL/NBA/NHL. MLB additionally requires the exact scheduled game and confirmed batting order/probable pitcher. NFL/NBA/NHL require an exact pregame ESPN event (pass date + eventId when known). recommendationEligible=false is fail-closed.',
    parameters: {
      type: 'object',
      properties: {
        player: { type: 'string', description: 'Full player name' },
        sport: { type: 'string', description: 'mlb, nfl, nba or nhl' },
        team: { type: 'string', description: 'Optional team name; helps resolve the MLB game' },
        date: { type: 'string', description: 'Game date YYYY-MM-DD (default today)' },
        gamePk: { type: 'number', description: 'Optional MLB Stats API gamePk from mlb_schedule' },
        eventId: { type: 'string', description: 'Official ESPN event ID for NFL/NBA/NHL' },
      },
      required: ['player', 'sport'],
    },
    handler: playerAvailability,
  },
  {
    name: 'mlb_batter_stats',
    description:
      'MLB batter season stats + last-15-game rolling log (hits, HR, RBI, total bases, AVG, OBP, SLG, OPS, K%) + platoon splits vs LHP/RHP, from statsapi.mlb.com. Call before answering any batter/prop question.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Player name, e.g. "Vladimir Guerrero Jr."' } },
      required: ['name'],
    },
    handler: batterStats,
  },
  {
    name: 'mlb_pitcher_stats',
    description:
      'MLB pitcher season stats + last-10-start log (K, IP, ERA, K/9, K%+BB% CSW proxy, computed FIP) + platoon K/9 splits vs LHB/RHB, from statsapi.mlb.com. Call before answering any pitcher/strikeout prop question.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Pitcher name, e.g. "Kevin Gausman"' } },
      required: ['name'],
    },
    handler: pitcherStats,
  },
  {
    name: 'mlb_advanced_metrics',
    description:
      'Baseball Savant expected statistics: xwOBA (est_woba), xBA (est_ba), xSLG (est_slg), barrel% and hard-hit% (statcast leaderboard) for 2026, matched by name. Use to evaluate batted-ball quality.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Player name, e.g. "Vladimir Guerrero Jr."' } },
      required: ['name'],
    },
    handler: advancedMetrics,
  },
  {
    name: 'mlb_schedule',
    description:
      "Today's and next-7-days MLB games with probable pitchers, venue and game time (statsapi.mlb.com). Optional team filter (nickname works: 'Blue Jays', 'Astros').",
    parameters: {
      type: 'object',
      properties: { team: { type: 'string', description: 'Optional team nickname, e.g. "Blue Jays"' } },
    },
    handler: schedule,
  },
  {
    name: 'mlb_lineups',
    description:
      'Confirmed MLB batting orders + probable pitchers for a game (statsapi boxscore). Pass gamePk, or team + date (YYYY-MM-DD). Honest "lineups not yet posted" when boxscore is empty pre-game.',
    parameters: {
      type: 'object',
      properties: {
        gamePk: { type: 'number', description: 'statsapi gamePk' },
        team: { type: 'string', description: 'Team nickname, e.g. "Astros"' },
        date: { type: 'string', description: 'Game date YYYY-MM-DD (default today)' },
      },
    },
    handler: lineups,
  },
  {
    name: 'game_weather',
    description:
      'Game-time weather (Open-Meteo): temperature F, wind mph + direction, precipitation % for any MLB venue, plus the venue 3-yr park factor table. Pass venue name or team.',
    parameters: {
      type: 'object',
      properties: {
        venue: { type: 'string', description: 'Venue name, e.g. "Rogers Centre"' },
        team: { type: 'string', description: 'Team nickname, e.g. "Blue Jays" (used when venue not given)' },
        date: { type: 'string', description: 'Date YYYY-MM-DD (default today)' },
      },
    },
    handler: gameWeather,
  },
  {
    name: 'game_odds',
    description:
      'Live sportsbook odds (The Odds API): h2h moneyline, spreads, totals with american odds + implied probability. Requires ODDS_API_KEY; props attempt marked unavailable without a Business plan. Off-season NFL/NBA returns empty honestly.',
    parameters: {
      type: 'object',
      properties: {
        teams: { type: 'string', description: 'Matchup, e.g. "Blue Jays vs Astros" or "Toronto Blue Jays, Houston Astros"' },
        sport: { type: 'string', description: 'mlb (default), nfl, or nba' },
        markets: { type: 'string', description: 'Comma-separated, default "h2h,spreads,totals"' },
      },
    },
    handler: gameOdds,
  },
  {
    name: 'player_news',
    description:
      'Real ESPN news headlines for a sport (mlb/nfl/nba/nhl), optionally filtered for a player name — injury, lineup and status context. No mentions honestly means no recent headlines, not a health claim.',
    parameters: {
      type: 'object',
      properties: {
        player: { type: 'string', description: 'Player name, e.g. "Vladimir Guerrero Jr."' },
        sport: { type: 'string', description: 'mlb (default), nfl, nba or nhl' },
      },
      required: ['player'],
    },
    handler: playerNews,
  },
  {
    name: 'espn_gamelog',
    description:
      'Real per-game stats for NFL/NBA/NHL players from ESPN v3 gamelog: NBA points/rebounds/assists/steals/blocks/3PM; NFL passing/rushing/receiving; NHL goals/assists/points/shots/saves when published. Season label comes from ESPN.',
    parameters: {
      type: 'object',
      properties: {
        player: { type: 'string', description: 'Player name, e.g. "Shai Gilgeous-Alexander"' },
        sport: { type: 'string', description: 'nfl or nba (default nba)' },
        games: { type: 'number', description: 'Number of recent games (default 10, max 20)' },
      },
      required: ['player'],
    },
    handler: espnGamelog,
  },
  {
    name: 'team_efficiency',
    description:
      'Team-level efficiency from ESPN team statistics: NBA estimated pace (possessions/game, computed FGA + 0.44*FTA - OReb + TOV) and offensive rating proxy; NFL yards/play (totalYards/totalOffensivePlays) and per-game splits. Defensive sides are honest unavailable where ESPN exposes no data.',
    parameters: {
      type: 'object',
      properties: {
        sport: { type: 'string', description: 'nfl or nba (default nba)' },
        team: { type: 'string', description: 'Team name, e.g. "Oklahoma City Thunder" or "Buffalo Bills"' },
      },
      required: ['team'],
    },
    handler: teamEfficiency,
  },
];
