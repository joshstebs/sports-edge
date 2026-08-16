import { useCallback, useEffect, useRef, useState } from 'react';
import Composer from './components/Composer';
import Header from './components/Header';
import LoginScreen from './components/LoginScreen';
import MessageList from './components/MessageList';
import ParlaySlip, { type SlipSaveStatus } from './components/ParlaySlip';
import SportSelector from './components/SportSelector';
import { fetchHealth, fetchLedger, saveLedgerTicket, type HealthInfo } from './lib/api';
import { fetchSession, signOut, type AuthUser } from './lib/auth';
import { legKey } from './lib/odds';
import {
  collectMessageLegs,
  ledgerKeysFromPicks,
  ledgerLegKey,
  ledgerTicketBatches,
  ledgerTicketKey,
  mergeSgpLegs,
} from './lib/slip';
import { streamChat } from './lib/sse';
import type { ChatMessage, HealthState, Sport, SgpLeg, ToolEvent } from './types';

export const SPORTS: readonly Sport[] = ['All', 'MLB', 'NFL', 'NBA', 'NHL'];
const CHAT_STORAGE_KEY = 'sports-edge:chat:v2';
const SLIP_STORAGE_KEY = 'sports-edge:betslip:v2';
const TRACKED_STORAGE_KEY = 'sports-edge:tracked-legs:v2';

function userStorageKey(base: string, userId: string): string {
  return `${base}:${userId}`;
}

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function loadPersisted(userId: string): { messages: ChatMessage[]; sport: Sport } {
  try {
    const raw = sessionStorage.getItem(userStorageKey(CHAT_STORAGE_KEY, userId));
    if (!raw) return { messages: [], sport: 'All' };
    const parsed = JSON.parse(raw) as { messages?: ChatMessage[]; sport?: Sport };
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages.map((m) => ({
          ...m,
          streaming: false,
          ...(Array.isArray(m.sgp) ? { sgp: mergeSgpLegs([], m.sgp) } : {}),
        }))
      : [];
    const sport = parsed.sport && SPORTS.includes(parsed.sport) ? parsed.sport : 'All';
    return { messages, sport };
  } catch {
    return { messages: [], sport: 'All' };
  }
}

/** null means no saved slip exists yet; [] means the user explicitly cleared it. */
function loadPersistedSlip(userId: string): SgpLeg[] | null {
  try {
    const raw = localStorage.getItem(userStorageKey(SLIP_STORAGE_KEY, userId));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? mergeSgpLegs([], parsed) : null;
  } catch {
    return null;
  }
}

function loadTrackedLegs(userId: string): Set<string> {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(userStorageKey(TRACKED_STORAGE_KEY, userId)) ?? '[]',
    ) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((key): key is string => typeof key === 'string').slice(-1000));
  } catch {
    return new Set();
  }
}

type AuthState =
  | { status: 'checking'; user: null; error: null }
  | { status: 'signed-out'; user: null; error: string | null }
  | { status: 'signed-in'; user: AuthUser; error: null };

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'checking', user: null, error: null });

  useEffect(() => {
    let cancelled = false;
    fetchSession()
      .then((user) => {
        if (cancelled) return;
        setAuth(
          user
            ? { status: 'signed-in', user, error: null }
            : { status: 'signed-out', user: null, error: null },
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setAuth({
          status: 'signed-out',
          user: null,
          error: error instanceof Error ? error.message : 'Authentication service unavailable.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (auth.status === 'checking') {
    return (
      <main className="flex min-h-full items-center justify-center bg-ink text-sm font-semibold text-frost2">
        Checking secure session…
      </main>
    );
  }
  if (!auth.user) {
    return (
      <LoginScreen
        serviceError={auth.error}
        onAuthenticated={(user) => setAuth({ status: 'signed-in', user, error: null })}
      />
    );
  }

  return (
    <Workspace
      key={auth.user.id}
      user={auth.user}
      onSessionExpired={() => setAuth({ status: 'signed-out', user: null, error: 'Your session expired. Please sign in again.' })}
      onLogout={async () => {
        try {
          await signOut();
        } finally {
          setAuth({ status: 'signed-out', user: null, error: null });
        }
      }}
    />
  );
}

function Workspace({
  user,
  onLogout,
  onSessionExpired,
}: {
  user: AuthUser;
  onLogout: () => Promise<void>;
  onSessionExpired: () => void;
}) {
  const chatStorageKey = userStorageKey(CHAT_STORAGE_KEY, user.id);
  const slipStorageKey = userStorageKey(SLIP_STORAGE_KEY, user.id);
  const trackedStorageKey = userStorageKey(TRACKED_STORAGE_KEY, user.id);
  const collapsedStorageKey = userStorageKey('sports-edge:slip-collapsed:v2', user.id);
  const initial = useRef(loadPersisted(user.id));
  const [messages, setMessages] = useState<ChatMessage[]>(initial.current.messages);
  const [sport, setSport] = useState<Sport>(initial.current.sport);
  // Bet slip starts MINIMIZED so it never covers the chatbox; state persists.
  const [slipCollapsed, setSlipCollapsed] = useState<boolean>(() => {
    try {
      return (sessionStorage.getItem(collapsedStorageKey) ?? '1') === '1';
    } catch {
      return true;
    }
  });
  const [model, setModel] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthState>('checking');
  const [healthInfo, setHealthInfo] = useState<HealthInfo | null>(null);
  const [streaming, setStreaming] = useState(false);
  // The bet slip is independent from chat history: retrying/starting a chat can
  // never discard saved picks. Upgrade old sessions by seeding from messages.
  const [slipLegs, setSlipLegs] = useState<SgpLeg[]>(() => {
    const saved = loadPersistedSlip(user.id);
    return saved ?? collectMessageLegs(initial.current.messages);
  });
  const [trackedLegs, setTrackedLegs] = useState<Set<string>>(() => loadTrackedLegs(user.id));
  const [slipSaveStatus, setSlipSaveStatus] = useState<SlipSaveStatus>({
    state: 'saving',
    message: 'Checking your results ledger…',
  });

  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef(messages);
  const sportRef = useRef(sport);
  const streamingRef = useRef(false);
  const slipSaveInFlightRef = useRef(false);

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
      sessionStorage.setItem(chatStorageKey, JSON.stringify({ messages, sport }));
    } catch {
      /* storage unavailable — ignore */
    }
  }, [chatStorageKey, messages, sport]);

  useEffect(() => {
    try {
      localStorage.setItem(slipStorageKey, JSON.stringify(slipLegs));
    } catch {
      /* storage unavailable — the in-memory slip still works */
    }
  }, [slipLegs, slipStorageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(trackedStorageKey, JSON.stringify(Array.from(trackedLegs).slice(-1000)));
    } catch {
      /* storage unavailable — server idempotency still protects retries */
    }
  }, [trackedLegs, trackedStorageKey]);

  // Local storage is only a cache. Rebuild tracked identities from the
  // authenticated durable ledger so a new browser/device does not re-save the
  // same ticket. Saving stays disabled until this initial reconciliation ends.
  useEffect(() => {
    let cancelled = false;
    fetchLedger()
      .then(({ picks }) => {
        if (cancelled) return;
        const serverKeys = ledgerKeysFromPicks(picks);
        setTrackedLegs((previous) => new Set([...previous, ...serverKeys]));
        setSlipSaveStatus({ state: 'idle' });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSlipSaveStatus({
          state: 'error',
          message: error instanceof Error
            ? `Could not verify prior tracked picks: ${error.message}`
            : 'Could not verify prior tracked picks.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const removeLeg = useCallback((key: string) => {
    setSlipLegs((prev) => prev.filter((leg) => legKey(leg) !== key));
  }, []);

  const clearSlip = useCallback(() => setSlipLegs([]), []);

  const unsavedSlipLegs = slipLegs.filter((leg) => !trackedLegs.has(ledgerLegKey(leg)));

  const saveSlip = useCallback(async () => {
    if (slipSaveInFlightRef.current) return;
    const now = new Date();
    const unsaved = slipLegs.filter((leg) => !trackedLegs.has(ledgerLegKey(leg, now)));
    if (unsaved.length === 0) {
      setSlipSaveStatus({ state: 'success', message: 'Every pick on this slip is already tracked.' });
      return;
    }

    slipSaveInFlightRef.current = true;
    setSlipSaveStatus({ state: 'saving', message: 'Saving picks to the results ledger…' });
    let confirmed = 0;
    let newlyAdded = 0;
    try {
      for (const batch of ledgerTicketBatches(unsaved)) {
        const response = await saveLedgerTicket(batch, ledgerTicketKey(batch, now));
        const savedKeys = batch.map((leg) => ledgerLegKey(leg, now));
        setTrackedLegs((prev) => new Set([...prev, ...savedKeys]));
        confirmed += batch.length;
        newlyAdded += typeof response.added === 'number'
          ? response.added
          : response.duplicate ? 0 : batch.length;
      }
      setSlipSaveStatus({
        state: 'success',
        message: newlyAdded === 0
          ? 'These picks were already in the ledger—no duplicates were created.'
          : newlyAdded === confirmed
            ? `${confirmed} ${confirmed === 1 ? 'pick' : 'picks'} saved and queued for outcome tracking.`
            : `${confirmed} picks tracked (${newlyAdded} new; the rest were already saved).`,
      });
    } catch (error) {
      if (error instanceof Error && /(?:HTTP 401|Authentication required)/i.test(error.message)) {
        onSessionExpired();
        return;
      }
      setSlipSaveStatus({
        state: 'error',
        message: `${confirmed ? `${confirmed} picks were saved. ` : ''}${
          error instanceof Error ? error.message : 'Could not save the remaining picks. Please retry.'
        }`,
      });
    } finally {
      slipSaveInFlightRef.current = false;
    }
  }, [onSessionExpired, slipLegs, trackedLegs]);

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
                // A response may contain more than one prediction block. Append
                // each event and update matches instead of replacing the first.
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, sgp: mergeSgpLegs(m.sgp ?? [], ev.legs) }
                      : m,
                  ),
                );
                setSlipLegs((prev) => mergeSgpLegs(prev, ev.legs));
                break;
              case 'log':
                // Prediction-log acknowledgement. Explicit bet tracking has
                // separate feedback in the parlay slip.
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
          if (err instanceof Error && /HTTP 401/i.test(err.message)) {
            onSessionExpired();
            return;
          }
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
    [onSessionExpired, setStreamingState],
  );

  const setSlipCollapsedPersisted = useCallback((v: boolean) => {
    setSlipCollapsed(v);
    try {
      sessionStorage.setItem(collapsedStorageKey, v ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsedStorageKey]);

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
    try {
      sessionStorage.removeItem(chatStorageKey);
    } catch {
      /* ignore */
    }
  }, [chatStorageKey, setStreamingState]);

  return (
    <div className="flex h-full flex-col">
      <Header
        model={model}
        health={health}
        healthInfo={healthInfo}
        user={user}
        onLogout={onLogout}
        onNewChat={newChat}
      />
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
                    <ParlaySlip
                      legs={slipLegs}
                      onRemove={removeLeg}
                      onClear={clearSlip}
                      onSave={saveSlip}
                      unsavedCount={unsavedSlipLegs.length}
                      saveStatus={slipSaveStatus}
                      className="max-h-[380px]"
                    />
                  </>
                )}
              </div>
            </div>
          )}
          <Composer onSend={sendMessage} streaming={streaming} />
        </div>
        <div className="hidden w-80 shrink-0 xl:block">
          <div className="sticky top-0 flex h-full flex-col p-4 pl-2">
            <ParlaySlip
              legs={slipLegs}
              onRemove={removeLeg}
              onClear={clearSlip}
              onSave={saveSlip}
              unsavedCount={unsavedSlipLegs.length}
              saveStatus={slipSaveStatus}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
