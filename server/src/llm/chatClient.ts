// OpenAI-compatible LLM chat client (raw fetch; Node 22 has fetch).
// Provider selection: GEMINI_API_KEY -> generativelanguage.googleapis.com/v1beta/openai
// else OPENAI_API_KEY -> api.openai.com/v1. Neither set -> llmConfigured=false.
// Supports streaming content deltas AND streaming tool_calls (accumulated per
// index, partial JSON fragments concatenated). Tool calls emitted in one model
// turn execute concurrently, then the model receives results in original order.

import { executeToolBatch } from './toolBatch.js';

export interface LlmConfig {
  configured: boolean;
  provider: string;
  model: string;
  models: string[];
  baseUrl: string;
  fallback?: LlmConfig;
}

export function llmConfig(): LlmConfig {
  const geminiKey = process.env.GEMINI_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiModels = [
    process.env.GEMINI_MODEL || 'gemini-3.5-flash',
    'gemini-flash-lite-latest',
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash-lite',
  ].filter((m, i, a) => a.indexOf(m) === i);
  const openrouterModels = [
    process.env.OPENROUTER_MODEL || 'openai/gpt-oss-20b:free',
    'nvidia/nemotron-3.5-lightning:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
  ].filter((m, i, a) => a.indexOf(m) === i);
  const openaiModels = [process.env.OPENAI_MODEL || 'gpt-4o-mini'];

  const providers: LlmConfig[] = [];
  if (geminiKey) providers.push({ configured: true, provider: 'gemini', model: geminiModels[0], models: geminiModels, baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' });
  if (openrouterKey) providers.push({ configured: true, provider: 'openrouter', model: openrouterModels[0], models: openrouterModels, baseUrl: 'https://openrouter.ai/api/v1' });
  if (openaiKey) providers.push({ configured: true, provider: 'openai', model: openaiModels[0], models: openaiModels, baseUrl: 'https://api.openai.com/v1' });
  for (let index = 0; index < providers.length - 1; index++) providers[index].fallback = providers[index + 1];
  if (providers.length) return providers[0];
  return { configured: false, provider: 'none', model: '', models: [], baseUrl: '' };
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content?: string | null | Array<{ type: string; [k: string]: unknown }>;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface ToolSchema {
  type: 'function';
  function: { name: string; description: string; parameters: any };
}

export interface ToolCallFragment {
  key?: string;
  index: number;
  id?: string;
  name?: string;
  arguments?: string;
  extra_content?: any;
}

export interface OneShotResult {
  content: string;
  modelUsed?: string;
  toolCalls: Array<{ index: number; id: string; name: string; arguments: string; parsed: any; extra_content?: any | null }>;
}

interface StreamCallbacks {
  onDelta?: (text: string) => void;
  onToolDelta?: (tc: ToolCallFragment) => void;
  signal?: AbortSignal;
}

const MODEL_TURN_TIMEOUT_MS = 8_000;
const CLOSER_TIMEOUT_MS = 7_000;
const MAX_TOOL_ROUNDS = 1;

function boundedSignal(parent: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

export async function streamChatOnce(
  cfg: LlmConfig,
  messages: ChatMessage[],
  tools: ToolSchema[],
  cb: StreamCallbacks = {}
): Promise<OneShotResult> {
  const providers: LlmConfig[] = [];
  const seen = new Set<LlmConfig>();
  for (let current: LlmConfig | undefined = cfg; current && !seen.has(current); current = current.fallback) {
    seen.add(current);
    providers.push(current);
  }
  const errors: string[] = [];

  for (const pc of providers) {
    for (const model of pc.models) {
      if (cb.signal?.aborted) throw new DOMException('Agent turn deadline exceeded', 'AbortError');
      const attempt = await tryModel(pc, model, messages, tools, cb);
      if (attempt.ok && attempt.result) return attempt.result;
      errors.push(`${pc.provider}/${model}: ${attempt.error}`);
    }
  }
  throw new Error(`All LLM providers failed: ${errors.join(' | ')}`);
}

interface TryResult { ok: boolean; result?: OneShotResult; error?: string; }

async function tryModel(
  pc: LlmConfig,
  model: string,
  messages: ChatMessage[],
  tools: ToolSchema[],
  cb: StreamCallbacks
): Promise<TryResult> {
  const url = `${pc.baseUrl}/chat/completions`;
  const apiKey = pc.provider === 'gemini' ? process.env.GEMINI_API_KEY : pc.provider === 'openrouter' ? process.env.OPENROUTER_API_KEY : process.env.OPENAI_API_KEY;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, tools, temperature: 0.6, stream: true }),
        signal: cb.signal ?? AbortSignal.timeout(MODEL_TURN_TIMEOUT_MS),
      });

      if (res.status === 429 && attempt === 0) {
        const retryAfter = Number(res.headers.get('retry-after')) || 0;
        await res.body?.cancel().catch(() => {});
        const wait = Math.min(retryAfter > 0 ? retryAfter : 1, 2);
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, wait * 1000);
          cb.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Agent turn deadline exceeded', 'AbortError')); }, { once: true });
        });
        continue;
      }
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => '');
        return { ok: false, error: `HTTP ${res.status}: ${errText.slice(0, 300)}` };
      }
      const result = await readStream(res, cb);
      result.modelUsed = model;
      return { ok: true, result };
    } catch (e) {
      const err = e as Error;
      if (err.name === 'AbortError' && cb.signal?.aborted) throw err;
      return { ok: false, error: err.message.slice(0, 200) };
    }
  }
  return { ok: false, error: 'HTTP 429 after retry' };
}

async function readStream(res: Response, cb: StreamCallbacks): Promise<OneShotResult> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let content = '';
  const toolCalls = new Map<string, ToolCallFragment>();
  const keyByIndex = new Map<number, string>();
  let sawKey = false;

  const flushToolCall = (idx: number, id?: string): ToolCallFragment => {
    let key = id ?? keyByIndex.get(idx);
    if (!key) { key = `idx-${idx}`; keyByIndex.set(idx, key); }
    let tc = toolCalls.get(key);
    if (!tc) {
      tc = { key, index: idx, id: id ?? '', name: '', arguments: '' };
      toolCalls.set(key, tc);
      if (id) keyByIndex.set(idx, key);
    }
    return tc;
  };

  const mergeToolFragment = (frag: ToolCallFragment) => {
    sawKey = true;
    const cur = flushToolCall(frag.index ?? 0, frag.id);
    if (frag.id) { cur.id = frag.id; keyByIndex.set(frag.index ?? 0, cur.key!); }
    if (frag.name) cur.name = frag.name;
    if (frag.arguments) cur.arguments = (cur.arguments ?? '') + frag.arguments;
    if (frag.extra_content) cur.extra_content = frag.extra_content;
    cb.onToolDelta?.(frag);
  };

  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') break;
      let json: any;
      try { json = JSON.parse(payload); } catch { continue; }
      const delta = json?.choices?.[0]?.delta;
      if (!delta) continue;
      if (typeof delta.content === 'string') { sawKey = true; content += delta.content; cb.onDelta?.(delta.content); }
      const tcFrags: any[] = delta.tool_calls ?? json?.choices?.[0]?.message?.tool_calls ?? [];
      for (const f of tcFrags) {
        const idx = f.index ?? 0;
        const name = f.function?.name;
        const args = f.function?.arguments;
        const id = f.id;
        const extra = f.extra_content;
        if (name === undefined && args === undefined && id === undefined && extra === undefined) continue;
        mergeToolFragment({ index: idx, id, name, arguments: args, extra_content: extra });
      }
    }
    if (buf.includes('[DONE]')) break;
  }

  if (!sawKey) throw new Error('LLM stream produced no content or tool calls (empty response from provider)');
  const calls = [...toolCalls.values()].map((tc) => {
    let parsed: any = null;
    try { parsed = tc.arguments ? JSON.parse(tc.arguments) : {}; } catch { parsed = null; }
    return { index: tc.index ?? 0, id: tc.id ?? `call_${tc.index ?? 0}`, name: tc.name ?? '', arguments: tc.arguments ?? '', parsed, extra_content: tc.extra_content ?? null };
  }).filter((c) => c.name);
  return { content, toolCalls: calls };
}

export interface ToolEvent { name: string; status: 'running' | 'done' | 'error'; summary?: string; data?: any; }
export interface AgentCallbacks { onDelta?: (text: string) => void; onToolEvent?: (ev: ToolEvent) => void; signal?: AbortSignal; }

export async function runAgent(
  cfg: LlmConfig,
  messages: ChatMessage[],
  tools: ToolSchema[],
  cb: AgentCallbacks = {}
): Promise<{ content: string; iterations: number; modelUsed: string | null }> {
  const msgs: ChatMessage[] = [...messages];
  const liteFirst = ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
  const researchCfg: LlmConfig = { ...cfg, models: [...liteFirst, ...cfg.models.filter((m) => !liteFirst.includes(m))] };
  let finalText = '';
  let iterations = 0;
  let modelUsed: string | null = null;
  let endedWithTools = false;

  // The route has a 52s hard deadline. Reserve time for final synthesis instead
  // of allowing 120s model turns that can never finish in production.
  for (; iterations < MAX_TOOL_ROUNDS; iterations++) {
    let turnText = '';
    const resp = await streamChatOnce(researchCfg, msgs, tools, {
      onDelta: (d) => { turnText += d; },
      signal: boundedSignal(cb.signal, MODEL_TURN_TIMEOUT_MS),
    });
    if (resp.modelUsed) modelUsed = resp.modelUsed;
    finalText = resp.content;

    if (!resp.toolCalls.length) {
      endedWithTools = false;
      if (turnText) cb.onDelta?.(turnText);
      break;
    }
    endedWithTools = true;
    msgs.push({
      role: 'assistant',
      content: resp.content || null,
      tool_calls: resp.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments || '{}' }, ...(tc.extra_content ? { extra_content: tc.extra_content } : {}) })),
    });

    const results = await executeToolBatch(
      resp.toolCalls.map((tc) => ({ id: tc.id, name: tc.name, parsed: tc.parsed ?? {} })),
      {
        // The slate screener legitimately needs more than the default 5s budget
        // (it fans out ~12 players x 2 Stats API calls in parallel, ~20s). Let
        // executeToolBatch's screener-aware clamp raise the window.
        timeoutMs: resp.toolCalls.some((tc) => tc.name === 'slate_candidate_screener') ? 45_000 : 5_000,
        onEvent: (event) => cb.onToolEvent?.({ name: event.name, status: event.status, summary: event.summary, data: event.data }),
      },
    );
    for (const result of results) msgs.push({ role: 'tool', tool_call_id: result.call.id, content: result.outcome.json });
  }

  if (endedWithTools || !finalText) {
    const closer = await streamChatOnce(
      cfg,
      [...msgs, { role: 'user', content: 'Wrap up now. Use the completed tool results only; do not call more tools. Return the strongest valid picks you have, including the requested count when the evidence supports it. Include the ```sgp block and [PREDICTION_LOG] for final-eligible picks. If a provider timed out, skip only that missing input rather than failing the whole answer.' }],
      [],
      { onDelta: cb.onDelta, signal: boundedSignal(cb.signal, CLOSER_TIMEOUT_MS) },
    );
    if (closer.content) finalText = closer.content;
    if (closer.modelUsed) modelUsed = closer.modelUsed;
  }

  return { content: finalText, iterations: iterations + 1, modelUsed };
}
