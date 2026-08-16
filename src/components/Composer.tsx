import { useEffect, useRef, useState } from 'react';
import { MAX_ATTACHMENTS, readAndResizeImage, isImageFile } from '../lib/images';
import {
  createSpeechRecognition,
  mergeDictationTranscript,
  speechRecognitionSupported,
  type BrowserSpeechRecognition,
} from '../lib/speech';

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

    // Web Speech emits its last final result immediately before `onend`. Wait
    // for that lifecycle before snapshotting input so the sent prompt includes
    // the final spoken words. The timeout is a defensive browser fallback.
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
      const next = mergeDictationTranscript(
        inputRef.current,
        dictationTranscriptRef.current,
        transcript,
      );
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
      const dataUrls = await Promise.all(picked.map((f) => readAndResizeImage(f)));
      setAttachments((prev) => [...prev, ...dataUrls].slice(0, MAX_ATTACHMENTS));
    } catch (e) {
      setAttachError(e instanceof Error ? e.message : 'Could not process image.');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <form
      className="shrink-0 border-t border-line/70 bg-ink/85 px-4 py-3 backdrop-blur"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="mx-auto w-full max-w-3xl">
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {attachments.map((src, i) => (
              <div key={i} className="group relative">
                <img
                  src={src}
                  alt={`attachment ${i + 1}`}
                  className="h-16 w-16 rounded-lg border border-line/70 object-cover"
                />
                <button
                  type="button"
                  onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  title="Remove attachment"
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500/90 text-[10px] font-bold text-white opacity-0 shadow transition group-hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            ))}
            <span className="text-[10px] font-semibold uppercase tracking-wider text-frost2">
              {attachments.length}/{MAX_ATTACHMENTS} images attached
            </span>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={streaming || attachments.length >= MAX_ATTACHMENTS}
            title="Attach screenshot"
            className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl border border-line/80 bg-panel2/80 text-frost2 transition hover:border-edge/50 hover:text-edge disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
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
            className={`flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl border transition disabled:cursor-not-allowed disabled:opacity-40 ${
              listening
                ? 'border-danger/70 bg-danger/15 text-danger shadow-[0_0_16px_rgba(248,113,113,0.2)]'
                : 'border-line/80 bg-panel2/80 text-frost2 hover:border-edge/50 hover:text-edge'
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3z" />
              <path d="M19 10v2a7 7 0 01-14 0v-2" />
              <path d="M12 19v3M8 22h8" />
            </svg>
          </button>
          <textarea
            value={input}
            onChange={(e) => {
              inputRef.current = e.target.value;
              setInput(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            disabled={streaming}
            placeholder={
              streaming
                ? 'Analyst is working…'
                : 'Ask about props, parlays, or attach a screenshot…'
            }
            className="max-h-40 min-h-[46px] w-full resize-none rounded-xl border border-line/80 bg-panel2/80 px-4 py-3 text-sm text-head placeholder:text-frost2/70 focus:border-edge/60 focus:outline-none focus:ring-1 focus:ring-edge/30 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!canSend}
            title="Send"
            className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-edge to-edge2 text-ink shadow-[0_0_16px_rgba(21,255,194,0.3)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500 disabled:shadow-none"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M22 2L11 13" />
              <path d="M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          </button>
        </div>
        {attachError && (
          <p className="mt-1.5 text-[11px] font-semibold text-red-400">{attachError}</p>
        )}
        {voiceError && (
          <p role="alert" className="mt-1.5 text-[11px] font-semibold text-red-400">{voiceError}</p>
        )}
        {listening && (
          <p aria-live="polite" className="mt-1.5 text-[11px] font-semibold text-edge">
            Listening… tap the microphone again when you are finished. Your browser may use its speech service; SportsEdge receives only the text you send.
          </p>
        )}
      </div>
    </form>
  );
}
