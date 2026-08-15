import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import Composer from './components/Composer';
import Header from './components/Header';
import MessageList from './components/MessageList';
import ParlaySlip from './components/ParlaySlip';
import SportSelector from './components/SportSelector';
import { fetchHealth, type HealthInfo } from './lib/api';
import { legKey } from './lib/odds';
import { streamChat } from './lib/sse';
import type { ChatMessage, HealthState, Sport, SgpLeg, ToolEvent } from './types';

export const SPORTS: readonly Sport[] = ['All', 'MLB', 'NFL', 'NBA'];
const STORAGE_KEY = 'sports-edge:chat:v1';

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function loadPersisted(): { messages: ChatMessage[]; sport: Sport } {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { messages: [], sport: 'All' };
    const parsed = JSON.parse(raw) as { messages?: ChatMessage[]; sport?: Sport };
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages.map((m) => ({ ...m, streaming: false }))
      : [];
    const sport = parsed.sport && SPORTS.includes(parsed.sport) ? parsed.sport : 'All';
    return { messages, sport };
  } catch {
    return { messages: [], sport: 'All' };
  }
}

export default function App() {
  const initial = useRef(loadPersisted());
  const [messages, setMessages] = useState<ChatMessage[]>(initial.current.messages);
  const [sport, setSport] = useState<Sport>(initial.current.sport);
  // Bet slip starts MINIMIZED so it never covers the chatbox; state persists.
  const [slipCollapsed, setSlipCollapsed] = useState<boolean>(() => {
    try {
      return (sessionStorage.getItem('se_slip_collapsed') ?? '1') === '1';
    } catch {
      return true;
    }
  });
  const [model, setModel] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthState>('checking');
  const [healthInfo, setHealthInfo] = useState<HealthInfo | null>(null);
  const [streaming, setStreaming] = useState(false);
  // Legs the user removed from the Parlay Slip (keys = selection::line).
  const [removedLegKeys, setRemovedLegKeys] = useState<Set<string>>(() => new Set());

  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef(messages);
  const sportRef = useRef(sport);
  const streamingRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    sportRef.current = sport;
  }, [sport]);
  useEffect(() => {
    streamingRef.current = streaming;
  }, [streaming]);

  // Persist conversation (messages + sport) so a refresh keeps the chat.
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ messages, sport }));
    } catch {
      /* storage unavailable — ignore */
    }
  }, [messages, sport]);

  // Live-data dot: green only when /api/health reports ok:true.
  useEffect(() => {
    let cancelled = false;
    fetchHealth()
      .then((h) => {
        if (cancelled) return;
        setHealthInfo(h);
        setHealth(h.ok ? 'ok' : 'down');
      })
      .catch(() => {
        if (cancelled) return;
        setHealth('down');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Parlay Slip legs: every SGP leg from every sgp event this conversation,
  // deduped by selection+line (latest event wins so odds stay fresh), minus
  // legs the user removed. Pure derivation from real SSE data — no fabrication.
  const slipLegs = useMemo(() => {
    const seen = new Map<string, SgpLeg>();
    for (const m of messages) {
      if (m.role !== 'assistant' || !m.sgp || m.sgp.length === 0) continue;
      for (const leg of m.sgp) {
        const key = legKey(leg);
        if (key === '::') continue;
        seen.set(key, leg);
      }
    }
    return Array.from(seen.values()).filter((leg) => !removedLegKeys.has(legKey(leg)));
  }, [messages, removedLegKeys]);

  const removeLeg = useCallback((key: string) => {
    setRemovedLegKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const setStreamingState = useCallback((v: boolean) => {
    streamingRef.current = v;
    setStreaming(v);
  }, []);

  const beginStream = useCallback(
    (text: string, history: ChatMessage[], appendUser: boolean, images?: string[]) => {
      const userMsg: ChatMessage = {
        id: uid(),
        role: 'user',
        content: text,
        ...(images && images.length ? { images } : {}),
      };
      const assistantId = uid();
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        tools: [],
        streaming: true,
      };

      setMessages((prev) => {
        const base = appendUser ? [...prev, userMsg] : prev;
        return [...base, assistantMsg];
      });
      setStreamingState(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const requestMessages = (appendUser ? [...history, userMsg] : history).map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.images && m.images.length ? { images: m.images } : {}),
      }));
      const requestSport = sportRef.current === 'All' ? null : sportRef.current;

      streamChat(
        { messages: requestMessages, sport: requestSport },
        {
          signal: controller.signal,
          onEvent: (ev) => {
            switch (ev.type) {
              case 'meta':
                if (ev.model) setModel(ev.model);
                break;
              case 'tool': {
                setMessages((prev) =>
                  prev.map((m) => {
                    if (m.id !== assistantId) return m;
                    const tools = m.tools ?? [];
                    const idx = tools.findIndex((t) => t.name === ev.name);
                    const tool: ToolEvent = {
                      name: ev.name,
                      status: ev.status,
                      summary: ev.summary ?? tools[idx]?.summary,
                    };
                    if (idx === -1) return { ...m, tools: [...tools, tool] };
                    const next = [...tools];
                    next[idx] = tool;
                    return { ...m, tools: next };
                  }),
                );
                break;
              }
              case 'delta':
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + ev.text } : m)),
                );
                break;
              case 'sgp':
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, sgp: ev.legs } : m)),
                );
                break;
              case 'done':
                setMessages((prev) =>
                  prev.map((m) => {
                    if (m.id !== assistantId) return m;
                    // Harden against silent failure: if the stream ended with
                    // no text and no error, surface that instead of nothing.
                    const next = { ...m, streaming: false };
                    if (!next.content && !next.error) {
                      next.error =
                        'The analyst returned no text this time — hit Retry, or rephrase the question.';
                    }
                    return next;
                  }),
                );
                break;
              case 'error':
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, error: ev.message, streaming: false } : m,
                  ),
                );
                break;
            }
          },
        },
      )
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          const isAbort = err instanceof DOMException && err.name === 'AbortError';
          if (isAbort) return;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    error: "Can't reach the analyst server. Is it running on port 3100?",
                    streaming: false,
                  }
                : m,
            ),
          );
        })
        .finally(() => {
          if (abortRef.current === controller) {
            abortRef.current = null;
            setStreamingState(false);
          }
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId && m.streaming ? { ...m, streaming: false } : m)),
          );
        });
    },
    [setStreamingState],
  );

  const setSlipCollapsedPersisted = useCallback((v: boolean) => {
    setSlipCollapsed(v);
    try {
      sessionStorage.setItem('se_slip_collapsed', v ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);

  const sendMessage = useCallback(
    (raw: string, images?: string[]) => {
      const text = raw.trim();
      if ((!text && (!images || images.length === 0)) || streamingRef.current) return;
      beginStream(text, messagesRef.current, true, images);
    },
    [beginStream],
  );

  const retryMessage = useCallback(
    (assistantId: string) => {
      if (streamingRef.current) return;
      const list = messagesRef.current;
      const idx = list.findIndex((m) => m.id === assistantId);
      if (idx === -1) return;
      let userIdx = -1;
      for (let i = idx; i >= 0; i--) {
        if (list[i].role === 'user') {
          userIdx = i;
          break;
        }
      }
      if (userIdx === -1) return;
      const history = list.slice(0, userIdx + 1);
      const text = history[userIdx].content;
      setMessages(history);
      beginStream(text, history, false);
    },
    [beginStream],
  );

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreamingState(false);
    setMessages([]);
    setModel(null);
    setRemovedLegKeys(new Set());
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, [setStreamingState]);

  return (
    <>
      <div className="flex h-full flex-col">
        <Header model={model} health={health} healthInfo={healthInfo} onNewChat={newChat} />
        <SportSelector sports={SPORTS} active={sport} onChange={setSport} />
        <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <MessageList messages={messages} onSend={sendMessage} onRetry={retryMessage} />
            {slipLegs.length > 0 && (
              <div className="shrink-0 border-t border-line/60 px-4 pb-3 pt-2.5 xl:hidden">
                <div className="mx-auto w-full max-w-3xl">
                  {slipCollapsed ? (
                    <button
                      onClick={() => setSlipCollapsedPersisted(false)}
                      className="flex w-full items-center justify-between rounded-lg border border-line/60 bg-card/60 px-3 py-2.5 text-left transition-colors hover:bg-card"
                    >
                      <span className="text-[11px] font-bold uppercase tracking-wider text-frost">
                        Parlay Slip · {slipLegs.length} leg{slipLegs.length === 1 ? '' : 's'}
                      </span>
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-edge" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                        <path d="M6 15l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  ) : (
                    <>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                          Parlay Slip · {slipLegs.length} leg{slipLegs.length === 1 ? '' : 's'}
                        </span>
                        <button
                          onClick={() => setSlipCollapsedPersisted(true)}
                          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted transition-colors hover:bg-card hover:text-frost"
                        >
                          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          Hide
                        </button>
                      </div>
                      <ParlaySlip legs={slipLegs} onRemove={removeLeg} className="max-h-[380px]" />
                    </>
                  )}
                </div>
              </div>
            )}
            <Composer onSend={sendMessage} streaming={streaming} />
          </div>
          <div className="hidden w-80 shrink-0 xl:block">
            <div className="sticky top-0 flex h-full flex-col p-4 pl-2">
              <ParlaySlip legs={slipLegs} onRemove={removeLeg} />
            </div>
          </div>
        </div>
      </div>
      <Analytics />
    </>
  );
}
