import type { ChatEvent } from '../types';

export interface StreamChatBody {
  messages: { role: 'user' | 'assistant'; content: string }[];
  sport?: string | null;
}

export interface StreamChatOptions {
  signal?: AbortSignal;
  onEvent: (event: ChatEvent) => void;
}

/**
 * Parse one complete SSE frame (already split on '\n\n').
 * Framing: "event: <type>\ndata: <json>\n\n". Malformed frames are dropped —
 * a bad frame must never kill the stream.
 */
export function parseFrame(frame: string, onEvent: (event: ChatEvent) => void): void {
  if (!frame.trim()) return;
  let type = '';
  const dataLines: string[] = [];
  for (const rawLine of frame.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('event:')) {
      type = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (!type || dataLines.length === 0) return;
  try {
    const data = JSON.parse(dataLines.join('\n'));
    onEvent({ type, ...data } as ChatEvent);
  } catch {
    // Malformed JSON payload — drop the frame, keep streaming.
  }
}

/**
 * POST /api/chat and consume the text/event-stream response.
 * Incremental TextDecoder (stream:true) + blank-line splitting handles LF and
 * CRLF frames arriving across network chunks. A final flush handles a partial
 * trailing frame at stream end.
 */
export async function streamChat(body: StreamChatBody, opts: StreamChatOptions): Promise<void> {
  const res = await fetch(`${import.meta.env.BASE_URL}api/chat`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (res.status === 401 || res.status === 402) {
    let code = 'AUTH_REQUIRED';
    let message = res.status === 402
      ? 'Start your free trial to unlock SportsEdge analysis.'
      : 'Authentication required.';
    try {
      const payload = (await res.json()) as { code?: string; error?: string };
      if (payload.code) code = payload.code;
      if (payload.error) message = payload.error;
    } catch {
      /* keep defaults */
    }
    const err = new Error(message) as Error & { code?: string; status?: number };
    err.code = code;
    err.status = res.status;
    throw err;
  }
  if (!res.ok) {
    throw new Error(`Chat API returned HTTP ${res.status}`);
  }
  if (!res.body) {
    throw new Error('Chat API returned no response body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let sawTerminalEvent = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.match(/\r?\n\r?\n/);
    while (boundary?.index !== undefined) {
      const frame = buffer.slice(0, boundary.index);
      // Track terminal events so a killed/truncated stream can't resolve blank.
      if (/^\s*event:\s*(done|error)\s*$/m.test(frame)) sawTerminalEvent = true;
      parseFrame(frame, opts.onEvent);
      buffer = buffer.slice(boundary.index + boundary[0].length);
      boundary = buffer.match(/\r?\n\r?\n/);
    }
  }
  buffer += decoder.decode(); // flush any decoder-internal state
  if (buffer.trim().length > 0) {
    if (/^\s*event:\s*(done|error)\s*$/m.test(buffer)) sawTerminalEvent = true;
    parseFrame(buffer, opts.onEvent);
  }
  // Vercel kills the function at 60s with no error frame — the old code resolved
  // normally, leaving a blank message with no error (user saw "nothing"). Throw so
  // the caller surfaces the retry message instead of blank.
  if (!sawTerminalEvent) {
    throw new Error('The analysis was cut off before it finished (server time limit). Your picks are saved locally — try again in a moment.');
  }
}
