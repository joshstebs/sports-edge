import { useEffect, useRef, useState } from 'react';
import { MAX_ATTACHMENTS, readAndResizeImage, isImageFile } from '../lib/images';
import {
  createSpeechRecognition,
  mergeDictationTranscript,
  speechRecognitionSupported,
  type BrowserSpeechRecognition,
} from '../lib/speech';
import VoiceCall from './VoiceCall';

interface ComposerProps {
  onSend: (text: string, images?: string[]) => void;
  streaming: boolean;
}

export default function Composer({ onSend, streaming }: ComposerProps) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [callOpen, setCallOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const dictationTranscriptRef = useRef('');
  const inputRef = useRef(input);
  const attachmentsRef = useRef(attachments);
  const pendingSubmitRef = useRef(false);
  const submitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSendRef = useRef(onSend);
  const voiceSupported = speechRecognitionSupported();

  useEffect(() => {
    inputRef.current = input;
  }, [input]);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);
  useEffect(() => {
    onSendRef.current = onSend;
  }, [onSend]);
  useEffect(() => () => {
    pendingSubmitRef.current = false;
    if (submitTimerRef.current) clearTimeout(submitTimerRef.current);
    const recognition = recognitionRef.current;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
    }
  }, []);

  const canSend = !streaming && (input.trim().length > 0 || attachments.length > 0);

  const finishSubmit = (abortRecognition = false) => {
    if (!pendingSubmitRef.current) return;
    pendingSubmitRef.current = false;
    if (submitTimerRef.current) {
      clearTimeout(submitTimerRef.current);
      submitTimerRef.current = null;
    }
    const recognition = recognitionRef.current;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognitionRef.current = null;
      if (abortRecognition) recognition.abort();
    }
    setListening(false);

    const text = inputRef.current;
    const images = attachmentsRef.current;
    if (!text.trim() && images.length === 0) return;
    onSendRef.current(text, images);
    inputRef.current = '';
    attachmentsRef.current = [];
    setInput('');
    setAttachments([]);
    setAttachError(null);
  };

  const submit = () => {
    if (!canSend || pendingSubmitRef.current) return;
    const recognition = recognitionRef.current;
    pendingSubmitRef.current = true;
    if (!recognition) {
      finishSubmit();
      return;
    }

    try {
      submitTimerRef.current = setTimeout(() => finishSubmit(true), 1200);
      recognition.stop();
    } catch {
      finishSubmit(true);
    }
  };

  const toggleDictation = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const recognition = createSpeechRecognition();
    if (!recognition) {
      setVoiceError('Voice dictation is not supported by this browser.');
      return;
    }
    dictationTranscriptRef.current = '';
    recognitionRef.current = recognition;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';
    recognition.onresult = (event) => {
      if (recognitionRef.current !== recognition) return;
      let transcript = '';
      for (let index = 0; index < event.results.length; index++) {
        transcript += event.results[index][0]?.transcript ?? '';
      }
      const next = mergeDictationTranscript(inputRef.current, dictationTranscriptRef.current, transcript);
      dictationTranscriptRef.current = transcript.trim();
      inputRef.current = next;
      setInput(next);
    };
    recognition.onerror = (event) => {
      if (recognitionRef.current !== recognition) return;
      setVoiceError(event.error === 'not-allowed'
        ? 'Microphone access was denied. Enable it in your browser settings to use dictation.'
        : `Dictation stopped: ${event.message || event.error}.`);
      setListening(false);
    };
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;
      setListening(false);
      if (pendingSubmitRef.current) finishSubmit();
    };
    setVoiceError(null);
    setListening(true);
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setListening(false);
      setVoiceError('Could not start voice dictation. Please retry.');
    }
  };

  const openCall = () => {
    const recognition = recognitionRef.current;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognitionRef.current = null;
      try { recognition.abort(); } catch { /* already stopped */ }
    }
    setListening(false);
    setVoiceError(null);
    setCallOpen(true);
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setAttachError(null);
    const room = MAX_ATTACHMENTS - attachments.length;
    const picked = Array.from(files).filter(isImageFile).slice(0, room);
    if (picked.length === 0) {
      setAttachError('Only image files can be attached.');
      return;
    }
    try {
      const dataUrls = await Promise.all(picked.map((file) => readAndResizeImage(file)));
      setAttachments((prev) => [...prev, ...dataUrls].slice(0, MAX_ATTACHMENTS));
    } catch (error) {
      setAttachError(error instanceof Error ? error.message : 'Could not process image.');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <form
      className="shrink-0 border-t border-line bg-ink/95 px-3 py-3 sm:px-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="mx-auto w-full max-w-3xl">
        <div className="overflow-hidden rounded-xl border border-line-strong bg-panel shadow-[0_14px_38px_rgba(0,0,0,0.22)] focus-within:border-edge/40 focus-within:ring-1 focus-within:ring-edge/15">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => handleFiles(event.target.files)}
          />

          {attachments.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 pt-3 pb-2.5">
              {attachments.map((src, index) => (
                <div key={index} className="group relative">
                  <img src={src} alt={`attachment ${index + 1}`} className="h-14 w-14 rounded-md border border-line object-cover" />
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                    title="Remove attachment"
                    aria-label={`Remove attachment ${index + 1}`}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-line-strong bg-panel2 text-[10px] font-bold text-frost opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                  >
                    ×
                  </button>
                </div>
              ))}
              <span className="font-mono text-[9px] text-frost2">{attachments.length}/{MAX_ATTACHMENTS} attached</span>
            </div>
          )}

          <textarea
            value={input}
            onChange={(event) => {
              inputRef.current = event.target.value;
              setInput(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={1}
            disabled={streaming}
            placeholder={streaming ? 'Analyst is checking live data…' : 'Ask about a prop, matchup, parlay, or paste a bet slip…'}
            className="max-h-40 min-h-[58px] w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[13px] leading-5 text-head outline-none placeholder:text-frost2/65 disabled:cursor-not-allowed disabled:opacity-60"
          />

          <div className="flex min-h-11 items-center gap-1 border-t border-line px-2 py-1.5">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={streaming || attachments.length >= MAX_ATTACHMENTS}
              title="Attach screenshot"
              aria-label="Attach screenshot"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-frost2 hover:bg-panel2 hover:text-frost disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <button
              type="button"
              onClick={toggleDictation}
              disabled={streaming || !voiceSupported}
              aria-pressed={listening}
              aria-label={listening ? 'Stop voice dictation' : 'Start voice dictation'}
              title={voiceSupported ? (listening ? 'Stop dictation' : 'Dictate with your microphone') : 'Voice dictation is not supported in this browser'}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md disabled:cursor-not-allowed disabled:opacity-40 ${listening ? 'bg-danger/10 text-danger' : 'text-frost2 hover:bg-panel2 hover:text-frost'}`}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3z" />
                <path d="M19 10v2a7 7 0 01-14 0v-2" />
                <path d="M12 19v3M8 22h8" />
              </svg>
            </button>
            <button
              type="button"
              onClick={openCall}
              disabled={!voiceSupported}
              title={voiceSupported ? 'Start continuous Call mode' : 'Continuous voice is not supported in this browser'}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[10px] font-medium text-frost2 hover:bg-panel2 hover:text-frost disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.12.9.33 1.78.62 2.63a2 2 0 01-.45 2.11L8 9.73a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0122 16.92z" />
              </svg>
              <span className="hidden sm:inline">Call</span>
            </button>

            <span className="ml-auto hidden font-mono text-[9px] text-frost2/70 sm:inline">Enter to send</span>
            <button
              type="submit"
              disabled={!canSend}
              title="Send"
              aria-label="Send message"
              className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-edge text-ink hover:brightness-105 disabled:cursor-not-allowed disabled:bg-panel2 disabled:text-frost2"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </div>
        </div>

        {attachError && <p className="mt-1.5 text-[10px] font-medium text-danger">{attachError}</p>}
        {voiceError && <p role="alert" className="mt-1.5 text-[10px] font-medium text-danger">{voiceError}</p>}
        {listening && (
          <p aria-live="polite" className="mt-1.5 flex items-center gap-1.5 text-[10px] font-medium text-frost2">
            <span className="h-1.5 w-1.5 rounded-full bg-danger" />
            Listening - tap the microphone when you are finished.
          </p>
        )}
      </div>

      {callOpen && (
        <VoiceCall
          streaming={streaming}
          onSend={(text) => onSendRef.current(text)}
          onClose={() => setCallOpen(false)}
        />
      )}
    </form>
  );
}
