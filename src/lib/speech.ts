export interface BrowserSpeechRecognitionResultEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

export interface BrowserSpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

export interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: BrowserSpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface BrowserSpeechRecognitionConstructor {
  new (): BrowserSpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  }
}

export function speechRecognitionSupported(): boolean {
  return typeof window !== 'undefined' && Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition);
}

export function createSpeechRecognition(): BrowserSpeechRecognition | null {
  if (typeof window === 'undefined') return null;
  const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  return Recognition ? new Recognition() : null;
}

export function speechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

export function speechFriendlyText(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[`*_#>|~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Merge the browser's cumulative transcript into the current textarea value.
 * SpeechRecognition reports the entire session on every event. Replacing only
 * the previously-rendered transcript preserves text the user typed or edited
 * while the microphone was active.
 */
export function mergeDictationTranscript(
  currentText: string,
  previousTranscript: string,
  nextTranscript: string,
): string {
  const previous = previousTranscript.trim();
  const next = nextTranscript.trim();
  if (!next) return currentText;

  if (!previous) {
    const separator = currentText.length > 0 && !/\s$/.test(currentText) ? ' ' : '';
    return `${currentText}${separator}${next}`;
  }

  const at = currentText.lastIndexOf(previous);
  if (at >= 0) {
    return `${currentText.slice(0, at)}${next}${currentText.slice(at + previous.length)}`;
  }

  // The user edited the prior transcript. Preserve that edit and append only
  // genuinely new recognized words when the browser extended the transcript.
  if (next.startsWith(previous)) {
    const delta = next.slice(previous.length).trimStart();
    if (!delta) return currentText;
    const separator = currentText.length > 0 && !/\s$/.test(currentText) ? ' ' : '';
    return `${currentText}${separator}${delta}`;
  }

  // An interim result was revised after the user edited it. There is no safe
  // segment to replace, so retain the user's text until a later additive event.
  return currentText;
}

/** Split long speech into sentence-sized utterances to avoid browser cut-offs. */
export function chunkSpeechText(text: string, maxChars = 220): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const limit = Math.max(40, Math.floor(maxChars));
  const chunks: string[] = [];
  let remaining = normalized;

  while (remaining.length > limit) {
    const window = remaining.slice(0, limit + 1);
    const sentence = Math.max(
      window.lastIndexOf('. '),
      window.lastIndexOf('! '),
      window.lastIndexOf('? '),
      window.lastIndexOf('; '),
    );
    const whitespace = window.lastIndexOf(' ');
    const cut = sentence >= Math.floor(limit * 0.45) ? sentence + 1 : whitespace > 0 ? whitespace : limit;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
