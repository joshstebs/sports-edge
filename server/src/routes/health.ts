// Health + sources endpoints.

import { Router } from 'express';
import { llmConfig } from '../llm/chatClient.js';
import { storageStatus } from '../lib/predictionStore.js';
import { oddsConfigured } from '../providers/oddsApi.js';
import { apiSportsConfigured, apiSportsQuota } from '../providers/apiSports.js';
import { sgoConfigured } from '../providers/sportsGameOdds.js';
import { SPORTS } from '../providers/sportsConfig.js';

export const VERSION = '0.2.0';

export const sources = {
  mlbStatsApi: {
    available: true,
    baseUrl: 'https://statsapi.mlb.com/api/v1',
    note: 'player search, season stats, game logs, schedule, boxscore lineups (keyless)',
  },
  savant: {
    available: true,
    baseUrl: 'https://baseballsavant.mlb.com/leaderboard',
    note: 'expected_statistics + statcast CSVs (est_ba/est_slg/est_woba, barrel%, hard-hit%) (keyless)',
  },
  apiSports: {
    available: apiSportsConfigured(),
    reason: apiSportsConfigured() ? 'configured' : 'API_SPORTS_KEY not set; NBA/NFL automatically fall back to ESPN',
    baseUrls: {
      nba: 'https://v2.nba.api-sports.io',
      nfl: 'https://v1.american-football.api-sports.io',
    },
    note: 'server-only NBA/NFL player/team/injury statistics provider with quota-aware fallback; NHL remains ESPN/NHL-web-first because API-Hockey coverage does not promise the player-stat depth SportsEdge needs',
  },
  espn: {
    available: true,
    baseUrl: 'https://site.web.api.espn.com/apis',
    note: 'MLB/NFL/NBA/NHL rosters and injury reports, plus league gamelogs/team statistics where available (keyless); fallback for NBA/NFL when API-Sports is unavailable',
  },
  oddsApi: {
    available: oddsConfigured(),
    reason: oddsConfigured() ? 'configured' : 'ODDS_API_KEY not set in server/.env — odds endpoints return available:false',
    baseUrl: 'https://api.the-odds-api.com/v4',
    note: 'h2h/spreads/totals on free plan; player props require Business plan',
  },
  weather: {
    available: true,
    baseUrl: 'https://api.open-meteo.com/v1/forecast',
    note: 'hour-matched game weather + static venue coordinate table (keyless)',
  },
  sportsGameOdds: {
    available: sgoConfigured(),
    reason: sgoConfigured() ? 'configured' : 'SPORTSGAMEODDS_API_KEY not set in server/.env — returns available:false',
    baseUrl: 'https://api.sportsgameodds.com/v2',
    note: 'multi-book h2h/spreads/totals + player props; odds/scores/results bundled per event',
  },
  news: {
    available: true,
    baseUrl: 'https://site.web.api.espn.com/apis/site/v2/sports/{sport}/news',
    note: 'real ESPN headlines for mlb/nfl/nba/nhl, player-name filterable — injury/lineup context (keyless)',
  },
  ledger: {
    available: storageStatus().backend !== 'not-configured',
    baseUrl: storageStatus().backend === 'upstash-redis'
      ? 'upstash-redis://configured'
      : storageStatus().backend === 'local-json' ? 'local-json://data/ledger.json' : null,
    note: 'per-user pick ledger: idempotent SGP saves, settlement, ROI and win rate from real odds (flat 1-unit stakes)',
  },
  parkFactors: {
    available: true,
    baseUrl: 'static table',
    note: '3-yr park factor (HR + runs) for all 30 MLB parks, public data',
  },
};

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  const cfg = llmConfig();
  const storage = storageStatus();
  const apiSportsQuotaState = apiSportsQuota();
  res.json({
    ok: true,
    llmConfigured: cfg.configured,
    llmProvider: cfg.configured ? cfg.provider : null,
    sources: {
      mlbStatsApi: { available: true },
      savant: { available: true },
      apiSports: {
        available: sources.apiSports.available,
        reason: sources.apiSports.reason,
        quota: apiSportsQuotaState,
        fallback: 'ESPN',
      },
      espn: { available: true },
      oddsApi: { available: sources.oddsApi.available, reason: sources.oddsApi.reason },
      weather: { available: true },
      news: { available: true },
      ledger: { available: storage.backend !== 'not-configured', backend: storage.backend, durable: storage.durable },
      parkFactors: { available: true },
    },
    version: VERSION,
  });
});

healthRouter.get('/sources', (_req, res) => {
  const cfg = llmConfig();
  res.json({
    llm: {
      configured: cfg.configured,
      provider: cfg.configured ? cfg.provider : null,
      model: cfg.configured ? cfg.model : null,
      baseUrl: cfg.configured ? cfg.baseUrl : null,
      hint: 'set GEMINI_API_KEY or OPENAI_API_KEY in server/.env',
    },
    sources,
    sourcePolicy: {
      NBA: ['API-Sports (when configured)', 'ESPN fallback', 'SportsEdge cached/learned history'],
      NFL: ['API-Sports (when configured)', 'ESPN fallback', 'SportsEdge cached/learned history'],
      NHL: ['ESPN/NHL web data', 'SportsEdge cached/learned history'],
      odds: ['The Odds API', 'ESPN sportsbook fallback'],
    },
    version: VERSION,
  });
});

// Modular sport registry (public). Front-end league nav reads this.
healthRouter.get('/sports', (_req, res) => {
  res.json({ sports: SPORTS });
});
