import { useCallback, useEffect, useRef, useState } from 'react';
import {
  chunkSpeechText,
  createSpeechRecognition,
  speechRecognitionSupported,
  speechSynthesisSupported,
  type BrowserSpeechRecognition,
} from '../lib/speech';

type CallPhase = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';

interface VoiceCallProps {
  streaming: boolean;
  onSend: (text: string) => void;
  onClose: () => void;
}

interface AssistantCompleteDetail {
  id: string;
  text: string;
}

function phaseLabel(phase: CallPhase): string {
  if (phase === 'listening') return 'Listening';
  if (phase === 'thinking') return 'Checking live data';
  if (phase === 'speaking') return 'Speaking';
  if (phase === 'error') return 'Voice unavailable';
  return 'Connecting';
}

function phaseCopy(phase: CallPhase, error: string | null): string {
  if (phase === 'listening') return 'Ask naturally. SportsEdge sends the final phrase through the same grounded analyst used by chat.';
  if (phase === 'thinking') return 'Verifying live sources, availability, current odds and model evidence.';
  if (phase === 'speaking') return 'The validated answer is being read aloud. Interrupt at any time.';
  if (phase === 'error') return error ?? 'Voice is unavailable.';
  return 'Starting microphone access…';
}

export default function VoiceCall({ streaming, onSend, onClose }: VoiceCallProps) {
  const [phase, setPhase] = useState<CallPhase>('connecting');
  const [muted, setMuted] = useState(false);
  const [lastHeard, setLastHeard] = useState('');
  const [lastAnswer, setLastAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const mountedRef = useRef(true);
  const streamingRef = useRef(streaming);
  const awaitingResponseRef = useRef(false);
  const speakingRef = useRef(false);
  const mutedRef = useRef(muted);
  const onSendRef = useRef(onSend);
  const speechSessionRef = useRef(0);

  useEffect(() => {
    streamingRef.current = streaming;
  }, [streaming]);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  useEffect(() => {
    onSendRef.current = onSend;
  }, [onSend]);

  const stopRecognition = useCallback((abort = true) => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try {
      if (abort) recognition.abort();
      else recognition.stop();
    } catch {
      // Browser speech implementations may throw when already stopped.
    }
  }, []);

  const startListening = useCallback(() => {
    if (!mountedRef.current || streamingRef.current || awaitingResponseRef.current || speakingRef.current) return;
    if (recognitionRef.current) return;
    const recognition = createSpeechRecognition();
    if (!recognition) {
      setPhase('error');
      setError('Continuous voice is not supported by this browser. Use Chrome or Edge, or keep using the normal chat microphone.');
      return;
    }

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';
    recognitionRef.current = recognition;
    setError(null);
    setPhase('listening');

    recognition.onresult = (event) => {
      if (recognitionRef.current !== recognition) return;
      let interim = '';
      let finalText = '';
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        const text = result?.[0]?.transcript ?? '';
        if (result?.isFinal) finalText += text;
        else interim += text;
      }
      const preview = (finalText || interim).trim();
      if (preview) setLastHeard(preview);
      if (!finalText.trim()) return;

      awaitingResponseRef.current = true;
      setPhase('thinking');
      stopRecognition(false);
      onSendRef.current(finalText.trim());
    };

    recognition.onerror = (event) => {
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;
      if (event.error === 'aborted' || event.error === 'no-speech') {
        if (!awaitingResponseRef.current && !streamingRef.current && mountedRef.current) {
          window.setTimeout(startListening, 180);
        }
        return;
      }
      setPhase('error');
      setError(event.error === 'not-allowed'
        ? 'Microphone access was denied. Allow microphone access and reopen Call mode.'
        : `Voice recognition stopped: ${event.message || event.error}.`);
    };

    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      if (!mountedRef.current || awaitingResponseRef.current || streamingRef.current || speakingRef.current) return;
      window.setTimeout(startListening, 180);
    };

    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setPhase('error');
      setError('Could not start the microphone. Close Call mode and retry.');
    }
  }, [stopRecognition]);

  const finishSpeaking = useCallback(() => {
    speakingRef.current = false;
    awaitingResponseRef.current = false;
    if (!mountedRef.current) return;
    setPhase('listening');
    window.setTimeout(startListening, 120);
  }, [startListening]);

  const speak = useCallback((text: string) => {
    const clean = text.trim();
    setLastAnswer(clean);
    awaitingResponseRef.current = false;
    if (!clean || mutedRef.current || !speechSynthesisSupported()) {
      finishSpeaking();
      return;
    }

    stopRecognition(true);
    speechSessionRef.current += 1;
    const session = speechSessionRef.current;
    speakingRef.current = true;
    setPhase('speaking');
    window.speechSynthesis.cancel();
    window.dispatchEvent(new CustomEvent('sports-edge:speech-owner', { detail: 'voice-call' }));
    const chunks = chunkSpeechText(clean, 210);

    const next = (index: number) => {
      if (!mountedRef.current || speechSessionRef.current !== session) return;
      if (index >= chunks.length) {
        finishSpeaking();
        return;
      }
      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      utterance.lang = navigator.language || 'en-US';
      utterance.rate = 1.03;
      utterance.onend = () => next(index + 1);
      utterance.onerror = () => finishSpeaking();
      window.speechSynthesis.speak(utterance);
    };
    next(0);
  }, [finishSpeaking, stopRecognition]);

  const interrupt = useCallback(() => {
    speechSessionRef.current += 1;
    speakingRef.current = false;
    awaitingResponseRef.current = false;
    if (speechSynthesisSupported()) window.speechSynthesis.cancel();
    setPhase('listening');
    startListening();
  }, [startListening]);

  useEffect(() => {
    if (streaming) {
      awaitingResponseRef.current = true;
      setPhase('thinking');
      stopRecognition(true);
    }
  }, [streaming, stopRecognition]);

  useEffect(() => {
    const onAssistantComplete = (event: Event) => {
      const detail = (event as CustomEvent<AssistantCompleteDetail>).detail;
      if (!detail?.text || !awaitingResponseRef.current) return;
      speak(detail.text);
    };
    window.addEventListener('sports-edge:assistant-complete', onAssistantComplete);
    return () => window.removeEventListener('sports-edge:assistant-complete', onAssistantComplete);
  }, [speak]);

  useEffect(() => {
    mountedRef.current = true;
    if (!speechRecognitionSupported()) {
      setPhase('error');
      setError('Continuous voice is not supported by this browser. Use Chrome or Edge.');
    } else {
      startListening();
    }
    return () => {
      mountedRef.current = false;
      speechSessionRef.current += 1;
      stopRecognition(true);
      if (speechSynthesisSupported()) window.speechSynthesis.cancel();
    };
  }, [startListening, stopRecognition]);

  const statusColor = phase === 'error' ? 'bg-danger' : phase === 'thinking' ? 'bg-aqua' : 'bg-edge';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-3 py-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="SportsEdge voice call">
      <div className="flex h-full max-h-[620px] w-full max-w-md flex-col overflow-hidden rounded-xl border border-line-strong bg-ink shadow-[0_24px_90px_rgba(0,0,0,0.6)]">
        <div className="flex h-12 items-center justify-between border-b border-line px-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md border border-edge/20 bg-edge/10 text-edge">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 17l5-5 4 3 6-8" />
                <path d="M14 7h4v4" />
              </svg>
            </div>
            <div>
              <p className="text-[12px] font-semibold leading-none text-head">SportsEdge Call</p>
              <p className="mt-1 font-mono text-[9px] text-frost2">grounded voice session</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-md text-frost2 hover:bg-panel2 hover:text-head" title="End call" aria-label="End call">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="border-b border-line bg-panel/45 px-4 py-3.5">
          <div className="flex items-center gap-2">
            {phase === 'thinking' ? (
              <span className="h-3 w-3 animate-spin rounded-full border border-aqua/25 border-t-aqua" />
            ) : (
              <span className={`h-2 w-2 rounded-full ${statusColor}`} />
            )}
            <span className="text-[12px] font-semibold text-head">{phaseLabel(phase)}</span>
          </div>
          <p className="mt-1.5 text-[11px] leading-[1.55] text-frost2">{phaseCopy(phase, error)}</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
          {!lastHeard && !lastAnswer ? (
            <div className="flex h-full min-h-48 items-center justify-center text-center">
              <div className="max-w-xs">
                <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-frost2">Conversation</p>
                <p className="mt-2 text-[12px] leading-relaxed text-frost">Your transcript and the latest validated answer will appear here while the call stays active.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {lastHeard && (
                <div className="ml-8 rounded-lg border border-line bg-panel2 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-frost2">You</p>
                    <span className="font-mono text-[8px] text-frost2/60">transcript</span>
                  </div>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-head">{lastHeard}</p>
                </div>
              )}
              {lastAnswer && (
                <div className="mr-5 rounded-lg border border-line bg-panel px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-edge">SportsEdge</p>
                    <span className="font-mono text-[8px] text-frost2/60">verified response</span>
                  </div>
                  <p className="mt-1.5 line-clamp-6 text-[12px] leading-relaxed text-frost">{lastAnswer}</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-line bg-panel/35 px-3.5 py-3">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setMuted((value) => !value)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-panel px-3 text-[10px] font-medium text-frost hover:border-line-strong hover:bg-panel2">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 5L6 9H2v6h4l5 4V5z" />{muted ? <path d="M15 9l6 6M21 9l-6 6" /> : <path d="M15.5 8.5a5 5 0 010 7" />}</svg>
              {muted ? 'Unmute' : 'Mute'}
            </button>
            {phase === 'speaking' && (
              <button type="button" onClick={interrupt} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-edge/25 bg-edge/10 px-3 text-[10px] font-medium text-edge hover:bg-edge/15">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg>
                Interrupt
              </button>
            )}
            <button type="button" onClick={onClose} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-md bg-danger px-3 text-[10px] font-semibold text-white hover:brightness-105">
              End call
            </button>
          </div>
          <p className="mt-2 text-[9px] leading-relaxed text-frost2/65">AI-generated analysis. Browser speech services may process microphone audio; SportsEdge receives the transcribed text you send.</p>
        </div>
      </div>
    </div>
  );
}
