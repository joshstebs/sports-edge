// POST /api/chat — SSE stream. Streams meta, tool, delta, sgp and done events.

import { Router, Request, Response } from 'express';
import { SYSTEM_PROMPT } from '../prompt/systemPrompt.js';
import { llmConfig, runAgent, ChatMessage } from '../llm/chatClient.js';
import { getToolSchemas } from '../llm/toolRegistry.js';

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
  req.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    sse(res, 'meta', { model: cfg.model, sport, llmConfigured: true, provider: cfg.provider });

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT + (sport ? `\nFocus analysis on ${sport}.` : '') },
      ...rawMessages
        .filter((m) => m && typeof m.content === 'string')
        .map((m) => ({ role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const), content: m.content })),
    ];

    const { content: finalText } = await runAgent(cfg, messages, getToolSchemas(), {
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
    sse(res, 'done', {});
    res.end();
  } catch (e) {
    if (res.writableEnded) return;
    const msg = e instanceof Error ? e.message : String(e);
    sse(res, 'error', { message: `Agent loop failed: ${msg}` });
    res.end();
  }
});
