import { executeTool, type ToolExecution } from './toolRegistry.js';

export interface BatchToolCall {
  id: string;
  name: string;
  parsed?: unknown;
}

export interface ToolEvidence {
  sources: string[];
  fetchedAt: string;
  latencyMs: number;
  quality: 'verified-live' | 'available-unlabeled' | 'unavailable';
}

export interface BatchToolResult {
  call: BatchToolCall;
  outcome: ToolExecution;
  evidence: ToolEvidence;
}

export interface BatchToolEvent {
  name: string;
  status: 'running' | 'done' | 'error';
  summary?: string;
  data?: unknown;
}

type ToolExecutor = (name: string, args: unknown) => Promise<ToolExecution>;

function collectSources(value: unknown, output: Set<string>, depth = 0): void {
  if (value == null || depth > 4) return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 50)) collectSources(item, output, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;

  const object = value as Record<string, unknown>;
  const direct = object.source;
  if (typeof direct === 'string' && direct.trim()) output.add(direct.trim());
  if (Array.isArray(direct)) {
    for (const source of direct) if (typeof source === 'string' && source.trim()) output.add(source.trim());
  }

  const sources = object.sources;
  if (Array.isArray(sources)) {
    for (const source of sources) if (typeof source === 'string' && source.trim()) output.add(source.trim());
  } else if (sources && typeof sources === 'object') {
    for (const [source, enabled] of Object.entries(sources as Record<string, unknown>)) {
      if (enabled !== false && enabled != null) output.add(source);
    }
  }

  for (const [key, nested] of Object.entries(object)) {
    if (key === 'source' || key === 'sources' || key === '_evidence') continue;
    collectSources(nested, output, depth + 1);
  }
}

export function evidenceForExecution(outcome: ToolExecution, latencyMs: number, now = new Date()): ToolEvidence {
  const sources = new Set<string>();
  collectSources(outcome.data, sources);
  try { collectSources(JSON.parse(outcome.json), sources); } catch {}
  return {
    sources: [...sources].sort(),
    fetchedAt: now.toISOString(),
    latencyMs: Math.max(0, Math.round(latencyMs)),
    quality: !outcome.ok ? 'unavailable' : sources.size ? 'verified-live' : 'available-unlabeled',
  };
}

function addEvidence(value: unknown, evidence: ToolEvidence): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) return { ...(value as Record<string, unknown>), _evidence: evidence };
  return { value, _evidence: evidence };
}

function enrichExecution(outcome: ToolExecution, evidence: ToolEvidence): ToolExecution {
  let payload: unknown;
  try { payload = JSON.parse(outcome.json); } catch { payload = outcome.json; }
  const sourceLabel = evidence.sources.length ? evidence.sources.join(', ') : 'source unlabeled';
  return {
    ...outcome,
    summary: `${outcome.summary} · ${sourceLabel} · ${evidence.latencyMs}ms`,
    data: addEvidence(outcome.data, evidence),
    json: JSON.stringify(addEvidence(payload, evidence)),
  };
}

function timeoutExecution(name: string, timeoutMs: number): ToolExecution {
  const seconds = Math.round(timeoutMs / 1000);
  return {
    ok: false,
    summary: `${name} timed out after ${seconds}s; continuing with remaining data`,
    data: { available: false, reason: `tool timeout after ${seconds}s` },
    json: JSON.stringify({ available: false, reason: `tool timeout after ${seconds}s` }),
  };
}

export async function executeToolBatch(
  calls: BatchToolCall[],
  options: {
    execute?: ToolExecutor;
    onEvent?: (event: BatchToolEvent) => void;
    timeoutMs?: number;
  } = {},
): Promise<BatchToolResult[]> {
  const executor = options.execute ?? executeTool;
  const requestedTimeout = Math.max(1_000, options.timeoutMs ?? 5_000);
  // Slate discovery legitimately performs several parallel roster/history reads.
  // Give only that batch a window near the agent deadline (but leave headroom
  // for synthesis). The screener is concurrency-limited + pool-capped so it
  // finishes well inside this budget. Previously capped at 6.5s, which
  // guaranteed timeouts on every slate request.
  const timeoutMs = calls.some((call) => call.name === 'slate_candidate_screener')
    ? Math.min(52_000, Math.max(20_000, requestedTimeout))
    : requestedTimeout;
  for (const call of calls) options.onEvent?.({ name: call.name, status: 'running' });

  return Promise.all(calls.map(async (call) => {
    const started = Date.now();
    let outcome: ToolExecution;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      outcome = await Promise.race([
        executor(call.name, call.parsed ?? {}),
        new Promise<ToolExecution>((resolve) => {
          timer = setTimeout(() => resolve(timeoutExecution(call.name, timeoutMs)), timeoutMs);
        }),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outcome = {
        ok: false,
        summary: `${call.name} crashed: ${message}`,
        data: null,
        json: JSON.stringify({ available: false, reason: `tool crashed: ${message}` }),
      };
    } finally {
      if (timer) clearTimeout(timer);
    }

    const evidence = evidenceForExecution(outcome, Date.now() - started);
    const enriched = enrichExecution(outcome, evidence);
    options.onEvent?.({ name: call.name, status: enriched.ok ? 'done' : 'error', summary: enriched.summary, data: enriched.data });
    return { call, outcome: enriched, evidence };
  }));
}
