import { useState } from 'react';

interface ComposerProps {
  onSend: (text: string) => void;
  streaming: boolean;
}

export default function Composer({ onSend, streaming }: ComposerProps) {
  const [input, setInput] = useState('');

  const submit = () => {
    if (!input.trim() || streaming) return;
    onSend(input);
    setInput('');
  };

  return (
    <form
      className="shrink-0 border-t border-line/70 bg-ink/85 px-4 py-3 backdrop-blur"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          disabled={streaming}
          placeholder={
            streaming ? 'Analyst is working…' : 'Ask about props, parlays, or tonight\u2019s slate…'
          }
          className="max-h-40 min-h-[46px] w-full resize-none rounded-xl border border-line/80 bg-panel2/80 px-4 py-3 text-sm text-head placeholder:text-frost2/70 focus:border-edge/60 focus:outline-none focus:ring-1 focus:ring-edge/30 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={streaming || !input.trim()}
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
    </form>
  );
}
