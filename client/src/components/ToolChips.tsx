import type { ToolEvent } from '../types';

function StatusIcon({ status }: { status: ToolEvent['status'] }) {
  if (status === 'running') {
    return (
      <span className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-[1.5px] border-edge/30 border-t-edge" />
    );
  }
  if (status === 'done') {
    return (
      <svg
        viewBox="0 0 20 20"
        className="h-3 w-3 shrink-0 text-edge"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 10.5l4 4 8-9" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-3 w-3 shrink-0 text-danger"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 6l8 8M14 6l-8 8" />
    </svg>
  );
}

/** Per-message provenance strip: which data-source tools ran to build this answer. */
export default function ToolChips({ tools }: { tools: ToolEvent[] }) {
  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
      {tools.map((t) => (
        <span
          key={t.name}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line/70 bg-panel2/70 px-2.5 py-1 backdrop-blur"
          title={`${t.name}: ${t.status}`}
        >
          <StatusIcon status={t.status} />
          <span className="truncate font-mono text-[11px] text-frost">{t.name}</span>
          {t.summary && <span className="truncate text-[11px] text-frost2">· {t.summary}</span>}
        </span>
      ))}
    </div>
  );
}
