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
    for (let i = 0; i < localStorage.length; i++) {
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
    try {
      await streamChat({ messages: [{ role: 'user', content: prompt }], sport: null }, {
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'sgp') setLegs((prev) => mergeSgpLegs(prev, event.legs));
        },
      });
    } catch (error) {
      setSaveStatus({ state: 'error', message: error instanceof Error ? error.message : 'Analyst request failed.' });
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

  return (
    <main className="flex h-full flex-col bg-ink text-head">
      {streaming ? (
        <div className="fixed right-3 top-3 z-50 rounded-full border border-edge/30 bg-ink/90 px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-edge shadow-xl backdrop-blur">Analyst working…</div>
      ) : null}
      <ExperienceHub
        legs={legs}
        health={health}
        healthInfo={healthInfo}
        onSend={(text) => void send(text)}
        onOpenChat={() => undefined}
        onClose={() => { window.location.href = `${import.meta.env.BASE_URL}`; }}
        onRemoveLeg={removeLeg}
        onClearSlip={clearSlip}
        onSaveSlip={() => void saveSlip()}
        unsavedCount={unsavedCount}
        saveStatus={saveStatus}
      />
    </main>
  );
}
