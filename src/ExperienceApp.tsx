import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ExperienceHub from './components/ExperienceHub';
import type { SlipSaveStatus } from './components/ParlaySlip';
import { fetchHealth, fetchLedger, saveLedgerTicket, type HealthInfo } from './lib/api';
import { legKey } from './lib/odds';
import { ledgerKeysFromPicks, ledgerLegKey, ledgerTicketBatches, ledgerTicketKey, mergeSgpLegs } from './lib/slip';
import { streamChat } from './lib/sse';
import type { HealthState, SgpLeg } from './types';

const SLIP_PREFIX = 'sports-edge:betslip:v2:';

function discoverSlipKey(): string {
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(SLIP_PREFIX)) return key;
    }
  } catch {
    // storage unavailable
  }
  return `${SLIP_PREFIX}experience`;
}

function loadSlip(key: string): SgpLeg[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? mergeSgpLegs([], parsed) : [];
  } catch {
    return [];
  }
}

export default function ExperienceApp() {
  const slipKey = useMemo(discoverSlipKey, []);
  const [legs, setLegs] = useState<SgpLeg[]>(() => loadSlip(slipKey));
  const [tracked, setTracked] = useState<Set<string>>(new Set());
  const [health, setHealth] = useState<HealthState>('checking');
  const [healthInfo, setHealthInfo] = useState<HealthInfo | null>(null);
  const [saveStatus, setSaveStatus] = useState<SlipSaveStatus>({ state: 'idle' });
  const [streaming, setStreaming] = useState(false);
  const [lastPrompt, setLastPrompt] = useState('');
  const [lastAnswer, setLastAnswer] = useState('');
  const [lastTool, setLastTool] = useState('');
  const [showAnswer, setShowAnswer] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try { localStorage.setItem(slipKey, JSON.stringify(legs)); } catch { /* ignore */ }
  }, [legs, slipKey]);

  useEffect(() => {
    let cancelled = false;
    fetchHealth().then((value) => {
      if (cancelled) return;
      setHealthInfo(value);
      setHealth(value.ok ? 'ok' : 'down');
    }).catch(() => { if (!cancelled) setHealth('down'); });
    fetchLedger().then(({ picks }) => {
      if (cancelled) return;
      setTracked(ledgerKeysFromPicks(picks));
    }).catch(() => undefined);
    return () => { cancelled = true; abortRef.current?.abort(); };
  }, []);

  const removeLeg = useCallback((key: string) => setLegs((prev) => prev.filter((leg) => legKey(leg) !== key)), []);
  const clearSlip = useCallback(() => setLegs([]), []);

  const send = useCallback(async (text: string) => {
    const prompt = text.trim();
    if (!prompt || streaming) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    setLastPrompt(prompt);
    setLastAnswer('');
    setLastTool('Gathering verified evidence…');
    setShowAnswer(true);
    try {
      await streamChat({ messages: [{ role: 'user', content: prompt }], sport: null }, {
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'delta') setLastAnswer((prev) => prev + event.text);
          if (event.type === 'tool') {
            const summary = event.summary?.trim();
            setLastTool(summary || `${event.name}: ${event.status}`);
          }
          if (event.type === 'sgp') setLegs((prev) => mergeSgpLegs(prev, event.legs));
          if (event.type === 'log' && event.failed) setLastAnswer((prev) => `${prev}\n\n⚠️ ${event.failed} prediction${event.failed === 1 ? '' : 's'} could not be saved to history. Verify the pick in My Picks before relying on tracking.`);
          if (event.type === 'error') setLastAnswer(event.message);
          if (event.type === 'done') setLastTool('Analysis complete');
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Analyst request failed.';
      setLastAnswer(message);
      setLastTool('Request failed');
      setSaveStatus({ state: 'error', message });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setStreaming(false);
    }
  }, [streaming]);

  const saveSlip = useCallback(async () => {
    const now = new Date();
    const unsaved = legs.filter((leg) => !tracked.has(ledgerLegKey(leg, now)));
    if (!unsaved.length) {
      setSaveStatus({ state: 'success', message: 'Every pick is already tracked.' });
      return;
    }
    setSaveStatus({ state: 'saving', message: 'Saving picks to the results ledger…' });
    try {
      let confirmed = 0;
      for (const batch of ledgerTicketBatches(unsaved)) {
        await saveLedgerTicket(batch, ledgerTicketKey(batch, now));
        confirmed += batch.length;
        setTracked((prev) => new Set([...prev, ...batch.map((leg) => ledgerLegKey(leg, now))]));
      }
      setSaveStatus({ state: 'success', message: `${confirmed} ${confirmed === 1 ? 'pick' : 'picks'} saved to the results ledger.` });
    } catch (error) {
      setSaveStatus({ state: 'error', message: error instanceof Error ? error.message : 'Could not save picks.' });
    }
  }, [legs, tracked]);

  const unsavedCount = legs.filter((leg) => !tracked.has(ledgerLegKey(leg))).length;
  const analyst = { prompt: lastPrompt, answer: lastAnswer, status: lastTool, streaming };

  return (
    <main className="relative flex h-full flex-col bg-ink text-head">
      <ExperienceHub
        legs={legs}
        health={health}
        healthInfo={healthInfo}
        analyst={analyst}
        onSend={(text) => void send(text)}
        onOpenChat={() => setShowAnswer(true)}
        onClose={() => { window.location.href = `${import.meta.env.BASE_URL}`; }}
        onRemoveLeg={removeLeg}
        onClearSlip={clearSlip}
        onSaveSlip={() => void saveSlip()}
        unsavedCount={unsavedCount}
        saveStatus={saveStatus}
      />

      {showAnswer && (streaming || lastPrompt || lastAnswer) ? (
        <aside className="fixed inset-x-3 bottom-3 z-50 mx-auto max-h-[48vh] max-w-2xl overflow-hidden rounded-2xl border border-edge/25 bg-ink/95 shadow-[0_24px_80px_rgba(0,0,0,.65)] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.12em] text-edge">SportsEdge Analyst</p>
              <p className="mt-0.5 truncate text-[9px] text-frost2">{streaming ? lastTool || 'Analyzing…' : lastTool || 'Analysis complete'}</p>
            </div>
            <div className="flex items-center gap-2">
              {streaming ? <span className="h-2 w-2 animate-pulse rounded-full bg-edge" /> : null}
              <button onClick={() => setShowAnswer(false)} className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-frost2 hover:text-head" aria-label="Close analyst result">×</button>
            </div>
          </div>
          <div className="max-h-[calc(48vh-52px)] overflow-y-auto p-4">
            {lastPrompt ? <div className="rounded-xl border border-line bg-panel/60 px-3 py-2.5"><p className="text-[8px] font-black uppercase tracking-wider text-frost2">Asked</p><p className="mt-1 text-xs text-head">{lastPrompt}</p></div> : null}
            <div className="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-frost">
              {lastAnswer || (streaming ? 'Gathering data and validating the recommendation…' : 'The analyst returned structured picks; review the active experience or parlay slip.')}
            </div>
          </div>
        </aside>
      ) : null}
    </main>
  );
}
