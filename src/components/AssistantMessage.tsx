import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { chunkSpeechText, speechFriendlyText, speechSynthesisSupported } from '../lib/speech';
import type { ChatMessage } from '../types';
import ErrorBanner from './ErrorBanner';
import SgpPanel from './SgpPanel';
import ToolChips from './ToolChips';

interface AssistantMessageProps {
  message: ChatMessage;
  onRetry: (assistantId: string) => void;
}

export default function AssistantMessage({ message, onRetry }: AssistantMessageProps) {
  const { content, streaming, tools, sgp, error, id } = message;
  const waiting = Boolean(streaming) && content.length === 0;
  const [speaking, setSpeaking] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speechSessionRef = useRef(0);

  useEffect(() => {
    const onSpeechOwner = (event: Event) => {
      const owner = (event as CustomEvent<string>).detail;
      if (owner === id) return;
      speechSessionRef.current += 1;
      utteranceRef.current = null;
      setSpeaking(false);
    };
    window.addEventListener('sports-edge:speech-owner', onSpeechOwner);
    return () => {
      window.removeEventListener('sports-edge:speech-owner', onSpeechOwner);
      speechSessionRef.current += 1;
      if (utteranceRef.current) window.speechSynthesis.cancel();
      utteranceRef.current = null;
    };
  }, [id]);

  // Strip internal protocol blocks from the user-facing markdown:
  // [PREDICTION_LOG] JSON and raw ```sgp fences are consumed by the backend
  // (learning loop / slip) — users never need to see the raw payloads.
  const visible = content.replace(
    /```sgp[\s\S]*?```/g,
    '',
  ).replace(
    /\[PREDICTION_LOG\][\s\S]*?(```|$)/g,
    '',
  ).replace(/\n{3,}/g, '\n\n').trim();

  const toggleSpeech = () => {
    if (!speechSynthesisSupported()) return;
    if (speaking) {
      speechSessionRef.current += 1;
      window.speechSynthesis.cancel();
      utteranceRef.current = null;
      setSpeaking(false);
      return;
    }
    const chunks = chunkSpeechText(speechFriendlyText(visible));
    if (!chunks.length) return;
    const session = speechSessionRef.current + 1;
    speechSessionRef.current = session;
    window.speechSynthesis.cancel();
    window.dispatchEvent(new CustomEvent('sports-edge:speech-owner', { detail: id }));

    const speakChunk = (index: number) => {
      if (speechSessionRef.current !== session) return;
      if (index >= chunks.length) {
        utteranceRef.current = null;
        setSpeaking(false);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      utterance.lang = navigator.language || 'en-US';
      utterance.rate = 1;
      utterance.onend = () => {
        if (speechSessionRef.current === session) speakChunk(index + 1);
      };
      utterance.onerror = () => {
        if (speechSessionRef.current !== session) return;
        utteranceRef.current = null;
        setSpeaking(false);
      };
      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    };
    setSpeaking(true);
    speakChunk(0);
  };

  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-edge/25 to-aqua/20 ring-1 ring-edge/25">
        <svg
          viewBox="0 0 24 24"
          className="h-[18px] w-[18px] text-edge"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M13 2L4.09 12.69a1 1 0 00.83 1.64H11l-1 7.67 8.91-10.69a1 1 0 00-.83-1.64H13l1-7.67z" />
        </svg>
      </div>

      <div className="min-w-0 flex-1 pt-1">
        {tools && tools.length > 0 && <ToolChips tools={tools} />}

        {waiting ? (
          <span className="flex items-center gap-1.5 py-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-2 w-2 animate-bounce rounded-full bg-edge/70"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </span>
        ) : visible ? (
          <div className="md-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{visible}</ReactMarkdown>
            {streaming && <span className="cursor-blink" aria-hidden="true" />}
          </div>
        ) : null}

        {visible && !streaming && speechSynthesisSupported() && (
          <button
            type="button"
            onClick={toggleSpeech}
            aria-pressed={speaking}
            className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-line/70 bg-panel2/60 px-2.5 py-1 text-[10px] font-semibold text-frost2 transition hover:border-edge/50 hover:text-edge focus:outline-none focus:ring-2 focus:ring-edge/30"
            title={speaking ? 'Stop reading aloud' : 'Read this response aloud'}
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M11 5L6 9H2v6h4l5 4V5z" />
              {speaking ? <path d="M15 9l6 6M21 9l-6 6" /> : <path d="M15.5 8.5a5 5 0 010 7M18 6a8 8 0 010 12" />}
            </svg>
            {speaking ? 'Stop voice' : 'Read aloud'}
          </button>
        )}

        {sgp && sgp.length > 0 && <SgpPanel legs={sgp} />}
        {error && <ErrorBanner message={error} onRetry={() => onRetry(id)} />}
      </div>
    </div>
  );
}
