import type { ToolEvent } from '../types';

function StatusIcon({ status }: { status: ToolEvent['status'] }) {
  if (status === 'running') {
    return <span className="inline-block h-2.5 w-2.5 shrink-0 animate-spin rounded-full border border-edge/25 border-t-edge" />;
  }
  if (status === 'done') {
    return (
      <svg viewBox="0 0 20 20" className="h-3 w-3 shrink-0 text-edge" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 10.5l4 4 8-9" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" className="h-3 w-3 shrink-0 text-danger" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 6l8 8M14 6l-8 8" />
    </svg>
  );
}

/** Compact provenance strip: which live-data tools built this answer. */
export default function ToolChips({ tools }: { tools: ToolEvent[] }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1">
      <span className="mr-1 font-mono text-[9px] uppercase tracking-[0.1em] text-frost2">Research</span>
      {tools.map((tool) => (
        <span
          key={tool.name}
          className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-md border border-line bg-panel px-2"
          title={tool.summary ? `${tool.name}: ${tool.summary}` : `${tool.name}: ${tool.status}`}
        >
          <StatusIcon status={tool.status} />
          <span className="truncate font-mono text-[9px] text-frost">{tool.name}</span>
        </span>
      ))}
    </div>
  );
}
