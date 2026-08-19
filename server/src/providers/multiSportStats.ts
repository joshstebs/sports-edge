import * as apiSports from './apiSports.js';
import * as espn from './espn.js';

export type MultiSport = 'nba' | 'nfl' | 'nhl';

const ESPN_MAP: Record<MultiSport, espn.EspnSport> = {
  nba: 'basketball/nba',
  nfl: 'football/nfl',
  nhl: 'hockey/nhl',
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: UnifiedPlayerStats }>();

export interface UnifiedPlayerStats {
  available: boolean;
  sport: MultiSport;
  player: string;
  source: string | null;
  fallbackUsed: boolean;
  fallbackReason?: string | null;
  profile?: any;
  season?: number | null;
  seasonStats?: any;
  recentGames?: any[];
  providerMeta?: Record<string, unknown>;
  reason?: string;
}

function fromCache(key: string): UnifiedPlayerStats | null {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at > CACHE_TTL_MS) return null;
  return hit.value;
}

function remember(key: string, value: UnifiedPlayerStats): UnifiedPlayerStats {
  if (value.available) cache.set(key, { at: Date.now(), value });
  return value;
}

function apiSportsPlayerId(player: any): string | number | null {
  const id = player?.id ?? player?.player?.id;
  return typeof id === 'string' || typeof id === 'number' ? id : null;
}

function apiSportsPlayerName(player: any, fallback: string): string {
  return String(player?.name ?? player?.player?.name ?? fallback).trim() || fallback;
}

export async function getUnifiedPlayerStats(
  sport: MultiSport,
  playerName: string,
  games = 10,
): Promise<UnifiedPlayerStats> {
  const requested = String(playerName ?? '').trim();
  if (!requested) return { available: false, sport, player: requested, source: null, fallbackUsed: false, reason: 'player name is required' };
  const key = `${sport}:${requested.toLowerCase()}:${games}`;
  const cached = fromCache(key);
  if (cached) return { ...cached, providerMeta: { ...(cached.providerMeta ?? {}), cached: true } };

  let fallbackReason: string | null = null;
  if (sport === 'nba' || sport === 'nfl') {
    const found = await apiSports.findPlayer(sport, requested);
    if (found.available && found.data) {
      const id = apiSportsPlayerId(found.data);
      if (id != null) {
        const season = apiSports.apiSportsSeasonForNow();
        const stats = await apiSports.getSeasonPlayerStats(sport, id, season);
        if (stats.available && Array.isArray(stats.data) && stats.data.length) {
          return remember(key, {
            available: true,
            sport,
            player: apiSportsPlayerName(found.data, requested),
            source: `api-sports.io/${sport}`,
            fallbackUsed: false,
            profile: found.data,
            season,
            seasonStats: stats.data,
            recentGames: [],
            providerMeta: {
              remainingDaily: stats.remainingDaily,
              remainingMinute: stats.remainingMinute,
              note: 'API-Sports season statistics; recent game log may be supplemented by ESPN when needed',
            },
          });
        }
        fallbackReason = stats.reason ?? 'API-Sports returned no season statistics';
      } else {
        fallbackReason = 'API-Sports player result did not include an id';
      }
    } else {
      fallbackReason = found.reason ?? 'API-Sports player lookup unavailable';
    }
  } else {
    fallbackReason = 'NHL player-stat depth is not assumed from API-Hockey; using ESPN/NHL web data';
  }

  const espnSport = ESPN_MAP[sport];
  const foundEspn = await espn.findPlayer(requested, espnSport);
  if (!foundEspn.available || !foundEspn.player) {
    return { available: false, sport, player: requested, source: null, fallbackUsed: Boolean(fallbackReason), fallbackReason, reason: foundEspn.reason ?? 'player not found in fallback source' };
  }
  const log = await espn.getGamelog(foundEspn.player.id, espnSport, Math.min(Math.max(games, 1), 20));
  if (!log.available || !Array.isArray(log.games)) {
    return { available: false, sport, player: foundEspn.player.displayName, source: null, fallbackUsed: true, fallbackReason, reason: log.reason ?? 'ESPN gamelog unavailable' };
  }
  return remember(key, {
    available: true,
    sport,
    player: foundEspn.player.displayName,
    source: 'site.web.api.espn.com',
    fallbackUsed: true,
    fallbackReason,
    profile: {
      id: foundEspn.player.id,
      teamId: foundEspn.player.teamId,
      teamName: foundEspn.player.teamName,
      position: foundEspn.player.position,
      rosterStatus: foundEspn.player.rosterStatus,
    },
    season: Number(log.season) || null,
    seasonStats: null,
    recentGames: log.games,
    providerMeta: {
      coverage: foundEspn.coverage,
      note: 'ESPN recent game log fallback; no fabricated API-Sports fields',
    },
  });
}

export async function getUnifiedInjuries(
  sport: MultiSport,
  playerName?: string,
): Promise<{ available: boolean; sport: MultiSport; source: string | null; fallbackUsed: boolean; fallbackReason?: string | null; injuries: any[]; reason?: string }> {
  const player = String(playerName ?? '').trim();
  let fallbackReason: string | null = null;

  if (sport === 'nfl' && apiSports.apiSportsConfigured()) {
    if (player) {
      const found = await apiSports.findPlayer('nfl', player);
      const id = found.available && found.data ? apiSportsPlayerId(found.data) : null;
      if (id != null) {
        const injuries = await apiSports.getNflInjuries(id);
        if (injuries.available && Array.isArray(injuries.data)) {
          return { available: true, sport, source: 'api-sports.io/nfl', fallbackUsed: false, injuries: injuries.data };
        }
        fallbackReason = injuries.reason ?? 'API-Sports NFL injury data unavailable';
      } else fallbackReason = found.reason ?? 'API-Sports NFL player lookup unavailable';
    } else {
      fallbackReason = 'API-Sports NFL injuries require a player/team filter; using ESPN league report';
    }
  } else if (sport === 'nfl') {
    fallbackReason = 'API_SPORTS_KEY not configured';
  } else if (sport === 'nba') {
    fallbackReason = 'NBA injury fallback remains ESPN until API-Sports injury coverage is verified for the target season';
  } else {
    fallbackReason = 'NHL injury source is ESPN/NHL web data';
  }

  const report = await espn.getLeagueInjuries(ESPN_MAP[sport]);
  if (!report.available) return { available: false, sport, source: null, fallbackUsed: true, fallbackReason, injuries: [], reason: report.reason };
  const filtered = player
    ? report.injuries.filter((injury) => injury.playerName.toLowerCase().includes(player.toLowerCase()))
    : report.injuries;
  return { available: true, sport, source: report.source, fallbackUsed: true, fallbackReason, injuries: filtered };
}
