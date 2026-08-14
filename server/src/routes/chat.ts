// POST /api/chat — SSE stream. Streams meta, tool, delta, sgp and done events.

import { Router, Request, Response } from 'express';
import { SYSTEM_PROMPT } from '../prompt/systemPrompt.js';
import { llmConfig, runAgent, ChatMessage } from '../llm/chatClient.js';
import { getToolSchemas } from '../llm/toolRegistry.js';
import { addPrediction, learningPromptBlock } from '../lib/predictionStore.js';

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
function extractPredictionLogs(text: string): any[] {
  const out: any[] = [];
  let idx = 0;
  while (true) {
    const start = text.indexOf('[PREDICTION_LOG]', idx);
    if (start < 0) break;
    let rest = text.slice(start + '[PREDICTION_LOG]'.length);
    // skip to the JSON object
    const open = rest.indexOf('{');
    if (open < 0) break;
    rest = rest.slice(open);
    const fence = rest.indexOf('```');
    const end = fence >= 0 ? fence : rest.length;
    const candidate = rest.slice(0, end).trim();
    const close = candidate.lastIndexOf('}');
    if (close > 0) {
      try {
        const parsed = JSON.parse(candidate.slice(0, close + 1));
        if (parsed && parsed.prediction_id && Array.isArray(parsed.legs)) out.push(parsed);
      } catch {
        // malformed — skip
      }
    }
    idx = start + 15;
  }
  return out;
}

chatRouter.post('/chat', async (req: Request, res: Response) => {
  const cfg = llmConfig();

  const body = req.body ?? {};
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
          learningPromptBlock() +
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

    const { content: finalText, modelUsed } = await runAgent(cfg, messages, getToolSchemas(), {
      signal: controller.signal,
      onDelta: (text) => sse(res, 'delta', { text }),
      onToolEvent: (ev) => {
        sse(res, 'tool', {
          name: ev.name,
          status: ev.status,
          summary: ev.summary ?? null,
          data: ev.data ?? null,
        });
      },
    });

    let sgpEmitted = 0;
    for (const block of extractSgpBlocks(finalText)) {
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
      sgpEmitted++;
      sse(res, 'sgp', block);
    }

    // Reliability fallback: the model sometimes omits the ```sgp fence but
    // reliably writes the [PREDICTION_LOG]. Derive the slip from the log so
    // the Parlay Slip always populates after a picks response.
    if (sgpEmitted === 0) {
      for (const log of extractPredictionLogs(finalText)) {
        const legs = (Array.isArray(log.legs) ? log.legs : [])
          .map((l: any) => {
            if (!l || typeof l.leg_name !== 'string') return null;
            const oddsStr = l.implied_odds != null ? String(l.implied_odds) : '';
            const oddsNum = /^-?\d+$/.test(oddsStr) ? Number(oddsStr) : null;
            const prob = l.model_probability != null ? Number(String(l.model_probability).replace('%', '')) : NaN;
            return {
              sport: log.sport ?? 'MLB',
              game: log.matchup ?? '',
              selection: l.leg_name,
              market: null,
              line: l.target_line != null ? String(l.target_line) : null,
              odds: oddsNum,
              game_odds: null,
              confidence: Number.isFinite(prob)
                ? Math.max(0, Math.min(100, prob <= 1 && prob > 0 ? Math.round(prob * 100) : Math.round(prob)))
                : undefined,
            };
          })
          .filter((l: any): l is any => l !== null);
        if (legs.length) sse(res, 'sgp', { legs });
      }
    }
    // Self-learning protocol: persist every [PREDICTION_LOG] block.
    const logs = extractPredictionLogs(finalText);
    for (const log of logs) {
      try {
        addPrediction({
          prediction_id: String(log.prediction_id),
          timestamp: String(log.timestamp ?? new Date().toISOString()),
          sport: String(log.sport ?? 'MLB').toUpperCase(),
          matchup: String(log.matchup ?? ''),
          bet_type: String(log.bet_type ?? 'PROP'),
          legs: Array.isArray(log.legs) ? log.legs : [],
          recommended_units: log.recommended_units != null ? String(log.recommended_units) : null,
          status: 'pending',
        });
      } catch {
        // never let the log store break the stream
      }
    }
    if (logs.length) sse(res, 'log', { stored: logs.length });
    sse(res, 'done', { modelUsed });
    res.end();
  } catch (e) {
    if (res.writableEnded) return;
    const msg = e instanceof Error ? e.message : String(e);
    sse(res, 'error', { message: `Agent loop failed: ${msg}` });
    res.end();
  }
});
