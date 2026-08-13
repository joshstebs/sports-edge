interface ErrorBannerProps {
  message: string;
  onRetry: () => void;
}

export default function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5">
      <div className="flex min-w-0 items-start gap-2 text-sm text-danger">
        <svg
          viewBox="0 0 24 24"
          className="mt-0.5 h-4 w-4 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v4M12 15.5v.5" />
        </svg>
        <span className="min-w-0 break-words">{message}</span>
      </div>
      <button
        onClick={onRetry}
        className="shrink-0 rounded-md border border-danger/50 px-3 py-1 text-xs font-bold text-danger transition hover:bg-danger/20"
      >
        Retry
      </button>
    </div>
  );
}
