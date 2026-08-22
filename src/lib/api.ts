export interface HealthInfo {
  ok: boolean;
  llmConfigured?: boolean;
  llmProvider?: string | null;
  sources?: Record<string, unknown>;
  version?: string;
}

/** Attach the Stripe customer id when present (trial/subscriber access). */
function customerHeaders(): Record<string, string> {
  try {
    const customerId = localStorage.getItem('sportsedge.customerId');
    return customerId ? { 'x-se-customer-id': customerId } : {};
  } catch {
    return {};
  }
}

/** GET /api/health — drives the "Live data" dot in the header. */
export async function fetchHealth(): Promise<HealthInfo> {
  const res = await fetch(`${import.meta.env.BASE_URL}api/health`, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Health check returned HTTP ${res.status}`);
  }
  return (await res.json()) as HealthInfo;
}

export interface SaveLedgerResponse {
  ok: boolean;
  duplicate?: boolean;
  added?: number;
  picks?: unknown[];
  summary?: unknown;
}

export interface LedgerPick {
  id: string;
  createdAt: string;
  eventDate?: string | null;
  eventId?: string | null;
  sport?: string | null;
  game?: string | null;
  selection: string;
  market?: string | null;
  line?: string | number | null;
  status: 'pending' | 'won' | 'lost' | 'push';
}

export interface LedgerResponse {
  picks: LedgerPick[];
  summary?: unknown;
}

/** GET the signed-in user's durable ledger for local slip reconciliation. */
export async function fetchLedger(): Promise<LedgerResponse> {
  const res = await fetch(`${import.meta.env.BASE_URL}api/ledger`, {
    headers: { Accept: 'application/json', ...customerHeaders() },
  });
  const payload = (await res.json().catch(() => null)) as
    | (Partial<LedgerResponse> & { error?: string })
    | null;
  if (!res.ok || !Array.isArray(payload?.picks)) {
    throw new Error(payload?.error || `Could not load tracked bets (HTTP ${res.status})`);
  }
  return payload as LedgerResponse;
}

/** POST a ticket to the tracked-picks ledger with retry-safe idempotency. */
export async function saveLedgerTicket(
  legs: readonly unknown[],
  idempotencyKey: string,
): Promise<SaveLedgerResponse> {
  const res = await fetch(`${import.meta.env.BASE_URL}api/ledger`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Idempotency-Key': idempotencyKey,
      ...customerHeaders(),
    },
    body: JSON.stringify({ legs, idempotencyKey }),
  });

  const payload = (await res.json().catch(() => null)) as
    | (Partial<SaveLedgerResponse> & { error?: string })
    | null;
  if (!res.ok || !payload?.ok) {
    throw new Error(payload?.error || `Could not track bet (HTTP ${res.status})`);
  }
  return payload as SaveLedgerResponse;
}

export interface PerformanceBand {
  band: string;
  range: string;
  n: number;
  won: number;
  lost: number;
  pushes: number;
  hitRate: number | null;
  netUnits: number;
  priced: number;
}

export interface PerformanceSummary {
  storage: { backend: string; durable: boolean };
  generatedAt: string;
  overall: {
    graded: number; wins: number; losses: number; pushes: number;
    winRate: number | null; roiPct: number | null; units: number | null;
    brierScore: number | null; priced: number;
  };
  last7: { graded: number; winRate: number | null; roiPct: number | null };
  last30: { graded: number; winRate: number | null; roiPct: number | null };
  bySport: Array<{ sport: string; graded: number; winRate: number | null; roiPct: number | null }>;
  byMarket: Array<{ market: string; graded: number; winRate: number | null; roiPct: number | null }>;
  byConfidence: PerformanceBand[];
  models: Array<{ model: string; graded: number; winRate: number | null; roiPct: number | null }>;
  recent: Array<{
    predictionId: string; sport: string; matchup: string; betType: string;
    gradedAt: string | null; outcome: string; selection: string;
  }>;
  learning: unknown | null;
}

export interface SportInfo {
  code: string;
  name: string;
  status: 'live' | 'planned';
  supportedMarkets: string[];
  inputs: string[];
  playerProps: boolean;
}

export async function fetchPerformance(): Promise<{ performance: PerformanceSummary; sports: SportInfo[] }> {
  const res = await fetch(`${import.meta.env.BASE_URL}api/predictions/performance`, {
    headers: { Accept: 'application/json', ...customerHeaders() },
  });
  if (!res.ok) throw new Error(`Performance data unavailable (HTTP ${res.status})`);
  const payload = (await res.json()) as { performance: PerformanceSummary; sports: SportInfo[] };
  return payload;
}

export async function fetchSports(): Promise<SportInfo[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}api/sports`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Sports registry unavailable (HTTP ${res.status})`);
  const payload = (await res.json()) as { sports: SportInfo[] };
  return payload.sports;
}

export interface CalibrationBucket {
  bucket: string;
  predictedProbMin: number;
  predictedProbMax: number;
  sampleSize: number;
  winRate: number;
  avgModelProb: number;
  calibrationError: number;
  brierScore: number;
  roi: number;
  clvBeatRate: number;
  avgClvPercent: number;
}

/** Mirrors server/src/lib/clvTracker.ts SportMarketCalibration (GET /api/calibration rows). */
export interface SportMarketCalibration {
  sport: string;
  market: string;
  buckets: CalibrationBucket[];
  overall: {
    totalSample: number;
    overallWinRate: number;
    overallBrier: number;
    overallRoi: number;
    overallClvBeatRate: number;
    avgCalibrationError: number;
    /** Not currently emitted by the server; the dashboard renders an em-dash when absent. */
    overallAvgClvPercent?: number | null;
  };
}

export interface CalibrationResponse {
  success: boolean;
  calibration: SportMarketCalibration[];
}

/** GET /api/calibration — model calibration report, optionally filtered by sport. */
export async function fetchCalibration(sport?: string): Promise<CalibrationResponse> {
  const params = sport ? `?sport=${encodeURIComponent(sport)}` : '';
  const res = await fetch(`${import.meta.env.BASE_URL}api/calibration${params}`, {
    headers: { Accept: 'application/json', ...customerHeaders() },
  });
  const payload = (await res.json().catch(() => null)) as
    | (Partial<CalibrationResponse> & { error?: string })
    | null;
  if (!res.ok || !payload || !Array.isArray(payload.calibration)) {
    throw new Error(payload?.error || `Calibration data unavailable (HTTP ${res.status})`);
  }
  return payload as CalibrationResponse;
}
