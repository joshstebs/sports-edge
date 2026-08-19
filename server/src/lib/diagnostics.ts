import { llmConfig } from '../llm/chatClient.js';
import { apiSportsConfigured, apiSportsQuota } from '../providers/apiSports.js';
import { oddsConfigured, quotaRemaining as oddsQuotaRemaining } from '../providers/oddsApi.js';
import { listPredictions, loadLearning, storageStatus, type Prediction } from './predictionStore.js';

export type ProviderStatus = 'ready' | 'fallback' | 'unavailable';

export interface ProviderDiagnostic {
  id: string;
  label: string;
  status: ProviderStatus;
  configured: boolean;
  primaryFor: string[];
  fallback?: string | null;
  quota?: unknown;
  cacheTtl: string;
  source: string;
  note: string;
}

export interface DriftAlert {
  severity: 'info' | 'warning' | 'critical';
  scope: string;
  message: string;
  sampleSize?: number;
}

export interface DiagnosticsSnapshot {
  generatedAt: string;
  storage: ReturnType<typeof storageStatus>;
  llm: { configured: boolean; provider: string | null; model: string | null };
  cron: { configured: boolean; schedule: string; timezone: string };
  providers: ProviderDiagnostic[];
  cachePolicy: Array<{ data: string; ttl: string; rationale: string }>;
  sourcePolicy: Record<string, string[]>;
  driftAlerts: DriftAlert[];
}

export async function buildDiagnostics(): Promise<DiagnosticsSnapshot> {
  const cfg = llmConfig();
  const storage = storageStatus();
  const learning = await loadLearning();
  const apiSports = apiSportsConfigured();
  const oddsApi = oddsConfigured();
  const driftAlerts: DriftAlert[] = [];

  for (const [scope, value] of Object.entries(learning?.perSportMarket ?? {})) {
    const gap = value.calibrationError ?? null;
    if (value.n >= 20 && gap != null && Math.abs(gap) >= 8) {
      driftAlerts.push({
        severity: Math.abs(gap) >= 12 ? 'critical' : 'warning',
        scope,
        sampleSize: value.n,
        message: gap > 0
          ? `Model confidence is ${Math.abs(gap).toFixed(1)} points above realized results.`
          : `Realized results are ${Math.abs(gap).toFixed(1)} points above stated confidence; review for underconfidence without automatically raising probabilities.`,
      });
    }
  }
  if ((learning?.priced ?? 0) >= 20 && (learning?.roi ?? 0) < -10) {
    driftAlerts.push({
      severity: 'critical',
      scope: 'verified-odds ROI',
      sampleSize: learning?.priced,
      message: `Verified-odds ROI is ${learning?.roi}% across ${learning?.priced} priced legs; keep conservative sizing while this persists.`,
    });
  }
  if (!driftAlerts.length) {
    driftAlerts.push({
      severity: 'info',
      scope: 'calibration',
      message: 'No material model-drift alert is currently supported by the stored sample.',
    });
  }

  const providers: ProviderDiagnostic[] = [
    {
      id: 'api-sports', label: 'API-Sports', configured: apiSports,
      status: apiSports ? 'ready' : 'fallback', primaryFor: ['NBA stats', 'NFL stats'], fallback: 'ESPN',
      quota: apiSportsQuota(), cacheTtl: 'provider-dependent / short-lived',
      source: 'v2.nba.api-sports.io + v1.american-football.api-sports.io',
      note: apiSports ? 'Primary NBA/NFL stats provider when an endpoint has reliable coverage.' : 'Not configured; NBA/NFL stats fall back to ESPN.',
    },
    {
      id: 'espn', label: 'ESPN', configured: true, status: 'ready',
      primaryFor: ['NHL stats', 'injuries', 'rosters', 'fallback NBA/NFL stats', 'sportsbook fallback'],
      fallback: null, cacheTtl: '5m injuries/rosters · 30m stable team data', source: 'site.web.api.espn.com',
      note: 'Keyless fallback and cross-check source. Sportsbook data is attributed to the provider published in ESPN event summaries.',
    },
    {
      id: 'odds-api', label: 'The Odds API', configured: oddsApi,
      status: oddsApi ? 'ready' : 'fallback', primaryFor: ['moneyline', 'spread', 'totals', 'supported props'], fallback: 'ESPN sportsbook odds',
      quota: { remaining: oddsQuotaRemaining() }, cacheTtl: 'short-lived around market changes', source: 'api.the-odds-api.com',
      note: oddsApi ? 'Primary multi-book odds source.' : 'Not configured; featured odds use the ESPN sportsbook fallback when available.',
    },
    {
      id: 'mlb-stats', label: 'MLB Stats API', configured: true, status: 'ready', primaryFor: ['MLB schedule', 'box scores', 'player stats', 'lineups'],
      fallback: 'ESPN for selected availability context', cacheTtl: '5m lineups · longer for stable history', source: 'statsapi.mlb.com',
      note: 'Official MLB data source for core baseball facts.',
    },
    {
      id: 'savant', label: 'Baseball Savant', configured: true, status: 'ready', primaryFor: ['MLB advanced metrics'],
      fallback: null, cacheTtl: 'longer-lived leaderboard/statcast cache', source: 'baseballsavant.mlb.com',
      note: 'Advanced expected-stat and Statcast context.',
    },
    {
      id: 'redis', label: 'Prediction storage', configured: storage.backend !== 'not-configured',
      status: storage.backend !== 'not-configured' && storage.durable ? 'ready' : 'unavailable', primaryFor: ['prediction history', 'learning', 'ledger'],
      fallback: storage.backend === 'local-json' ? 'local JSON (development)' : null, cacheTtl: 'durable state, not a cache', source: storage.backend,
      note: storage.durable ? `Durable ${storage.backend} storage is active.` : 'Durable production storage is not available.',
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    storage,
    llm: { configured: cfg.configured, provider: cfg.configured ? cfg.provider : null, model: cfg.configured ? cfg.model : null },
    cron: { configured: Boolean(process.env.CRON_SECRET), schedule: '06:00 daily', timezone: 'America/Toronto' },
    providers,
    cachePolicy: [
      { data: 'injuries / game-day availability', ttl: '≈5 minutes', rationale: 'Late scratches and status changes need freshness.' },
      { data: 'sportsbook odds', ttl: 'short-lived', rationale: 'Lines can move quickly; stale odds must not be presented as current.' },
      { data: 'rosters', ttl: '≈5 minutes', rationale: 'Fast enough for availability checks while reducing repeated league calls.' },
      { data: 'team statistics', ttl: '≈30 minutes', rationale: 'Team aggregates move slowly compared with odds and injuries.' },
      { data: 'historical game logs / settled results', ttl: 'longer-lived', rationale: 'Completed game data is stable and safe to reuse.' },
    ],
    sourcePolicy: {
      NBA: ['API-Sports when configured and covered', 'ESPN fallback', 'stored SportsEdge learning history'],
      NFL: ['API-Sports when configured and covered', 'ESPN fallback', 'stored SportsEdge learning history'],
      NHL: ['ESPN/NHL web data', 'stored SportsEdge learning history'],
      MLB: ['MLB Stats API', 'Baseball Savant advanced context', 'ESPN availability cross-check where useful'],
      odds: ['The Odds API', 'ESPN sportsbook fallback'],
    },
    driftAlerts,
  };
}

function csvEscape(value: unknown): string {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function predictionsToCsv(predictions: Prediction[]): string {
  const header = [
    'prediction_id','timestamp','sport','matchup','bet_type','status','selection','market','side','line','model_probability','model_version','model_source','entry_odds','closing_odds','closing_odds_source','outcome','actual','evaluated_at',
  ];
  const rows = [header.join(',')];
  for (const prediction of predictions) {
    for (const leg of prediction.legs) {
      const extended = leg as typeof leg & { closing_odds?: unknown; closing_odds_source?: unknown };
      rows.push([
        prediction.prediction_id, prediction.timestamp, prediction.sport, prediction.matchup, prediction.bet_type, prediction.status,
        leg.leg_name, leg.market ?? '', leg.side ?? '', leg.line ?? leg.target_line ?? '', leg.model_probability ?? '', leg.model_version ?? '', leg.model_source ?? '',
        leg.implied_odds ?? '', extended.closing_odds ?? '', extended.closing_odds_source ?? '', leg.outcome ?? '', leg.actual ?? '', leg.evaluated_at ?? '',
      ].map(csvEscape).join(','));
    }
  }
  return `${rows.join('\n')}\n`;
}

export async function predictionCsvForUser(userId: string): Promise<string> {
  const { predictions } = await listPredictions(userId);
  return predictionsToCsv(predictions);
}
