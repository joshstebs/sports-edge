// POST /api/chat — SSE stream. Streams meta, tool, delta, sgp and done events.

import { Router, Request, Response } from 'express';
import { SYSTEM_PROMPT } from '../prompt/systemPrompt.js';
import { llmConfig, runAgent, ChatMessage } from '../llm/chatClient.js';
import { getToolSchemas } from '../llm/toolRegistry.js';
import { addPrediction, learningPromptBlock, loadModelEvidence, type ModelEvidence } from '../lib/predictionStore.js';
import {
  parseSportKey,
  playerFromSelection,
  verifyRecommendationAvailability,
} from '../providers/playerAvailability.js';
import { normalizeMarket } from '../models/playerPropModel.js';
import { normalizeName } from '../providers/http.js';

export const chatRouter = Router();

function sse(res: Response, event: string, data: any) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  (res as any).flush?.();
}

function extractSgpBlocks(text: string): any[] {
  const blocks: any[] = [];
  const re = /```sgp\s*([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (parsed && Array.isArray(parsed.legs)) blocks.push(parsed);
    } catch {
      // malformed sgp block — skip, don't crash the stream
    }
  }
  return blocks;
}

/** Extract [PREDICTION_LOG] JSON blocks (self-learning protocol). */
function parseJsonObjectAt(text: string, start: number): { value: any; end: number } | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      try { return { value: JSON.parse(text.slice(start, i + 1)), end: i + 1 }; }
      catch { return null; }
    }
  }
  return null;
}

export function extractPredictionLogs(text: string): any[] {
  const out: any[] = [];
  let idx = 0;
  while (true) {
    const start = text.indexOf('[PREDICTION_LOG]', idx);
    if (start < 0) break;
    const contentStart = start + '[PREDICTION_LOG]'.length;
    const open = text.indexOf('{', contentStart);
    if (open < 0) break;
    // Do not accidentally consume ordinary prose JSON after a malformed marker.
    if (open - contentStart > 80) { idx = contentStart; continue; }
    const parsed = parseJsonObjectAt(text, open);
    if (parsed?.value && Array.isArray(parsed.value.legs)) out.push(parsed.value);
    idx = parsed?.end ?? contentStart;
  }
  return out;
}

export function parseAmericanOdds(value: unknown): number | null {
  const text = value == null ? '' : String(value).trim().replace(/−/g, '-');
  return /^[+-]?\d+$/.test(text) && Number(text) !== 0 ? Number(text) : null;
}

export function isClearlyNonPlayerLeg(leg: any): boolean {
  // Fail closed: text and market labels are model-authored and ambiguous
  // ("team total" can even appear in a player-prop description). Only the
  // explicit entity discriminator may bypass player status/model checks.
  if (leg?.player_id != null || String(leg?.player_name ?? '').trim()) return false;
  return /^(?:team|game)$/i.test(String(leg?.entity_type ?? '').trim());
}

function playerForLeg(leg: any): string | null {
  const explicit = String(leg?.player_name ?? '').trim();
  const parsed = playerFromSelection(leg?.selection ?? leg?.leg_name);
  if (explicit && parsed && normalizeName(explicit) !== normalizeName(parsed)) return null;
  return explicit || parsed;
}

function legFingerprint(leg: any, contextSport: unknown): string {
  const sport = String(leg?.sport ?? contextSport ?? '').trim().toLowerCase();
  const selection = String(leg?.selection ?? leg?.leg_name ?? '').toLowerCase()
    .replace(/[^a-z0-9.+-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `${sport}:${selection}`;
}

interface RecommendationContext {
  sport?: unknown;
  date?: unknown;
  gamePk?: unknown;
  eventId?: unknown;
  team?: unknown;
}

export function applyModelEvidence(
  rawLegs: unknown,
  contextSport: unknown,
  evidence: ModelEvidence[],
  context: RecommendationContext = {},
): { legs: any[]; blocked: string[] } {
  const legs = Array.isArray(rawLegs) ? rawLegs : [];
  const blocked: string[] = [];
  // Evidence gate: 'strict' withholds any leg lacking a learned, verified
  // positive-edge model (intended for when per-market evidence loading is
  // wired). 'relaxed' (default) displays analysis-only legs — the model's
  // own confidence still rides on each leg; nothing is invented.
  const gate = (process.env.EVIDENCE_GATE ?? 'relaxed').toLowerCase();
  const accepted = legs.flatMap((leg: any) => {
    if (isClearlyNonPlayerLeg(leg)) return [leg];
    const selection = String(leg?.selection ?? leg?.leg_name ?? '');
    const player = playerForLeg(leg);
    const sport = String(leg?.sport ?? contextSport ?? '').toLowerCase();
    const market = normalizeMarket(String(leg?.market ?? ''));
    const side = String(leg?.side ?? (/\bunder\b/i.test(selection) ? 'under' : 'over')).toLowerCase();
    const line = Number(leg?.line ?? leg?.target_line ?? selection.match(/\b(?:over|under)\s*([0-9.]+)/i)?.[1]);
    const eventDate = String(leg?.game_date ?? leg?.gameDate ?? context.date ?? '').slice(0, 10);
    const eventId = String(leg?.event_id ?? leg?.game_id ?? leg?.gamePk ?? context.eventId ?? context.gamePk ?? '').trim();
    const match = player && evidence.find((item) =>
      normalizeName(item.player) === normalizeName(player) && item.sport === sport &&
      normalizeMarket(item.market) === market && item.side === side && Number(item.line) === line
    );
    // A result without verified positive edge, or a D grade, is analysis-only.
    if (!match || match.grade === 'D' || match.estimatedEdge == null || match.estimatedEdge <= 0) {
      if (gate !== 'strict') return [leg];
      blocked.push(legFingerprint(leg, contextSport));
      return [];
    }
    const probabilityPct = Math.round(match.probability * 1000) / 10;
    return [{
      ...leg,
      confidence: Math.round(probabilityPct),
      model_probability: String(probabilityPct),
      model_version: match.modelVersion,
      model_sample_size: match.sampleSize,
      model_source: match.source,
      market: leg.market ?? match.market,
      side: leg.side ?? match.side,
      line: leg.line != null && String(leg.line).trim() !== '' && Number.isFinite(Number(leg.line)) ? Number(leg.line) : match.line,
    }];
  });
  return { legs: accepted, blocked };
}

async function filterRecommendationLegs(
  rawLegs: unknown,
  context: RecommendationContext,
  cache: Map<string, Promise<boolean>>,
): Promise<{ legs: any[]; blocked: string[] }> {
  const legs = Array.isArray(rawLegs) ? rawLegs : [];
  const blocked: string[] = [];
  const checked = await Promise.all(legs.map(async (leg: any) => {
    const selection = leg?.selection ?? leg?.leg_name;
    if (isClearlyNonPlayerLeg(leg)) return leg;
    const player = playerForLeg(leg);
    if (!player) {
      blocked.push(legFingerprint(leg, context.sport));
      console.warn('Availability gate blocked an unparseable recommendation leg:', String(selection ?? '').slice(0, 120));
      return null;
    }
    const sport = parseSportKey(leg?.sport ?? context.sport);
    if (!sport) {
      blocked.push(legFingerprint(leg, context.sport));
      return null;
    }
    const date = typeof context.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(context.date)
      ? context.date.slice(0, 10) : undefined;
    if (!date) {
      blocked.push(legFingerprint(leg, context.sport));
      console.warn(`Availability gate blocked ${player}: exact event date missing`);
      return null;
    }
    const rawEventId = context.eventId ?? context.gamePk;
    const eventId = rawEventId != null && String(rawEventId).trim() ? String(rawEventId).trim() : undefined;
    const gamePk = Number(context.gamePk ?? context.eventId);
    const key = `${sport}:${normalizeName(player)}:${date ?? ''}:${eventId ?? ''}`;
    let promise = cache.get(key);
    if (!promise) {
      promise = verifyRecommendationAvailability({
        player,
        sport,
        team: typeof context.team === 'string' ? context.team : undefined,
        date,
        gamePk: sport === 'mlb' && Number.isInteger(gamePk) ? gamePk : undefined,
        eventId,
      }).then((status) => {
        if (!status.recommendationEligible) {
          console.warn(`Availability gate blocked ${status.player}: ${status.reason} ${status.gameDay.reason}`);
        }
        return status.recommendationEligible === true;
      }).catch((error) => {
        console.error(`Availability gate failed for ${player}:`, error);
        return false;
      });
      cache.set(key, promise);
    }
    if (await promise) return leg;
    blocked.push(legFingerprint(leg, context.sport));
    return null;
  }));
  return { legs: checked.filter((leg): leg is any => leg !== null), blocked };
}

chatRouter.post('/chat', async (req: Request, res: Response) => {
  const cfg = llmConfig();

  const body = req.body ?? {};
  const userId = req.auth!.userId;
  const rawMessages: any[] = Array.isArray(body.messages) ? body.messages : [];
  const sport: string | null = typeof body.sport === 'string' && body.sport ? body.sport : null;

  // Server-side attachment validation (client checks are trivially bypassed):
  // only data:image/* base64 payloads — no http(s) URLs (which would make the
  // LLM provider fetch arbitrary URLs server-side), max 4 per message /
  // 8 per request / ~8MB each. MUST run before the SSE headers are sent.
  const allImages: string[] = (
    rawMessages.flatMap((m: any) => (Array.isArray(m?.images) ? m.images : [])) as string[]
  ).filter((i: any): i is string => typeof i === 'string');
  if (allImages.length > 8) {
    res.status(400).json({ ok: false, error: 'Too many images (max 4 per message, 8 per request).' });
    return;
  }
  for (const img of allImages) {
    if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/.test(img) || img.length > 11_000_000) {
      res
        .status(400)
        .json({ ok: false, error: 'Invalid image attachment — only base64 data:image payloads up to ~8MB are accepted.' });
      return;
    }
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  if (!cfg.configured) {
    sse(res, 'error', { message: 'No LLM API key configured. Add GEMINI_API_KEY or OPENAI_API_KEY to server/.env' });
    res.end();
    return;
  }

  const controller = new AbortController();
  // Node 18+: req 'close' fires when the request BODY is consumed, not on
  // disconnect — that would abort every request instantly. Detect real client
  // disconnects via 'aborted' + res 'close' while the response is unfinished.
  req.on('aborted', () => controller.abort());
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    sse(res, 'meta', { model: cfg.model, sport, llmConfigured: true, provider: cfg.provider });

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          SYSTEM_PROMPT +
          await learningPromptBlock() +
          (sport ? `\nFocus analysis on ${sport}.` : ''),
      },
      ...(rawMessages.map((m: any): ChatMessage | null => {
        if (!m || typeof m.content !== 'string') return null;
        const role: ChatMessage['role'] = m.role === 'assistant' ? 'assistant' : 'user';
        const images: string[] = Array.isArray(m.images)
          ? m.images.filter((i: any) => typeof i === 'string')
          : [];
        if (images.length === 0) return { role, content: m.content };
        // Multimodal: text + image_url parts (data: URLs from the client).
        return {
          role,
          content: [
            { type: 'text', text: m.content || '' },
            ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
          ],
        };
      }).filter((m): m is ChatMessage => m !== null)),
    ];

    const modelEvidence: ModelEvidence[] = await loadModelEvidence();
    const { content: finalText, modelUsed } = await runAgent(cfg, messages, getToolSchemas(), {
      signal: controller.signal,
      // Recommendation text is buffered until the server validates every
      // structured leg. Streaming it here would display an injured/unmodeled
      // pick before the later safety gates had a chance to remove it.
      onDelta: () => undefined,
      onToolEvent: (ev) => {
        if (ev.name === 'player_prop_model' && ev.status === 'done' && ev.data && Number.isFinite(ev.data.probability)) {
          modelEvidence.push(ev.data as ModelEvidence);
        }
        sse(res, 'tool', {
          name: ev.name,
          status: ev.status,
          summary: ev.summary ?? null,
          data: ev.data ?? null,
        });
      },
    });

    const availabilityCache = new Map<string, Promise<boolean>>();
    const rawSgpBlocks = extractSgpBlocks(finalText);
    const rawLogs = extractPredictionLogs(finalText);
    const hadStructuredCandidates = rawLogs.some((log) => Array.isArray(log?.legs) && log.legs.length) ||
      rawSgpBlocks.some((block) => Array.isArray(block?.legs) && block.legs.length);
    const logContextBySelection = new Map<string, RecommendationContext>();
    for (const log of rawLogs) {
      for (const leg of Array.isArray(log?.legs) ? log.legs : []) {
        const key = legFingerprint(leg, '').split(':').slice(1).join(':');
        logContextBySelection.set(key, {
          sport: log.sport,
          date: log.game_date ?? log.gameDate ?? log.timestamp,
          gamePk: log.gamePk ?? log.event_id ?? log.game_id,
          eventId: log.event_id ?? log.game_id ?? log.gamePk,
          team: leg.team,
        });
      }
    }
    const filteredLogs: any[] = [];
    const availabilityBlocked = new Set<string>();
    const modelBlocked = new Set<string>();
    for (const log of rawLogs) {
      const logContext = {
        sport: log.sport,
        date: log.game_date ?? log.gameDate ?? log.timestamp,
        gamePk: log.gamePk ?? log.event_id ?? log.game_id,
        eventId: log.event_id ?? log.game_id ?? log.gamePk,
      };
      const checked = await filterRecommendationLegs(log.legs, logContext, availabilityCache);
      checked.blocked.forEach((key) => availabilityBlocked.add(key));
      const modeled = applyModelEvidence(checked.legs, log.sport, modelEvidence, logContext);
      modeled.blocked.forEach((key) => modelBlocked.add(key));
      if (modeled.legs.length) filteredLogs.push({ ...log, legs: modeled.legs });
    }

    const acceptedSgpBlocks: any[] = [];
    for (const block of rawSgpBlocks) {
      // Data hygiene: the model sometimes writes the full explanation INTO the
      // selection field. Keep the title short; move the rest to justification
      // so both the chat panel and the slip render cleanly.
      const tidyLeg = (leg: any) => {
        if (!leg || typeof leg.selection !== 'string') return leg;
        const sel = leg.selection;
        if (sel.length > 90 && !leg.justification) {
          const m = sel.match(/^(.{0,80}?[.!?:])\s+(.*)$/s);
          if (m) {
            leg.selection = m[1];
            leg.justification = m[2];
          } else {
            leg.selection = `${sel.slice(0, 85)}…`;
            leg.justification = sel;
          }
        }
        return leg;
      };
      // Honest confidence fallback: if the model omitted `confidence` on a leg
      // but stated its own model_probability (0-1 or "55" style), map that onto
      // confidence rather than leaving the leg at N/A. Never invents numbers.
      if (Array.isArray(block?.legs)) {
        block.legs = block.legs.map((leg: any) => {
          if (leg && typeof leg.confidence !== 'number' && leg.model_probability != null) {
            const p = Number(leg.model_probability);
            const pct = p <= 1 ? p * 100 : p;
            if (Number.isFinite(pct)) leg.confidence = Math.max(0, Math.min(100, Math.round(pct)));
          }
          return tidyLeg(leg);
        });
      }
      const modeledLegs: any[] = [];
      for (const leg of Array.isArray(block?.legs) ? block.legs : []) {
        const selectionKey = legFingerprint(leg, '').split(':').slice(1).join(':');
        const logContext = logContextBySelection.get(selectionKey);
        const legContext = logContext ?? {
          sport: sport ?? leg?.sport,
          date: leg?.game_date ?? leg?.gameDate,
          gamePk: leg?.gamePk ?? leg?.event_id ?? leg?.game_id,
          eventId: leg?.event_id ?? leg?.game_id ?? leg?.gamePk,
          team: leg?.team,
        };
        const checked = await filterRecommendationLegs([leg], legContext, availabilityCache);
        checked.blocked.forEach((key) => availabilityBlocked.add(key));
        const modeled = applyModelEvidence(checked.legs, sport ?? leg?.sport, modelEvidence, legContext);
        modeled.blocked.forEach((key) => modelBlocked.add(key));
        const eventDate = String(legContext.date ?? '').slice(0, 10);
        const eventId = String(legContext.eventId ?? legContext.gamePk ?? '').trim();
        modeledLegs.push(...modeled.legs.map((modeledLeg) => ({
          ...modeledLeg,
          ...( /^\d{4}-\d{2}-\d{2}$/.test(eventDate) ? { eventDate } : {}),
          ...(eventId ? { eventId } : {}),
        })));
      }
      block.legs = modeledLegs;
      if (!block.legs.length) continue;
      acceptedSgpBlocks.push(block);
    }

    // Reliability fallback: the model sometimes omits the ```sgp fence but
    // reliably writes the [PREDICTION_LOG]. Derive the slip from the log so
    // the Parlay Slip always populates after a picks response.
    if (acceptedSgpBlocks.length === 0) {
      for (const log of filteredLogs) {
        const legs = (Array.isArray(log.legs) ? log.legs : [])
          .map((l: any) => {
            if (!l || typeof l.leg_name !== 'string') return null;
            const oddsNum = parseAmericanOdds(l.implied_odds);
            const prob = l.model_probability != null ? Number(String(l.model_probability).replace('%', '')) : NaN;
            return {
              sport: log.sport ?? 'MLB',
              game: log.matchup ?? '',
              eventDate: String(log.game_date ?? log.gameDate ?? '').slice(0, 10) || undefined,
              eventId: String(log.event_id ?? log.game_id ?? log.gamePk ?? '').trim() || undefined,
              selection: l.leg_name,
              market: l.market ?? null,
              line: l.target_line != null ? String(l.target_line) : null,
              odds: oddsNum,
              game_odds: null,
              confidence: Number.isFinite(prob)
                ? Math.max(0, Math.min(100, prob <= 1 && prob > 0 ? Math.round(prob * 100) : Math.round(prob)))
                : undefined,
            };
          })
          .filter((l: any): l is any => l !== null);
        if (legs.length) acceptedSgpBlocks.push({ legs });
      }
    }

    // If prose looks like a player-prop recommendation but the model omitted
    // both machine-readable protocols, it cannot be checked and is withheld.
    const looksLikeUnstructuredProp = /\b(?:over|under)\s+\d+(?:\.\d+)?\s+(?:points?|rebounds?|assists?|hits?|total bases?|strikeouts?|passing yards?|rushing yards?|receiving yards?|shots?(?: on goal)?|saves?)\b/i.test(finalText) ||
      /\b\d+(?:\.\d+)?\+\s+(?:points?|rebounds?|assists?|hits?|total bases?|strikeouts?|passing yards?|rushing yards?|receiving yards?|shots?(?: on goal)?|saves?)\b/i.test(finalText) ||
      /\banytime\s+(?:touchdown|goal)\s+(?:scorer|market)\b/i.test(finalText);
    const lastUserText = [...rawMessages].reverse().find((message) => message?.role !== 'assistant' && typeof message?.content === 'string')?.content ?? '';
    const asksForRecommendation = /\b(?:give|build|make|create|recommend|suggest|find|show|add|save)\b[\s\S]{0,60}\b(?:bet|bets|pick|picks|prop|props|parlay|parlays|sgp|wager|wagers)\b/i.test(lastUserText) ||
      /\b(?:best|top)\s+(?:bet|bets|pick|picks|prop|props|parlay|parlays|wager|wagers)\b/i.test(lastUserText);
    const gateMode = (process.env.EVIDENCE_GATE ?? 'relaxed').toLowerCase();
    if (gateMode === 'strict' && !hadStructuredCandidates && (looksLikeUnstructuredProp || asksForRecommendation)) {
      modelBlocked.add('unstructured-player-prop');
    }

    const blockedLegs = availabilityBlocked.size;
    const modelBlockedLegs = modelBlocked.size;
    if (blockedLegs || modelBlockedLegs) {
      const notes = [
        blockedLegs ? `${blockedLegs} leg${blockedLegs === 1 ? '' : 's'} failed current roster, injury, or game-day verification` : '',
        modelBlockedLegs ? `${modelBlockedLegs} leg${modelBlockedLegs === 1 ? '' : 's'} lacked an exact non-D evidence model with verified positive edge` : '',
      ].filter(Boolean).join('; ');
      sse(res, 'delta', {
        text: `**Recommendation withheld:** ${notes}. The unverified recommendation text was not displayed. ${acceptedSgpBlocks.length ? 'Only the verified structured picks are shown below.' : 'No bet was added to the slip.'}`,
      });
    } else if (hadStructuredCandidates) {
      // Never display model-authored recommendation prose. It can mention
      // extra picks that were not represented in the machine-readable blocks
      // and therefore never passed availability/model verification.
      sse(res, 'delta', {
        text: `**Verified recommendation:** ${acceptedSgpBlocks.reduce((sum, block) => sum + (Array.isArray(block?.legs) ? block.legs.length : 0), 0)} structured ${acceptedSgpBlocks.length === 1 && acceptedSgpBlocks[0]?.legs?.length === 1 ? 'leg passed' : 'legs passed'} current availability and evidence checks. Details are shown below.`,
      });
    } else {
      sse(res, 'delta', { text: finalText });
    }
    for (const block of acceptedSgpBlocks) sse(res, 'sgp', block);

    // Self-learning protocol: persist every [PREDICTION_LOG] block.
    let stored = 0;
    let failed = 0;
    for (const log of filteredLogs) {
      try {
        await addPrediction({ ...log, userId });
        stored++;
      } catch (error) {
        failed++;
        console.error('Prediction log storage failed:', error);
      }
    }
    if (rawLogs.length) sse(res, 'log', {
      stored, failed,
      blocked: blockedLegs,
      modelBlocked: modelBlockedLegs,
      ...(failed ? { error: 'Prediction history could not be saved; durable storage may not be configured.' } : {}),
    });
    sse(res, 'done', { modelUsed });
    res.end();
  } catch (e) {
    if (res.writableEnded) return;
    const msg = e instanceof Error ? e.message : String(e);
    sse(res, 'error', { message: `Agent loop failed: ${msg}` });
    res.end();
  }
});
