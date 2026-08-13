// OpenAI-compatible LLM chat client (raw fetch; Node 22 has fetch).
// Provider selection: GEMINI_API_KEY -> generativelanguage.googleapis.com/v1beta/openai
// else OPENAI_API_KEY -> api.openai.com/v1. Neither set -> llmConfigured=false.
// Supports streaming content deltas AND streaming tool_calls (accumulated per
// index, partial JSON fragments concatenated). The tool-calling loop executes
// registered tools and re-calls the model, max 5 iterations.

import { executeTool } from './toolRegistry.js';

export interface LlmConfig {
  configured: boolean;
  provider: string;
  model: string;
  baseUrl: string;
}

export function llmConfig(): LlmConfig {
  if (process.env.GEMINI_API_KEY) {
    return {
      configured: true,
      provider: 'gemini',
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      configured: true,
      provider: 'openai',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
    };
  }
  return { configured: false, provider: 'none', model: '', baseUrl: '' };
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
  index: number;
  id?: string;
  name?: string;
  arguments?: string;
}

export interface OneShotResult {
  content: string;
  toolCalls: Array<{ index: number; id: string; name: string; arguments: string; parsed: any }>;
}

interface StreamCallbacks {
  onDelta?: (text: string) => void;
  onToolDelta?: (tc: ToolCallFragment) => void;
  signal?: AbortSignal;
}

/** One streaming chat completion. Accumulates content + tool_calls. */
export async function streamChatOnce(
  cfg: LlmConfig,
  messages: ChatMessage[],
  tools: ToolSchema[],
  cb: StreamCallbacks = {}
): Promise<OneShotResult> {
  const url = `${cfg.baseUrl}/chat/completions`;
  const apiKey = cfg.provider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      tools,
      temperature: 0.6,
      stream: true,
    }),
    signal: cb.signal ?? AbortSignal.timeout(120000),
  });
  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '');
    throw new Error(`LLM HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let content = '';
  const toolCalls = new Map<number, ToolCallFragment>();
  let sawKey = false;

  const flushToolCall = (idx: number): ToolCallFragment => {
    const tc = toolCalls.get(idx) ?? { index: idx, id: '', name: '', arguments: '' };
    toolCalls.set(idx, tc);
    return tc;
  };

  const mergeToolFragment = (frag: ToolCallFragment) => {
    sawKey = true;
    const cur = flushToolCall(frag.index);
    if (frag.id) cur.id = frag.id;
    if (frag.name) cur.name = frag.name;
    if (frag.arguments) cur.arguments = (cur.arguments ?? '') + frag.arguments;
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
      // OpenAI streams tool_calls as {index, id, function:{name, arguments}} fragments
      const tcFrags: any[] = delta.tool_calls ?? json?.choices?.[0]?.message?.tool_calls ?? [];
      for (const f of tcFrags) {
        const idx = f.index ?? 0;
        const name = f.function?.name;
        const args = f.function?.arguments;
        const id = f.id;
        if (name === undefined && args === undefined && id === undefined) continue;
        mergeToolFragment({ index: idx, id, name, arguments: args });
      }
    }
    if (buf.includes('[DONE]')) break;
  }

  if (!sawKey) {
    throw new Error(
      'LLM stream produced no content or tool calls (empty response from provider)'
    );
  }

  const calls = [...toolCalls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, tc]) => {
      let parsed: any = null;
      try {
        parsed = tc.arguments ? JSON.parse(tc.arguments) : {};
      } catch {
        parsed = null;
      }
      return { index, id: tc.id ?? `call_${index}`, name: tc.name ?? '', arguments: tc.arguments ?? '', parsed };
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
