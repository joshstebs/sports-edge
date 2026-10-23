export default function Logo({
  size = 28,
  wordmark = false,
  heading = false,
  className = '',
}: {
  size?: number;
  wordmark?: boolean;
  heading?: boolean;
  className?: string;
}) {
  const Name = heading ? 'h1' : 'span';
  return (
    <span className={`inline-flex min-w-0 items-center gap-2.5 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 36 36"
        className="logo-mark shrink-0"
        role="img"
        aria-label={wordmark ? undefined : 'SportsEdge'}
        aria-hidden={wordmark ? true : undefined}
      >
        <path
          d="M5.5 10.2 10.4 5.2H25.2L30.8 10.6V25.6L25.4 30.8H10.6L5.5 25.8V10.2Z"
          className="logo-plate"
        />
        <path d="M12 12.2h10" pathLength={1} className="logo-stroke" />
        <path d="M12 18.2h6.2L23.6 12.2H28" pathLength={1} className="logo-stroke logo-stroke-b" />
        <path d="M12 24.2h8" pathLength={1} className="logo-stroke logo-stroke-c" />
        <circle r="1.55" className="logo-node" />
      </svg>
      {wordmark ? (
        <Name className="display truncate text-head">
          Sports<span className="text-edge">Edge</span>
        </Name>
      ) : null}
    </span>
  );
}