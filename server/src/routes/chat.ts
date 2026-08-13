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

  const body = req.body ?? {};
  const rawMessages: any[] = Array.isArray(body.messages) ? body.messages : [];
  const sport: string | null = typeof body.sport === 'string' && body.sport ? body.sport : null;

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
      ...rawMessages
        .filter((m) => m && typeof m.content === 'string')
        .map((m) => ({ role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const), content: m.content })),
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

    for (const block of extractSgpBlocks(finalText)) {
      sse(res, 'sgp', block);
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
