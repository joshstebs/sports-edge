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
  const announcedRef = useRef('');

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

  const visible = content.replace(
    /```sgp[\s\S]*?```/g,
    '',
  ).replace(
    /\[PREDICTION_LOG\][\s\S]*?(```|$)/g,
    '',
  ).replace(/\n{3,}/g, '\n\n').trim();

  useEffect(() => {
    if (streaming || !visible) return;
    const speechText = speechFriendlyText(visible);
    const key = `${id}:${speechText}`;
    if (!speechText || announcedRef.current === key) return;
    announcedRef.current = key;
    window.dispatchEvent(new CustomEvent('sports-edge:assistant-complete', {
      detail: { id, text: speechText },
    }));
  }, [id, streaming, visible]);

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
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-panel text-edge">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 17l5-5 4 3 6-8" />
          <path d="M14 7h4v4" />
        </svg>
      </div>

      <div className="min-w-0 flex-1 pt-0.5">
        {tools && tools.length > 0 && <ToolChips tools={tools} />}

        {waiting ? (
          <div className="flex h-7 items-center gap-2 text-frost2">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border border-edge/25 border-t-edge" />
            <span className="font-mono text-[10px]">Researching live data…</span>
          </div>
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
            className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-transparent px-2 text-[10px] font-medium text-frost2 hover:bg-panel hover:text-frost focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge/30"
            title={speaking ? 'Stop reading aloud' : 'Read this response aloud'}
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M11 5L6 9H2v6h4l5 4V5z" />
              {speaking ? <path d="M15 9l6 6M21 9l-6 6" /> : <path d="M15.5 8.5a5 5 0 010 7M18 6a8 8 0 010 12" />}
            </svg>
            {speaking ? 'Stop' : 'Read aloud'}
          </button>
        )}

        {sgp && sgp.length > 0 && <SgpPanel legs={sgp} />}
        {error && <ErrorBanner message={error} onRetry={() => onRetry(id)} />}
      </div>
    </div>
  );
}
