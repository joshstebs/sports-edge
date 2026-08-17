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
  try {
    collectSources(JSON.parse(outcome.json), sources);
  } catch {
    // The registry normally returns JSON. Evidence extraction must never make a
    // successful provider result fail if an adapter returns plain text.
  }
  return {
    sources: [...sources].sort(),
    fetchedAt: now.toISOString(),
    latencyMs: Math.max(0, Math.round(latencyMs)),
    quality: !outcome.ok ? 'unavailable' : sources.size ? 'verified-live' : 'available-unlabeled',
  };
}

function addEvidence(value: unknown, evidence: ToolEvidence): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>), _evidence: evidence };
  }
  return { value, _evidence: evidence };
}

function enrichExecution(outcome: ToolExecution, evidence: ToolEvidence): ToolExecution {
  let payload: unknown;
  try {
    payload = JSON.parse(outcome.json);
  } catch {
    payload = outcome.json;
  }
  const sourceLabel = evidence.sources.length ? evidence.sources.join(', ') : 'source unlabeled';
  return {
    ...outcome,
    summary: `${outcome.summary} · ${sourceLabel} · ${evidence.latencyMs}ms`,
    data: addEvidence(outcome.data, evidence),
    json: JSON.stringify(addEvidence(payload, evidence)),
  };
}

/**
 * Execute every tool call emitted in one model turn concurrently.
 *
 * Calls in a single tool-call turn are independent by definition: a call that
 * depends on another call's output can only be emitted by the model in the next
 * turn. Promise.all therefore removes avoidable provider latency without
 * changing the agent's reasoning semantics. Results are returned in the model's
 * original call order so tool_call_id history remains deterministic.
 */
export async function executeToolBatch(
  calls: BatchToolCall[],
  options: {
    execute?: ToolExecutor;
    onEvent?: (event: BatchToolEvent) => void;
  } = {},
): Promise<BatchToolResult[]> {
  const executor = options.execute ?? executeTool;
  for (const call of calls) options.onEvent?.({ name: call.name, status: 'running' });

  return Promise.all(calls.map(async (call) => {
    const started = Date.now();
    let outcome: ToolExecution;
    try {
      outcome = await executor(call.name, call.parsed ?? {});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outcome = {
        ok: false,
        summary: `${call.name} crashed: ${message}`,
        data: null,
        json: JSON.stringify({ available: false, reason: `tool crashed: ${message}` }),
      };
    }

    const evidence = evidenceForExecution(outcome, Date.now() - started);
    const enriched = enrichExecution(outcome, evidence);
    options.onEvent?.({
      name: call.name,
      status: enriched.ok ? 'done' : 'error',
      summary: enriched.summary,
      data: enriched.data,
    });
    return { call, outcome: enriched, evidence };
  }));
}
