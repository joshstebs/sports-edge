export interface HealthInfo {
  ok: boolean;
  llmConfigured?: boolean;
  llmProvider?: string | null;
  sources?: Record<string, unknown>;
  version?: string;
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
    headers: { Accept: 'application/json' },
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
