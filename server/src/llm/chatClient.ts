// OpenAI-compatible LLM chat client (raw fetch; Node 22 has fetch).
// Provider selection: GEMINI_API_KEY -> generativelanguage.googleapis.com/v1beta/openai
// else OPENAI_API_KEY -> api.openai.com/v1. Neither set -> llmConfigured=false.
// Supports streaming content deltas AND streaming tool_calls (accumulated per
// index, partial JSON fragments concatenated). The tool-calling loop executes
// registered tools and re-calls the model, max 5 iterations.

import { executeTool } from './toolRegistry.js';
import fs from 'node:fs';
import path from 'node:path';

export interface LlmConfig {
  configured: boolean;
  provider: string;
  model: string; // default/display model
  models: string[]; // chain tried in order — per-model quota buckets make rotation the fix for 429s
  baseUrl: string;
  fallback?: LlmConfig; // secondary provider (e.g. OpenAI) tried after the primary chain
}

export function llmConfig(): LlmConfig {
  const geminiKey = process.env.GEMINI_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  // NOTE: 2.5-era models are LISTED in the models endpoint but 404 for new
  // keys ("no longer available to new users") — only 3.x/current-gen work.
  const geminiModels = [
    process.env.GEMINI_MODEL || 'gemini-3.5-flash',
    'gemini-flash-latest',
    'gemini-3.1-flash-lite',
  ].filter((m, i, a) => a.indexOf(m) === i);
  const openrouterModels = [process.env.OPENROUTER_MODEL || 'openai/gpt-oss-20b:free'];
  const openaiModels = [process.env.OPENAI_MODEL || 'gpt-4o-mini'];

  const fallbacks: LlmConfig[] = [];
  if (openrouterKey) {
    fallbacks.push({
      configured: true,
      provider: 'openrouter',
      model: openrouterModels[0],
      models: openrouterModels,
      baseUrl: 'https://openrouter.ai/api/v1',
    });
  }
  if (openaiKey) {
    fallbacks.push({
      configured: true,
      provider: 'openai',
      model: openaiModels[0],
      models: openaiModels,
      baseUrl: 'https://api.openai.com/v1',
    });
  }
  const withFallback = (cfg: LlmConfig): LlmConfig => {
    if (fallbacks.length) cfg.fallback = fallbacks[0];
    for (let i = 1; i < fallbacks.length; i++) {
      let cur = cfg.fallback;
      while (cur?.fallback) cur = cur.fallback;
      if (cur) cur.fallback = fallbacks[i];
    }
    return cfg;
  };

  if (geminiKey) {
    return withFallback({
      configured: true,
      provider: 'gemini',
      model: geminiModels[0],
      models: geminiModels,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    });
  }
  if (openrouterKey) {
    return withFallback({
      configured: true,
      provider: 'openrouter',
      model: openrouterModels[0],
      models: openrouterModels,
      baseUrl: 'https://openrouter.ai/api/v1',
    });
  }
  if (openaiKey) {
    return withFallback({
      configured: true,
      provider: 'openai',
      model: openaiModels[0],
      models: openaiModels,
      baseUrl: 'https://api.openai.com/v1',
    });
  }
  return { configured: false, provider: 'none', model: '', models: [], baseUrl: '' };
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content?: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface ToolSchema {
  type: 'function';
  function: { name: string; description: string; parameters: any };
}

export interface ToolCallFragment {
  key?: string; // internal map key (id or idx-N)
  index: number;
  id?: string;
  name?: string;
  arguments?: string;
  extra_content?: any; // Gemini 3.x: thought_signature lives here; MUST be echoed back
}

export interface OneShotResult {
  content: string;
  modelUsed?: string;
  toolCalls: Array<{
    index: number;
    id: string;
    name: string;
    arguments: string;
    parsed: any;
    extra_content?: any | null;
  }>;
}

interface StreamCallbacks {
  onDelta?: (text: string) => void;
  onToolDelta?: (tc: ToolCallFragment) => void;
  signal?: AbortSignal;
}

/** One streaming chat completion with model-chain fallback.
 * Tries cfg.models in order (Gemini free tier quotas are PER-MODEL, so a 429
 * on one model is fixed by rotating), then cfg.fallback provider if present. */
export async function streamChatOnce(
  cfg: LlmConfig,
  messages: ChatMessage[],
  tools: ToolSchema[],
  cb: StreamCallbacks = {}
): Promise<OneShotResult> {
  const providers = [cfg, ...(cfg.fallback ? [cfg.fallback] : [])];
  const errors: string[] = [];

  for (const pc of providers) {
    for (const model of pc.models) {
      const attempt = await tryModel(pc, model, messages, tools, cb);
      if (attempt.ok && attempt.result) return attempt.result;
      errors.push(`${pc.provider}/${model}: ${attempt.error}`);
    }
  }

  throw new Error(`All LLM providers failed: ${errors.join(' | ')}`);
}

interface TryResult {
  ok: boolean;
  result?: OneShotResult;
  error?: string;
}

async function tryModel(
  pc: LlmConfig,
  model: string,
  messages: ChatMessage[],
  tools: ToolSchema[],
  cb: StreamCallbacks
): Promise<TryResult> {
  const url = `${pc.baseUrl}/chat/completions`;
  const apiKey =
    pc.provider === 'gemini'
      ? process.env.GEMINI_API_KEY
      : pc.provider === 'openrouter'
        ? process.env.OPENROUTER_API_KEY
        : process.env.OPENAI_API_KEY;

  // One quick 429 retry with backoff (respect Retry-After up to 20s), then move on.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          tools,
          temperature: 0.6,
          stream: true,
        }),
        signal: cb.signal ?? AbortSignal.timeout(120000),
      });

      if (res.status === 429 && attempt === 0) {
        const retryAfter = Number(res.headers.get('retry-after')) || 0;
        await res.body?.cancel().catch(() => {});
        const wait = Math.min(retryAfter > 0 ? retryAfter : 8, 20);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => '');
        if (res.status === 400) {
          try {
            fs.writeFileSync(
              path.join(process.cwd(), 'data', `debug-400-${Date.now()}.json`),
              JSON.stringify({ model, status: res.status, error: errText.slice(0, 500), messages }, null, 1),
              'utf8'
            );
          } catch { /* debug dump is best-effort */ }
        }
        return { ok: false, error: `HTTP ${res.status}: ${errText.slice(0, 300)}` };
      }
      const result = await readStream(res, cb);
      result.modelUsed = model;
      return { ok: true, result };
    } catch (e) {
      const err = e as Error;
      if (err.name === 'AbortError' && cb.signal?.aborted) throw err; // client left — don't fall through
      return { ok: false, error: err.message.slice(0, 200) };
    }
  }
  return { ok: false, error: 'HTTP 429 after retry' };
}

async function readStream(
  res: Response,
  cb: StreamCallbacks
): Promise<OneShotResult> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let content = '';
  // Keyed by tool-call id when present (Gemini omits `index`, so keying by
  // index would merge multiple calls in one turn). OpenAI sends id only on the
  // first fragment — subsequent fragments fall back to the last key for their index.
  const toolCalls = new Map<string, ToolCallFragment>();
  const keyByIndex = new Map<number, string>();
  let sawKey = false;

  const flushToolCall = (idx: number, id?: string): ToolCallFragment => {
    let key = id ?? keyByIndex.get(idx);
    if (!key) {
      key = `idx-${idx}`;
      keyByIndex.set(idx, key);
    }
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
    if (frag.id) {
      cur.id = frag.id;
      keyByIndex.set(frag.index ?? 0, cur.key!);
    }
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
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }
      const delta = json?.choices?.[0]?.delta;
      if (!delta) continue;
      if (typeof delta.content === 'string') {
        sawKey = true;
        content += delta.content;
        cb.onDelta?.(delta.content);
      }
      // OpenAI streams tool_calls as {index, id, function:{name, arguments}} fragments;
      // Gemini 3.x also carries extra_content.google.thought_signature per call.
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

  if (!sawKey) {
    throw new Error(
      'LLM stream produced no content or tool calls (empty response from provider)'
    );
  }

  const calls = [...toolCalls.values()]
    .map((tc) => {
      let parsed: any = null;
      try {
        parsed = tc.arguments ? JSON.parse(tc.arguments) : {};
      } catch {
        parsed = null;
      }
      return {
        index: tc.index ?? 0,
        id: tc.id ?? `call_${tc.index ?? 0}`,
        name: tc.name ?? '',
        arguments: tc.arguments ?? '',
        parsed,
        extra_content: tc.extra_content ?? null,
      };
    })
    .filter((c) => c.name);

  return { content, toolCalls: calls };
}

export interface ToolEvent {
  name: string;
  status: 'running' | 'done' | 'error';
  summary?: string;
  data?: any;
}

export interface AgentCallbacks {
  onDelta?: (text: string) => void;
  onToolEvent?: (ev: ToolEvent) => void;
  signal?: AbortSignal;
}

/** Full tool-calling loop: stream -> execute tools -> re-call, max 5 iterations. */
export async function runAgent(
  cfg: LlmConfig,
  messages: ChatMessage[],
  tools: ToolSchema[],
  cb: AgentCallbacks = {}
): Promise<{ content: string; iterations: number }> {
  const msgs: ChatMessage[] = [...messages];
  let finalText = '';
  let iterations = 0;

  for (; iterations < 5; iterations++) {
    const resp = await streamChatOnce(cfg, msgs, tools, {
      onDelta: cb.onDelta,
      signal: cb.signal,
    });
    finalText = resp.content;

    if (!resp.toolCalls.length) break;

    // Record assistant turn with tool_calls (required by the API), then run tools.
    msgs.push({
      role: 'assistant',
      content: resp.content || null,
      tool_calls: resp.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments || '{}' },
        // Gemini 3.x requires the thought_signature roundtrip or the API 400s.
        ...(tc.extra_content ? { extra_content: tc.extra_content } : {}),
      })),
    });

    for (const tc of resp.toolCalls) {
      cb.onToolEvent?.({ name: tc.name, status: 'running' });
      let outcome: { ok: boolean; summary: string; data: any; json: string };
      try {
        outcome = await executeTool(tc.name, tc.parsed ?? {});
      } catch (e) {
        outcome = {
          ok: false,
          summary: `${tc.name} crashed: ${(e as Error).message}`,
          data: null,
          json: JSON.stringify({ available: false, reason: `tool crashed: ${(e as Error).message}` }),
        };
      }
      cb.onToolEvent?.({
        name: tc.name,
        status: outcome.ok ? 'done' : 'error',
        summary: outcome.summary,
        data: outcome.data,
      });
      msgs.push({ role: 'tool', tool_call_id: tc.id, content: outcome.json });
    }
  }

  return { content: finalText, iterations: iterations + 1 };
}
