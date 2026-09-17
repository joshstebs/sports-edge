// OpenAI-compatible LLM chat client (raw fetch; Node 22 has fetch).
// Routing: Groq GPT-OSS-120B -> Gemini 3.6 Flash (verified 2026-09-07).
// Supports streaming content deltas AND streaming tool_calls (accumulated per
// index, partial JSON fragments concatenated). Tool calls emitted in one model
// turn execute concurrently, then the model receives results in original order.

import { executeToolBatch } from './toolBatch.js';
import { renderScreenerSummaryBlocks } from './screenerRenderer.js';

export interface LlmConfig {
  configured: boolean;
  provider: string;
  model: string;
  models: string[];
  baseUrl: string;
  fallback?: LlmConfig;
}

export function llmConfig(): LlmConfig {
  // Only live-verified routes enter the chain. Credentials for retired providers
  // remain stored, but do not silently re-enable those providers.
  const providers: LlmConfig[] = [];
  if (process.env.GROQ_API_KEY) {
    const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
    providers.push({ configured: true, provider: 'groq', model, models: [model], baseUrl: 'https://api.groq.com/openai/v1' });
  }
  if (process.env.GEMINI_API_KEY) {
    const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
    providers.push({ configured: true, provider: 'gemini', model, models: [model], baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' });
  }
  if (providers.length > 1) providers[0].fallback = providers[1];
  return providers[0] ?? { configured: false, provider: 'none', model: '', models: [], baseUrl: '' };
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

const MODEL_TURN_TIMEOUT_MS = 14_000;
const CLOSER_TIMEOUT_MS = 12_000;
const MAX_TOOL_ROUNDS = 1;

function boundedSignal(parent: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

type ScreenerSide = 'over' | 'under';
interface ScreenerIntent {
  requestedPicks?: number;
  market?: string;
  side?: ScreenerSide;
  sport?: 'mlb' | 'nba' | 'nfl' | 'nhl';
  gameMarket?: 'moneyline';
  requestKind?: 'player_prop' | 'game_market' | 'mixed';
  sameGame?: boolean;
}

function clampRequestedPicks(value: number): number | undefined {
  return Number.isFinite(value) ? Math.min(10, Math.max(1, Math.round(value))) : undefined;
}

function inferRequestedPicks(text: string): number | undefined {
  const numberWords: Record<string, string> = {
    one: '1', two: '2', three: '3', four: '4', five: '5',
    six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  };
  const normalized = text.toLowerCase().replace(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/g,
    (word) => numberWords[word],
  );
  const range = normalized.match(/\b(\d{1,2})\s*(?:or|to|-|–|—)\s*(\d{1,2})\s+(?:good\s+)?(?:one|ones|pick|picks|prop|props|bet|bets|leg|legs|player|players)\b/i);
  if (range) return clampRequestedPicks(Math.max(Number(range[1]), Number(range[2])));
  const giveMe = normalized.match(/\b(?:give|show|find|send)\s+me\s+(\d{1,2})(?:\s*(?:or|to|-|–|—)\s*(\d{1,2}))?/i);
  if (giveMe) return clampRequestedPicks(Math.max(Number(giveMe[1]), Number(giveMe[2] ?? giveMe[1])));
  const sportQualified = normalized.match(/\b(\d{1,2})\s*(?:mlb|nfl|nba|nhl|baseball|football|basketball|hockey)\s+(?:pick|picks|prop|props|bet|bets|play|plays)\b/i);
  if (sportQualified) return clampRequestedPicks(Number(sportQualified[1]));
  const explicit = normalized.match(/\b(\d{1,2})\s*(?:leg|legs|pick|picks|player|players|prop|props|bet|bets|play|plays)\b/i);
  if (explicit) return clampRequestedPicks(Number(explicit[1]));
  return undefined;
}

export function inferScreenerIntent(text: string): ScreenerIntent {
  const lower = text.toLowerCase();
  const intent: ScreenerIntent = {};
  intent.requestedPicks = inferRequestedPicks(text);
  intent.sameGame = /\b(?:same[- ]?game|sgp)\b/i.test(text);

  const hasOver = /\bover(?:s)?\b/i.test(text);
  const hasUnder = /\bunder(?:s)?\b/i.test(text);
  if (hasOver !== hasUnder) intent.side = hasOver ? 'over' : 'under';

  const marketPatterns: Array<[RegExp, string, ScreenerIntent['sport']?]> = [
    [/\btotal\s*bases?\b/i, 'totalBases', 'mlb'],
    [/\b(?:batter\s+)?hits?\b/i, 'hits', 'mlb'],
    [/\b(?:pitcher\s+)?strikeouts?\b|\bks\b/i, 'strikeouts', 'mlb'],
    [/\bouts?\s*recorded\b/i, 'outsRecorded', 'mlb'],
    [/\brebounds?\b/i, 'rebounds', 'nba'],
    [/\bpassing\s*yards?\b/i, 'passingYards', 'nfl'],
    [/\bpassing\s*(?:touchdowns?|tds?)\b/i, 'passingTouchdowns', 'nfl'],
    [/\brushing\s*(?:\+|and)?\s*receiving\s*yards?\b/i, 'rushingReceivingYards', 'nfl'],
    [/\brushing\s*yards?\b/i, 'rushingYards', 'nfl'],
    [/\breceiving\s*yards?\b/i, 'receivingYards', 'nfl'],
    [/\breceptions?\b/i, 'receptions', 'nfl'],
    [/\b(?:anytime\s+)?touchdowns?\b|\btd\s*scorer\b/i, 'touchdowns', 'nfl'],
    [/\bshots?\s*(?:on\s*goal|sog)\b/i, 'shotsOnGoal', 'nhl'],
    [/\bhockey\s*points?\b/i, 'hockeyPoints', 'nhl'],
    [/\bgoalie\s*saves?\b|\bsaves?\b/i, 'saves', 'nhl'],
    [/\bpoints?\b/i, 'points', 'nba'],
  ];
  for (const [pattern, market, sport] of marketPatterns) {
    if (!pattern.test(text)) continue;
    intent.market = market;
    intent.requestKind = 'player_prop';
    if (sport) intent.sport = sport;
    break;
  }

  const explicitMoneyline = /\bmoney\s*line\b|\bmoneyline\b|\bh2h\b|(?:^|\s)ml(?:\s|$|s\b)/i.test(text);
  if (explicitMoneyline) {
    intent.gameMarket = 'moneyline';
    intent.requestKind = 'game_market';
    delete intent.market;
    delete intent.side;
  } else if (/\bprops?\b|\bplayer\s+(?:bet|bets|pick|picks)\b/i.test(text)) {
    intent.requestKind ??= 'player_prop';
  } else if (/\b(?:pick|picks|bet|bets|plays?|parlay)\b/i.test(text)) {
    intent.requestKind ??= 'mixed';
  }

  if (/\bmlb\b|\bbaseball\b/i.test(lower)) intent.sport = 'mlb';
  else if (/\bnba\b|\bbasketball\b/i.test(lower)) intent.sport = 'nba';
  else if (/\bnfl\b|\bfootball\b/i.test(lower)) intent.sport = 'nfl';
  else if (/\bnhl\b|\bhockey\b/i.test(lower)) intent.sport = 'nhl';

  return intent;
}

function inferConversationScreenerIntent(msgs: ChatMessage[]): ScreenerIntent {
  const userTexts = msgs
    .filter((m) => m.role === 'user' && typeof m.content === 'string')
    .map((m) => m.content as string);
  if (!userTexts.length) return {};
  const current = inferScreenerIntent(userTexts[userTexts.length - 1]);
  // Follow-ups like "give me 5 more" should keep the immediately preceding
  // market/side context. Only inherit from the last few user turns so an old,
  // unrelated betting request cannot leak into a new topic.
  for (let i = userTexts.length - 2; i >= Math.max(0, userTexts.length - 4); i--) {
    const prior = inferScreenerIntent(userTexts[i]);
    current.market ??= prior.market;
    current.side ??= prior.side;
    current.sport ??= prior.sport;
    current.gameMarket ??= prior.gameMarket;
    current.requestKind ??= prior.requestKind;
    current.sameGame ||= prior.sameGame;
    if (current.requestedPicks == null && /\b(more|other|another|different|additional|again)\b/i.test(userTexts[userTexts.length - 1])) {
      current.requestedPicks = prior.requestedPicks;
    }
  }
  return current;
}

function patchScreenerCall(
  call: OneShotResult['toolCalls'][number],
  intent: ScreenerIntent,
  wantsMore: boolean,
  priorNames: string[],
): OneShotResult['toolCalls'][number] {
  let parsed: any = {};
  try { parsed = JSON.parse(call.arguments || '{}'); } catch { parsed = {}; }
  if (intent.sport) parsed.sport = intent.sport;
  if (intent.requestedPicks != null) parsed.requestedPicks = intent.requestedPicks;
  if (intent.market) parsed.market = intent.market;
  if (intent.side) parsed.side = intent.side;
  if (intent.sameGame) parsed.sameGame = true;
  if (wantsMore && priorNames.length) {
    const already = new Set<string>([
      ...(Array.isArray(parsed.exclude) ? parsed.exclude.map(String) : []),
      ...String(parsed.exclude ?? '').split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean),
    ]);
    for (const name of priorNames) already.add(name.toLowerCase());
    parsed.exclude = [...already];
  }
  const argumentsJson = JSON.stringify(parsed);
  return { ...call, arguments: argumentsJson, parsed };
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
      // Silent fallback-chain failures were invisible in prod — log each dead
      // model so "All LLM providers failed" is never the first signal.
      console.warn(`[llm] ${pc.provider}/${model} failed: ${attempt.error}`);
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
  const apiKey = pc.provider === 'gemini' ? process.env.GEMINI_API_KEY : pc.provider === 'openrouter' ? process.env.OPENROUTER_API_KEY : pc.provider === 'opencode-go' ? process.env.OPENCODE_GO_API_KEY : pc.provider === 'opencode-zen' ? process.env.OPENCODE_ZEN_API_KEY : pc.provider === 'groq' ? process.env.GROQ_API_KEY : process.env.OPENAI_API_KEY;

  // x-opencode-session: OpenCode requires this header (mandatory from 2026-09-06 —
  // requests without it error). It pins one conversation to one upstream backend so
  // the provider's prompt cache stays warm. Value must be stable per conversation;
  // caller passes a conversation-scoped id via env-compatible session key.
  const extraHeaders: Record<string, string> = {};
  if (pc.provider === 'opencode-go' || pc.provider === 'opencode-zen') {
    const sessionKey = process.env.OPENCODE_SESSION_KEY || 'sportsedge-single-tenant';
    extraHeaders['x-opencode-session'] = `${sessionKey}-${new Date().toISOString().slice(0, 10)}`;
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, ...extraHeaders },
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
      // An empty-content response is not a usable answer (e.g. flash-lite
      // returning a blank completion). Treat it as a failure so the caller
      // falls through to the next model in the fallback chain instead of
      // emitting a blank recommendation.
      if (!result.content?.trim() && !result.toolCalls.length) {
        return { ok: false, error: `empty content from ${model}` };
      }
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
  // Hard ceiling on stream reads: a provider that stalls mid-stream without
  // closing used to hang the model turn until the route deadline ate the
  // whole budget. Abort reads slightly past MODEL_TURN_TIMEOUT_MS so the
  // fallback chain still gets a chance to run.
  const streamDeadlineMs = MODEL_TURN_TIMEOUT_MS + 2_000;
  const readerDeadline = AbortSignal.timeout(streamDeadlineMs);
  const deadlineError = () => new DOMException(`LLM stream read deadline exceeded (${streamDeadlineMs}ms)`, 'TimeoutError');
  const readWithDeadline = (): Promise<ReadableStreamReadResult<Uint8Array>> => {
    if (readerDeadline.aborted) return Promise.reject(deadlineError());
    return Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        readerDeadline.addEventListener('abort', () => reject(deadlineError()), { once: true })
      ),
    ]);
  };
  try {
    for (;;) {
      const { done, value } = await readWithDeadline();
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
  } catch (e) {
    await reader.cancel().catch(() => {});
    const err = e as Error;
    if (err.name === 'AbortError' && cb.signal?.aborted) throw e;
    console.warn(`[llm] stream read failed: ${err.name === 'TimeoutError' ? err.message : (err.message || err.name)}`);
    throw e;
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
  // Fast, cheap models for the optional research turn. These slugs are Gemini
  // family and only valid on the Gemini provider — VERIFIED LIVE 2026-08-30:
  // sending them to opencode-go returned 401 ModelError for all three, wasting
  // three network calls on every research turn before the real model answered.
  const geminiLite = ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
  const researchCfg: LlmConfig = cfg.provider === 'gemini'
    ? { ...cfg, models: [...geminiLite, ...cfg.models.filter((m) => !geminiLite.includes(m))] }
    : cfg;
  let finalText = '';
  let iterations = 0;
  let modelUsed: string | null = null;
  let endedWithTools = false;

  // The route has a 58s hard deadline (function maxDuration is 60s). Reserve
  // time for final synthesis instead of allowing long model turns that can
  // never finish in production.
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

    const lastUser = msgs.filter((m) => m.role === 'user' && typeof m.content === 'string').pop()?.content;
    const lastUserText = typeof lastUser === 'string' ? lastUser : '';
    const intent = inferConversationScreenerIntent(msgs);
    const wantsMore = /\b(more|other|another|different|else|additional|again)\b/i.test(lastUserText);
    const priorNames = extractPriorPickNames(msgs);
    const userAskedMultiPick = (intent.requestedPicks ?? 0) >= 3 || /\bparlay\b/i.test(lastUserText) || msgs.some(
      (m) => m.role === 'user' && typeof m.content === 'string' && /(\d+)\s*(?:leg|pick|player|parlay|prop|bet)/i.test(m.content),
    );

    let screenerCall = resp.toolCalls.find((tc) => tc.name === 'slate_candidate_screener');
    let gameMarketCall = resp.toolCalls.find((tc) => tc.name === 'game_market_screener');
    const currentDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const explicitGameMarket = intent.requestKind === 'game_market' || Boolean(intent.gameMarket);
    const explicitPlayerProp = intent.requestKind === 'player_prop';
    const genericMixed = intent.requestKind === 'mixed' && userAskedMultiPick;

    // User intent wins over model tool choice. An explicit moneyline request
    // must never spend its only tool round on the player-prop screener.
    if (explicitGameMarket) {
      resp.toolCalls = resp.toolCalls.filter((tc) => tc.name !== 'slate_candidate_screener');
      screenerCall = undefined;
    }
    if (explicitPlayerProp) {
      resp.toolCalls = resp.toolCalls.filter((tc) => tc.name !== 'game_market_screener');
      gameMarketCall = undefined;
    }

    if ((userAskedMultiPick || explicitPlayerProp) && !explicitGameMarket && !screenerCall) {
      const forcedArgs: Record<string, unknown> = {
        sport: intent.sport ?? 'mlb',
        requestedPicks: intent.requestedPicks ?? 5,
        date: currentDate,
        ...(intent.sameGame ? { sameGame: true } : {}),
      };
      if (intent.market) forcedArgs.market = intent.market;
      if (intent.side) forcedArgs.side = intent.side;
      if (wantsMore && priorNames.length) forcedArgs.exclude = priorNames;
      screenerCall = {
        index: resp.toolCalls.length,
        id: `forced_prop_screener_${Date.now()}`,
        name: 'slate_candidate_screener',
        arguments: JSON.stringify(forcedArgs),
        parsed: forcedArgs,
        extra_content: null,
      };
      resp.toolCalls.push(screenerCall);
    }

    if ((explicitGameMarket || genericMixed) && !gameMarketCall) {
      const forcedArgs: Record<string, unknown> = {
        sport: intent.sport ?? 'nfl',
        market: intent.gameMarket ?? 'moneyline',
        requestedPicks: intent.requestedPicks ?? 5,
        date: currentDate,
      };
      gameMarketCall = {
        index: resp.toolCalls.length,
        id: `forced_game_screener_${Date.now()}`,
        name: 'game_market_screener',
        arguments: JSON.stringify(forcedArgs),
        parsed: forcedArgs,
        extra_content: null,
      };
      resp.toolCalls.push(gameMarketCall);
    }

    // Explicit prop market/side remains authoritative even if the model called
    // the generic prop screener with different/default arguments.
    if (screenerCall) {
      const patched = patchScreenerCall(screenerCall, intent, wantsMore, priorNames);
      screenerCall = patched;
      resp.toolCalls = resp.toolCalls.map((tc) => tc.id === patched.id ? patched : tc);
    }

    if (gameMarketCall && explicitGameMarket) {
      const parsed = {
        ...(gameMarketCall.parsed ?? {}),
        sport: intent.sport ?? gameMarketCall.parsed?.sport ?? 'nfl',
        market: 'moneyline',
        requestedPicks: intent.requestedPicks ?? gameMarketCall.parsed?.requestedPicks ?? 5,
        date: currentDate,
      };
      gameMarketCall = { ...gameMarketCall, parsed, arguments: JSON.stringify(parsed) };
      resp.toolCalls = resp.toolCalls.map((tc) => tc.id === gameMarketCall!.id ? gameMarketCall! : tc);
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
        timeoutMs: resp.toolCalls.some((tc) => tc.name === 'slate_candidate_screener') ? 36_000 : 5_000,
        onEvent: (event) => cb.onToolEvent?.({ name: event.name, status: event.status, summary: event.summary, data: event.data }),
      },
    );
    for (const result of results) msgs.push({ role: 'tool', tool_call_id: result.call.id, content: result.outcome.json });
  }

  if (endedWithTools || !finalText) {
    // Prefer a fast, deterministic summary built directly from the screener
    // candidates. The full LLM "closer" synthesis is slow (gpt-oss / gemini can
    // take 30s+ to write a 5-leg prose answer) and blows the 60s function budget
    // after the ~20s screener. We only fall back to the LLM closer if we have no
    // screener data to render. This guarantees the user sees real picks.
    const screenerData = extractScreenerCandidates(msgs);
    if (screenerData.length) {
      finalText = renderScreenerSummaryBlocks(screenerData, requestedCountHint(msgs));
      cb.onDelta?.(finalText);
      modelUsed = modelUsed ?? 'server-template';
    } else {
      const closer = await streamChatOnce(
        cfg,
        [...msgs, { role: 'user', content: 'Wrap up now. Use the completed tool results only; do not call more tools. Return the strongest valid picks you have, including the requested count when the evidence supports it. Include the ```sgp block and [PREDICTION_LOG] for final-eligible picks. If a provider timed out, skip only that missing input rather than failing the whole answer.' }],
        [],
        { onDelta: cb.onDelta, signal: boundedSignal(cb.signal, CLOSER_TIMEOUT_MS) },
      );
      if (closer.content) finalText = closer.content;
      if (closer.modelUsed) modelUsed = closer.modelUsed;
    }
  }

  return { content: finalText, iterations: iterations + 1, modelUsed };
}

/** Pull the candidates array out of a slate_candidate_screener tool result. */
function extractScreenerCandidates(msgs: ChatMessage[]): any[] {
  const rows: any[] = [];
  for (const m of msgs) {
    if (m.role !== 'tool' || typeof m.content !== 'string') continue;
    try {
      const parsed = JSON.parse(m.content);
      if (Array.isArray(parsed?.candidates)) rows.push(...parsed.candidates);
    } catch { /* not JSON or not a screener payload */ }
  }
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      const key = [
        row?.candidateType ?? 'player_prop',
        row?.eventId ?? '',
        row?.player ?? row?.team ?? '',
        row?.market ?? '',
        row?.side ?? '',
        row?.marketLine ?? row?.suggestedLine ?? '',
      ].join('|').toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Number(b?.confidencePct ?? 0) - Number(a?.confidencePct ?? 0));
}

/**
 * Extract player names the assistant already recommended in PRIOR turns.
 * Picks are rendered as "**Full Name** (Team vs Opp)" so we pull the bold
 * lead. This lets a "more/other" follow-up exclude them even though the
 * screener tool result isn't in the visible message history.
 */
function extractPriorPickNames(msgs: ChatMessage[]): string[] {
  const names = new Set<string>();
  for (const m of msgs) {
    if (m.role !== 'assistant' || typeof m.content !== 'string') continue;
    for (const match of m.content.matchAll(/\*\*([^*]+?)\*\*/g)) {
      const name = match[1].trim();
      // Skip non-player bold leads (headers like "Verified slate screen")
      if (name.includes('Verified slate') || name.includes('⚠')) continue;
      names.add(name);
    }
  }
  return [...names];
}

function requestedCountHint(msgs: ChatMessage[]): number {
  const intent = inferConversationScreenerIntent(msgs);
  return intent.requestedPicks ?? 5;
}
