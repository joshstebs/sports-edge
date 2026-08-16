import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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

        {sgp && sgp.length > 0 && <SgpPanel legs={sgp} />}
        {error && <ErrorBanner message={error} onRetry={() => onRetry(id)} />}
      </div>
    </div>
  );
}
