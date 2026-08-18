// Health + sources endpoints.

import { Router } from 'express';
import { llmConfig } from '../llm/chatClient.js';
import { storageStatus } from '../lib/predictionStore.js';
import { oddsConfigured } from '../providers/oddsApi.js';
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
  espn: {
    available: true,
    baseUrl: 'https://site.web.api.espn.com/apis',
    note: 'MLB/NFL/NBA/NHL rosters and injury reports, plus league gamelogs/team statistics where available (keyless)',
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
  res.json({
    ok: true,
    llmConfigured: cfg.configured,
    llmProvider: cfg.configured ? cfg.provider : null,
    sources: {
      mlbStatsApi: { available: true },
      savant: { available: true },
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
    version: VERSION,
  });
});

// Modular sport registry (public). Front-end league nav reads this.
healthRouter.get('/sports', (_req, res) => {
  res.json({ sports: SPORTS });
});
