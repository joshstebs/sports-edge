/**
 * SportsEdge mark. A heavy E, with the middle arm sheared into a two-facet
 * blade. The blade seats on load, then a glint runs the cutting edge.
 */
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
        viewBox="0 0 64 64"
        className="logo-mark shrink-0"
        role="img"
        aria-label={wordmark ? undefined : 'SportsEdge'}
        aria-hidden={wordmark ? true : undefined}
      >
        <path className="logo-body" d="M8 8h10v48H8z" />
        <path className="logo-body" d="M18 8h10v12H18z" />
        <path className="logo-body" d="M18 46h12v10H18z" />
        <g className="logo-blade">
          <path className="logo-lit" d="M18 26 L62 6 L18 33 Z" />
          <path className="logo-shade" d="M18 33 L62 6 L18 40 Z" />
        </g>
        <path className="logo-sheen" pathLength={1} d="M18 26 L62 6" />
      </svg>
      {wordmark ? (
        <Name className="display truncate text-head">
          Sports<span className="text-edge">Edge</span>
        </Name>
      ) : null}
    </span>
  );
}
