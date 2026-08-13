// Static MLB ballpark factors — public-data table (3-year park factors).
// LABELED approximate; values are commonly published 3-yr park factor figures.

export interface ParkFactor {
  venue: string;
  hrFactor: number;
  runsFactor: number;
}

export const PARK_FACTORS: ParkFactor[] = [
  { venue: 'Coors Field', hrFactor: 1.35, runsFactor: 1.28 },
  { venue: 'Great American Ball Park', hrFactor: 1.28, runsFactor: 1.1 },
  { venue: 'Yankee Stadium', hrFactor: 1.2, runsFactor: 1.01 },
  { venue: 'Citizens Bank Park', hrFactor: 1.16, runsFactor: 1.11 },
  { venue: 'Camden Yards', hrFactor: 1.15, runsFactor: 1.02 },
  { venue: 'Angel Stadium', hrFactor: 1.13, runsFactor: 1.03 },
  { venue: 'Guaranteed Rate Field', hrFactor: 1.12, runsFactor: 1.05 },
  { venue: 'Dodger Stadium', hrFactor: 1.1, runsFactor: 1.03 },
  { venue: 'American Family Field', hrFactor: 1.1, runsFactor: 1.05 },
  { venue: 'Globe Life Field', hrFactor: 1.1, runsFactor: 1.08 },
  { venue: 'Truist Park', hrFactor: 1.06, runsFactor: 1.06 },
  { venue: 'Rogers Centre', hrFactor: 1.05, runsFactor: 1.04 },
  { venue: 'Wrigley Field', hrFactor: 1.05, runsFactor: 1.03 },
  { venue: 'Citi Field', hrFactor: 1.05, runsFactor: 1.0 },
  { venue: 'Chase Field', hrFactor: 1.04, runsFactor: 1.02 },
  { venue: 'Minute Maid Park', hrFactor: 1.04, runsFactor: 1.01 },
  { venue: 'Target Field', hrFactor: 1.04, runsFactor: 1.0 },
  { venue: 'Comerica Park', hrFactor: 1.02, runsFactor: 0.98 },
  { venue: 'Fenway Park', hrFactor: 1.02, runsFactor: 1.06 },
  { venue: 'Progressive Field', hrFactor: 1.02, runsFactor: 1.0 },
  { venue: 'Nationals Park', hrFactor: 1.01, runsFactor: 0.99 },
  { venue: 'Busch Stadium', hrFactor: 0.96, runsFactor: 0.97 },
  { venue: 'Tropicana Field', hrFactor: 0.95, runsFactor: 0.96 },
  { venue: 'PNC Park', hrFactor: 0.94, runsFactor: 0.97 },
  { venue: 'Oakland Coliseum', hrFactor: 0.94, runsFactor: 0.96 },
  { venue: 'Petco Park', hrFactor: 0.92, runsFactor: 0.95 },
  { venue: 'LoanDepot Park', hrFactor: 0.91, runsFactor: 0.97 },
  { venue: 'Kauffman Stadium', hrFactor: 0.9, runsFactor: 0.96 },
  { venue: 'T-Mobile Park', hrFactor: 0.87, runsFactor: 0.92 },
  { venue: 'Oracle Park', hrFactor: 0.85, runsFactor: 0.94 },
];

export function getParkFactor(venue?: string | null): ParkFactor | null {
  if (!venue) return null;
  const v = venue.trim().toLowerCase();
  return (
    PARK_FACTORS.find((p) => p.venue.toLowerCase() === v) ??
    PARK_FACTORS.find((p) => p.venue.toLowerCase().includes(v) || v.includes(p.venue.toLowerCase())) ??
    null
  );
}
