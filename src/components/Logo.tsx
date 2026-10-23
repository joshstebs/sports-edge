import { useId } from 'react';

/**
 * SportsEdge mark. A heavy E, with the middle arm sheared into a two-facet
 * blade. The blade seats on load, a mint halo rests under the edge, and a
 * glint runs the cutting edge.
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
  const glowId = `se-glow-${useId().replace(/:/g, '')}`;
  const edge = 'M18 26 L62 6 L18 33 Z';
  return (
    <span className={`inline-flex min-w-0 items-center gap-2.5 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        className="logo-mark shrink-0"
        overflow="visible"
        role="img"
        aria-label={wordmark ? undefined : 'SportsEdge'}
        aria-hidden={wordmark ? true : undefined}
      >
        <defs>
          <filter id={glowId} x="-60%" y="-60%" width="220%" height="220%" colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation="4.5" />
          </filter>
        </defs>
        <path className="logo-body" d="M8 8h10v48H8z" />
        <path className="logo-body" d="M18 8h10v12H18z" />
        <path className="logo-body" d="M18 46h12v10H18z" />
        <g className="logo-blade">
          <path className="logo-glow" filter={`url(#${glowId})`} d={edge} />
          <path className="logo-lit" d={edge} />
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
