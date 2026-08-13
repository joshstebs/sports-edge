export interface HealthInfo {
  ok: boolean;
  llmConfigured?: boolean;
  llmProvider?: string | null;
  sources?: Record<string, unknown>;
  version?: string;
}

/** GET /api/health — drives the "Live data" dot in the header. */
export async function fetchHealth(): Promise<HealthInfo> {
  const res = await fetch('/api/health', { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Health check returned HTTP ${res.status}`);
  }
  return (await res.json()) as HealthInfo;
}
